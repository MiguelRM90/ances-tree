/**
 * Test fixtures.
 *
 * ALL anonymised. A fixture holding real family data is a PII leak in a public
 * repository (architecture.md, tests section).
 */

import {
  createProject,
  createPerson,
  createPlaceholder,
  createUnion,
  createParentChild,
  ParentType,
  UnionType,
  Sex,
} from '../../src/domain/model/factories.js';
import { parseDate } from '../../src/domain/date/parse.js';

const event = (raw, place = '') => ({ date: parseDate(raw), place });

export function person(firstName, { sex = Sex.UNKNOWN, born = '', died = '' } = {}) {
  return createPerson({
    firstName,
    lastName: 'Doe',
    sex,
    birth: born ? event(born) : null,
    death: died ? event(died) : null,
  });
}

export function project(parts) {
  return { ...createProject({ title: 'Test family' }), ...parts };
}

/** Minimal tree: two married parents and one child. */
export function minimalFamily() {
  const father = person('Father', { sex: Sex.MALE, born: '1900', died: '1970' });
  const mother = person('Mother', { sex: Sex.FEMALE, born: '1902', died: '1975' });
  const child = person('Child', { sex: Sex.FEMALE, born: '1930' });

  const union = createUnion({
    partner1Id: father.id,
    partner2Id: mother.id,
    type: UnionType.MARRIED,
    startDate: parseDate('1925'),
  });

  return {
    father,
    mother,
    child,
    union,
    data: project({
      persons: [father, mother, child],
      unions: [union],
      parentChildren: [
        createParentChild({ parentId: father.id, childId: child.id, unionId: union.id }),
        createParentChild({ parentId: mother.id, childId: child.id, unionId: union.id }),
      ],
      settings: {
        focalPersonId: child.id,
        maxGenerationsUp: 4,
        maxGenerationsDown: 4,
        stripExifOnImport: true,
      },
    }),
  };
}

/**
 * THE CASE THAT DROVE THE ParentChild DESIGN: a biological father and an
 * adoptive mother for the same child. One row per couple cannot express this
 * (data-model.md, ParentChild section).
 */
export function mixedAdoptionFamily() {
  const father = person('BioFather', { sex: Sex.MALE, born: '1900' });
  const mother = person('AdoptiveMother', { sex: Sex.FEMALE, born: '1905' });
  const child = person('Child', { born: '1935' });

  const union = createUnion({
    partner1Id: father.id,
    partner2Id: mother.id,
    type: UnionType.MARRIED,
  });

  return {
    father,
    mother,
    child,
    union,
    data: project({
      persons: [father, mother, child],
      unions: [union],
      parentChildren: [
        createParentChild({
          parentId: father.id,
          childId: child.id,
          unionId: union.id,
          type: ParentType.BIOLOGICAL,
        }),
        createParentChild({
          parentId: mother.id,
          childId: child.id,
          unionId: union.id,
          type: ParentType.ADOPTED,
        }),
      ],
    }),
  };
}

/** A placeholder person standing in for an unknown parent. */
export function familyWithPlaceholder() {
  const known = person('Known', { sex: Sex.FEMALE, born: '1900' });
  const ghost = createPlaceholder();
  const child = person('Child', { born: '1930' });

  return {
    known,
    ghost,
    child,
    data: project({
      persons: [known, ghost, child],
      parentChildren: [
        createParentChild({ parentId: known.id, childId: child.id }),
        createParentChild({ parentId: ghost.id, childId: child.id }),
      ],
    }),
  };
}

/** Half siblings: they share exactly one parent. */
export function halfSiblingsFamily() {
  const father = person('Father', { sex: Sex.MALE, born: '1900' });
  const motherA = person('MotherA', { sex: Sex.FEMALE, born: '1902' });
  const motherB = person('MotherB', { sex: Sex.FEMALE, born: '1910' });
  const childA = person('ChildA', { born: '1925' });
  const childB = person('ChildB', { born: '1940' });

  return {
    father,
    motherA,
    motherB,
    childA,
    childB,
    data: project({
      persons: [father, motherA, motherB, childA, childB],
      parentChildren: [
        createParentChild({ parentId: father.id, childId: childA.id }),
        createParentChild({ parentId: motherA.id, childId: childA.id }),
        createParentChild({ parentId: father.id, childId: childB.id }),
        createParentChild({ parentId: motherB.id, childId: childB.id }),
      ],
    }),
  };
}
