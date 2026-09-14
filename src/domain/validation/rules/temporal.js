/**
 * Temporal rules (validation-rules.md).
 *
 * GOLDEN RULE: only IMPOSSIBLE produces an ERROR. If the intervals overlap, or
 * information is missing, it is a WARNING at most. Real genealogy is full of
 * contradictory data and a tree that refuses to store it is useless.
 */

import { Severity, issue, subject } from '../issue.js';
import {
  isBefore,
  yearsBetween,
  monthsBetween,
  looksInverted,
  Comparison,
  isOpen,
} from '../../date/compare.js';
import { isBiological } from '../../graph/queries.js';
import { Sex } from '../../model/factories.js';
import {
  MIN_PARENT_AGE,
  MAX_MOTHER_AGE,
  MAX_LIFESPAN_YEARS,
  POSTHUMOUS_MARGIN_MONTHS,
  MIN_UNION_AGE,
} from '../../../config/limits.js';

const { ERROR, WARNING } = Severity;

/**
 * ERROR when impossible, WARNING when the written order looks wrong, nothing
 * otherwise.
 *
 * Overlapping intervals alone are not a warning. "Cannot be ruled out" is the
 * normal state of genealogical dates, and treating it as suspicious buried the
 * real problems under thousands of notes about perfectly sensible records.
 */
function gradeOrder(earlier, later) {
  const comparison = isBefore(earlier, later);
  if (comparison === Comparison.IMPOSSIBLE) return ERROR;
  if (comparison === Comparison.CERTAIN) return null;
  return looksInverted(earlier, later) ? WARNING : null;
}

const birthDate = (person) => person?.birth?.date ?? null;
const deathDate = (person) => person?.death?.date ?? null;

/** Death cannot precede birth. */
function deathBeforeBirth(g) {
  const found = [];
  for (const person of g.persons.values()) {
    const birth = birthDate(person);
    const death = deathDate(person);
    if (isOpen(birth) || isOpen(death)) continue;

    const severity = gradeOrder(birth, death);
    if (severity) {
      found.push(
        issue(
          'DEATH_BEFORE_BIRTH',
          severity,
          [subject('person', person.id)],
          'validation.deathBeforeBirth',
        ),
      );
    }
  }
  return found;
}

/** Lifespan above MAX_LIFESPAN_YEARS. Always a WARNING: usually a typo. */
function implausibleLifespan(g) {
  const found = [];
  for (const person of g.persons.values()) {
    const { min } = yearsBetween(birthDate(person), deathDate(person));
    if (min !== null && min > MAX_LIFESPAN_YEARS) {
      found.push(
        issue(
          'IMPLAUSIBLE_LIFESPAN',
          WARNING,
          [subject('person', person.id)],
          'validation.implausibleLifespan',
          { years: min },
        ),
      );
    }
  }
  return found;
}

/**
 * A biological parent born after their child (ERROR when impossible), plus the
 * milder case of a gap under MIN_PARENT_AGE — always a WARNING, since teenage
 * pregnancies are a historical fact.
 */
function parentAge(g) {
  const found = [];

  for (const link of g.parentChildren.values()) {
    if (!isBiological(link)) continue;

    const parent = g.persons.get(link.parentId);
    const child = g.persons.get(link.childId);
    const parentBirth = birthDate(parent);
    const childBirth = birthDate(child);
    if (isOpen(parentBirth) || isOpen(childBirth)) continue;

    const order = isBefore(parentBirth, childBirth);
    if (order === Comparison.IMPOSSIBLE) {
      found.push(
        issue(
          'PARENT_BORN_AFTER_CHILD',
          ERROR,
          [subject('person', parent.id), subject('person', child.id)],
          'validation.parentBornAfterChild',
        ),
      );
      continue;
    }

    const { max } = yearsBetween(parentBirth, childBirth);
    if (max !== null && max < MIN_PARENT_AGE) {
      found.push(
        issue(
          'PARENT_TOO_YOUNG',
          WARNING,
          [subject('person', parent.id), subject('person', child.id)],
          'validation.parentTooYoung',
          { age: max, threshold: MIN_PARENT_AGE },
        ),
      );
    }

    // Biological mother only; with sex UNKNOWN the rule does not apply.
    if (parent.sex === Sex.FEMALE) {
      const { min } = yearsBetween(parentBirth, childBirth);
      if (min !== null && min > MAX_MOTHER_AGE) {
        found.push(
          issue(
            'PARENT_TOO_OLD',
            WARNING,
            [subject('person', parent.id), subject('person', child.id)],
            'validation.parentTooOld',
            { age: min, threshold: MAX_MOTHER_AGE },
          ),
        );
      }
    }
  }

  return found;
}

