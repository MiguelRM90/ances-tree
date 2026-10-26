/**
 * Curated sample archive for one-click exploration and onboarding.
 *
 * Pure domain factory: builds a multi-generational Spanish family archive that
 * exercises two surnames, uncertain historical dates (ABT, EST, BEF, AFT, BET),
 * adoptive lineage, unknown-parent placeholders, international emigration, and
 * non-blocking consanguinity detection.
 */

import {
  createProject,
  createPerson,
  createPlaceholder,
  createUnion,
  createParentChild,
  createLifeEvent,
  Sex,
  UnionType,
  ParentType,
} from './factories.js';
import { parseDate } from '../date/parse.js';

const event = (rawDate, place = '') =>
  createLifeEvent({
    date: parseDate(rawDate),
    place,
  });

/**
 * Builds a complete, valid sample project ready to be written and opened.
 *
 * @param {{locale?: string, title?: string}} [options]
 * @returns {object}
 */
export function createSampleProject({ locale = 'en', title } = {}) {
  const isEs = locale === 'es';
  const projectTitle =
    title ?? (isEs ? 'Familia Navarro-García (Ejemplo)' : 'Navarro-García Family (Sample)');

  const project = createProject({ title: projectTitle });

  // --- Generation -3: Great-grandparents (shared ancestor) -------------------
  const ramon = createPerson({
    firstName: 'Ramón',
    lastName: 'Fernández',
    secondLastName: 'Álvarez',
    sex: Sex.MALE,
    nationality: 'ES',
    birth: event('ABT 1862', 'Toledo'),
    death: event('BEF 1930', 'Toledo'),
    notes: isEs
      ? 'Inscrito en el censo parroquial de San Juan Bautista (Toledo).'
      : 'Recorded in the parish census of San Juan Bautista (Toledo).',
  });

  const unknownGreatGrandmother = createPlaceholder({
    sex: Sex.FEMALE,
  });

  const uGreatGrand = createUnion({
    partner1Id: ramon.id,
    partner2Id: unknownGreatGrandmother.id,
    type: UnionType.MARRIED,
    startDate: parseDate('ABT 1888'),
  });

  // --- Generation -2: Grandparents -------------------------------------------
  const luis = createPerson({
    firstName: 'Luis',
    lastName: 'Navarro',
    secondLastName: 'Ruiz',
    sex: Sex.MALE,
    nationality: 'ES',
    birth: event('ABT 1890', 'Segovia'),
    death: event('1964', 'Segovia'),
  });

  const isabel = createPerson({
    firstName: 'Isabel',
    lastName: 'Gómez',
    secondLastName: 'Fernández',
    sex: Sex.FEMALE,
    nationality: 'ES',
    birth: event('1892', 'Toledo'),
    death: event('AFT 1972', 'Segovia'),
  });

  const uPaternalGrand = createUnion({
    partner1Id: luis.id,
    partner2Id: isabel.id,
    type: UnionType.MARRIED,
    startDate: parseDate('1918'),
  });

  const manuel = createPerson({
    firstName: 'Manuel',
    lastName: 'García',
    secondLastName: 'Martín',
    sex: Sex.MALE,
    nationality: 'ES',
    birth: event('1889', 'Cuenca'),
    death: event('1958', 'Toledo'),
  });

  const teresa = createPerson({
    firstName: 'Teresa',
    lastName: 'Mendoza',
    secondLastName: 'Fernández',
    sex: Sex.FEMALE,
    nationality: 'ES',
    birth: event('BET 1893 AND 1895', 'Toledo'),
    death: event('1976', 'Toledo'),
  });

  const uMaternalGrand = createUnion({
    partner1Id: manuel.id,
    partner2Id: teresa.id,
    type: UnionType.MARRIED,
    startDate: parseDate('MAY 1919'),
  });

  // --- Generation -1: Parents (cousins sharing Ramón Fernández Álvarez) ------
  const carlos = createPerson({
    firstName: 'Carlos',
    lastName: 'Navarro',
    secondLastName: 'Gómez',
    sex: Sex.MALE,
    nationality: 'ES',
    birth: event('12 MAY 1922', 'Segovia'),
    death: event('8 NOV 2004', 'Toledo'),
  });

  const carmen = createPerson({
    firstName: 'Carmen',
    lastName: 'García',
    secondLastName: 'Mendoza',
    sex: Sex.FEMALE,
    nationality: 'ES',
    birth: event('BET 1924 AND 1926', 'Cuenca'),
    death: event('2011', 'Toledo'),
    notes: isEs
      ? 'Partida de matrimonio con dispensa de consanguinidad en tercer grado (ancestro común: Ramón Fernández Álvarez).'
      : 'Marriage record notes a third-degree consanguinity dispensation (common ancestor: Ramón Fernández Álvarez).',
  });

  const uParents = createUnion({
    partner1Id: carlos.id,
    partner2Id: carmen.id,
    type: UnionType.MARRIED,
    startDate: parseDate('19 OCT 1948'),
  });

  // --- Generation 0: Focal person, sibling, and partner ----------------------
  const rafael = createPerson({
    firstName: 'Rafael',
    lastName: 'Navarro',
    secondLastName: 'García',
    sex: Sex.MALE,
    nationality: 'AR',
    birth: event('1950', 'Toledo'),
    death: event('BEF 2018', 'Buenos Aires'),
    notes: isEs
      ? 'Emigró a Buenos Aires en 1974; nacionalizado argentino.'
      : 'Emigrated to Buenos Aires in 1974; naturalized Argentine citizen.',
  });

  const elena = createPerson({
    firstName: 'Elena',
    lastName: 'Navarro',
    secondLastName: 'García',
    sex: Sex.FEMALE,
    nationality: 'ES',
    birth: event('14 MAR 1954', 'Toledo'),
    death: null,
    notes: isEs
      ? 'Conserva el archivo familiar y las fotografías originales de Toledo y Segovia.'
      : 'Keeps the family archive and original photographs from Toledo and Segovia.',
  });

  const javier = createPerson({
    firstName: 'Javier',
    lastName: 'Moreno',
    secondLastName: 'Domínguez',
    sex: Sex.MALE,
    nationality: 'ES',
    birth: event('ABT 1952', 'Zaragoza'),
    death: null,
  });

  const uFocal = createUnion({
    partner1Id: elena.id,
    partner2Id: javier.id,
    type: UnionType.MARRIED,
    startDate: parseDate('24 JUN 1978'),
  });

  // --- Generation +1: Children and partner -----------------------------------
  const lucia = createPerson({
    firstName: 'Lucía',
    lastName: 'Moreno',
    secondLastName: 'Navarro',
    sex: Sex.FEMALE,
    nationality: 'ES',
    birth: event('22 JUN 1980', 'Madrid'),
    death: null,
  });

  const alejandro = createPerson({
    firstName: 'Alejandro',
    lastName: 'Vázquez',
    secondLastName: 'Gil',
    sex: Sex.MALE,
    nationality: 'ES',
    birth: event('1978', 'Sevilla'),
    death: null,
  });

  const uLucia = createUnion({
    partner1Id: lucia.id,
    partner2Id: alejandro.id,
    type: UnionType.PARTNERS,
    startDate: parseDate('2007'),
  });

  const miguel = createPerson({
    firstName: 'Miguel',
    lastName: 'Moreno',
    secondLastName: 'Navarro',
    sex: Sex.MALE,
    nationality: 'ES',
    birth: event('EST 1984', 'Madrid'),
    death: null,
    notes: isEs
      ? 'Adopción plena inscrita en el Registro Civil de Madrid (1986).'
      : 'Full adoption registered in the Civil Registry of Madrid (1986).',
  });

  // --- Generation +2: Grandchildren ------------------------------------------
  const mateo = createPerson({
    firstName: 'Mateo',
    lastName: 'Vázquez',
    secondLastName: 'Moreno',
    sex: Sex.MALE,
    nationality: 'ES',
    birth: event('19 APR 2010', 'Madrid'),
    death: null,
  });

  const sofia = createPerson({
    firstName: 'Sofía',
    lastName: 'Vázquez',
    secondLastName: 'Moreno',
    sex: Sex.FEMALE,
    nationality: 'ES',
    birth: event('4 NOV 2013', 'Madrid'),
    death: null,
  });

  const linkCouple = (parentA, parentB, child, union, type = ParentType.BIOLOGICAL) => [
    createParentChild({
      parentId: parentA.id,
      childId: child.id,
      unionId: union.id,
      type,
    }),
    createParentChild({
      parentId: parentB.id,
      childId: child.id,
      unionId: union.id,
      type,
    }),
  ];

  project.persons = [
    ramon,
    unknownGreatGrandmother,
    luis,
    isabel,
    manuel,
    teresa,
    carlos,
    carmen,
    rafael,
    elena,
    javier,
    lucia,
    alejandro,
    miguel,
    mateo,
    sofia,
  ];

  project.unions = [uGreatGrand, uPaternalGrand, uMaternalGrand, uParents, uFocal, uLucia];

  project.parentChildren = [
    ...linkCouple(ramon, unknownGreatGrandmother, isabel, uGreatGrand),
    ...linkCouple(ramon, unknownGreatGrandmother, teresa, uGreatGrand),
    ...linkCouple(luis, isabel, carlos, uPaternalGrand),
    ...linkCouple(manuel, teresa, carmen, uMaternalGrand),
    ...linkCouple(carlos, carmen, rafael, uParents),
    ...linkCouple(carlos, carmen, elena, uParents),
    ...linkCouple(elena, javier, lucia, uFocal),
    ...linkCouple(elena, javier, miguel, uFocal, ParentType.ADOPTED),
    ...linkCouple(lucia, alejandro, mateo, uLucia),
    ...linkCouple(lucia, alejandro, sofia, uLucia),
  ];

  project.settings.focalPersonId = elena.id;
  project.settings.maxGenerationsUp = 2;
  project.settings.maxGenerationsDown = 2;

  return project;
}

