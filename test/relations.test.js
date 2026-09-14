import { expect } from '@open-wc/testing';
import { buildIndexes } from '../src/domain/graph/indexes.js';
import { descendantIds, parentsOf, parentLinksOf } from '../src/domain/graph/queries.js';
import { validateBlocking } from '../src/domain/validation/engine.js';
import {
  createPerson,
  createUnion,
  createParentChild,
  ParentType,
  UnionType,
} from '../src/domain/model/factories.js';
import { parseDate } from '../src/domain/date/parse.js';
import { store } from '../src/store/store.js';
import * as actions from '../src/store/actions.js';
import { createBrowserFolder, removeBrowserFolder } from '../src/storage/opfs.js';
import { person, project, minimalFamily } from './fixtures/families.js';
import '../src/ui/components/relation-editor.js';

/**
 * The relationship edits, tested as the pure project-to-project functions they
 * are underneath. The store adds undo and the refusal of anything blocking;
 * what matters here is that the shapes coming out are the ones intended.
 */

// --- The transforms, mirroring store/actions.js -----------------------------

const updateUnion = (p, unionId, changes) => ({
  ...p,
  unions: p.unions.map((u) => (u.id === unionId ? { ...u, ...changes } : u)),
});

const updateParentLink = (p, linkId, changes) => ({
  ...p,
  parentChildren: p.parentChildren.map((l) => (l.id === linkId ? { ...l, ...changes } : l)),
});

function setChildUnion(p, childId, union) {
  const partnerIds = union ? [union.partner1Id, union.partner2Id] : [];
  const linked = new Set(
    p.parentChildren.filter((l) => l.childId === childId).map((l) => l.parentId),
  );

  const updated = p.parentChildren.map((l) => {
    if (l.childId !== childId) return l;
    if (!union) return l.unionId === null ? l : { ...l, unionId: null };
    return partnerIds.includes(l.parentId) ? { ...l, unionId: union.id } : l;
  });

  const added = partnerIds
    .filter((id) => !linked.has(id))
    .map((parentId) => createParentChild({ parentId, childId, unionId: union.id }));

  return { ...p, parentChildren: [...updated, ...added] };
}

// --- Fixtures ---------------------------------------------------------------

/**
 * THE REPORTED CASE: a child, one parent added to them, and then a partner
 * added to that parent. Nothing yet says the partner is the other parent.
 */
function childWithOneParentAndAStepIn() {
  const child = person('Tn', { born: '1950' });
  const father = person('Tnx', { born: '1920' });
  const mother = person('Tny', { born: '1922' });

  const union = createUnion({ partner1Id: father.id, partner2Id: mother.id });
  const link = createParentChild({ parentId: father.id, childId: child.id });

  return {
    child,
    father,
    mother,
    union,
    link,
    data: project({
      persons: [child, father, mother],
      unions: [union],
      parentChildren: [link],
      settings: { focalPersonId: child.id, maxGenerationsUp: 3, maxGenerationsDown: 3 },
    }),
  };
}

describe('descendantIds', () => {
  it('is the person plus everyone under them', () => {
    const { father, mother, child, data } = minimalFamily();
    const g = buildIndexes(data);

    expect([...descendantIds(g, father.id)]).to.have.members([father.id, child.id]);
    expect([...descendantIds(g, child.id)]).to.eql([child.id]);
    expect(descendantIds(g, mother.id).has(child.id)).to.equal(true);
  });

  it('walks a branch that rejoins only once', () => {
    // Cousins who married: their child is reachable by two paths from the
    // shared ancestor, and must still be visited a single time.
    const root = person('Root', { born: '1900' });
    const a = person('A', { born: '1925' });
    const b = person('B', { born: '1927' });
    const grandchild = person('C', { born: '1950' });

    const data = project({
      persons: [root, a, b, grandchild],
      parentChildren: [
        createParentChild({ parentId: root.id, childId: a.id }),
        createParentChild({ parentId: root.id, childId: b.id }),
        createParentChild({ parentId: a.id, childId: grandchild.id }),
        createParentChild({ parentId: b.id, childId: grandchild.id }),
      ],
    });

    const found = descendantIds(buildIndexes(data), root.id);
    expect([...found]).to.have.members([root.id, a.id, b.id, grandchild.id]);
    expect(found.size).to.equal(4);
  });
});

