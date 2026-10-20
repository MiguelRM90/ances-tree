/**
 * Human-readable rendering of genealogical dates.
 *
 * Numeric parts are formatted with Intl, so the order follows the reader's
 * locale on its own: 12/05/1912 in Spain, 05/12/1912 in the United States. The
 * app never picks one order and imposes it.
 *
 * Subtle point: for qualified dates the derived interval is NOT shown, the
 * value the user typed is. "ABT 1885" reads as "about 1885", not "about 1880" —
 * the [1880, 1890] interval exists to validate and sort, not to be displayed.
 */

import { DateKind, Precision, anchorOf, yearOf } from './parse.js';
import { en } from '../../config/locales/en.js';
import { es } from '../../config/locales/es.js';

const dictionaryFor = (locale) =>
  String(locale ?? '')
    .slice(0, 2)
    .toLowerCase() === 'es'
    ? es
    : en;

// Intl.DateTimeFormat is expensive to build, so instances are reused.
const formatters = new Map();

function formatter(locale, options) {
  const key = `${locale ?? ''}|${options.day ?? ''}|${options.month}`;
  let instance = formatters.get(key);
  if (!instance) {
    instance = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
    formatters.set(key, instance);
  }
  return instance;
}

/**
 * @param {import('./parse.js').GenealogicalDate|null} date
 * @param {string} [locale]  defaults to the runtime locale
 * @returns {string} empty string when there is no date
 */
export function formatDate(date, locale) {
  if (!date || date.kind === DateKind.UNKNOWN) return date?.raw ?? '';

  const dict = dictionaryFor(locale).dateFormat;

  if (date.kind === DateKind.BETWEEN) {
    return dict.between(yearOf(date.earliest), yearOf(date.latest));
  }

  const point = formatPoint(anchorOf(date), date.precision, locale);
  const qualifier = dict[date.kind];

  return qualifier ? `${qualifier} ${point}` : point;
}

/** Short form for the tree cards: the year only. */
export function formatYear(date) {
  if (!date || date.kind === DateKind.UNKNOWN) return '';

  const year = yearOf(anchorOf(date));
  if (year === null) return '';

  const isPrecise = date.kind === DateKind.EXACT || date.kind === DateKind.PARTIAL;
  return isPrecise ? String(year) : `~${year}`;
}

/**
 * '1885 – 1950' for the card. One open end is meaningful in genealogy and is
 * rendered as such: '1885 –' or '– 1950'.
 */
export function formatLifespan(birth, death) {
  const born = formatYear(birth?.date ?? null);
  const died = formatYear(death?.date ?? null);
  if (!born && !died) return '';
  return `${born} – ${died}`.trim();
}

function formatPoint(isoDate, precision, locale) {
  if (!isoDate) return '';

  const [year, month, day] = isoDate.split('-').map(Number);
  if (precision === Precision.YEAR || precision === Precision.NONE) return String(year);

  const value = new Date(Date.UTC(year, month - 1, day));

  if (precision === Precision.DAY) {
    return formatter(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(value);
  }

  // Intl quietly downgrades month: '2-digit' to numeric when no day is asked
  // for, giving '5/1912'. Rebuilding from the parts keeps the locale's order
  // and separators while restoring the padding.
  return formatter(locale, { month: '2-digit', year: 'numeric' })
    .formatToParts(value)
    .map((part) => (part.type === 'month' ? part.value.padStart(2, '0') : part.value))
    .join('');
}
