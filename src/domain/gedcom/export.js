/**
 * GEDCOM 5.5.1 export (gedcom-mapping.md).
 *
 * Pure: project in, text out. No DOM, no disk.
 *
 * The JSON is the source of truth and this is a projection of it. The export
 * loses information, and which information is documented rather than hidden:
 * certainty, the exact flavour of an unmarried union, media roles and hashes
 * survive only as `_` extension tags that other applications ignore.
 *
 * 5.5.1 rather than 7.0 because 5.5.1 is what every existing genealogy
 * application reads, and being read by them is the entire point of exporting.
 */

import { ParentType, UnionType, Certainty, MediaKind } from '../model/factories.js';

const APP = 'AncesTree';
const MAX_LINE = 248; // 255 minus room for the level and tag of a CONC

/** ParentChild.type -> the PEDI value 5.5.1 understands. */
const PEDIGREE = {
  [ParentType.BIOLOGICAL]: 'birth',
  [ParentType.ADOPTED]: 'adopted',
  [ParentType.FOSTER]: 'foster',
  [ParentType.STEP]: 'foster',
  [ParentType.GUARDIAN]: 'foster',
};

/**
 * @param {object} project
 * @param {{now?: string}} [options]  the header date, injected so the output
 *   is reproducible in tests
 * @returns {string} the full GEDCOM file
 */
export function exportGedcom(project, { now = new Date() } = {}) {
  const out = new Writer();
  const xref = buildXrefs(project);
  const families = buildFamilies(project);
  const media = buildMediaLinks(project);

  writeHeader(out, project, now);

  for (const person of project.persons) {
    writeIndividual(out, person, { xref, families, media });
  }

  for (const family of families.all) {
    writeFamily(out, family, { project, xref });
  }

  for (const item of project.media) {
    writeObject(out, item, xref);
  }

  out.line(0, 'TRLR');
  return out.toString();
}

// --- Cross-reference ids ---------------------------------------------------

/**
 * GEDCOM identifies records by @I1@-style pointers. They are generated per
 * export and never stored: the model's UUIDs are the real identity, and
 * keeping a stable mapping between the two would buy nothing.
 */
function buildXrefs(project) {
  const map = new Map();
  project.persons.forEach((person, index) => map.set(person.id, `@I${index + 1}@`));
  project.media.forEach((item, index) => map.set(item.id, `@O${index + 1}@`));
  return map;
}

/**
 * GEDCOM groups parenthood by family; the model records one edge per parent.
 * Edges are gathered back into families here, and edges with no union get a
 * synthetic family with a single parent.
 */
function buildFamilies(project) {
  const byUnion = new Map();
  const all = [];

  for (const union of project.unions) {
    const family = {
      xref: `@F${all.length + 1}@`,
      union,
      parentIds: [union.partner1Id, union.partner2Id],
      children: [],
    };
    byUnion.set(union.id, family);
    all.push(family);
  }

  const soloByParent = new Map();

  for (const link of project.parentChildren) {
    const family = link.unionId ? byUnion.get(link.unionId) : null;

    if (family) {
      family.children.push(link);
      continue;
    }

    let solo = soloByParent.get(link.parentId);
    if (!solo) {
      solo = {
        xref: `@F${all.length + 1}@`,
        union: null,
        parentIds: [link.parentId],
        children: [],
      };
      soloByParent.set(link.parentId, solo);
      all.push(solo);
    }
    solo.children.push(link);
  }

  const childFamilies = new Map();
  const spouseFamilies = new Map();

  for (const family of all) {
    for (const parentId of family.parentIds) push(spouseFamilies, parentId, family);
    for (const link of family.children) push(childFamilies, link.childId, { family, link });
  }

  return { all, childFamilies, spouseFamilies };
}

/** The parent links a child has, gathered per family. */
function groupByFamily(entries = []) {
  const byFamily = new Map();

  for (const { family, link } of entries) {
    const links = byFamily.get(family.xref);
    if (links) links.push(link);
    else byFamily.set(family.xref, [link]);
  }

  return byFamily;
}

