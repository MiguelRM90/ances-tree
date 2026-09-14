/**
 * Placeholder portraits, drawn as inline SVG.
 *
 * No image files: they are built as DOM nodes, so they inherit the current
 * colour, stay crisp at any size, need no network request and cost nothing
 * under the CSP.
 *
 * Three silhouettes, chosen by the GEDCOM SEX value. The unknown one is a
 * deliberately neutral figure rather than a male one with a label — a person
 * whose sex was never recorded is genuinely unknown, not male by default.
 */

import { svg } from './dom.js';
import { Sex } from '../domain/model/factories.js';

const SILHOUETTES = {
  [Sex.MALE]: [
    { tag: 'circle', attrs: { cx: 20, cy: 15, r: 6.5 } },
    {
      tag: 'path',
      attrs: { d: 'M20 23c-6.9 0-12.5 4.6-12.5 11.5V36h25v-1.5C32.5 27.6 26.9 23 20 23Z' },
    },
  ],

  // Framed by hair and a narrower shoulder line.
  [Sex.FEMALE]: [
    {
      tag: 'path',
      attrs: {
        d: 'M20 6c-4.4 0-7.5 3.1-7.5 7.5 0 3 .5 5.5-1 8.5 2-1 3-2.5 3.2-4.5 2.8 1.3 7.8 1.3 10.6 0 .2 2 1.2 3.5 3.2 4.5-1.5-3-1-5.5-1-8.5C27.5 9.1 24.4 6 20 6Z',
      },
    },
    { tag: 'circle', attrs: { cx: 20, cy: 15.5, r: 6 } },
    { tag: 'path', attrs: { d: 'M20 23.5c-6 0-11 4.4-11 11V36h22v-1.5c0-6.6-5-11-11-11Z' } },
  ],

  unknown: [
    { tag: 'circle', attrs: { cx: 20, cy: 15, r: 6.5 } },
    {
      tag: 'path',
      attrs: { d: 'M20 23c-6.4 0-11.5 4.6-11.5 11.5V36h23v-1.5C31.5 27.6 26.4 23 20 23Z' },
    },
  ],
};

/**
 * Which silhouette a person gets.
 *
 * A placeholder person is always drawn as unknown, whatever sex was guessed
 * for them: they are a gap in the record, not a described individual.
 */
export function avatarKindFor(person) {
  if (!person || person.isPlaceholder) return 'unknown';
  if (person.sex === Sex.MALE || person.sex === Sex.FEMALE) return person.sex;
  return 'unknown';
}

/**
 * Builds the SVG for one silhouette.
 * @param {string} kind  'M' | 'F' | 'unknown'
 */
export function avatarSvg(kind) {
  const root = svg('svg', {
    viewBox: '0 0 40 40',
    fill: 'currentColor',
    'aria-hidden': 'true',
    focusable: 'false',
  });

  for (const { tag, attrs } of SILHOUETTES[kind] ?? SILHOUETTES.unknown) {
    root.append(svg(tag, attrs));
  }

  return root;
}
