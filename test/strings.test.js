import { expect } from '@open-wc/testing';
import { en } from '../src/config/locales/en.js';
import { es } from '../src/config/locales/es.js';
import { S, LOCALES, messageFor } from '../src/config/strings.js';
import { buildIndexes } from '../src/domain/graph/indexes.js';
import { validateAll } from '../src/domain/validation/engine.js';
import { createParentChild } from '../src/domain/model/factories.js';
import { person, project } from './fixtures/families.js';

/** Every leaf key, as a dotted path. */
function keysOf(dictionary, prefix = '') {
  return Object.entries(dictionary).flatMap(([key, value]) =>
    value && typeof value === 'object' && typeof value !== 'function'
      ? keysOf(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

const at = (dictionary, path) => path.split('.').reduce((node, key) => node?.[key], dictionary);

describe('translations', () => {
  /**
   * A missing key does not throw, it renders `undefined` into the interface —
   * which is exactly the kind of thing nobody notices until a user does.
   */
  it('the two dictionaries agree key for key', () => {
    const english = keysOf(en).sort();
    const spanish = keysOf(es).sort();

    expect(
      spanish.filter((key) => !english.includes(key)),
      'extra in Spanish',
    ).to.eql([]);
    expect(
      english.filter((key) => !spanish.includes(key)),
      'missing from Spanish',
    ).to.eql([]);
  });

  it('a key is the same kind of thing in both', () => {
    for (const key of keysOf(en)) {
      expect(typeof at(es, key), key).to.equal(typeof at(en, key));
    }
  });

  it('the functions take the same arguments in both', () => {
    for (const key of keysOf(en)) {
      const english = at(en, key);
      if (typeof english !== 'function') continue;
      expect(at(es, key).length, key).to.equal(english.length);
    }
  });

  it('nothing is left empty', () => {
    for (const dictionary of [en, es]) {
      for (const key of keysOf(dictionary)) {
        const value = at(dictionary, key);
        if (typeof value === 'function') continue;
        expect(String(value).trim(), key).to.not.equal('');
      }
    }
  });

  it('offers exactly the languages it has dictionaries for', () => {
    expect(LOCALES.map((l) => l.code).sort()).to.eql(['en', 'es']);
  });
});

describe('validation messages', () => {
  /**
   * Rules carry a messageKey, and a key with no message renders as the raw
   * rule id. This walks every issue the validator can produce and checks both
   * languages have prose for it.
   */
  it('every rule the validator fires has a message in both languages', () => {
    const parent = person('Parent', { born: '1950' });
    const child = person('Child', { born: '1920' });
    const lonely = person('Lonely');

    const graph = buildIndexes(
      project({
        persons: [parent, child, lonely],
        parentChildren: [createParentChild({ parentId: parent.id, childId: child.id })],
      }),
    );

    const issues = validateAll(graph);
    expect(issues.length).to.be.above(0);

    for (const issue of issues) {
      const [group, key] = issue.messageKey.split('.');
      expect(at(en, `${group}.${key}`), issue.ruleId).to.be.a('string');
      expect(at(es, `${group}.${key}`), issue.ruleId).to.be.a('string');
      expect(messageFor(issue), issue.ruleId).to.not.equal(issue.ruleId);
    }
  });

  it('the active dictionary is one of the two', () => {
    expect([en, es]).to.include(S);
  });
});