describe('editing a union', () => {
  it('records what kind of relationship it was', () => {
    const { union, data } = minimalFamily();
    const after = updateUnion(data, union.id, { type: UnionType.CASUAL });

    expect(after.unions.find((u) => u.id === union.id).type).to.equal(UnionType.CASUAL);
  });

  /**
   * Divorce is not a fourth kind of union. It is a marriage with an end date,
   * which is also how it leaves in a GEDCOM — MARR alongside DIV.
   */
  it('says a marriage ended with an end date, not a different type', () => {
    const { union, data } = minimalFamily();

    const married = updateUnion(data, union.id, { type: UnionType.MARRIED });
    const divorced = updateUnion(married, union.id, { endDate: { raw: '1950' } });
    const result = divorced.unions.find((u) => u.id === union.id);

    expect(result.type).to.equal(UnionType.MARRIED);
    expect(result.endDate.raw).to.equal('1950');
    expect(Object.values(UnionType)).to.not.include('DIVORCED');
  });

  it('leaves every other union alone', () => {
    const { union, data } = minimalFamily();
    const other = createUnion({ partner1Id: data.persons[0].id, partner2Id: data.persons[2].id });
    const withBoth = { ...data, unions: [...data.unions, other] };

    const after = updateUnion(withBoth, union.id, { type: UnionType.PARTNERS });
    expect(after.unions.find((u) => u.id === other.id).type).to.equal(UnionType.UNKNOWN);
  });
});

describe('editing a parent link', () => {
  it('changes who the parent is, keeping the kind of parent', () => {
    const { father, mother, child, data } = minimalFamily();
    const stranger = person('Stranger', { born: '1899' });

    const link = data.parentChildren.find((l) => l.parentId === father.id);
    const adoptive = updateParentLink(data, link.id, { type: ParentType.ADOPTED });
    const moved = updateParentLink(
      { ...adoptive, persons: [...adoptive.persons, stranger] },
      link.id,
      { parentId: stranger.id },
    );

    const result = moved.parentChildren.find((l) => l.id === link.id);
    expect(result.parentId).to.equal(stranger.id);
    expect(result.type).to.equal(ParentType.ADOPTED);

    // And the child is now the stranger's, not the father's.
    const g = buildIndexes(moved);
    expect(parentsOf(g, child.id).map((p) => p.id)).to.have.members([stranger.id, mother.id]);
  });

  it('changes the kind of parent without touching the person', () => {
    const { father, data } = minimalFamily();
    const link = data.parentChildren.find((l) => l.parentId === father.id);

    const after = updateParentLink(data, link.id, { type: ParentType.STEP });
    const result = after.parentChildren.find((l) => l.id === link.id);

    expect(result.type).to.equal(ParentType.STEP);
    expect(result.parentId).to.equal(father.id);
  });
});

