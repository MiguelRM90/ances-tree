import { expect } from '@open-wc/testing';
import { parseGedcom, decodeGedcom, readFileWithEncoding } from '../src/domain/gedcom/parser.js';
import { importGedcom } from '../src/domain/gedcom/import.js';
import { exportGedcom } from '../src/domain/gedcom/export.js';
import { ParentType, UnionType, Sex } from '../src/domain/model/factories.js';
import { displayName } from '../src/domain/graph/queries.js';
import { minimalFamily, mixedAdoptionFamily } from './fixtures/families.js';

const ged = (...lines) => `${lines.join('\r\n')}\r\n`;

const MINIMAL = ged(
  '0 HEAD',
  '1 GEDC',
  '2 VERS 5.5.1',
  '1 CHAR UTF-8',
  '0 @I1@ INDI',
  '1 NAME Ramón /García Pérez/',
  '2 _SURN2 Pérez',
  '1 SEX M',
  '1 BIRT',
  '2 DATE ABT 1885',
  '2 PLAC Cuenca',
  '1 FAMS @F1@',
  '0 @I2@ INDI',
  '1 NAME Carmen /Díaz/',
  '1 SEX F',
  '1 FAMS @F1@',
  '0 @I3@ INDI',
  '1 NAME Luis /García Díaz/',
  '1 FAMC @F1@',
  '2 PEDI birth',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '1 CHIL @I3@',
  '1 MARR',
  '2 DATE 1910',
  '0 TRLR',
);

describe('GEDCOM parser', () => {
  it('reads levels, xrefs, tags and values', () => {
    const { records, errors } = parseGedcom(MINIMAL);

    expect(errors).to.eql([]);
    expect(records.map((r) => r.tag)).to.include.members(['HEAD', 'INDI', 'FAM', 'TRLR']);
    expect(records.find((r) => r.xref === '@I1@').children[0].tag).to.equal('NAME');
  });

  // Real files come with all three line endings, sometimes in the same file.
  it('accepts CRLF, LF and CR alike', () => {
    for (const eol of ['\r\n', '\n', '\r']) {
      const text = ['0 HEAD', '0 @I1@ INDI', '1 NAME A /B/', '0 TRLR'].join(eol);
      expect(parseGedcom(text).records).to.have.lengthOf(3);
    }
  });

  it('ignores a byte-order mark and blank lines', () => {
    const text = '﻿0 HEAD\r\n\r\n0 @I1@ INDI\r\n\r\n0 TRLR\r\n';
    const { records, errors } = parseGedcom(text);

    expect(errors).to.eql([]);
    expect(records).to.have.lengthOf(3);
  });

  it('joins CONC without a space and CONT with a newline', () => {
    const { records } = parseGedcom(
      ged('0 @I1@ INDI', '1 NOTE first', '2 CONC  continued', '2 CONT second line', '0 TRLR'),
    );

    expect(records[0].children[0].value).to.equal('first continued\nsecond line');
  });

  it('unescapes a literal at-sign', () => {
    const { records } = parseGedcom(ged('0 @I1@ INDI', '1 NOTE mail@@example.com', '0 TRLR'));
    expect(records[0].children[0].value).to.equal('mail@example.com');
  });

  /**
   * Aborting on the first bad line would reject most real archives, so the
   * damage is collected and the rest of the file is still read.
   */
  it('collects bad lines instead of giving up', () => {
    const { records, errors } = parseGedcom(
      ged('0 HEAD', 'this is not gedcom at all', '0 @I1@ INDI', '1 NAME A /B/', '0 TRLR'),
    );

    expect(errors).to.have.lengthOf(1);
    expect(errors[0].reason).to.equal('MALFORMED');
    expect(records).to.have.lengthOf(3);
  });

  it('reports the declared version and encoding', () => {
    const { version, encoding } = parseGedcom(MINIMAL);
    expect(version).to.equal('5.5.1');
    expect(encoding).to.equal('UTF-8');
  });
});

function encodeUtf16(text, { bigEndian = false, bom = false } = {}) {
  const offset = bom ? 2 : 0;
  const bytes = new Uint8Array(offset + text.length * 2);
  if (bom) {
    bytes[0] = bigEndian ? 0xfe : 0xff;
    bytes[1] = bigEndian ? 0xff : 0xfe;
  }
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const high = (code >> 8) & 0xff;
    const low = code & 0xff;
    bytes[offset + i * 2] = bigEndian ? high : low;
    bytes[offset + i * 2 + 1] = bigEndian ? low : high;
  }
  return bytes;
}

