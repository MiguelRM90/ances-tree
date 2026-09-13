import { expect } from '@open-wc/testing';
import { detectDocumentType, importDocument } from '../src/storage/documents.js';
import { photosOf, documentsOf, portraitOf } from '../src/domain/graph/queries.js';
import { buildIndexes } from '../src/domain/graph/indexes.js';
import { exportGedcom } from '../src/domain/gedcom/export.js';
import { importGedcom } from '../src/domain/gedcom/import.js';
import {
  createMediaObject,
  mediaLink,
  MediaKind,
  MediaRole,
} from '../src/domain/model/factories.js';
import { person, project } from './fixtures/families.js';

const fileOf = (bytes, name) => new File([new Uint8Array(bytes)], name);

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const RTF_MAGIC = [0x7b, 0x5c, 0x72, 0x74, 0x66, 0x31, 0x20, 0x61];
const TXT_BYTES = [0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64];

describe('document type detection', () => {
  it('recognises valid PDF documents', async () => {
    const result = await detectDocumentType(fileOf(PDF_MAGIC, 'record.pdf'));
    expect(result).to.include({ mime: 'application/pdf', ext: 'pdf' });
  });

  it('recognises valid DOCX and XLSX documents', async () => {
    const docx = await detectDocumentType(fileOf(ZIP_MAGIC, 'contract.docx'));
    expect(docx).to.include({
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ext: 'docx',
    });

    const xlsx = await detectDocumentType(fileOf(ZIP_MAGIC, 'census.xlsx'));
    expect(xlsx).to.include({
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ext: 'xlsx',
    });
  });

  it('recognises legacy Office and RTF documents', async () => {
    const doc = await detectDocumentType(fileOf(OLE_MAGIC, 'old.doc'));
    expect(doc).to.include({ mime: 'application/msword', ext: 'doc' });

    const rtf = await detectDocumentType(fileOf(RTF_MAGIC, 'notes.rtf'));
    expect(rtf).to.include({ mime: 'application/rtf', ext: 'rtf' });
  });

  it('recognises plain text and CSV files', async () => {
    const txt = await detectDocumentType(fileOf(TXT_BYTES, 'notes.txt'));
    expect(txt).to.include({ mime: 'text/plain', ext: 'txt' });

    const csv = await detectDocumentType(fileOf(TXT_BYTES, 'data.csv'));
    expect(csv).to.include({ mime: 'text/csv', ext: 'csv' });
  });

  it('rejects files with fraudulent extensions', async () => {
    // Executable with a .pdf or .docx extension
    const fakePdf = fileOf([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00], 'virus.pdf');
    expect(await detectDocumentType(fakePdf)).to.equal(null);

    const fakeDocx = fileOf([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01], 'script.docx');
    expect(await detectDocumentType(fakeDocx)).to.equal(null);
  });

  it('rejects unsupported extensions', async () => {
    const exe = fileOf([0x4d, 0x5a, 0x90, 0x00], 'app.exe');
    expect(await detectDocumentType(exe)).to.equal(null);
  });

  it('rejects empty files', async () => {
    expect(await detectDocumentType(fileOf([], 'empty.pdf'))).to.equal(null);
  });
});

describe('document import pipeline', () => {
  function mockDir() {
    const files = new Map();
    const subdirs = new Map();

    return {
      files,
      async getDirectoryHandle(name) {
        if (!subdirs.has(name)) subdirs.set(name, mockDir());
        return subdirs.get(name);
      },
      async getFileHandle(name) {
        return {
          async createWritable() {
            return {
              async write(data) {
                files.set(name, data);
              },
              async close() {},
            };
          },
          async getFile() {
            return files.get(name);
          },
        };
      },
    };
  }

  it('imports a document and returns MediaKind.DOCUMENT', async () => {
    const dir = mockDir();
    const file = fileOf(PDF_MAGIC, 'will.pdf');
    const result = await importDocument(dir, file);

    expect(result.reused).to.equal(false);
    expect(result.media.kind).to.equal(MediaKind.DOCUMENT);
    expect(result.media.mime).to.equal('application/pdf');
    expect(result.media.caption).to.equal('will.pdf');
    expect(result.media.path).to.match(/^documents\/[a-f0-9]{2}\/[a-f0-9]{64}\.pdf$/);

    // Deduplication
    const second = await importDocument(dir, file, [result.media]);
    expect(second.reused).to.equal(true);
    expect(second.media.id).to.equal(result.media.id);
  });
});

describe('graph media queries for documents and photos', () => {
  const subject = person('Subject');
  const photo = createMediaObject({
    id: 'p1',
    kind: MediaKind.PHOTO,
    path: 'photos/aa/p1.jpg',
    hash: 'p1',
    mime: 'image/jpeg',
    links: [mediaLink(subject.id, MediaRole.PORTRAIT)],
  });
  const doc = createMediaObject({
    id: 'd1',
    kind: MediaKind.DOCUMENT,
    path: 'documents/bb/d1.pdf',
    hash: 'd1',
    mime: 'application/pdf',
    links: [mediaLink(subject.id, MediaRole.ATTACHMENT)],
  });

  const graph = buildIndexes(project({ persons: [subject], media: [photo, doc] }));

  it('segregates photos and documents via photosOf and documentsOf', () => {
    expect(photosOf(graph, subject.id).map((m) => m.id)).to.eql(['p1']);
    expect(documentsOf(graph, subject.id).map((m) => m.id)).to.eql(['d1']);
  });

  it('never uses a document as a portrait', () => {
    const docOnlyGraph = buildIndexes(project({ persons: [subject], media: [doc] }));
    expect(portraitOf(docOnlyGraph, subject.id)).to.equal(null);
  });
});

describe('GEDCOM round-trip with documents', () => {
  it('exports documents with proper FORM and relative paths', () => {
    const subject = person('Subject');
    const doc = createMediaObject({
      id: 'd1',
      kind: MediaKind.DOCUMENT,
      path: 'documents/4c/4c88fe02.docx',
      hash: '4c88fe02',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      caption: 'Birth certificate transcript',
      links: [mediaLink(subject.id, MediaRole.ATTACHMENT)],
    });

    const gedcom = exportGedcom(project({ persons: [subject], media: [doc] }));

    expect(gedcom).to.include('1 FILE documents/4c/4c88fe02.docx');
    expect(gedcom).to.include('2 FORM docx');
    expect(gedcom).to.include('2 TITL Birth certificate transcript');
  });

  it('imports GEDCOM OBJE records into MediaKind.DOCUMENT', () => {
    const sample = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 5.5.1',
      '2 FORM LINEAGE-LINKED',
      '1 CHAR UTF-8',
      '0 @I1@ INDI',
      '1 NAME John /Doe/',
      '1 OBJE @O1@',
      '0 @O1@ OBJE',
      '1 FILE documents/4c/4c88fe02.docx',
      '2 FORM docx',
      '2 TITL Birth certificate transcript',
      '1 _HASH 4c88fe02',
      '0 TRLR',
    ].join('\r\n');

    const result = importGedcom(sample, { title: 'Test' });
    expect(result.project.media).to.have.lengthOf(1);

    const item = result.project.media[0];
    expect(item.kind).to.equal(MediaKind.DOCUMENT);
    expect(item.path).to.equal('documents/4c/4c88fe02.docx');
    expect(item.mime).to.equal(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(item.caption).to.equal('Birth certificate transcript');
    expect(item.links).to.have.lengthOf(1);
  });
});