describe('making a child descend from a couple', () => {
  it('adds the missing parent and stamps both links with the union', () => {
    const { child, father, mother, union, data } = childWithOneParentAndAStepIn();

    // Before: the child hangs off the father alone, with no couple recorded.
    const before = buildIndexes(data);
    expect(parentsOf(before, child.id).map((p) => p.id)).to.eql([father.id]);
    expect(parentLinksOf(before, child.id)[0].unionId).to.equal(null);

    const after = buildIndexes(setChildUnion(data, child.id, union));
    const links = parentLinksOf(after, child.id);

    expect(parentsOf(after, child.id).map((p) => p.id)).to.have.members([father.id, mother.id]);
    expect(links).to.have.lengthOf(2);
    expect(links.every((l) => l.unionId === union.id)).to.equal(true);
  });

  it('does not duplicate the parent who was already linked', () => {
    const { child, father, link, union, data } = childWithOneParentAndAStepIn();
    const after = setChildUnion(data, child.id, union);

    const toFather = after.parentChildren.filter(
      (l) => l.childId === child.id && l.parentId === father.id,
    );

    expect(toFather).to.have.lengthOf(1);
    expect(toFather[0].id).to.equal(link.id, 'the existing link is kept, not replaced');
  });

  it('leaves the graph valid', () => {
    const { child, union, data } = childWithOneParentAndAStepIn();
    const after = setChildUnion(data, child.id, union);

    expect(validateBlocking(buildIndexes(after))).to.eql([]);
  });

  /**
   * An adoptive parent recorded alongside a biological couple is a real third
   * link, so attaching the couple must not sweep it away.
   */
  it('leaves a parent from outside the couple exactly as they were', () => {
    const { child, union, data } = childWithOneParentAndAStepIn();
    const guardian = createPerson({ firstName: 'Guardian' });
    const guardianLink = createParentChild({
      parentId: guardian.id,
      childId: child.id,
      type: ParentType.GUARDIAN,
    });

    const withGuardian = {
      ...data,
      persons: [...data.persons, guardian],
      parentChildren: [...data.parentChildren, guardianLink],
    };

    const after = setChildUnion(withGuardian, child.id, union);
    const kept = after.parentChildren.find((l) => l.id === guardianLink.id);

    expect(kept.parentId).to.equal(guardian.id);
    expect(kept.type).to.equal(ParentType.GUARDIAN);
    expect(kept.unionId).to.equal(null, 'not claimed by a couple it is not part of');
  });

  it('detaches without removing anybody', () => {
    const { child, father, mother, union, data } = childWithOneParentAndAStepIn();

    const attached = setChildUnion(data, child.id, union);
    const detached = buildIndexes(setChildUnion(attached, child.id, null));

    expect(parentsOf(detached, child.id).map((p) => p.id)).to.have.members([father.id, mother.id]);
    expect(parentLinksOf(detached, child.id).every((l) => l.unionId === null)).to.equal(true);
  });

  /**
   * The guarantee the interface leans on: it never has to work out for itself
   * whether an edit is safe, because the store refuses one that is not.
   */
  it('is refused when it would make a third biological parent', () => {
    const { child, union, data } = childWithOneParentAndAStepIn();
    const outsider = person('Outsider', { born: '1921' });

    const crowded = {
      ...data,
      persons: [...data.persons, outsider],
      parentChildren: [
        ...data.parentChildren,
        createParentChild({ parentId: outsider.id, childId: child.id }),
      ],
    };

    expect(validateBlocking(buildIndexes(crowded))).to.eql([], 'two biological parents is fine');

    const after = validateBlocking(buildIndexes(setChildUnion(crowded, child.id, union)));
    expect(after.map((issue) => issue.ruleId)).to.include('TOO_MANY_BIO_PARENTS');
  });

  it('is refused when a parent change would close a loop', () => {
    const { father, child, data } = minimalFamily();
    const link = data.parentChildren.find((l) => l.parentId === father.id);

    // Making the child their own father's parent is the loop the editor's
    // search refuses to offer in the first place.
    const looped = updateParentLink(data, link.id, { parentId: child.id });
    const found = validateBlocking(buildIndexes(looped)).map((issue) => issue.ruleId);

    expect(found).to.include.oneOf(['CYCLE', 'SELF_PARENT']);
  });
});

/**
 * The same operations again, but through the real actions and the real store.
 *
 * Everything above tests the transform in isolation, which proves the shape is
 * right and nothing else. The claim the interface actually leans on — that an
 * edit which would corrupt the graph is REFUSED rather than applied — lives in
 * the store, so it has to be tested there.
 */
