/**
 * Coherence and completeness rules (validation-rules.md).
 *
 * None of these block. INFO issues are additionally kept OFF the person card
 * and confined to the review panel: turning the app into a to-do list that
 * nags the user is the fastest way to make them abandon it.
 */

import { Severity, issue, subject } from '../issue.js';
import { closestCommonAncestor } from '../../graph/traversal.js';
import { biologicalParentIds, childLinksOf, unionsOf } from '../../graph/queries.js';
import { Sex } from '../../model/factories.js';
import { CONSANGUINITY_MAX_DEPTH, MAX_LIFESPAN_YEARS } from '../../../config/limits.js';

const { WARNING, INFO } = Severity;

/**
 * Both members of a union with children share an ancestor.
 *
 * Explicitly does NOT block: unions between relatives are a frequent historical
 * fact and recording them is part of the job. Computing the consanguinity
 * coefficient is out of scope for the MVP; this only detects the shared
 * ancestor.
 */
function consanguineousUnions(g) {
  const found = [];

  for (const union of g.unions.values()) {
    if (!g.childrenByUnion.has(union.id)) continue;

    const common = closestCommonAncestor(
      g,
      union.partner1Id,
      union.partner2Id,
      CONSANGUINITY_MAX_DEPTH,
    );
    if (!common) continue;

    // The subjects are the couple, NOT the shared ancestor.
    //
    // The ancestor was in this list so the interface could name them, and the
    // effect was that every warning landed on their card: one founder was
    // carrying eleven notes, none of which were about him, because eleven of
    // his descendants had married cousins. Context belongs in params.
    found.push(
      issue(
        'CONSANGUINEOUS_UNION',
        WARNING,
        [
          subject('union', union.id),
          subject('person', union.partner1Id),
          subject('person', union.partner2Id),
        ],
        'validation.consanguineousUnion',
        { ancestorId: common.ancestorId, generations: Math.max(common.depthA, common.depthB) },
      ),
    );
  }

  return found;
}

/** Someone listed as a parent of their own sibling. */
function siblingAsParent(g) {
  const found = [];

  for (const link of g.parentChildren.values()) {
    const parentParents = biologicalParentIds(g, link.parentId);
    if (parentParents.size === 0) continue;

    const childParents = biologicalParentIds(g, link.childId);
    const shared = [...parentParents].some((id) => childParents.has(id));

    if (shared) {
      found.push(
        issue(
          'SIBLING_AS_PARENT',
          WARNING,
          [subject('parentChild', link.id)],
          'validation.siblingAsParent',
        ),
      );
    }
  }

  return found;
}

/** Completeness. All INFO, all review-panel only. */
function completeness(g) {
  const found = [];
  const thisYear = new Date().getUTCFullYear();

  for (const person of g.persons.values()) {
    if (person.isPlaceholder) continue;

    const subjects = [subject('person', person.id)];

    if (!person.birth?.date?.raw) {
      found.push(issue('MISSING_BIRTH_DATE', INFO, subjects, 'validation.missingBirthDate'));
    }
    if (person.lastName.trim() === '') {
      found.push(issue('MISSING_SURNAME', INFO, subjects, 'validation.missingSurname'));
    }
    if (person.sex === Sex.UNKNOWN) {
      found.push(issue('MISSING_SEX', INFO, subjects, 'validation.missingSex'));
    }

    const hasParents = (g.parentsByChild.get(person.id) ?? []).length > 0;
    const hasChildren = childLinksOf(g, person.id).length > 0;
    const hasUnions = unionsOf(g, person.id).length > 0;

    if (!hasParents && !hasChildren && !hasUnions) {
      found.push(issue('ORPHAN_PERSON', INFO, subjects, 'validation.orphanPerson'));
    }

    const bornAt = person.birth?.date?.latest ?? null;
    if (bornAt !== null && !person.death?.date?.raw) {
      const year = Number(bornAt.slice(0, 4));
      if (thisYear - year > MAX_LIFESPAN_YEARS) {
        found.push(
          issue('LIVING_PERSON_NO_DEATH', INFO, subjects, 'validation.livingPersonNoDeath'),
        );
      }
    }
  }

  return found;
}

export const coherenceRules = [consanguineousUnions, siblingAsParent, completeness];
