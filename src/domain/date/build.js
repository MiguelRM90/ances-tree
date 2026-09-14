/**
 * Composing and decomposing the `raw` of a genealogical date.
 *
 * This is what lets the editor offer a proper control per kind of date — a
 * native date picker, a month picker, a year box — while the model keeps
 * storing a single GEDCOM-shaped `raw` string. The UI is only a builder for
 * that string; it never becomes a second source of truth.
 *
 * Pure, so the whole thing is testable without a browser.
 */

import { DateKind, Precision, parseDate, anchorOf, yearOf } from './parse.js';

/**
 * Editor modes. Finer than DateKind, because "month and year" and "year only"
 * are both PARTIAL in the model but need different inputs.
 */
export const DateMode = {
  UNKNOWN: 'UNKNOWN',
  EXACT: 'EXACT',
  MONTH: 'MONTH',
  YEAR: 'YEAR',
  ABOUT: 'ABOUT',
  ESTIMATED: 'ESTIMATED',
  BEFORE: 'BEFORE',
  AFTER: 'AFTER',
  BETWEEN: 'BETWEEN',
  RAW: 'RAW',
};

/** Which control each mode needs. Drives what the editor renders. */
export const MODE_INPUT = {
  [DateMode.UNKNOWN]: 'none',
  [DateMode.EXACT]: 'date',
  [DateMode.MONTH]: 'month',
  [DateMode.YEAR]: 'year',
  [DateMode.ABOUT]: 'year',
  [DateMode.ESTIMATED]: 'year',
  [DateMode.BEFORE]: 'year',
  [DateMode.AFTER]: 'year',
  [DateMode.BETWEEN]: 'year-range',
  [DateMode.RAW]: 'text',
};

const GEDCOM_MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

const QUALIFIER_TAG = {
  [DateMode.ABOUT]: 'ABT',
  [DateMode.ESTIMATED]: 'EST',
  [DateMode.BEFORE]: 'BEF',
  [DateMode.AFTER]: 'AFT',
};

/**
 * Builds the GEDCOM `raw` string from what the editor collected.
 *
 * @param {string} mode
 * @param {{date?: string, month?: string, year?: string|number, from?: string|number, to?: string|number, text?: string}} values
 * @returns {string} empty string when there is nothing usable
 */
export function buildRaw(mode, values = {}) {
  switch (mode) {
    case DateMode.EXACT:
      return fromIsoDay(values.date);

    case DateMode.MONTH:
      return fromIsoMonth(values.month);

    case DateMode.YEAR:
      return year(values.year);

    case DateMode.ABOUT:
    case DateMode.ESTIMATED:
    case DateMode.BEFORE:
    case DateMode.AFTER: {
      const value = year(values.year);
      return value === '' ? '' : `${QUALIFIER_TAG[mode]} ${value}`;
    }

    case DateMode.BETWEEN: {
      const from = year(values.from);
      const to = year(values.to);
      return from === '' || to === '' ? '' : `BET ${from} AND ${to}`;
    }

    case DateMode.RAW:
      return String(values.text ?? '').trim();

    default:
      return '';
  }
}

/**
 * The reverse: works out which mode and values an existing date came from, so
 * reopening the editor shows the same control the user used.
 *
 * Anything the app cannot express with a dedicated control falls back to RAW,
 * which keeps exotic values editable instead of silently dropping them.
 *
 * @returns {{mode: string, values: object}}
 */
export function describeDate(date) {
  if (!date || date.raw.trim() === '') return { mode: DateMode.UNKNOWN, values: {} };

  const anchor = anchorOf(date);

  switch (date.kind) {
    case DateKind.EXACT:
      return { mode: DateMode.EXACT, values: { date: anchor } };

    case DateKind.PARTIAL:
      return date.precision === Precision.MONTH
        ? { mode: DateMode.MONTH, values: { month: anchor.slice(0, 7) } }
        : { mode: DateMode.YEAR, values: { year: yearOf(anchor) } };

    case DateKind.ABOUT:
    case DateKind.ESTIMATED:
    case DateKind.BEFORE:
    case DateKind.AFTER:
      // Only a plain year round-trips through the year box. "ABT 12 MAY 1885"
      // is legal GEDCOM, so it stays as raw text rather than losing its day.
      return date.precision === Precision.YEAR
        ? { mode: date.kind, values: { year: yearOf(anchor) } }
        : { mode: DateMode.RAW, values: { text: date.raw } };

    case DateKind.BETWEEN:
      return {
        mode: DateMode.BETWEEN,
        values: { from: yearOf(date.earliest), to: yearOf(date.latest) },
      };

    default:
      return { mode: DateMode.RAW, values: { text: date.raw } };
  }
}

/** Convenience for the editor: build and parse in one step. */
export const dateFrom = (mode, values) => parseDate(buildRaw(mode, values));

// --- Value coercion --------------------------------------------------------

/** '1912-05-12' (what <input type="date"> gives) -> '12 MAY 1912' */
function fromIsoDay(value) {
  if (!value) return '';
  const [y, m, d] = String(value).split('-').map(Number);
  if (!validMonth(m) || !Number.isInteger(d)) return '';
  return `${d} ${GEDCOM_MONTHS[m - 1]} ${y}`;
}

/** '1912-05' (what <input type="month"> gives) -> 'MAY 1912' */
function fromIsoMonth(value) {
  if (!value) return '';
  const [y, m] = String(value).split('-').map(Number);
  if (!validMonth(m)) return '';
  return `${GEDCOM_MONTHS[m - 1]} ${y}`;
}

function year(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 9999) return '';
  return String(number);
}

const validMonth = (m) => Number.isInteger(m) && m >= 1 && m <= 12;