describe('through the store', () => {
  let folder = null;

  beforeEach(async () => {
    folder = await createBrowserFolder('Relations test');
  });

  afterEach(async () => {
    store.close();
    await removeBrowserFolder(folder.name).catch(() => {});
  });

  const openWith = (data) => store.adoptNew(data, folder);

  it('attaches a child to a couple in one action', async () => {
    const { child, father, mother, union, data } = childWithOneParentAndAStepIn();
    await openWith(data);

    const result = actions.setChildUnion(child.id, union.id);
    expect(result.ok).to.equal(true);

    const links = parentLinksOf(store.graph, child.id);
    expect(links.map((l) => l.parentId)).to.have.members([father.id, mother.id]);
    expect(links.every((l) => l.unionId === union.id)).to.equal(true);
  });

  it('refuses a parent link that would close a loop, and says why', async () => {
    const { father, child, data } = minimalFamily();
    await openWith(data);

    const link = parentLinksOf(store.graph, child.id).find((l) => l.parentId === father.id);
    const result = actions.updateParentLink(link.id, { parentId: child.id });

    expect(result.ok).to.equal(false);
    expect(result.errors.map((issue) => issue.ruleId)).to.include.oneOf(['CYCLE', 'SELF_PARENT']);

    // And nothing moved: a refused edit leaves the graph exactly as it was.
    expect(parentLinksOf(store.graph, child.id).find((l) => l.id === link.id).parentId).to.equal(
      father.id,
    );
  });

  it('records the kind of relationship, and that a marriage ended', async () => {
    const { union, data } = minimalFamily();
    await openWith(data);

    expect(actions.updateUnion(union.id, { type: UnionType.MARRIED }).ok).to.equal(true);
    expect(actions.updateUnion(union.id, { endDate: parseDate('1962') }).ok).to.equal(true);

    const saved = store.graph.unions.get(union.id);
    expect(saved.type).to.equal(UnionType.MARRIED);
    expect(saved.endDate.raw).to.equal('1962');
  });

  it('puts a refused edit back on the undo stack unchanged', async () => {
    const { father, child, data } = minimalFamily();
    await openWith(data);

    const before = store.canUndo;
    const link = parentLinksOf(store.graph, child.id).find((l) => l.parentId === father.id);
    actions.updateParentLink(link.id, { parentId: child.id });

    expect(store.canUndo).to.equal(before, 'a refusal is not an edit to undo');
  });

  it('automatically creates a union when adding a second biological parent via addParentFor', async () => {
    const child = person('Child');
    const father = person('Father');
    const link = createParentChild({
      parentId: father.id,
      childId: child.id,
      type: ParentType.BIOLOGICAL,
    });
    await openWith(project({ persons: [child, father], parentChildren: [link] }));

    const result = actions.addParentFor(child.id);
    expect(result.ok).to.equal(true);

    const unions = [...store.graph.unions.values()];
    expect(unions).to.have.lengthOf(1);
    expect([unions[0].partner1Id, unions[0].partner2Id]).to.have.members([
      father.id,
      result.person.id,
    ]);

    const links = parentLinksOf(store.graph, child.id);
    expect(links).to.have.lengthOf(2);
    expect(links.every((l) => l.unionId === unions[0].id)).to.equal(true);
  });

  it('removes the second parent and its union when creation is cancelled', async () => {
    const child = person('Child');
    const mother = person('Mother');
    const motherLink = createParentChild({ parentId: mother.id, childId: child.id });
    await openWith(project({ persons: [child, mother], parentChildren: [motherLink] }));

    const result = actions.addParentFor(child.id);
    expect(result.ok).to.equal(true);
    expect(actions.removeEntity('person', result.person.id).ok).to.equal(true);

    expect(store.graph.persons.has(result.person.id)).to.equal(false);
    expect([...store.graph.unions.values()]).to.have.lengthOf(0);
    expect(parentLinksOf(store.graph, child.id)).to.have.lengthOf(1);
    expect(parentLinksOf(store.graph, child.id)[0].parentId).to.equal(mother.id);
  });

  it('automatically creates a union when adding a second biological parent via addParentLink', async () => {
    const child = person('Child');
    const father = person('Father');
    const mother = person('Mother');
    const link = createParentChild({
      parentId: father.id,
      childId: child.id,
      type: ParentType.BIOLOGICAL,
    });
    await openWith(project({ persons: [child, father, mother], parentChildren: [link] }));

    const result = actions.addParentLink(child.id, mother.id);
    expect(result.ok).to.equal(true);

    const unions = [...store.graph.unions.values()];
    expect(unions).to.have.lengthOf(1);
    expect([unions[0].partner1Id, unions[0].partner2Id]).to.have.members([father.id, mother.id]);

    const links = parentLinksOf(store.graph, child.id);
    expect(links).to.have.lengthOf(2);
    expect(links.every((l) => l.unionId === unions[0].id)).to.equal(true);
  });

  it('reuses an existing union and avoids duplicates when adding a second parent', async () => {
    const child = person('Child');
    const father = person('Father');
    const mother = person('Mother');
    const union = createUnion({ partner1Id: father.id, partner2Id: mother.id });
    const link = createParentChild({
      parentId: father.id,
      childId: child.id,
      type: ParentType.BIOLOGICAL,
    });
    await openWith(
      project({
        persons: [child, father, mother],
        unions: [union],
        parentChildren: [link],
      }),
    );

    const result = actions.addParentLink(child.id, mother.id);
    expect(result.ok).to.equal(true);

    const unions = [...store.graph.unions.values()];
    expect(unions).to.have.lengthOf(1, 'no duplicate union is created');
    expect(unions[0].id).to.equal(union.id);

    const links = parentLinksOf(store.graph, child.id);
    expect(links).to.have.lengthOf(2);
    expect(links.every((l) => l.unionId === union.id)).to.equal(true);
  });

  it('does not create a union when adding the first parent', async () => {
    const child = person('Child');
    await openWith(project({ persons: [child] }));

    const result = actions.addParentFor(child.id);
    expect(result.ok).to.equal(true);

    expect([...store.graph.unions.values()]).to.have.lengthOf(0);
    const links = parentLinksOf(store.graph, child.id);
    expect(links).to.have.lengthOf(1);
    expect(links[0].unionId).to.equal(null);
  });

  it('does not create a union when the second parent link is non-biological', async () => {
    const child = person('Child');
    const father = person('Father');
    const guardian = person('Guardian');
    const link = createParentChild({
      parentId: father.id,
      childId: child.id,
      type: ParentType.BIOLOGICAL,
    });
    await openWith(project({ persons: [child, father, guardian], parentChildren: [link] }));

    const result = actions.addParentLink(child.id, guardian.id, { type: ParentType.GUARDIAN });
    expect(result.ok).to.equal(true);

    expect([...store.graph.unions.values()]).to.have.lengthOf(0);
    const links = parentLinksOf(store.graph, child.id);
    expect(links.every((l) => l.unionId === null)).to.equal(true);
  });

  it('does not create a union if createUnion: false is specified', async () => {
    const child = person('Child');
    const father = person('Father');
    const mother = person('Mother');
    const link = createParentChild({
      parentId: father.id,
      childId: child.id,
      type: ParentType.BIOLOGICAL,
    });
    await openWith(project({ persons: [child, father, mother], parentChildren: [link] }));

    const result = actions.addParentLink(child.id, mother.id, { createUnion: false });
    expect(result.ok).to.equal(true);

    expect([...store.graph.unions.values()]).to.have.lengthOf(0);
    const links = parentLinksOf(store.graph, child.id);
    expect(links.every((l) => l.unionId === null)).to.equal(true);
  });

  it('creates a union between two existing people via addUnion', async () => {
    const a = person('A');
    const b = person('B');
    await openWith(project({ persons: [a, b] }));

    const result = actions.addUnion(a.id, b.id, { type: UnionType.MARRIED });
    expect(result.ok).to.equal(true);

    const saved = store.graph.unions.get(result.union.id);
    expect(saved).to.be.ok;
    expect(saved.type).to.equal(UnionType.MARRIED);
  });

  it('attaches shared biological children when adding an existing partner', async () => {
    const child = person('Child');
    const father = person('Father');
    const mother = person('Mother');
    const fatherLink = createParentChild({ parentId: father.id, childId: child.id });
    const motherLink = createParentChild({ parentId: mother.id, childId: child.id });
    await openWith(
      project({
        persons: [child, father, mother],
        parentChildren: [fatherLink, motherLink],
      }),
    );

    const result = actions.addUnion(mother.id, father.id);
    expect(result.ok).to.equal(true);

    const links = parentLinksOf(store.graph, child.id);
    expect(links).to.have.lengthOf(2);
    expect(links.every((link) => link.unionId === result.union.id)).to.equal(true);
  });

  it('refuses to add a duplicate union between the same people', async () => {
    const a = person('A');
    const b = person('B');
    const union = createUnion({ partner1Id: a.id, partner2Id: b.id });
    await openWith(project({ persons: [a, b], unions: [union] }));

    const result = actions.addUnion(a.id, b.id);
    expect(result.ok).to.equal(false);
    expect(result.errors.map((e) => e.ruleId)).to.include('DUPLICATE_UNION');
  });

  it('refuses to create a union with oneself', async () => {
    const a = person('A');
    await openWith(project({ persons: [a] }));

    const result = actions.addUnion(a.id, a.id);
    expect(result.ok).to.equal(false);
    expect(result.errors.map((e) => e.ruleId)).to.include('SELF_UNION');
  });
});