/** personId -> the media attached to them, carrying the role of the link. */
function buildMediaLinks(project) {
  const map = new Map();

  for (const item of project.media) {
    for (const link of item.links ?? []) {
      if (link.targetType !== 'person') continue;
      push(map, link.targetId, { ...item, role: link.role });
    }
  }

  return map;
}

// --- Records ---------------------------------------------------------------

function writeHeader(out, project, now) {
  out.line(0, 'HEAD');
  out.line(1, 'SOUR', APP);
  out.line(2, 'VERS', project.app?.version ?? '0.0.0');
  out.line(2, 'NAME', APP);
  out.line(1, 'GEDC');
  out.line(2, 'VERS', '5.5.1');
  out.line(2, 'FORM', 'LINEAGE-LINKED');
  out.line(1, 'CHAR', 'UTF-8');
  out.line(1, 'DATE', gedcomDate(now));
  if (project.project?.title) out.text(1, 'NOTE', project.project.title);
}

function writeIndividual(out, person, { xref, families, media }) {
  out.line(0, xref.get(person.id), 'INDI');

  // A placeholder is emitted without a NAME, which is the usual convention for
  // "someone was here and we do not know who".
  if (!person.isPlaceholder || person.firstName || person.lastName) {
    // GEDCOM has one surname field, so the two go into it separated by a
    // space, which is how a Spanish name is written anyway. _SURN2 keeps the
    // split so our own import can restore it; other applications ignore it and
    // still read a correct full name.
    const surnames = [person.lastName, person.secondLastName].filter(Boolean).join(' ');

    out.line(1, 'NAME', `${person.firstName} /${surnames}/`.trim());
    if (person.firstName) out.line(2, 'GIVN', person.firstName);
    if (surnames) out.line(2, 'SURN', surnames);
    if (person.secondLastName) out.line(2, '_SURN2', person.secondLastName);
  }

  for (const alias of person.alsoKnownAs ?? []) {
    out.line(1, 'NAME', alias);
    out.line(2, 'TYPE', 'aka');
  }

  out.line(1, 'SEX', person.sex);

  // NATI is a standard 5.5.1 attribute, so other applications understand it.
  if (person.nationality) out.line(1, 'NATI', person.nationality);

  writeEvent(out, 'BIRT', person.birth);
  writeEvent(out, 'DEAT', person.death);

  if (person.notes) out.text(1, 'NOTE', person.notes);

  // FAMC: the families this person is a child in. ONE line per family, not per
  // parent — the model holds an edge per parent, and writing one FAMC for each
  // produced a duplicate pointer to the same family, which is invalid and came
  // back on import as two sets of links.
  //
  // PEDI belongs to the family link, so both parents share it. That is the one
  // place where GEDCOM cannot express what the model holds, and the biological
  // link wins when they disagree.
  for (const [xref, links] of groupByFamily(families.childFamilies.get(person.id))) {
    const link = links.find((l) => l.type === ParentType.BIOLOGICAL) ?? links[0];

    out.line(1, 'FAMC', xref);
    out.line(2, 'PEDI', PEDIGREE[link.type] ?? 'birth');
    if (link.certainty !== Certainty.CONFIRMED) out.line(2, '_CERT', link.certainty);
    if (link.type === ParentType.STEP || link.type === ParentType.GUARDIAN) {
      out.line(2, '_REL', link.type);
    }
  }

  for (const family of families.spouseFamilies.get(person.id) ?? []) {
    out.line(1, 'FAMS', family.xref);
  }

  for (const item of media.get(person.id) ?? []) {
    out.line(1, 'OBJE', xref.get(item.id));
    if (item.role) out.line(2, '_ROLE', item.role);
  }

  if (person.updatedAt) {
    out.line(1, 'CHAN');
    out.line(2, 'DATE', gedcomDate(new Date(person.updatedAt)));
  }
}

