/**
 * Finding a person by name.
 *
 * An archive of ten thousand people cannot be navigated by scrolling, and the
 * tree only ever shows the few dozen around whoever is centred. Without this
 * there is no way to reach someone you are not already next to.
 *
 * Pure, so it is tested without a browser.
 */

import { displayName } from './queries.js';
import { formatLifespan } from '../date/format.js';

/**
 * Accents are stripped from both sides, so "jimenez" finds "Jiménez".
 * Nobody types the accents when they are searching, and in a Spanish archive
 * that would make the search close to useless.
 */
const fold = (text) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/**
 * @param {object} g       indexed graph
 * @param {string} query
 * @param {{limit?: number}} [options]
 * @returns {Array<{id: string, name: string, lifespan: string, isPlaceholder: boolean}>}
 */
export function searchPeople(g, query, { limit = 20, locale } = {}) {
  const needle = fold(query);
  if (needle === '') return [];

  const terms = needle.split(/\s+/);
  const found = [];

  for (const person of g.persons.values()) {
    const name = displayName(person, locale);
    const haystack = fold(name);

    // Every word has to appear somewhere: "gil ramon" finds "Ramón Gil".
    if (!terms.every((term) => haystack.includes(term))) continue;

    found.push({
      person,
      name,
      // A name that starts with what was typed is almost always the one meant.
      rank: haystack.startsWith(terms[0]) ? 0 : 1,
      born: person.birth?.date?.earliest ?? '9999',
    });

    // Stopping early would bias towards whoever happens to be first in the
    // file, so everything is scored and only the display is capped.
  }

  found.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name) || compare(a.born, b.born));

  return found.slice(0, limit).map(({ person, name }) => ({
    id: person.id,
    name,
    lifespan: formatLifespan(person.birth, person.death),
    isPlaceholder: person.isPlaceholder,
  }));
}

const compare = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