describe('GEDCOM encoding detection', () => {
  const UNICODE_GED = ged(
    '0 HEAD',
    '1 GEDC',
    '2 VERS 5.5.1',
    '1 CHAR UNICODE',
    '0 @I1@ INDI',
    '1 NAME Inés /Nuñez/',
    '1 SEX F',
    '0 TRLR',
  );

  it('decodes UTF-16LE with a BOM', async () => {
    const bytes = encodeUtf16(UNICODE_GED, { bigEndian: false, bom: true });
    const text = await readFileWithEncoding(new Blob([bytes]));
    const { project, counts } = importGedcom(text);

    expect(counts.persons).to.equal(1);
    expect(displayName(project.persons[0])).to.equal('Inés Nuñez');
  });

  it('decodes UTF-16BE with a BOM', async () => {
    const bytes = encodeUtf16(UNICODE_GED, { bigEndian: true, bom: true });
    const text = await readFileWithEncoding(new Blob([bytes]));
    const { project, counts } = importGedcom(text);

    expect(counts.persons).to.equal(1);
    expect(displayName(project.persons[0])).to.equal('Inés Nuñez');
  });

  it('decodes BOM-less UTF-16LE declared as UNICODE', async () => {
    const bytes = encodeUtf16(UNICODE_GED, { bigEndian: false, bom: false });
    const text = await readFileWithEncoding(new Blob([bytes]));
    const { project, counts } = importGedcom(text);

    expect(counts.persons).to.equal(1);
    expect(displayName(project.persons[0])).to.equal('Inés Nuñez');
  });

  it('decodes BOM-less UTF-16BE via null-byte heuristics', async () => {
    const bytes = encodeUtf16(UNICODE_GED, { bigEndian: true, bom: false });
    const text = await readFileWithEncoding(new Blob([bytes]));
    const { project, counts } = importGedcom(text);

    expect(counts.persons).to.equal(1);
    expect(displayName(project.persons[0])).to.equal('Inés Nuñez');
  });

  it('decodes UTF-8 with a BOM', async () => {
    const body = new TextEncoder().encode(MINIMAL);
    const bytes = new Uint8Array(3 + body.length);
    bytes.set([0xef, 0xbb, 0xbf], 0);
    bytes.set(body, 3);

    const text = await readFileWithEncoding(new Blob([bytes]));
    const { counts } = importGedcom(text);
    expect(counts.persons).to.equal(3);
  });

  it('falls back to windows-1252 when 1 CHAR ANSEL or ANSI is declared', () => {
    // '0 HEAD\r\n1 CHAR ANSI\r\n0 @I1@ INDI\r\n1 NAME José /Martín/\r\n0 TRLR\r\n'
    // In Latin-1 / Windows-1252: é = 0xe9, í = 0xed
    const raw = '0 HEAD\r\n1 CHAR ANSI\r\n0 @I1@ INDI\r\n1 NAME Jos\xe9 /Mart\xedn/\r\n0 TRLR\r\n';
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);

    const { project, counts } = importGedcom(decodeGedcom(bytes));
    expect(counts.persons).to.equal(1);
    expect(displayName(project.persons[0])).to.equal('José Martín');
  });
});

