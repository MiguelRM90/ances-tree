/**
 * Structural rules: all ERROR (validation-rules.md).
 *
 * These are integrity violations, not judgements about the data. They block
 * saving.
 */

import { Severity, issue, subject } from '../issue.js';
import { isBiological, childLinksOf } from '../../graph/queries.js';
import { isBefore, Comparison } from '../../date/compare.js';

const E = Severity.ERROR;

/** A person cannot be their own parent. */
function selfParent(g) {
  const found = [];
  for (const link of g.parentChildren.values()) {
    if (link.parentId === link.childId) {
      found.push(
        issue(
          'SELF_PARENT',
          E,
          [subject('parentChild', link.id), subject('person', link.parentId)],
          'validation.selfParent',
        ),
      );
    }
  }
  return found;
}

/** Both members of a union cannot be the same person. */
function selfUnion(g) {
  const found = [];
  for (const union of g.unions.values()) {
    if (union.partner1Id === union.partner2Id) {
      found.push(issue('SELF_UNION', E, [subject('union', union.id)], 'validation.selfUnion'));
    }
  }
  return found;
}

/**
 * An ancestor cannot be a descendant of their own descendants.
 *
 * Evaluated over the complete graph without filtering by type: a loop through
 * an adoption is still a loop.
 */
function cycles(g) {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;

  const colour = new Map();
  const found = [];

  // One depth-first sweep over the whole graph, iterative so a deep lineage
  // cannot blow the call stack. A link that reaches a person still on the
  // current path — grey — is the edge that closes a loop.
  //
  // The obvious implementation, asking "would this link create a cycle?" once
  // per link, rebuilds the graph for every edge and costs O(E × (V + E)). On a
  // 10,000-person tree that measured 13 seconds. This is O(V + E).
  for (const rootId of g.persons.keys()) {
    if ((colour.get(rootId) ?? WHITE) !== WHITE) continue;

    colour.set(rootId, GREY);
    const stack = [{ personId: rootId, next: 0 }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const links = childLinksOf(g, frame.personId);

      if (frame.next >= links.length) {
        colour.set(frame.personId, BLACK);
        stack.pop();
        continue;
      }

      const link = links[frame.next];
      frame.next += 1;

      if (link.parentId === link.childId) continue; // covered by SELF_PARENT

      const state = colour.get(link.childId) ?? WHITE;

      if (state === GREY) {
        found.push(
          issue('CYCLE', E, [subject('parentChild', link.id)], 'validation.cycle', {
            parentId: link.parentId,
            childId: link.childId,
          }),
        );
      } else if (state === WHITE) {
        colour.set(link.childId, GREY);
        stack.push({ personId: link.childId, next: 0 });
      }
    }
  }

  return found;
}

/** There cannot be two links with the same parent + child pair. */
function duplicateEdges(g) {
  const seen = new Map();
  const found = [];

  for (const link of g.parentChildren.values()) {
    const key = `${link.parentId}|${link.childId}`;
    const first = seen.get(key);
    if (first) {
      found.push(
        issue(
          'DUPLICATE_EDGE',
          E,
          [subject('parentChild', first), subject('parentChild', link.id)],
          'validation.duplicateEdge',
        ),
      );
    } else {
      seen.set(key, link.id);
    }
  }

  return found;
}

/** At most two biological parents per child. */
function tooManyBiologicalParents(g) {
  const found = [];
  for (const [childId, links] of g.parentsByChild) {
    const count = links.filter(isBiological).length;
    if (count > 2) {
      found.push(
        issue(
          'TOO_MANY_BIO_PARENTS',
          E,
          [subject('person', childId)],
          'validation.tooManyBiologicalParents',
          { count },
        ),
      );
    }
  }
  return found;
}

/** Every id reference must resolve to an existing entity. */
function danglingRefs(g) {
  const found = [];

  const check = (ownerType, ownerId, refType, refId, field) => {
    if (refId === null || refId === undefined) return;
    const pool = refType === 'person' ? g.persons : g.unions;
    if (!pool.has(refId)) {
      found.push(
        issue('DANGLING_REF', E, [subject(ownerType, ownerId)], 'validation.danglingRef', {
          field,
          refId,
        }),
      );
    }
  };

  for (const link of g.parentChildren.values()) {
    check('parentChild', link.id, 'person', link.parentId, 'parentId');
    check('parentChild', link.id, 'person', link.childId, 'childId');
    check('parentChild', link.id, 'union', link.unionId, 'unionId');
  }

  for (const union of g.unions.values()) {
    check('union', union.id, 'person', union.partner1Id, 'partner1Id');
    check('union', union.id, 'person', union.partner2Id, 'partner2Id');
  }

  return found;
}

/** There cannot be two unions linking the same pair of people (unless dates do not overlap). */
function duplicateUnions(g) {
  const byPair = new Map();
  const found = [];

  for (const union of g.unions.values()) {
    if (!union.partner1Id || !union.partner2Id || union.partner1Id === union.partner2Id) continue;
    const key =
      union.partner1Id < union.partner2Id
        ? `${union.partner1Id}|${union.partner2Id}`
        : `${union.partner2Id}|${union.partner1Id}`;

    const existing = byPair.get(key);
    if (!existing) {
      byPair.set(key, [union]);
      continue;
    }

    for (const prev of existing) {
      const prevEndsBefore =
        prev.endDate &&
        union.startDate &&
        isBefore(prev.endDate, union.startDate) === Comparison.CERTAIN;
      const unionEndsBefore =
        union.endDate &&
        prev.startDate &&
        isBefore(union.endDate, prev.startDate) === Comparison.CERTAIN;

      if (!prevEndsBefore && !unionEndsBefore) {
        found.push(
          issue(
            'DUPLICATE_UNION',
            E,
            [subject('union', prev.id), subject('union', union.id)],
            'validation.duplicateUnion',
          ),
        );
        break;
      }
    }
    existing.push(union);
  }

  return found;
}

export const structuralRules = [
  selfParent,
  selfUnion,
  cycles,
  duplicateEdges,
  duplicateUnions,
  tooManyBiologicalParents,
  danglingRefs,
];
