import { expect } from '@open-wc/testing';
import { parseGedcom, decodeGedcom, readFileWithEncoding } from '../src/domain/gedcom/parser.js';
import { importGedcom } from '../src/domain/gedcom/import.js';
import { exportGedcom } from '../src/domain/gedcom/export.js';
import {
  createPerson,
  createPlaceholder,
  createUnion,
  createParentChild,
  createMediaObject,
  mediaLink,
  ParentType,
  Certainty,
  UnionType,
  MediaKind,
  MediaRole,
  Sex,
} from '../src/domain/model/factories.js';
import { parseDate } from '../src/domain/date/parse.js';
import { displayName } from '../src/domain/graph/queries.js';
import {
  minimalFamily,
  mixedAdoptionFamily,
  person,
  project as makeProject,
} from './fixtures/families.js';

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

  it('tolerates leading indentation before level numbers', () => {
    const { records, errors } = parseGedcom(
      ged('0 HEAD', '  0 @I1@ INDI', '    1 NAME Ana /López/', '0 TRLR'),
    );
    expect(errors).to.eql([]);
    expect(records).to.have.lengthOf(3);
    expect(records[1].children[0].value).to.equal('Ana /López/');
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

  it('links children declared via 1 CHIL on FAM even when 1 FAMC on INDI is missing', () => {
    const { project } = importGedcom(
      ged(
        '0 @I1@ INDI',
        '1 NAME Father /Smith/',
        '0 @I2@ INDI',
        '1 NAME Child /Smith/',
        '0 @F1@ FAM',
        '1 HUSB @I1@',
        '1 CHIL @I2@',
        '0 TRLR',
      ),
    );

    expect(project.parentChildren).to.have.lengthOf(1);
    expect(project.parentChildren[0].parentId).to.equal(project.persons[0].id);
    expect(project.parentChildren[0].childId).to.equal(project.persons[1].id);
  });

  it('resolves top-level 0 @N1@ NOTE pointers and inline 1 OBJE media blocks from third-party exporters', () => {
    const { project } = importGedcom(
      ged(
        '0 HEAD',
        '1 NOTE Familia Histórica',
        '0 @N1@ NOTE Crónica compartida desde Gramps.',
        '1 CONT Segunda línea de la nota.',
        '0 @I1@ INDI',
        '1 NAME Isabel /Castro/',
        '1 NOTE @N1@',
        '1 OBJE',
        '2 FILE photos/c1/isabel.jpg',
        '3 FORM jpeg',
        '3 TITL Retrato de Isabel',
        '2 _ROLE PORTRAIT',
        '0 TRLR',
      ),
    );

    expect(project.project.title).to.equal('Familia Histórica');
    expect(project.persons[0].notes).to.equal(
      'Crónica compartida desde Gramps.\nSegunda línea de la nota.',
    );
    expect(project.media).to.have.lengthOf(1);
    expect(project.media[0].path).to.equal('photos/c1/isabel.jpg');
    expect(project.media[0].caption).to.equal('Retrato de Isabel');
    expect(project.media[0].links[0].role).to.equal(MediaRole.PORTRAIT);
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

  it('preserves STEP and GUARDIAN parent types via _REL extension', () => {
    const p1 = person('StepParent', { born: '1950' });
    const c1 = person('Child', { born: '1980' });
    const data = makeProject({
      persons: [p1, c1],
      parentChildren: [
        createParentChild({
          parentId: p1.id,
          childId: c1.id,
          type: ParentType.STEP,
        }),
      ],
    });

    const { project } = importGedcom(exportGedcom(data));
    expect(project.parentChildren).to.have.lengthOf(1);
    expect(project.parentChildren[0].type).to.equal(ParentType.STEP);
  });

  it('preserves media takenDate across export and import', () => {
    const p1 = person('PhotoOwner', { born: '1920' });
    const media = createMediaObject({
      kind: MediaKind.PHOTO,
      path: 'photos/a1/portrait.jpg',
      mime: 'image/jpeg',
      caption: 'Wedding day',
      takenDate: parseDate('12 MAY 1945'),
      links: [mediaLink(p1.id, MediaRole.PORTRAIT)],
    });
    const data = makeProject({ persons: [p1], media: [media] });

    const { project } = importGedcom(exportGedcom(data));
    expect(project.media).to.have.lengthOf(1);
    expect(project.media[0].takenDate?.raw).to.equal('12 MAY 1945');
  });

  it('round-trips a comprehensive 20-member multi-generation family with all features intact', async () => {
    const evt = (raw, place = '') => ({ date: parseDate(raw), place });
    const longNote = `Bio with emoji 𐐷 and email archive@example.com.\nSecond paragraph: ${'chronicle '.repeat(35).trim()}`;

    // Generation 1 (6 people: 2 paternal, 2 maternal, 2 great-aunt/uncle)
    const g1PatGf = createPerson({
      firstName: 'Alfonso',
      lastName: 'De la Fuente',
      secondLastName: 'Mendoza',
      alsoKnownAs: ['El Abuelo Alfonso'],
      sex: Sex.MALE,
      nationality: 'ES',
      birth: evt('@#DJULIAN@ 15 MAR 1875', 'Toledo, España'),
      death: evt('12 NOV 1950', 'Madrid, España'),
      notes: longNote,
    });
    const g1PatGm = createPerson({
      firstName: 'Concepción',
      lastName: 'Ruiz',
      secondLastName: 'Gallardo',
      sex: Sex.FEMALE,
      nationality: 'ES',
      birth: evt('ABT 1878', 'Aranjuez'),
      death: evt('BEF 1960', 'Madrid'),
    });
    const g1MatGf = createPerson({
      firstName: 'Giuseppe',
      lastName: 'Rossi',
      sex: Sex.MALE,
      nationality: 'IT',
      birth: evt('EST 1880', 'Genova'),
      death: evt('AFT 1955', 'Buenos Aires'),
    });
    const g1MatGm = createPerson({
      firstName: 'Lucía',
      lastName: 'Fernández',
      secondLastName: 'Vega',
      sex: Sex.FEMALE,
      nationality: 'AR',
      birth: evt('BET 1882 AND 1885', 'Córdoba, Argentina'),
      death: evt('1968', 'Buenos Aires'),
    });
    const g1Uncle = createPerson({
      firstName: 'Hermenegildo',
      lastName: 'De la Fuente',
      secondLastName: 'Mendoza',
      sex: Sex.MALE,
      nationality: 'ES',
      birth: evt('CAL 1877', 'Toledo'),
    });
    const g1Placeholder = createPlaceholder();

    // Generation 2 (6 people)
    const g2Father = createPerson({
      firstName: 'Ramón',
      lastName: 'De la Fuente',
      secondLastName: 'Ruiz',
      alsoKnownAs: ['Moncho', 'Don Ramón'],
      sex: Sex.MALE,
      nationality: 'ES',
      birth: evt('4 JUL 1905', 'Madrid'),
      death: evt('1988', 'Madrid'),
    });
    const g2Mother = createPerson({
      firstName: 'Valeria',
      lastName: 'Rossi',
      secondLastName: 'Fernández',
      sex: Sex.FEMALE,
      nationality: 'AR',
      birth: evt('MAY 1908', 'Buenos Aires'),
      death: evt('1995', 'Madrid'),
    });
    const g2FatherEx = createPerson({
      firstName: 'Clara',
      lastName: 'Sánchez',
      sex: Sex.FEMALE,
      nationality: 'ES',
      birth: evt('1906', 'Segovia'),
    });
    const g2StepFather = createPerson({
      firstName: 'Arturo',
      lastName: 'Benítez',
      sex: Sex.MALE,
      nationality: 'MX',
      birth: evt('1904', 'Veracruz'),
    });
    const g2Aunt = createPerson({
      firstName: 'Elena',
      lastName: 'De la Fuente',
      secondLastName: 'Ruiz',
      sex: Sex.FEMALE,
      nationality: 'ES',
      birth: evt('1910', 'Madrid'),
    });
    const g2AuntPartner = createPerson({
      firstName: 'Beatriz',
      lastName: 'Navarro',
      secondLastName: 'Gil',
      sex: Sex.FEMALE,
      nationality: 'ES',
      birth: evt('1912', 'Valencia'),
    });

    // Generation 3 (5 people)
    const g3Focal = createPerson({
      firstName: 'Carlos',
      lastName: 'De la Fuente',
      secondLastName: 'Rossi',
      sex: Sex.MALE,
      nationality: 'ES',
      birth: evt('22 OCT 1938', 'Madrid'),
      notes: 'Line 1\nLine 2\nLine 3',
    });
    const g3Wife = createPerson({
      firstName: 'Inés',
      lastName: 'Nuñez',
      secondLastName: 'Cabrera',
      sex: Sex.FEMALE,
      nationality: 'UY',
      birth: evt('1940', 'Montevideo'),
    });
    const g3HalfSister = createPerson({
      firstName: 'Sofía',
      lastName: 'De la Fuente',
      secondLastName: 'Sánchez',
      sex: Sex.FEMALE,
      nationality: 'ES',
      birth: evt('1929', 'Madrid'),
    });
    const g3AdoptedBro = createPerson({
      firstName: 'Mateo',
      lastName: 'De la Fuente',
      secondLastName: 'Rossi',
      sex: Sex.MALE,
      nationality: 'PE',
      birth: evt('ABT 1942', 'Lima'),
    });
    const g3FosterSis = createPerson({
      firstName: 'Camila',
      lastName: 'Ortega',
      sex: Sex.FEMALE,
      nationality: 'CL',
      birth: evt('1944', 'Santiago'),
    });

    // Generation 4 (3 people)
    const g4Child1 = createPerson({
      firstName: 'Javier',
      lastName: 'De la Fuente',
      secondLastName: 'Nuñez',
      sex: Sex.MALE,
      nationality: 'ES',
      birth: evt('14 FEB 1968', 'Madrid'),
    });
    const g4Child2 = createPerson({
      firstName: 'Natalia',
      lastName: 'De la Fuente',
      secondLastName: 'Nuñez',
      sex: Sex.OTHER,
      nationality: 'ES',
      birth: evt('1972', 'Barcelona'),
    });
    const g4Ward = createPerson({
      firstName: 'Tomás',
      lastName: 'Vargas',
      sex: Sex.MALE,
      nationality: 'CO',
      birth: evt('1975', 'Bogotá'),
    });

    const persons = [
      g1PatGf,
      g1PatGm,
      g1MatGf,
      g1MatGm,
      g1Uncle,
      g1Placeholder,
      g2Father,
      g2Mother,
      g2FatherEx,
      g2StepFather,
      g2Aunt,
      g2AuntPartner,
      g3Focal,
      g3Wife,
      g3HalfSister,
      g3AdoptedBro,
      g3FosterSis,
      g4Child1,
      g4Child2,
      g4Ward,
    ];
    expect(persons).to.have.lengthOf(20);

    // Unions (6 unions covering MARRIED, divorced MARRIED, PARTNERS, CASUAL, same-sex)
    const uPatG1 = createUnion({
      partner1Id: g1PatGf.id,
      partner2Id: g1PatGm.id,
      type: UnionType.MARRIED,
      startDate: parseDate('1902'),
    });
    const uMatG1 = createUnion({
      partner1Id: g1MatGf.id,
      partner2Id: g1MatGm.id,
      type: UnionType.MARRIED,
      startDate: parseDate('1905'),
    });
    const uFatherFirst = createUnion({
      partner1Id: g2Father.id,
      partner2Id: g2FatherEx.id,
      type: UnionType.MARRIED,
      startDate: parseDate('1927'),
      endDate: parseDate('1933'),
      notes: 'Divorced in Madrid',
    });
    const uParents = createUnion({
      partner1Id: g2Father.id,
      partner2Id: g2Mother.id,
      type: UnionType.MARRIED,
      startDate: parseDate('1936'),
    });
    const uAuntSameSex = createUnion({
      partner1Id: g2Aunt.id,
      partner2Id: g2AuntPartner.id,
      type: UnionType.PARTNERS,
    });
    const uFocal = createUnion({
      partner1Id: g3Focal.id,
      partner2Id: g3Wife.id,
      type: UnionType.CASUAL,
      startDate: parseDate('1966'),
    });

    const unions = [uPatG1, uMatG1, uFatherFirst, uParents, uAuntSameSex, uFocal];

    const parentChildren = [
      // Gen 1 -> Gen 2
      createParentChild({ parentId: g1PatGf.id, childId: g2Father.id, unionId: uPatG1.id }),
      createParentChild({ parentId: g1PatGm.id, childId: g2Father.id, unionId: uPatG1.id }),
      createParentChild({ parentId: g1PatGf.id, childId: g2Aunt.id, unionId: uPatG1.id }),
      createParentChild({ parentId: g1PatGm.id, childId: g2Aunt.id, unionId: uPatG1.id }),
      createParentChild({ parentId: g1MatGf.id, childId: g2Mother.id, unionId: uMatG1.id }),
      createParentChild({ parentId: g1MatGm.id, childId: g2Mother.id, unionId: uMatG1.id }),
      // Single-parent link from placeholder to g1Uncle
      createParentChild({ parentId: g1Placeholder.id, childId: g1Uncle.id }),
      // Gen 2 -> Gen 3
      createParentChild({
        parentId: g2Father.id,
        childId: g3HalfSister.id,
        unionId: uFatherFirst.id,
      }),
      createParentChild({
        parentId: g2FatherEx.id,
        childId: g3HalfSister.id,
        unionId: uFatherFirst.id,
      }),
      // Step-parent solo link on g3HalfSister
      createParentChild({
        parentId: g2StepFather.id,
        childId: g3HalfSister.id,
        type: ParentType.STEP,
        certainty: Certainty.PROBABLE,
      }),
      // Biological child of couple
      createParentChild({ parentId: g2Father.id, childId: g3Focal.id, unionId: uParents.id }),
      createParentChild({ parentId: g2Mother.id, childId: g3Focal.id, unionId: uParents.id }),
      // Adopted child of couple with DISPUTED certainty
      createParentChild({
        parentId: g2Father.id,
        childId: g3AdoptedBro.id,
        unionId: uParents.id,
        type: ParentType.ADOPTED,
        certainty: Certainty.DISPUTED,
      }),
      createParentChild({
        parentId: g2Mother.id,
        childId: g3AdoptedBro.id,
        unionId: uParents.id,
        type: ParentType.ADOPTED,
        certainty: Certainty.DISPUTED,
      }),
      // Foster child of same-sex couple
      createParentChild({
        parentId: g2Aunt.id,
        childId: g3FosterSis.id,
        unionId: uAuntSameSex.id,
        type: ParentType.FOSTER,
      }),
      createParentChild({
        parentId: g2AuntPartner.id,
        childId: g3FosterSis.id,
        unionId: uAuntSameSex.id,
        type: ParentType.FOSTER,
      }),
      // Gen 3 -> Gen 4
      createParentChild({ parentId: g3Focal.id, childId: g4Child1.id, unionId: uFocal.id }),
      createParentChild({ parentId: g3Wife.id, childId: g4Child1.id, unionId: uFocal.id }),
      createParentChild({ parentId: g3Focal.id, childId: g4Child2.id, unionId: uFocal.id }),
      createParentChild({ parentId: g3Wife.id, childId: g4Child2.id, unionId: uFocal.id }),
      // Guardian solo link
      createParentChild({
        parentId: g3Focal.id,
        childId: g4Ward.id,
        type: ParentType.GUARDIAN,
        certainty: Certainty.DISPUTED,
      }),
    ];

    const media = [
      createMediaObject({
        kind: MediaKind.PHOTO,
        path: 'photos/f1/alfonso-portrait.jpg',
        hash: 'sha256-abc123',
        mime: 'image/jpeg',
        caption: 'Retrato en Toledo',
        takenDate: parseDate('ABT 1920'),
        links: [
          mediaLink(g1PatGf.id, MediaRole.PORTRAIT),
          mediaLink(g2Father.id, MediaRole.ATTACHMENT),
        ],
      }),
      createMediaObject({
        kind: MediaKind.DOCUMENT,
        path: 'documents/d1/partida-bautismo.pdf',
        hash: 'sha256-def456',
        mime: 'application/pdf',
        caption: 'Partida bautismal',
        takenDate: parseDate('15 MAR 1875'),
        links: [mediaLink(g1PatGf.id, MediaRole.ATTACHMENT)],
      }),
    ];

    const original = makeProject({ persons, unions, parentChildren, media });
    const gedText = exportGedcom(original);

    // 1. Verify round-trip via UTF-8
    const { project: restored, warnings, counts } = importGedcom(gedText);
    expect(warnings).to.eql([]);
    expect(counts).to.eql({
      persons: 20,
      unions: 6,
      parentChildren: 21,
      media: 2,
    });

    // 2. Verify round-trip via UTF-16LE BOM-less (simulating UNICODE file exchange)
    const utf16Bytes = encodeUtf16(gedText.replace('1 CHAR UTF-8', '1 CHAR UNICODE'), {
      bigEndian: false,
      bom: false,
    });
    const decodedFromUtf16 = await readFileWithEncoding(new Blob([utf16Bytes]));
    const { counts: utf16Counts, warnings: utf16Warnings } = importGedcom(decodedFromUtf16);
    expect(utf16Warnings).to.eql([]);
    expect(utf16Counts.persons).to.equal(20);

    // 3. Verify every person's fields survived intact
    for (let i = 0; i < persons.length; i += 1) {
      const orig = persons[i];
      const rest = restored.persons[i];
      expect(rest.firstName, `person[${i}].firstName`).to.equal(orig.firstName);
      expect(rest.lastName, `person[${i}].lastName`).to.equal(orig.lastName);
      expect(rest.secondLastName, `person[${i}].secondLastName`).to.equal(orig.secondLastName);
      expect(rest.alsoKnownAs, `person[${i}].alsoKnownAs`).to.eql(orig.alsoKnownAs);
      expect(rest.sex, `person[${i}].sex`).to.equal(orig.sex);
      expect(rest.nationality, `person[${i}].nationality`).to.equal(orig.nationality);
      expect(rest.isPlaceholder, `person[${i}].isPlaceholder`).to.equal(orig.isPlaceholder);
      expect(rest.birth?.date?.raw ?? '', `person[${i}].birth.date`).to.equal(
        orig.birth?.date?.raw ?? '',
      );
      expect(rest.birth?.place ?? '', `person[${i}].birth.place`).to.equal(orig.birth?.place ?? '');
      expect(rest.death?.date?.raw ?? '', `person[${i}].death.date`).to.equal(
        orig.death?.date?.raw ?? '',
      );
      expect(rest.death?.place ?? '', `person[${i}].death.place`).to.equal(orig.death?.place ?? '');
      expect(rest.notes, `person[${i}].notes`).to.equal(orig.notes);
    }

    // 4. Verify unions (types, start/end dates, divorced marriage, and notes without synthetic noise)
    expect(restored.project.title).to.equal('Test family');
    expect(restored.unions.map((u) => u.type)).to.eql(unions.map((u) => u.type));
    expect(restored.unions.map((u) => u.notes)).to.eql(unions.map((u) => u.notes));
    expect(restored.unions[2].startDate?.raw).to.equal('1927');
    expect(restored.unions[2].endDate?.raw).to.equal('1933');

    // 5. Verify parent-child types and certainties (BIOLOGICAL, ADOPTED, FOSTER, STEP, GUARDIAN)
    const countByType = (list, t) => list.filter((l) => l.type === t).length;
    for (const t of Object.values(ParentType)) {
      expect(countByType(restored.parentChildren, t), `ParentType.${t}`).to.equal(
        countByType(parentChildren, t),
      );
    }
    const stepLink = restored.parentChildren.find((l) => l.type === ParentType.STEP);
    expect(stepLink.certainty).to.equal(Certainty.PROBABLE);
    const guardianLink = restored.parentChildren.find((l) => l.type === ParentType.GUARDIAN);
    expect(guardianLink.certainty).to.equal(Certainty.DISPUTED);

    // 6. Verify media (photo & PDF document, hashes, captions, takenDates, PORTRAIT/ATTACHMENT roles)
    expect(restored.media[0]).to.include({
      kind: MediaKind.PHOTO,
      path: 'photos/f1/alfonso-portrait.jpg',
      hash: 'sha256-abc123',
      caption: 'Retrato en Toledo',
    });
    expect(restored.media[0].takenDate?.raw).to.equal('ABT 1920');
    expect(restored.media[0].links.map((l) => l.role)).to.eql([
      MediaRole.PORTRAIT,
      MediaRole.ATTACHMENT,
    ]);

    expect(restored.media[1]).to.include({
      kind: MediaKind.DOCUMENT,
      path: 'documents/d1/partida-bautismo.pdf',
      hash: 'sha256-def456',
      caption: 'Partida bautismal',
    });
    expect(restored.media[1].takenDate?.raw).to.equal('15 MAR 1875');
  });
});
