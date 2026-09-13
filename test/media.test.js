import { expect } from '@open-wc/testing';
import { detectImageType, readExifDate, sha256Hex } from '../src/storage/media.js';
import { avatarKindFor, avatarSvg } from '../src/ui/avatars.js';
import { portraitOf, mediaOf } from '../src/domain/graph/queries.js';
import { buildIndexes } from '../src/domain/graph/indexes.js';
import {
  createMediaObject,
  createPlaceholder,
  mediaLink,
  MediaRole,
  Sex,
} from '../src/domain/model/factories.js';
import { person, project } from './fixtures/families.js';

const blobOf = (bytes) => new Blob([new Uint8Array(bytes)]);

// Real leading bytes of each format, which is what the detector reads.
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

describe('image type detection', () => {
  it('recognises the formats it accepts', async () => {
    expect(await detectImageType(blobOf(JPEG))).to.include({ mime: 'image/jpeg', ext: 'jpg' });
    expect(await detectImageType(blobOf(PNG))).to.include({ mime: 'image/png', ext: 'png' });
    expect(await detectImageType(blobOf(WEBP))).to.include({ mime: 'image/webp', ext: 'webp' });
  });

  // The extension and file.type are both supplied by whoever made the file,
  // so neither counts as evidence of anything.
  it('is not fooled by the name or the declared type', async () => {
    const liar = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], 'holiday.jpg', {
      type: 'image/jpeg',
    });
    expect(await detectImageType(liar)).to.equal(null);
  });

  it('rejects an empty or truncated file', async () => {
    expect(await detectImageType(blobOf([]))).to.equal(null);
    expect(await detectImageType(blobOf([0xff]))).to.equal(null);
  });

  it('rejects a RIFF container that is not WebP', async () => {
    const avi = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20];
    expect(await detectImageType(blobOf(avi))).to.equal(null);
  });
});

describe('EXIF capture date', () => {
  /** A JPEG carrying just enough of an APP1 block to hold one date tag. */
  function jpegWithDate(text) {
    const ascii = [...text].map((c) => c.charCodeAt(0)).concat(0);

    // TIFF: little endian, IFD0 at offset 8, one entry: DateTime (0x0132).
    // Layout: 8 header + 2 count + 12 entry + 4 next-IFD pointer = data at 26.
    const tiff = [
      0x49,
      0x49,
      0x2a,
      0x00,
      0x08,
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x32,
      0x01,
      0x02,
      0x00,
      ascii.length,
      0x00,
      0x00,
      0x00,
      0x1a,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      ...ascii,
    ];

    const app1 = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
    const length = app1.length + 2;

    return blobOf([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...app1]);
  }

  it('reads the date and converts it to GEDCOM form', async () => {
    const date = await readExifDate(jpegWithDate('1998:07:12 10:30:00'));
    expect(date.raw).to.equal('12 JUL 1998');
    expect(date.earliest).to.equal('1998-07-12');
  });

  it('returns nothing when there is no EXIF', async () => {
    expect(await readExifDate(blobOf(JPEG))).to.equal(null);
    expect(await readExifDate(blobOf(PNG))).to.equal(null);
  });

  it('ignores a malformed date rather than inventing one', async () => {
    expect(await readExifDate(jpegWithDate('0000:00:00 00:00:00'))).to.equal(null);
    expect(await readExifDate(jpegWithDate('not a date'))).to.equal(null);
  });
});

describe('content hashing', () => {
  it('matches the published SHA-256 of "abc"', async () => {
    const digest = await sha256Hex(new Blob(['abc']));
    expect(digest).to.equal('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  // Identical content must produce one file, whatever the originals were called.
  it('gives identical content the same name', async () => {
    const first = await sha256Hex(blobOf(JPEG));
    const second = await sha256Hex(blobOf(JPEG));
    expect(first).to.equal(second);
    expect(await sha256Hex(blobOf(PNG))).to.not.equal(first);
  });
});

describe('placeholder portraits', () => {
  it('picks a silhouette from the recorded sex', () => {
    expect(avatarKindFor(person('A', { sex: Sex.MALE }))).to.equal('M');
    expect(avatarKindFor(person('B', { sex: Sex.FEMALE }))).to.equal('F');
    expect(avatarKindFor(person('C', { sex: Sex.UNKNOWN }))).to.equal('unknown');
    expect(avatarKindFor(person('D', { sex: Sex.OTHER }))).to.equal('unknown');
  });

  // A placeholder is a gap in the record, not a described individual, so it is
  // never drawn as a man or a woman.
  it('always draws a placeholder person as unknown', () => {
    const ghost = createPlaceholder({ sex: Sex.MALE });
    expect(avatarKindFor(ghost)).to.equal('unknown');
    expect(avatarKindFor(null)).to.equal('unknown');
  });

  it('builds a self-contained SVG for each kind', () => {
    for (const kind of ['M', 'F', 'unknown']) {
      const node = avatarSvg(kind);
      expect(node.tagName).to.equal('svg');
      expect(node.getAttribute('fill')).to.equal('currentColor');
      expect(node.getAttribute('aria-hidden')).to.equal('true');
      expect(node.children.length).to.be.above(0);
    }
  });
});

describe('portrait selection', () => {
  const photo = (id, personId, role) =>
    createMediaObject({
      id,
      path: `photos/aa/${id}.jpg`,
      hash: id,
      mime: 'image/jpeg',
      bytes: 1,
      links: [mediaLink(personId, role)],
    });

  it('prefers the photo marked as the portrait', () => {
    const subject = person('Subject');
    const graph = buildIndexes(
      project({
        persons: [subject],
        media: [
          photo('a', subject.id, MediaRole.ATTACHMENT),
          photo('b', subject.id, MediaRole.PORTRAIT),
        ],
      }),
    );

    expect(portraitOf(graph, subject.id).id).to.equal('b');
    expect(mediaOf(graph, subject.id).map((m) => m.id)).to.eql(['b', 'a']);
  });

  // Someone who attached a single photo clearly meant it as their picture.
  it('falls back to the only photo when none is marked', () => {
    const subject = person('Subject');
    const graph = buildIndexes(
      project({ persons: [subject], media: [photo('a', subject.id, MediaRole.ATTACHMENT)] }),
    );

    expect(portraitOf(graph, subject.id).id).to.equal('a');
  });

  it('returns nothing for a person with no photos', () => {
    const subject = person('Subject');
    const graph = buildIndexes(project({ persons: [subject] }));
    expect(portraitOf(graph, subject.id)).to.equal(null);
  });

  it('never treats a document as a portrait', () => {
    const subject = person('Subject');
    const doc = createMediaObject({
      id: 'doc-1',
      kind: 'DOCUMENT',
      path: 'documents/dd/doc-1.pdf',
      hash: 'doc-1',
      mime: 'application/pdf',
      bytes: 100,
      links: [mediaLink(subject.id, MediaRole.ATTACHMENT)],
    });
    const graph = buildIndexes(project({ persons: [subject], media: [doc] }));
    expect(portraitOf(graph, subject.id)).to.equal(null);
  });
});