describe('GEDCOM import', () => {
  it('builds people, a union and the parent links', () => {
    const { project, counts } = importGedcom(MINIMAL);

    expect(counts).to.include({ persons: 3, unions: 1 });
    expect(project.unions[0].type).to.equal(UnionType.MARRIED);
    expect(project.unions[0].startDate.raw).to.equal('1910');

    // One edge per parent, which is what the model wants and the format does
    // not give directly.
    expect(project.parentChildren).to.have.lengthOf(2);
    expect(project.parentChildren.every((l) => l.type === ParentType.BIOLOGICAL)).to.equal(true);
  });

  it('splits the surnames only when the file says how', () => {
    const { project } = importGedcom(MINIMAL);
    const [ramon, carmen] = project.persons;

    expect(displayName(ramon)).to.equal('Ramón García Pérez');
    expect(ramon.lastName).to.equal('García');
    expect(ramon.secondLastName).to.equal('Pérez');

    // No _SURN2, so nothing is guessed.
    expect(carmen.lastName).to.equal('Díaz');
    expect(carmen.secondLastName).to.equal('');
  });

  it('keeps the raw date exactly as written', () => {
    const { project } = importGedcom(MINIMAL);
    expect(project.persons[0].birth.date.raw).to.equal('ABT 1885');
    expect(project.persons[0].birth.place).to.equal('Cuenca');
  });

  it('reads the sex codes it knows and defaults the rest', () => {
    const { project, warnings } = importGedcom(
      ged('0 @I1@ INDI', '1 SEX M', '0 @I2@ INDI', '1 SEX Z', '0 TRLR'),
    );

    expect(project.persons[0].sex).to.equal(Sex.MALE);
    expect(project.persons[1].sex).to.equal(Sex.UNKNOWN);
    expect(warnings.some((w) => w.reason === 'UNKNOWN_SEX')).to.equal(true);
  });

  it('treats a family with one parent as a parent, not a union', () => {
    const { project } = importGedcom(
      ged(
        '0 @I1@ INDI',
        '1 NAME A /B/',
        '0 @I2@ INDI',
        '1 NAME C /D/',
        '1 FAMC @F1@',
        '0 @F1@ FAM',
        '1 HUSB @I1@',
        '1 CHIL @I2@',
        '0 TRLR',
      ),
    );

    expect(project.unions).to.have.lengthOf(0);
    expect(project.parentChildren).to.have.lengthOf(1);
  });

  it('reads an unmarried union from the absence of a marriage', () => {
    const { project } = importGedcom(
      ged(
        '0 @I1@ INDI',
        '0 @I2@ INDI',
        '0 @F1@ FAM',
        '1 HUSB @I1@',
        '1 WIFE @I2@',
        '1 _UTYPE PARTNERS',
        '0 TRLR',
      ),
    );

    expect(project.unions[0].type).to.equal(UnionType.PARTNERS);
  });

  it('carries the pedigree through', () => {
    const { project } = importGedcom(
      ged(
        '0 @I1@ INDI',
        '0 @I2@ INDI',
        '1 FAMC @F1@',
        '2 PEDI adopted',
        '0 @F1@ FAM',
        '1 HUSB @I1@',
        '1 CHIL @I2@',
        '0 TRLR',
      ),
    );

    expect(project.parentChildren[0].type).to.equal(ParentType.ADOPTED);
  });

  it('marks a nameless record as a placeholder', () => {
    const { project } = importGedcom(ged('0 @I1@ INDI', '1 SEX U', '0 TRLR'));
    expect(project.persons[0].isPlaceholder).to.equal(true);
  });

  it('reads a nationality it recognises and drops one it does not', () => {
    const { project } = importGedcom(
      ged('0 @I1@ INDI', '1 NATI ES', '0 @I2@ INDI', '1 NATI Atlantis', '0 TRLR'),
    );

    expect(project.persons[0].nationality).to.equal('ES');
    expect(project.persons[1].nationality).to.equal('');
  });
});

/**
 * Export and import are written against the same mapping document, so what
 * leaves has to come back. This is the check that keeps them honest with each
 * other.
 */
describe('GEDCOM round trip', () => {
  it('brings a family back with its structure intact', () => {
    const { data } = minimalFamily();
    const { project, counts } = importGedcom(exportGedcom(data));

    expect(counts.persons).to.equal(data.persons.length);
    expect(counts.unions).to.equal(data.unions.length);
    expect(project.parentChildren).to.have.lengthOf(data.parentChildren.length);

    const names = project.persons.map(displayName).sort();
    expect(names).to.eql(data.persons.map(displayName).sort());
  });

  // Caught by running the whole 10,000-person archive through: the reader
  // understood NATI and the writer never emitted it, so every nationality
  // vanished on the way out.
  it('brings the nationality back', () => {
    const { data } = minimalFamily();
    data.persons[0].nationality = 'ES';
    data.persons[1].nationality = 'AR';

    const { project } = importGedcom(exportGedcom(data));
    expect(project.persons.map((p) => p.nationality).sort()).to.eql(['', 'AR', 'ES']);
  });

  it('brings the dates back byte for byte', () => {
    const { data } = minimalFamily();
    const { project } = importGedcom(exportGedcom(data));

    const before = data.persons.map((p) => p.birth?.date?.raw ?? '').sort();
    const after = project.persons.map((p) => p.birth?.date?.raw ?? '').sort();

    expect(after).to.eql(before);
  });

  // The one loss the format forces: PEDI belongs to the family link, so both
  // parents share it (gedcom-mapping.md).
  it('loses the per-parent pedigree, as documented', () => {
    const { data } = mixedAdoptionFamily();
    const { project } = importGedcom(exportGedcom(data));

    const types = new Set(project.parentChildren.map((l) => l.type));
    expect(types.size).to.equal(1, 'both parents end up with the same pedigree');
  });
});
