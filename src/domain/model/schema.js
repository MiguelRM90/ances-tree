/**
 * Shape validation for family.json and the migration policy
 * (data-model.md, schema versioning section).
 *
 * This does NOT check genealogical rules — that is domain/validation. Here we
 * only check that the file looks like a family.json.
 *
 * Firm rule: anything coming from outside is validated before use. An imported
 * JSON file is external data, exactly as if it came from an API.
 */

import {
  SCHEMA_VERSION,
  Sex,
  UnionType,
  ParentType,
  Certainty,
  MediaKind,
  MediaRole,
} from './factories.js';
import { parseDate, unknownDate } from '../date/parse.js';
import { isCountryCode } from './countries.js';

const COLLECTIONS = ['persons', 'unions', 'parentChildren', 'media'];

/**
 * No migrations yet, on purpose.
 *
 * The schema is still being designed, so it stays at version 1 and changes in
 * place. Writing a migration per field while the shape is still moving is
 * bookkeeping for versions nobody ever had.
 *
 * Every field so far is additive with a safe default and normalizeProject
 * fills them in, so a file written by an older build still opens. The
 * migration chain — and the refusal to open a file from a later version —
 * arrive when v1 actually ships, which is the point at which a version number
 * starts meaning anything.
 */

export class SchemaError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.detail = detail;
  }
}

/**
 * @returns {{ok: true, data: object} | {ok: false, errors: SchemaError[]}}
 */
export function parseProject(rawText) {
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (cause) {
    return { ok: false, errors: [new SchemaError('INVALID_JSON', cause.message)] };
  }
  return validateProject(data);
}

export function validateProject(data) {
  const errors = [];

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: [new SchemaError('NOT_AN_OBJECT', 'root is not an object')] };
  }

  if (!Number.isInteger(data.schemaVersion)) {
    errors.push(new SchemaError('MISSING_VERSION', 'schemaVersion is required'));
  } else if (data.schemaVersion > SCHEMA_VERSION) {
    errors.push(
      new SchemaError(
        'FUTURE_VERSION',
        `schemaVersion ${data.schemaVersion} requires a newer version of AncesTree`,
      ),
    );
  }

  for (const key of COLLECTIONS) {
    if (!Array.isArray(data[key])) {
      errors.push(new SchemaError('MISSING_COLLECTION', `${key} must be an array`));
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, data: normalizeProject(data) };
}

/**
 * Fills in defaults and rebuilds every derived date field from `raw`, which is
 * the only source of truth. Unknown enum values degrade instead of failing the
 * whole import (validation-rules.md, INVALID_ENUM).
 */
export function normalizeProject(data) {
  return {
    // Whatever came in, what leaves is the current version.
    schemaVersion: SCHEMA_VERSION,
    app: data.app ?? { name: 'AncesTree', version: '0.0.0' },
    project: data.project ?? { id: crypto.randomUUID(), title: 'Untitled family' },
    settings: {
      focalPersonId: data.settings?.focalPersonId ?? null,
      maxGenerationsUp: numberOr(data.settings?.maxGenerationsUp, 4),
      maxGenerationsDown: numberOr(data.settings?.maxGenerationsDown, 4),
      stripExifOnImport: data.settings?.stripExifOnImport !== false,
    },
    persons: data.persons.map(normalizePerson),
    unions: data.unions.map(normalizeUnion),
    parentChildren: data.parentChildren.map(normalizeParentChild),
    media: data.media.map(normalizeMedia),
  };
}

function normalizePerson(p) {
  return {
    id: String(p.id),
    firstName: stringOr(p.firstName),
    lastName: stringOr(p.lastName),
    secondLastName: stringOr(p.secondLastName),
    alsoKnownAs: Array.isArray(p.alsoKnownAs) ? p.alsoKnownAs.map((v) => stringOr(v)) : [],
    sex: enumOr(p.sex, Sex, Sex.UNKNOWN),
    // An unrecognised code is dropped rather than kept: a flag for a country
    // that does not exist is worse than no flag.
    nationality: isCountryCode(p.nationality) ? p.nationality : '',
    birth: normalizeEvent(p.birth),
    death: normalizeEvent(p.death),
    isPlaceholder: p.isPlaceholder === true,
    notes: stringOr(p.notes),
    createdAt: stringOr(p.createdAt),
    updatedAt: stringOr(p.updatedAt),
  };
}

function normalizeEvent(event) {
  if (!event) return null;
  return { date: normalizeDate(event.date), place: stringOr(event.place) };
}

/** earliest/latest are derived: always recomputed from `raw`. */
function normalizeDate(date) {
  if (!date) return unknownDate();
  return parseDate(typeof date === 'string' ? date : (date.raw ?? ''));
}

function normalizeUnion(u) {
  return {
    id: String(u.id),
    partner1Id: String(u.partner1Id),
    partner2Id: String(u.partner2Id),
    type: enumOr(u.type, UnionType, UnionType.UNKNOWN),
    startDate: u.startDate ? normalizeDate(u.startDate) : null,
    endDate: u.endDate ? normalizeDate(u.endDate) : null,
    notes: stringOr(u.notes),
  };
}

function normalizeParentChild(pc) {
  return {
    id: String(pc.id),
    parentId: String(pc.parentId),
    childId: String(pc.childId),
    type: enumOr(pc.type, ParentType, ParentType.BIOLOGICAL),
    unionId: pc.unionId ? String(pc.unionId) : null,
    certainty: enumOr(pc.certainty, Certainty, Certainty.CONFIRMED),
  };
}

function normalizeMedia(m) {
  return {
    id: String(m.id),
    kind: enumOr(m.kind, MediaKind, MediaKind.PHOTO),
    path: safeMediaPath(m.path),
    hash: stringOr(m.hash),
    mime: stringOr(m.mime),
    bytes: numberOr(m.bytes, 0),
    width: Number.isFinite(m.width) ? m.width : null,
    height: Number.isFinite(m.height) ? m.height : null,
    caption: stringOr(m.caption),
    takenDate: m.takenDate ? normalizeDate(m.takenDate) : null,
    links: Array.isArray(m.links) ? m.links.map(normalizeMediaLink).filter(Boolean) : [],
    exifStripped: m.exifStripped === true,
  };
}

function normalizeMediaLink(link) {
  if (!link || typeof link !== 'object') return null;
  const targetId =
    typeof link.targetId === 'string'
      ? link.targetId.trim()
      : typeof link.targetId === 'number'
        ? String(link.targetId)
        : '';
  if (targetId === '') return null;

  return {
    targetType: 'person',
    targetId,
    role: enumOr(link.role, MediaRole, MediaRole.ATTACHMENT),
  };
}

/**
 * Validates that a media path is a safe relative path under `photos/` or `documents/`.
 * Returns '' if the path is missing or unsafe.
 */
export function safeMediaPath(raw) {
  if (typeof raw !== 'string') return '';
  const normalized = raw.replace(/\\/g, '/').trim();
  if (normalized === '' || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) return '';

  const segments = normalized.split('/');
  if (segments.length < 2) return '';
  if (segments[0] !== 'photos' && segments[0] !== 'documents') return '';
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return '';

  return normalized;
}

const stringOr = (value, fallback = '') => (typeof value === 'string' ? value : fallback);
const numberOr = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const enumOr = (value, allowed, fallback) =>
  Object.values(allowed).includes(value) ? value : fallback;
