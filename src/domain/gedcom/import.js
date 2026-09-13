/**
 * GEDCOM records -> project (gedcom-mapping.md).
 *
 * The JSON model is richer than the format, so this direction is lossy in the
 * other sense: a FAM says two people are the parents of a child but pins one
 * pedigree on the pair, and the model wants one per parent. What arrives is
 * split faithfully and what cannot be known is left at its default rather than
 * guessed.
 *
 * Pure: records in, project out. Nothing touches the disk.
 */

import { parseGedcom, child, children, childValue } from './parser.js';
import { parseDate } from '../date/parse.js';
import { isCountryCode } from '../model/countries.js';
import {
  createProject,
  createPerson,
  createUnion,
  createParentChild,
  createMediaObject,
  mediaLink,
  ParentType,
  UnionType,
  Certainty,
  MediaKind,
  MediaRole,
  Sex,
} from '../model/factories.js';

/** PEDI back into the model's link types. */
const PEDIGREE = {
  birth: ParentType.BIOLOGICAL,
  adopted: ParentType.ADOPTED,
  foster: ParentType.FOSTER,
  sealing: ParentType.BIOLOGICAL,
};

/**
 * @param {string} text     the whole .ged file
 * @param {{title?: string}} [options]
 * @returns {{project: object, warnings: Array<{reason: string, line?: number, text?: string}>,
 *            counts: object, encoding: string, version: string}}
 */
export function importGedcom(text, { title = 'Imported family' } = {}) {
  const { records, errors, encoding, version } = parseGedcom(text);
  const warnings = errors.map((error) => ({ ...error }));

  const project = createProject({ title });
  const personByXref = new Map();

  // --- People ---------------------------------------------------------------
  for (const record of records.filter((r) => r.tag === 'INDI')) {
    const person = readIndividual(record, warnings);
    personByXref.set(record.xref, person);
    project.persons.push(person);
  }

  // --- Media ----------------------------------------------------------------
  const mediaByXref = new Map();
  for (const record of records.filter((r) => r.tag === 'OBJE')) {
    const item = readObject(record);
    if (!item) continue;
    mediaByXref.set(record.xref, item);
    project.media.push(item);
  }

  attachMedia(records, personByXref, mediaByXref);

  // --- Families -------------------------------------------------------------
  const unionByXref = new Map();
  for (const record of records.filter((r) => r.tag === 'FAM')) {
    readFamily(record, { project, personByXref, unionByXref, warnings });
  }

  // FAMC lives on the individual and carries the pedigree, so the parent links
  // are built from that side rather than from CHIL.
  for (const record of records.filter((r) => r.tag === 'INDI')) {
    const person = personByXref.get(record.xref);

    for (const famc of children(record, 'FAMC')) {
      const family = unionByXref.get(famc.value);
      if (!family) {
        warnings.push({ reason: 'UNKNOWN_FAMILY', line: famc.line, text: famc.value });
        continue;
      }

      const type = PEDIGREE[childValue(famc, 'PEDI').toLowerCase()] ?? ParentType.BIOLOGICAL;
      const certainty = readCertainty(childValue(famc, '_CERT'));

      // One edge per parent: the format pins one pedigree on the couple, so
      // both parents get the same one. That loss is the format's, and it is
      // recorded in gedcom-mapping.md rather than hidden.
      for (const parentId of family.parentIds) {
        project.parentChildren.push(
          createParentChild({
            parentId,
            childId: person.id,
            unionId: family.unionId,
            type,
            certainty,
          }),
        );
      }
    }
  }

  project.settings.focalPersonId = project.persons[0]?.id ?? null;

  return {
    project,
    warnings,
    encoding,
    version,
    counts: {
      persons: project.persons.length,
      unions: project.unions.length,
      parentChildren: project.parentChildren.length,
      media: project.media.length,
    },
  };
}

// --- Individuals -----------------------------------------------------------