describe('relation editor UI', () => {
  let folder = null;
  let element = null;

  beforeEach(async () => {
    folder = await createBrowserFolder('RelationEditor UI test');
    element = document.createElement('relation-editor');
    document.body.append(element);
  });

  afterEach(async () => {
    element.remove();
    store.close();
    await removeBrowserFolder(folder.name).catch(() => {});
  });

  it('excludes self, descendants, and existing partners from partner search', async () => {
    const focal = person('Focal');
    const spouse = person('Spouse');
    const child = person('Child');
    const grandchild = person('Grandchild');
    const sibling = person('Sibling');
    const union = createUnion({ partner1Id: focal.id, partner2Id: spouse.id });
    const link1 = createParentChild({ parentId: focal.id, childId: child.id, unionId: union.id });
    const link2 = createParentChild({ parentId: child.id, childId: grandchild.id });

    const data = project({
      persons: [focal, spouse, child, grandchild, sibling],
      unions: [union],
      parentChildren: [link1, link2],
    });
    await store.adoptNew(data, folder);

    element.open(focal.id, () => store.graph);

    const searches = element.shadowRoot.querySelectorAll('person-search');
    const partnerSearch = searches[1];
    expect(partnerSearch).to.be.ok;

    expect(partnerSearch.exclude.has(focal.id)).to.equal(true);
    expect(partnerSearch.exclude.has(spouse.id)).to.equal(true);
    expect(partnerSearch.exclude.has(child.id)).to.equal(true);
    expect(partnerSearch.exclude.has(grandchild.id)).to.equal(true);
    expect(partnerSearch.exclude.has(sibling.id)).to.equal(false);
  });

  it('dispatches addUnion action when a partner is selected', async () => {
    const focal = person('Focal');
    const candidate = person('Candidate');
    const data = project({ persons: [focal, candidate] });
    await store.adoptNew(data, folder);

    element.open(focal.id, () => store.graph);

    let dispatched = null;
    element.addEventListener('relation:change', (event) => {
      dispatched = event.detail;
    });

    const partnerSearch = element.shadowRoot.querySelectorAll('person-search')[1];
    partnerSearch.dispatchEvent(
      new CustomEvent('relation:pick-partner', {
        detail: { personId: candidate.id },
        bubbles: true,
        composed: true,
      }),
    );

    expect(dispatched).to.eql({
      action: 'addUnion',
      args: [focal.id, candidate.id],
    });
  });

  it('resets searches when closed without adding a partner', async () => {
    const focal = person('Focal');
    await store.adoptNew(project({ persons: [focal] }), folder);

    element.open(focal.id, () => store.graph);
    const partnerSearch = element.shadowRoot.querySelectorAll('person-search')[1];
    const input = partnerSearch.shadowRoot.querySelector('input');
    input.value = 'query';

    element.close();
    expect(input.value).to.equal('');
  });
});