function writeFamily(out, family, { project, xref }) {
  out.line(0, family.xref, 'FAM');

  // HUSB and WIFE assume a heterosexual marriage. When the sexes do not fit,
  // the partners are written in their stored order and a note says so, rather
  // than the model being bent to suit the format.
  const parents = family.parentIds.map((id) => project.persons.find((p) => p.id === id));
  const husband = parents.find((p) => p?.sex === 'M') ?? parents[0];
  const wife = parents.find((p) => p && p !== husband) ?? null;

  if (husband) out.line(1, 'HUSB', xref.get(husband.id));
  if (wife) out.line(1, 'WIFE', xref.get(wife.id));

  const ambiguous = parents.length === 2 && !(husband?.sex === 'M' && wife?.sex === 'F');
  if (ambiguous) out.text(1, 'NOTE', 'HUSB/WIFE assigned by record order, not by sex.');

  for (const link of family.children) out.line(1, 'CHIL', xref.get(link.childId));

  const union = family.union;
  if (!union) return;

  // An unmarried union is a FAM with no MARR event, which is the closest thing
  // 5.5.1 has. The exact kind survives as an extension for our own round trip.
  if (union.type === UnionType.MARRIED || union.startDate?.raw) {
    out.line(1, 'MARR');
    if (union.startDate?.raw) out.line(2, 'DATE', union.startDate.raw);
  }

  if (union.endDate?.raw) {
    out.line(1, 'DIV');
    out.line(2, 'DATE', union.endDate.raw);
  }

  if (union.type !== UnionType.MARRIED) out.line(1, '_UTYPE', union.type);
  if (union.notes) out.text(1, 'NOTE', union.notes);
}

function writeObject(out, item, xref) {
  out.line(0, xref.get(item.id), 'OBJE');
  out.line(1, 'FILE', item.path);
  out.line(2, 'FORM', formatOf(item));
  if (item.caption) out.line(2, 'TITL', item.caption);
  if (item.takenDate?.raw) out.text(1, 'NOTE', `Taken ${item.takenDate.raw}`);
  if (item.hash) out.line(1, '_HASH', item.hash);
}

const formatOf = (item) => {
  if (item.kind === MediaKind.DOCUMENT) {
    const ext = item.path?.split('.').pop()?.toLowerCase();
    if (
      ext &&
      [
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
      ].includes(ext)
    ) {
      return ext;
    }
    return 'pdf';
  }
  return item.mime?.split('/')[1] ?? 'jpeg';
};

function writeEvent(out, tag, event) {
  if (!event || (!event.date?.raw && !event.place)) return;
  out.line(1, tag);
  if (event.date?.raw) out.line(2, 'DATE', event.date.raw);
  if (event.place) out.line(2, 'PLAC', event.place);
}

// --- Writing ---------------------------------------------------------------

class Writer {
  #lines = [];

  /** line(level, tag, value) or line(level, xref, tag) for record starts. */
  line(level, ...parts) {
    const text = [String(level), ...parts.filter((p) => p !== '' && p !== undefined)].join(' ');
    this.#lines.push(text);
  }

  /**
   * A value that may be long or contain newlines. 5.5.1 caps a line at 255
   * characters, so continuations are split across CONC, and real line breaks
   * become CONT.
   */
  text(level, tag, value) {
    const paragraphs = String(value).split(/\r?\n/);

    paragraphs.forEach((paragraph, index) => {
      const chunks = split(paragraph, MAX_LINE);
      const first = chunks.shift() ?? '';

      if (index === 0) this.line(level, tag, first);
      else this.line(level + 1, 'CONT', first);

      for (const chunk of chunks) this.line(level + 1, 'CONC', chunk);
    });
  }

  /** GEDCOM files are CRLF-terminated, including the last line. */
  toString() {
    return `${this.#lines.join('\r\n')}\r\n`;
  }
}

function split(text, size) {
  if (text.length <= size) return [text];
  const chunks = [];
  for (let at = 0; at < text.length; at += size) chunks.push(text.slice(at, at + size));
  return chunks;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const gedcomDate = (date) =>
  `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;

function push(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
