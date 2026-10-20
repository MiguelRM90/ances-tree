import { expect } from '@open-wc/testing';
import { ZipWriter } from '../src/storage/zip/write.js';
import { openArchive, ZipError } from '../src/storage/zip/read.js';
import { parseProject } from '../src/domain/model/schema.js';
import { importGedcom } from '../src/domain/gedcom/import.js';
import { buildIndexes } from '../src/domain/graph/indexes.js';
import { validateAll } from '../src/domain/validation/engine.js';
import { createMediaObject, mediaLink, MediaRole } from '../src/domain/model/factories.js';
import { store } from '../src/store/store.js';
import * as actions from '../src/store/actions.js';
import { createBrowserFolder, removeBrowserFolder } from '../src/storage/opfs.js';
import { person, project } from './fixtures/families.js';
import '../src/ui/components/app-root.js';

function collector() {
  const chunks = [];
  return {
    stream: new WritableStream({ write: (chunk) => void chunks.push(chunk) }),
    bytes: async () => new Uint8Array(await new Blob(chunks).arrayBuffer()),
  };
}

const encode = (text) => new TextEncoder().encode(text);

describe('Phase 2 — Security against external files', function () {
  this.timeout(15_000);

  let folder = null;

  beforeEach(async () => {
    folder = await createBrowserFolder('Security test');
  });

  afterEach(async () => {
    store.close();
    if (folder) await removeBrowserFolder(folder.name).catch(() => {});
  });

  it('2.1 aborts decompression when actual unzipped bytes exceed the limit (spoofed ZIP header)', async () => {
    // Create a valid compressed ZIP entry of 10,000 bytes
    const sink = collector();
    const zip = new ZipWriter(sink.stream);
    await zip.addBytes('family.json', encode('A'.repeat(10_000)));
    await zip.close();

    const rawZip = await sink.bytes();
    const view = new DataView(rawZip.buffer);

    // Spoof the uncompressedSize in both Local Header (offset 22) and Central Directory
    // so the archive claims to be only 50 bytes while actually decompressing to 10,000 bytes.
    view.setUint32(22, 50, true);
    for (let i = 0; i < rawZip.length - 4; i += 1) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 50, true);
      }
    }

    const archive = await openArchive(new Blob([rawZip]));
    expect(archive.totalBytes).to.equal(50, 'spoofed header claims 50 bytes');

    let caught = null;
    try {
      await archive.bytes(archive.entries[0], { maxBytes: 1_000 });
    } catch (error) {
      caught = error;
    }

    expect(caught).to.be.instanceOf(ZipError);
    expect(caught.code).to.equal('TOO_LARGE');
  });

  it('2.2 rejects or sanitizes unsafe media paths in family.json and GEDCOM', () => {
    const rawJson = JSON.stringify({
      schemaVersion: 1,
      persons: [],
      unions: [],
      parentChildren: [],
      media: [
        { id: 'm1', kind: 'PHOTO', path: '../../etc/passwd', links: [] },
        { id: 'm2', kind: 'PHOTO', path: '/absolute/path.jpg', links: [] },
        { id: 'm3', kind: 'PHOTO', path: 'backups/family-2026.json', links: [] },
        { id: 'm4', kind: 'PHOTO', path: 'photos/a3/valid.jpg', links: [] },
      ],
    });

    const parsed = parseProject(rawJson);
    expect(parsed.ok).to.equal(true);
    expect(parsed.data.media.find((m) => m.id === 'm1').path).to.equal('');
    expect(parsed.data.media.find((m) => m.id === 'm2').path).to.equal('');
    expect(parsed.data.media.find((m) => m.id === 'm3').path).to.equal('');
    expect(parsed.data.media.find((m) => m.id === 'm4').path).to.equal('photos/a3/valid.jpg');

    const gedcomText = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 5.5.1',
      '0 @I1@ INDI',
      '1 NAME Juan /Perez/',
      '1 OBJE @O1@',
      '1 OBJE @O2@',
      '0 @O1@ OBJE',
      '1 FILE ../../../secret.pdf',
      '2 FORM pdf',
      '0 @O2@ OBJE',
      '1 FILE photos/a3/portrait.jpg',
      '2 FORM jpg',
      '0 TRLR',
    ].join('\n');

    const imported = importGedcom(gedcomText);
    expect(imported.project.media.map((m) => m.path)).to.eql(['photos/a3/portrait.jpg']);
  });

  it('2.3 sanitizes malformed media.links entries in normalizeMedia', () => {
    const rawJson = JSON.stringify({
      schemaVersion: 1,
      persons: [{ id: 'p1', firstName: 'Ana' }],
      unions: [],
      parentChildren: [],
      media: [
        {
          id: 'm1',
          kind: 'PHOTO',
          path: 'photos/a3/valid.jpg',
          links: [
            null,
            'not-an-object',
            { targetId: '' },
            { targetType: 'person', targetId: 123, role: 'INVALID_ROLE' },
            { targetType: 'person', targetId: 'p1', role: 'PORTRAIT' },
          ],
        },
      ],
    });

    const parsed = parseProject(rawJson);
    expect(parsed.ok).to.equal(true);
    const links = parsed.data.media[0].links;
    expect(links).to.eql([
      { targetType: 'person', targetId: '123', role: MediaRole.ATTACHMENT },
      { targetType: 'person', targetId: 'p1', role: MediaRole.PORTRAIT },
    ]);

    // And buildIndexes does not throw on it
    expect(() => buildIndexes(parsed.data)).to.not.throw();
  });

  it('2.4 cleans up media links when deleting a person and flags dangling media links in validation', async () => {
    const a = person('Alice');
    const b = person('Bob');
    const soloMedia = createMediaObject({
      path: 'photos/aa/solo.jpg',
      hash: 'aa',
      mime: 'image/jpeg',
      bytes: 100,
      links: [mediaLink(a.id, MediaRole.PORTRAIT)],
    });
    const sharedMedia = createMediaObject({
      path: 'photos/bb/shared.jpg',
      hash: 'bb',
      mime: 'image/jpeg',
      bytes: 100,
      links: [mediaLink(a.id, MediaRole.ATTACHMENT), mediaLink(b.id, MediaRole.ATTACHMENT)],
    });

    await store.adoptNew(project({ persons: [a, b], media: [soloMedia, sharedMedia] }), folder);

    actions.removeEntity('person', a.id);

    // soloMedia had only Alice, so it is removed; sharedMedia keeps only Bob
    expect(store.project.media).to.have.lengthOf(1);
    expect(store.project.media[0].id).to.equal(sharedMedia.id);
    expect(store.project.media[0].links.map((l) => l.targetId)).to.eql([b.id]);

    // And if an external project arrives with a dangling media link, structural validation flags it
    const withDanglingMedia = project({
      persons: [b],
      media: [
        createMediaObject({
          path: 'photos/cc/ghost.jpg',
          hash: 'cc',
          mime: 'image/jpeg',
          bytes: 100,
          links: [mediaLink('missing-person-id', MediaRole.ATTACHMENT)],
        }),
      ],
    });
    const issues = validateAll(buildIndexes(withDanglingMedia));
    expect(issues.map((i) => i.ruleId)).to.include('DANGLING_REF');
  });

  it('2.5 restricts relation:change events in app-root to an explicit allowlist of relation actions', () => {
    const root = document.createElement('app-root');
    document.body.append(root);

    try {
      const a = person('Alice');
      store.close();
      // Even if a project is open, dispatching a non-relation action like deleteBrowserProject
      // or newProject through relation:change must be ignored.
      let called = false;
      const realDelete = window.showDirectoryPicker;
      window.showDirectoryPicker = () => {
        called = true;
        return Promise.reject(new Error('Should not be called'));
      };

      try {
        root.dispatchEvent(
          new CustomEvent('relation:change', {
            detail: { action: 'openProject', args: [] },
            bubbles: true,
            composed: true,
          }),
        );
        expect(called).to.equal(false);
      } finally {
        window.showDirectoryPicker = realDelete;
      }
      expect(a.firstName).to.equal('Alice');
    } finally {
      root.remove();
    }
  });
});
