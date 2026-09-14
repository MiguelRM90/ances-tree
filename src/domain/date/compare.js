/**
 * Comparison of genealogical dates.
 *
 * Comparing two uncertain dates does not yield a boolean but one of three
 * states. EVERY temporal validation goes through here, never through a plain
 * `<` (data-model.md, date comparison section).
 */

import { anchorOf } from './parse.js';

export const Comparison = {
  CERTAIN: 'CERTAIN',
  POSSIBLE: 'POSSIBLE',
  IMPOSSIBLE: 'IMPOSSIBLE',
};

/**
 * Can `a` be earlier than `b`?
 *
 *   CERTAIN     - it definitely is
 *   IMPOSSIBLE  - it cannot be, under any reading
 *   POSSIBLE    - the intervals overlap, or information is missing
 *
 * The rule that ties this to validation: only IMPOSSIBLE may produce an ERROR.
 * An overlap never does.
 */
export function isBefore(a, b) {
  if (!a || !b) return Comparison.POSSIBLE;
  if (a.latest !== null && b.earliest !== null && a.latest < b.earliest) return Comparison.CERTAIN;
  if (a.earliest !== null && b.latest !== null && a.earliest > b.latest)
    return Comparison.IMPOSSIBLE;
  return Comparison.POSSIBLE;
}

/**
 * Range of years elapsed between two uncertain dates: the minimum and maximum
 * compatible with both intervals.
 *
 * Used by the age rules (PARENT_TOO_YOUNG, MAX_MOTHER_AGE, ...), which need to
 * know whether an unlikely age is *possible*, not merely whether it is likely.
 *
 * @returns {{min: number|null, max: number|null}}
 */
export function yearsBetween(from, to) {
  if (!from || !to) return { min: null, max: null };
  return {
    min: diffYears(from.latest, to.earliest),
    max: diffYears(from.earliest, to.latest),
  };
}

/** Whole years between two ISO 'YYYY-MM-DD' values. null if a bound is open. */
function diffYears(fromIso, toIso) {
  if (fromIso === null || toIso === null) return null;
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years -= 1;
  return years;
}

/** Whole months between two ISO dates. Used by the posthumous-birth rules. */
export function monthsBetween(fromIso, toIso) {
  if (fromIso === null || toIso === null) return null;
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months;
}

/** true when the date provides no bound at all. */
export function isOpen(date) {
  return !date || (date.earliest === null && date.latest === null);
}

/**
 * Does the order the user actually wrote look wrong?
 *
 * Overlapping intervals mean "cannot be ruled out", which is not the same as
 * "suspicious". Someone born AFT 1700 who died BEF 1755 has intervals that
 * overlap — [1701, ∞) against (-∞, 1754] — yet nothing about those dates is
 * odd, and warning about them buries the real problems in noise.
 *
 * Comparing the values as written keeps the signal: ABT 1900 followed by 1898
 * still reads as inverted and still deserves a warning.
 */
export function looksInverted(a, b) {
  const from = anchorOf(a);
  const to = anchorOf(b);
  if (from === null || to === null) return false;
  return from > to;
}