/**
 * A child cannot be born more than POSTHUMOUS_MARGIN_MONTHS after their
 * biological mother died. The margin covers immediate posthumous births.
 *
 * For the father it is ALWAYS a warning: late posthumous fatherhood is possible
 * today, and in old records it usually points to a wrong date rather than an
 * impossibility.
 */
function posthumousBirths(g) {
  const found = [];

  for (const link of g.parentChildren.values()) {
    if (!isBiological(link)) continue;

    const parent = g.persons.get(link.parentId);
    const child = g.persons.get(link.childId);
    const parentDeath = deathDate(parent);
    const childBirth = birthDate(child);
    if (isOpen(parentDeath) || isOpen(childBirth)) continue;

    const gapMonths = monthsBetween(parentDeath.latest, childBirth.earliest);
    if (gapMonths === null || gapMonths <= POSTHUMOUS_MARGIN_MONTHS) continue;

    const isMother = parent.sex === Sex.FEMALE;
    found.push(
      issue(
        isMother ? 'CHILD_AFTER_MOTHER_DEATH' : 'CHILD_LONG_AFTER_FATHER_DEATH',
        isMother ? ERROR : WARNING,
        [subject('person', parent.id), subject('person', child.id)],
        isMother ? 'validation.childAfterMotherDeath' : 'validation.childLongAfterFatherDeath',
        { months: gapMonths },
      ),
    );
  }

  return found;
}

/** Temporal coherence of unions. */
function unionDates(g) {
  const found = [];

  for (const union of g.unions.values()) {
    const start = union.startDate;
    const end = union.endDate;

    if (!isOpen(start) && !isOpen(end)) {
      const severity = gradeOrder(start, end);
      if (severity) {
        found.push(
          issue(
            'UNION_END_BEFORE_START',
            severity,
            [subject('union', union.id)],
            'validation.unionEndBeforeStart',
          ),
        );
      }
    }

    if (isOpen(start)) continue;

    for (const partnerId of [union.partner1Id, union.partner2Id]) {
      const person = g.persons.get(partnerId);
      if (!person) continue;

      const death = deathDate(person);
      if (!isOpen(death)) {
        const severity = gradeOrder(start, death);
        if (severity) {
          found.push(
            issue(
              'UNION_AFTER_DEATH',
              severity,
              [subject('union', union.id), subject('person', partnerId)],
              'validation.unionAfterDeath',
            ),
          );
        }
      }

      const birth = birthDate(person);
      if (isOpen(birth)) continue;

      const order = isBefore(birth, start);
      if (order === Comparison.IMPOSSIBLE) {
        found.push(
          issue(
            'UNION_BEFORE_BIRTH',
            ERROR,
            [subject('union', union.id), subject('person', partnerId)],
            'validation.unionBeforeBirth',
          ),
        );
        continue;
      }

      const { max } = yearsBetween(birth, start);
      if (max !== null && max < MIN_UNION_AGE) {
        found.push(
          issue(
            'UNION_TOO_YOUNG',
            WARNING,
            [subject('union', union.id), subject('person', partnerId)],
            'validation.unionTooYoung',
            { age: max },
          ),
        );
      }
    }
  }

  return found;
}

export const temporalRules = [
  deathBeforeBirth,
  implausibleLifespan,
  parentAge,
  posthumousBirths,
  unionDates,
];
