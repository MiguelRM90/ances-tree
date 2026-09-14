import { expect } from '@open-wc/testing';
import { exportGedcom } from '../src/domain/gedcom/export.js';
import {
  createParentChild,
  ParentType,
  Certainty,
  UnionType,
  Sex,
} from '../src/domain/model/factories.js';
import {
  minimalFamily,
  mixedAdoptionFamily,
  familyWithPlaceholder,
  person,
  project,
} from './fixtures/families.js';

// Fixed so the header date does not make the output vary between runs.
const AT = new Date(Date.UTC(2026, 7, 15));

const write = (data) => exportGedcom(data, { now: AT });
const lines = (text) => text.split('\r\n');
const has = (text, line) => lines(text).includes(line);

describe('GEDCOM export', () => {
  it('writes a well-formed 5.5.1 skeleton', () => {
    const { data } = minimalFamily();
    const text = write(data);

    expect(lines(text)[0]).to.equal('0 HEAD');
    expect(has(text, '2 VERS 5.5.1')).to.equal(true);
    expect(has(text, '2 FORM LINEAGE-LINKED')).to.equal(true);
    expect(has(text, '1 CHAR UTF-8')).to.equal(true);
    expect(has(text, '1 DATE 15 AUG 2026')).to.equal(true);
    expect(has(text, '0 TRLR')).to.equal(true);
  });

  // GEDCOM files are CRLF-terminated, including the final line.
  it('uses CRLF line endings throughout', () => {
    const text = write(minimalFamily().data);
    expect(text.endsWith('\r\n')).to.equal(true);
    expect(text.includes('\n\n')).to.equal(false);
  });

  it('writes names with the surname between slashes', () => {
    const text = write(minimalFamily().data);
    expect(has(text, '1 NAME Father /Doe/')).to.equal(true);
    expect(has(text, '2 GIVN Father')).to.equal(true);
    expect(has(text, '2 SURN Doe')).to.equal(true);
  });

  it('keeps the raw genealogical date exactly as written', () => {
    const subject = person('X', { born: 'ABT 1885', died: 'BET 1950 AND 1955' });
    const text = write(project({ persons: [subject] }));

    expect(has(text, '2 DATE ABT 1885')).to.equal(true);
    expect(has(text, '2 DATE BET 1950 AND 1955')).to.equal(true);
  });

  it('links parents and children through a family record', () => {
    const text = write(minimalFamily().data);

    expect(has(text, '1 HUSB @I1@')).to.equal(true);
    expect(has(text, '1 WIFE @I2@')).to.equal(true);
    expect(has(text, '1 CHIL @I3@')).to.equal(true);
    expect(has(text, '1 FAMC @F1@')).to.equal(true);
    expect(has(text, '1 FAMS @F1@')).to.equal(true);
  });

  /**
   * The one place GEDCOM cannot hold what the model does: PEDI belongs to the
   * FAMC link, so it is shared by both parents. The export picks the pedigree
   * and the loss is documented rather than hidden (gedcom-mapping.md).
   */
  it('writes a pedigree for the family link', () => {
    const text = write(mixedAdoptionFamily().data);
    expect(lines(text).some((l) => l.startsWith('2 PEDI '))).to.equal(true);
  });

  it('carries certainty as an extension tag', () => {
    const parent = person('P', { born: '1900' });
    const child = person('C', { born: '1930' });
    const data = project({
      persons: [parent, child],
      parentChildren: [
        createParentChild({
          parentId: parent.id,
          childId: child.id,
          type: ParentType.ADOPTED,
          certainty: Certainty.DISPUTED,
        }),
      ],
    });

    const text = write(data);
    expect(has(text, '2 PEDI adopted')).to.equal(true);
    expect(has(text, '2 _CERT DISPUTED')).to.equal(true);
  });

  // The usual convention for "someone was here and we do not know who".
  it('emits a placeholder person without a NAME', () => {
    const { ghost, data } = familyWithPlaceholder();
    const text = write(data);

    const at = lines(text).findIndex((l) => l.endsWith(' INDI') && l.includes('@I2@'));
    expect(data.persons[1].id).to.equal(ghost.id);
    expect(lines(text)[at + 1]).to.not.contain('NAME');
  });

  it('writes an unmarried union as a family with no marriage event', () => {
    const a = person('A', { sex: Sex.MALE, born: '1900' });
    const b = person('B', { sex: Sex.FEMALE, born: '1902' });
    const data = project({
      persons: [a, b],
      unions: [
        {
          id: 'u1',
          partner1Id: a.id,
          partner2Id: b.id,
          type: UnionType.PARTNERS,
          startDate: null,
          endDate: null,
          notes: '',
        },
      ],
    });

    const text = write(data);
    expect(has(text, '1 MARR')).to.equal(false);
    expect(has(text, '1 _UTYPE PARTNERS')).to.equal(true);
  });

  // 5.5.1 caps a line at 255 characters.
  it('splits a long note across CONC continuations', () => {
    const subject = person('X');
    subject.notes = 'a'.repeat(700);
    const text = write(project({ persons: [subject] }));

    expect(lines(text).filter((l) => l.startsWith('2 CONC ')).length).to.be.at.least(2);
    for (const line of lines(text)) expect(line.length).to.be.at.most(255);
  });

  it('turns real line breaks into CONT', () => {
    const subject = person('X');
    subject.notes = 'first\nsecond';
    const text = write(project({ persons: [subject] }));

    expect(has(text, '1 NOTE first')).to.equal(true);
    expect(has(text, '2 CONT second')).to.equal(true);
  });

  it('says when HUSB and WIFE were assigned by order rather than by sex', () => {
    const a = person('A', { sex: Sex.MALE, born: '1900' });
    const b = person('B', { sex: Sex.MALE, born: '1902' });
    const data = project({
      persons: [a, b],
      unions: [
        {
          id: 'u1',
          partner1Id: a.id,
          partner2Id: b.id,
          type: UnionType.MARRIED,
          startDate: null,
          endDate: null,
          notes: '',
        },
      ],
    });

    expect(write(data)).to.contain('HUSB/WIFE assigned by record order');
  });

  it('produces nothing but a header and trailer for an empty project', () => {
    const text = write(project({}));
    expect(lines(text)[0]).to.equal('0 HEAD');
    expect(has(text, '0 TRLR')).to.equal(true);
  });
});