function readIndividual(record, warnings) {
  const name = child(record, 'NAME');
  const { firstName, lastName, secondLastName } = readName(name);

  const nationality = childValue(record, 'NATI').toUpperCase();

  return createPerson({
    firstName,
    lastName,
    secondLastName,
    alsoKnownAs: children(record, 'NAME')
      .slice(1)
      .map((alias) => alias.value.replace(/\//g, '').trim())
      .filter(Boolean),
    sex: readSex(childValue(record, 'SEX'), record, warnings),
    nationality: isCountryCode(nationality) ? nationality : '',
    birth: readEvent(child(record, 'BIRT')),
    death: readEvent(child(record, 'DEAT')),
    // A record with no name at all is the usual way of saying "somebody was
    // here and we do not know who".
    isPlaceholder: !name && !childValue(record, 'BIRT'),
    notes: children(record, 'NOTE')
      .map((note) => note.value)
      .join('\n\n'),
  });
}

/**
 * `Juan /García Pérez/` — given names outside the slashes, surnames within.
 *
 * The two surnames are NOT split on the space. "De la Fuente" and
 * "García Pérez" are indistinguishable, and guessing wrong would quietly
 * corrupt somebody's line, so everything lands in the first surname unless our
 * own `_SURN2` extension says otherwise.
 */
function readName(node) {
  if (!node) return { firstName: '', lastName: '', secondLastName: '' };

  const match = /^([^/]*)\/([^/]*)\/?(.*)$/.exec(node.value);
  const given = (match ? match[1] : node.value).trim();
  const surnames = (match ? match[2] : '').trim();

  const second = childValue(node, '_SURN2').trim();
  const first =
    second && surnames.endsWith(second) ? surnames.slice(0, -second.length).trim() : surnames;

  return {
    firstName: childValue(node, 'GIVN').trim() || given,
    lastName: first,
    secondLastName: second,
  };
}

function readSex(value, record, warnings) {
  const code = value.trim().toUpperCase();
  if (Object.values(Sex).includes(code)) return code;
  if (code !== '') warnings.push({ reason: 'UNKNOWN_SEX', line: record.line, text: code });
  return Sex.UNKNOWN;
}

function readEvent(node) {
  if (!node) return null;

  const raw = childValue(node, 'DATE');
  const place = childValue(node, 'PLAC');
  if (!raw && !place) return null;

  return { date: parseDate(raw), place };
}

const readCertainty = (value) =>
  Object.values(Certainty).includes(value.toUpperCase())
    ? value.toUpperCase()
    : Certainty.CONFIRMED;

// --- Families --------------------------------------------------------------

function readFamily(record, { project, personByXref, unionByXref, warnings }) {
  const husband = personByXref.get(childValue(record, 'HUSB'));
  const wife = personByXref.get(childValue(record, 'WIFE'));
  const parents = [husband, wife].filter(Boolean);

  if (parents.length === 0) {
    warnings.push({ reason: 'FAMILY_WITHOUT_PARENTS', line: record.line, text: record.xref });
    unionByXref.set(record.xref, { unionId: null, parentIds: [] });
    return;
  }

  // A family with a single parent is a real thing — an unknown spouse — and
  // does not become a union: a union needs two people.
  if (parents.length === 1) {
    unionByXref.set(record.xref, { unionId: null, parentIds: [parents[0].id] });
    return;
  }

  const marriage = child(record, 'MARR');
  const divorce = child(record, 'DIV');
  const declared = childValue(record, '_UTYPE');

  const union = createUnion({
    partner1Id: parents[0].id,
    partner2Id: parents[1].id,
    // Our own export writes _UTYPE; anything else is read the standard way,
    // where the presence of a MARR event is what makes it a marriage.
    type: Object.values(UnionType).includes(declared)
      ? declared
      : marriage
        ? UnionType.MARRIED
        : UnionType.UNKNOWN,
    startDate: marriage ? parseDate(childValue(marriage, 'DATE')) : null,
    endDate: divorce ? parseDate(childValue(divorce, 'DATE')) : null,
    notes: children(record, 'NOTE')
      .map((note) => note.value)
      .join('\n\n'),
  });

  project.unions.push(union);
  unionByXref.set(record.xref, { unionId: union.id, parentIds: parents.map((p) => p.id) });
}

// --- Media -----------------------------------------------------------------

const DOC_EXTS = new Set([
  'pdf',
  'docx',
  'doc',
  'xlsx',
  'xls',
  'odt',
  'ods',
  'pptx',
  'ppt',
  'txt',
  'csv',
  'rtf',
]);

const DOC_MIMES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/ms-excel',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/ms-powerpoint',
  txt: 'text/plain',
  csv: 'text/csv',
  rtf: 'application/rtf',
};

function readObject(record) {
  const file = child(record, 'FILE');
  if (!file?.value) return null;

  const form = childValue(file, 'FORM').toLowerCase() || childValue(record, 'FORM').toLowerCase();
  const path = file.value.replace(/\\/g, '/');
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const isDoc = DOC_EXTS.has(form) || DOC_EXTS.has(ext) || path.startsWith('documents/');

  const mime = isDoc
    ? DOC_MIMES[form] || DOC_MIMES[ext] || 'application/octet-stream'
    : `image/${form || 'jpeg'}`;

  return createMediaObject({
    kind: isDoc ? MediaKind.DOCUMENT : MediaKind.PHOTO,
    path,
    hash: childValue(record, '_HASH'),
    mime,
    bytes: 0,
    caption: childValue(file, 'TITL') || childValue(record, 'TITL'),
  });
}

function attachMedia(records, personByXref, mediaByXref) {
  for (const record of records.filter((r) => r.tag === 'INDI')) {
    const person = personByXref.get(record.xref);
    if (!person) continue;

    for (const reference of children(record, 'OBJE')) {
      const item = mediaByXref.get(reference.value);
      if (!item) continue;

      const role = childValue(reference, '_ROLE');
      item.links.push(
        mediaLink(
          person.id,
          role === MediaRole.PORTRAIT ? MediaRole.PORTRAIT : MediaRole.ATTACHMENT,
        ),
      );
    }
  }
}
