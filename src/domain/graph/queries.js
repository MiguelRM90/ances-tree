/**
 * Derived queries over the graph (data-model.md, derived queries section).
 * None of this is stored: it is computed from the four collections.
 */

import { ParentType, MediaRole, MediaKind } from '../model/factories.js';

const EMPTY = Object.freeze([]);

export const parentLinksOf = (g, personId) => g.parentsByChild.get(personId) ?? EMPTY;
export const childLinksOf = (g, personId) => g.childrenByParent.get(personId) ?? EMPTY;
export const unionsOf = (g, personId) => g.unionsByPerson.get(personId) ?? EMPTY;

export const isBiological = (link) => link.type === ParentType.BIOLOGICAL;

/** Parents. Filtering by biological gives the genetic line. */
export function parentsOf(g, personId, { biologicalOnly = false } = {}) {
  return parentLinksOf(g, personId)
    .filter((link) => !biologicalOnly || isBiological(link))
    .map((link) => g.persons.get(link.parentId))
    .filter(Boolean);
}

export function childrenOf(g, personId, { biologicalOnly = false } = {}) {
  return childLinksOf(g, personId)
    .filter((link) => !biologicalOnly || isBiological(link))
    .map((link) => g.persons.get(link.childId))
    .filter(Boolean);
}

/**
 * Everyone below this person, plus the person themselves.
 *
 * The set of people who cannot become one of their parents: the CYCLE rule
 * would reject it, and an interface that offers a choice it is about to refuse
 * is worse than one that never offers it.
 *
 * Iterative, and it marks a person on the way in rather than on the way out —
 * a tree where two branches meet again lower down would otherwise be walked
 * once per path through it.
 */
export function descendantIds(g, personId) {
  const seen = new Set([personId]);
  const stack = [personId];

  while (stack.length > 0) {
    for (const link of childLinksOf(g, stack.pop())) {
      if (seen.has(link.childId)) continue;
      seen.add(link.childId);
      stack.push(link.childId);
    }
  }

  return seen;
}

/** The other person in a union. */
export function partnerIn(union, personId) {
  return union.partner1Id === personId ? union.partner2Id : union.partner1Id;
}

export function partnersOf(g, personId) {
  return unionsOf(g, personId)
    .map((union) => g.persons.get(partnerIn(union, personId)))
    .filter(Boolean);
}

/**
 * Siblings, split into full and half.
 *
 *   full  - share both biological parents
 *   half  - share exactly one
 *
 * Computed over sets of parentId rather than unionId, so it also works when the
 * links have no union attached.
 */
export function siblingsOf(g, personId) {
  const own = biologicalParentIds(g, personId);
  if (own.size === 0) return { full: [], half: [] };

  const candidates = new Set();
  for (const parentId of own) {
    for (const link of childLinksOf(g, parentId)) {
      if (link.childId !== personId && isBiological(link)) candidates.add(link.childId);
    }
  }

  const full = [];
  const half = [];
  for (const candidateId of candidates) {
    const theirs = biologicalParentIds(g, candidateId);
    const shared = [...own].filter((id) => theirs.has(id)).length;
    const person = g.persons.get(candidateId);
    if (!person) continue;
    if (shared === 2 && own.size === 2 && theirs.size === 2) full.push(person);
    else if (shared >= 1) half.push(person);
  }

  return { full: sortByBirth(full), half: sortByBirth(half) };
}

export function biologicalParentIds(g, personId) {
  return new Set(
    parentLinksOf(g, personId)
      .filter(isBiological)
      .map((l) => l.parentId),
  );
}

/**
 * Children of a given union: the links that reference it, or else the children
 * shared by both partners when unionId was never set.
 */
export function childrenOfUnion(g, union) {
  const linked = g.childrenByUnion.get(union.id);

  if (linked) {
    const direct = new Set(linked.map((link) => link.childId));
    return sortByBirth([...direct].map((id) => g.persons.get(id)).filter(Boolean));
  }

  const fromP1 = new Set(childLinksOf(g, union.partner1Id).map((l) => l.childId));
  const shared = childLinksOf(g, union.partner2Id)
    .map((l) => l.childId)
    .filter((id) => fromP1.has(id));

  return sortByBirth([...new Set(shared)].map((id) => g.persons.get(id)).filter(Boolean));
}

/** Sorts by birth; unknown dates go last. */
export function sortByBirth(persons) {
  return [...persons].sort((a, b) => {
    const av = a.birth?.date?.earliest ?? null;
    const bv = b.birth?.date?.earliest ?? null;
    if (av === bv) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return av < bv ? -1 : 1;
  });
}

/** Every media item linked to a person, portrait first. */
export function mediaOf(g, personId) {
  const items = g.mediaByTarget.get(personId) ?? EMPTY;
  return [...items].sort((a, b) => roleRank(a, personId) - roleRank(b, personId));
}

/** Only photos linked to a person. */
export function photosOf(g, personId) {
  return mediaOf(g, personId).filter((item) => item.kind === MediaKind.PHOTO);
}

/** Only documents linked to a person. */
export function documentsOf(g, personId) {
  return mediaOf(g, personId).filter((item) => item.kind === MediaKind.DOCUMENT);
}

/**
 * The portrait. Falls back to the first photo linked to the person: someone
 * who attached one photo clearly meant it to be their picture, and making them
 * mark it explicitly would be pedantry. Documents are never used as portrait.
 */
export function portraitOf(g, personId) {
  const photos = photosOf(g, personId);
  return photos[0] ?? null;
}

const roleRank = (item, personId) =>
  item.links.some((link) => link.targetId === personId && link.role === MediaRole.PORTRAIT) ? 0 : 1;

export function displayName(person) {
  if (!person) return '';

  const name = [person.firstName, person.lastName, person.secondLastName]
    .filter((part) => part && part.trim() !== '')
    .join(' ');

  if (name !== '') return name;
  return person.isPlaceholder ? 'Unknown' : 'Unnamed';
}

/** Both surnames, for the places that care about the family line rather than
 *  the whole name. */
export const surnamesOf = (person) =>
  [person?.lastName, person?.secondLastName].filter((part) => part && part.trim() !== '');
