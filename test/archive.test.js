import { expect } from '@open-wc/testing';
import { ZipWriter } from '../src/storage/zip/write.js';
import { openArchive, findEntry } from '../src/storage/zip/read.js';
import { crc32 } from '../src/storage/zip/crc32.js';
import { safeEntryPath, METHOD_STORE, METHOD_DEFLATE } from '../src/storage/zip/format.js';
import { mergeProjects, newMediaOf } from '../src/domain/model/merge.js';
import { minimalFamily, person, project } from './fixtures/families.js';

/** Collects everything the writer emits, so a ZIP can be built in memory. */
function collector() {
  const chunks = [];
  return {
    stream: new WritableStream({ write: (chunk) => void chunks.push(chunk) }),
    blob: () => new Blob(chunks),
  };
}

const encode = (text) => new TextEncoder().encode(text);
const decode = (bytes) => new TextDecoder().decode(bytes);

describe('crc32', () => {
  it('matches the reference value for "123456789"', () => {
    expect(crc32(encode('123456789'))).to.equal(0xcbf43926);
  });

  it('is zero for empty input', () => {
    expect(crc32(new Uint8Array(0))).to.equal(0);
  });
});

describe('safeEntryPath', () => {
  it('accepts ordinary project paths', () => {
    expect(safeEntryPath('photos/a3/a3f2.jpg')).to.equal('photos/a3/a3f2.jpg');
    expect(safeEntryPath('family.json')).to.equal('family.json');
  });

  // Zip Slip is not theoretical here: extraction writes to the real disk.
  it('rejects traversal, absolute and drive-letter paths', () => {
    for (const evil of [
      '../../etc/passwd',
      'photos/../../secret',
      '/etc/passwd',
      'C:/Windows/system32',
      '..\\..\\windows',
      './family.json',
      '',
    ]) {
      expect(() => safeEntryPath(evil), evil).to.throw();
    }
  });
});

describe('zip round trip', () => {
  it('writes and reads back a text entry', async () => {
    const sink = collector();
    const zip = new ZipWriter(sink.stream);
    await zip.addBytes('family.json', encode('{"schemaVersion":1}'));
    await zip.close();

    const archive = await openArchive(sink.blob());
    expect(archive.entries).to.have.lengthOf(1);

    const entry = archive.entries[0];
    expect(entry.path).to.equal('family.json');
    expect(decode(await archive.bytes(entry))).to.equal('{"schemaVersion":1}');
  });

  it('survives a payload large enough to actually compress', async () => {
    const text = 'the quick brown fox '.repeat(5000);

    const sink = collector();
    const zip = new ZipWriter(sink.stream);
    await zip.addBytes('big.json', encode(text));
    await zip.close();

    const archive = await openArchive(sink.blob());
    const entry = archive.entries[0];

    expect(entry.method).to.equal(METHOD_DEFLATE);
    expect(entry.compressedSize).to.be.below(entry.uncompressedSize);
    expect(decode(await archive.bytes(entry))).to.equal(text);
  });

  // Deflating a JPEG burns CPU for nothing and often grows the file.
  it('stores already-compressed formats instead of deflating them', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);

    const sink = collector();
    const zip = new ZipWriter(sink.stream);
    await zip.addFile('photos/a3/a3f2.jpg', new File([bytes], 'a3f2.jpg'));
    await zip.close();

    const archive = await openArchive(sink.blob());
    const entry = findEntry(archive, 'photos/a3/a3f2.jpg');

    expect(entry.method).to.equal(METHOD_STORE);
    expect(entry.uncompressedSize).to.equal(bytes.length);
    expect(new Uint8Array(await archive.bytes(entry))).to.eql(bytes);
  });

  it('keeps several entries and their order', async () => {
    const sink = collector();
    const zip = new ZipWriter(sink.stream);
    await zip.addBytes('manifest.json', encode('{}'));
    await zip.addBytes('family.json', encode('{}'));
    await zip.addFile('documents/4c/deed.pdf', new File([new Uint8Array([1, 2, 3])], 'deed.pdf'));
    await zip.close();

    const archive = await openArchive(sink.blob());
    expect(archive.entries.map((e) => e.path)).to.eql([
      'manifest.json',
      'family.json',
      'documents/4c/deed.pdf',
    ]);
  });

  it('records a CRC that matches the original bytes', async () => {
    const bytes = encode('checksum me');

    const sink = collector();
    const zip = new ZipWriter(sink.stream);
    await zip.addBytes('note.txt', bytes);
    await zip.close();

    const archive = await openArchive(sink.blob());
    expect(archive.entries[0].crc).to.equal(crc32(bytes));
  });

  it('reports the total expanded size, for the zip-bomb check', async () => {
    const sink = collector();
    const zip = new ZipWriter(sink.stream);
    await zip.addBytes('a.json', encode('x'.repeat(100)));
    await zip.addBytes('b.json', encode('y'.repeat(50)));
    await zip.close();

    const archive = await openArchive(sink.blob());
    expect(archive.totalBytes).to.equal(150);
  });

  it('refuses something that is not a ZIP', async () => {
    let threw = false;
    try {
      await openArchive(new Blob([encode('definitely not a zip file')]));
    } catch (error) {
      threw = true;
      expect(error.code).to.equal('NOT_A_ZIP');
    }
    expect(threw).to.equal(true);
  });
});

describe('mergeProjects', () => {
  it('adds what is missing and counts it', () => {
    const { data: current } = minimalFamily();
    const stranger = person('Stranger', { born: '1880' });
    const incoming = project({ ...current, persons: [...current.persons, stranger] });

    const { project: merged, added } = mergeProjects(current, incoming);

    expect(merged.persons).to.have.lengthOf(current.persons.length + 1);
    expect(added.persons).to.equal(1);
  });

  // Overwriting a local edit with an older copy from someone else's ZIP would
  // be the worse surprise, so the local version wins.
  it('keeps the local version on conflict', () => {
    const { data: current, child } = minimalFamily();
    const edited = { ...child, firstName: 'Renamed' };
    const incoming = project({
      ...current,
      persons: current.persons.map((p) => (p.id === child.id ? edited : p)),
    });

    const { project: merged, kept } = mergeProjects(current, incoming);

    expect(merged.persons.find((p) => p.id === child.id).firstName).to.equal(child.firstName);
    expect(kept.persons).to.equal(current.persons.length);
  });

  it('lists only the media the current project lacks', () => {
    const current = project({ media: [{ id: '1', path: 'photos/a/1.jpg' }] });
    const incoming = project({
      media: [
        { id: '1', path: 'photos/a/1.jpg' },
        { id: '2', path: 'photos/b/2.jpg' },
      ],
    });

    expect(newMediaOf(current, incoming).map((m) => m.path)).to.eql(['photos/b/2.jpg']);
  });
});
