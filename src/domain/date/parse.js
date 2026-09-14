/**
 * Genealogical date parsing.
 *
 * The `raw` field is the source of truth and is NEVER lost or rewritten.
 * Everything else is derived and recomputed (data-model.md, dates section).
 *
 * The shape of `raw` is deliberately that of a GEDCOM DATE: it makes the
 * mapping in gedcom-mapping.md almost trivial.
 */

import { ABOUT_MARGIN_YEARS, ESTIMATED_MARGIN_YEARS } from '../../config/limits.js';

export const DateKind = {
  EXACT: 'EXACT',
  PARTIAL: 'PARTIAL',
  ABOUT: 'ABOUT',
  ESTIMATED: 'ESTIMATED',
  CALCULATED: 'CALCULATED',
  BEFORE: 'BEFORE',
  AFTER: 'AFTER',
  BETWEEN: 'BETWEEN',
  UNKNOWN: 'UNKNOWN',
};

export const Precision = {
  DAY: 'DAY',
  MONTH: 'MONTH',
  YEAR: 'YEAR',
  NONE: 'NONE',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const PREFIXES = {
  ABT: DateKind.ABOUT,
  EST: DateKind.ESTIMATED,
  CAL: DateKind.CALCULATED,
  BEF: DateKind.BEFORE,
  AFT: DateKind.AFTER,
};

/**
 * @typedef {Object} GenealogicalDate
 * @property {string} raw
 * @property {string} kind
 * @property {string|null} earliest  ISO 'YYYY-MM-DD'
 * @property {string|null} latest    ISO 'YYYY-MM-DD'
 * @property {string} precision
 */

/** @returns {GenealogicalDate} */
export function unknownDate(raw = '') {
  return { raw, kind: DateKind.UNKNOWN, earliest: null, latest: null, precision: Precision.NONE };
}

/**
 * Parses the text of a genealogical date.
 *
 * An unrecognised format is NOT discarded: it is kept in `raw` with kind
 * UNKNOWN and an open interval. It is the user's information even when the app
 * cannot interpret it.
 *
 * @param {string} raw
 * @returns {GenealogicalDate}
 */
export function parseDate(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return unknownDate('');

  const tokens = text.toUpperCase().split(/\s+/);

  if (tokens[0] === 'BET') return parseBetween(text, tokens);

  const kind = PREFIXES[tokens[0]];
  if (kind) return parsePrefixed(text, tokens.slice(1), kind);

  const span = parseSpan(tokens);
  if (!span) return unknownDate(text);

  return {
    raw: text,
    kind: span.precision === Precision.DAY ? DateKind.EXACT : DateKind.PARTIAL,
    earliest: span.earliest,
    latest: span.latest,
    precision: span.precision,
  };
}

function parseBetween(raw, tokens) {
  const andAt = tokens.indexOf('AND');
  if (andAt === -1) return unknownDate(raw);

  const from = parseSpan(tokens.slice(1, andAt));
  const to = parseSpan(tokens.slice(andAt + 1));
  if (!from || !to) return unknownDate(raw);

  return {
    raw,
    kind: DateKind.BETWEEN,
    earliest: from.earliest,
    latest: to.latest,
    precision: Precision.YEAR,
  };
}

function parsePrefixed(raw, tokens, kind) {
  const span = parseSpan(tokens);
  if (!span) return unknownDate(raw);

  switch (kind) {
    case DateKind.BEFORE:
      return {
        raw,
        kind,
        earliest: null,
        latest: shiftDays(span.earliest, -1),
        precision: span.precision,
      };

    case DateKind.AFTER:
      return {
        raw,
        kind,
        earliest: shiftDays(span.latest, 1),
        latest: null,
        precision: span.precision,
      };

    case DateKind.ABOUT:
      return { raw, kind, ...widen(span, ABOUT_MARGIN_YEARS), precision: span.precision };

    case DateKind.ESTIMATED:
      return { raw, kind, ...widen(span, ESTIMATED_MARGIN_YEARS), precision: span.precision };

    case DateKind.CALCULATED:
    default:
      // CAL is derived by calculation but still a point in time: same interval
      // as an exact date. The kind is kept so it can be displayed differently.
      return { raw, kind, earliest: span.earliest, latest: span.latest, precision: span.precision };
  }
}

/**
 * Turns ['12','MAY','1912'] / ['MAY','1912'] / ['1912'] into an interval.
 * Returns null when it matches no known pattern.
 */
function parseSpan(tokens) {
  const parts = tokens.filter(Boolean);
  if (parts.length === 0 || parts.length > 3) return null;

  const year = Number(parts[parts.length - 1]);
  if (!Number.isInteger(year) || year < 1 || year > 9999) return null;

  if (parts.length === 1) {
    return { earliest: iso(year, 1, 1), latest: iso(year, 12, 31), precision: Precision.YEAR };
  }

  const month = MONTHS.indexOf(parts[parts.length - 2]) + 1;
  if (month === 0) return null;

  if (parts.length === 2) {
    return {
      earliest: iso(year, month, 1),
      latest: iso(year, month, lastDayOfMonth(year, month)),
      precision: Precision.MONTH,
    };
  }

  const day = Number(parts[0]);
  if (!Number.isInteger(day) || day < 1 || day > lastDayOfMonth(year, month)) return null;

  return {
    earliest: iso(year, month, day),
    latest: iso(year, month, day),
    precision: Precision.DAY,
  };
}

function widen(span, years) {
  return {
    earliest: shiftYears(span.earliest, -years),
    latest: shiftYears(span.latest, years),
  };
}

// --- Date helpers ----------------------------------------------------------
// Dates are handled as ISO 'YYYY-MM-DD' strings, which compare correctly with
// < and >. Date is only used for arithmetic.

function iso(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftDays(isoDate, days) {
  if (isoDate === null) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function shiftYears(isoDate, years) {
  if (isoDate === null) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  const year = y + years;
  if (year < 1) return iso(1, 1, 1);
  if (year > 9999) return iso(9999, 12, 31);
  // 29 February in a non-leap year: clamp to the last day of the month.
  return iso(year, m, Math.min(d, lastDayOfMonth(year, m)));
}

const QUALIFIER_PREFIX = /^\s*(ABT|EST|CAL|BEF|AFT)\s+/i;

/**
 * The point in time the user actually wrote, ignoring any widening.
 *
 * For a qualified date the derived interval is not what should be shown or
 * edited: "ABT 1885" must read back as 1885, not as the [1880, 1890] range the
 * validator works with.
 *
 * @returns {string|null} ISO 'YYYY-MM-DD'
 */
export function anchorOf(date) {
  if (!date) return null;
  if (date.kind === DateKind.BETWEEN) return date.earliest;

  if (!QUALIFIER_PREFIX.test(date.raw)) return date.earliest ?? date.latest;

  const plain = parseDate(date.raw.replace(QUALIFIER_PREFIX, ''));
  return plain.earliest ?? date.earliest ?? date.latest;
}

export const yearOf = (isoDate) => (isoDate ? Number(isoDate.slice(0, 4)) : null);

export const __testables = { parseSpan, shiftDays, shiftYears, lastDayOfMonth };
