import { expect } from '@open-wc/testing';
import { buildIndexes } from '../src/domain/graph/indexes.js';
import { parentsOf, childrenOf, siblingsOf, childrenOfUnion } from '../src/domain/graph/queries.js';
import { ancestorsOf, wouldCreateCycle, closestCommonAncestor } from '../src/domain/graph/traversal.js';
import { assignGenerations } from '../src/domain/graph/generations.js';
import { buildLayout, NodeType } from '../src/domain/layout/engine.js';
import { ParentType, Sex, createUnion, createParentChild } from '../src/domain/model/factories.js';
import {
  minimalFamily,
  mixedAdoptionFamily,
  halfSiblingsFamily,
  familyWithPlaceholder,
  person,
  project,
} from './fixtures/families.js';

describe('queries', () => {
  it('finds both parents of a child', () => {
    const { father, mother, child, data } = minimalFamily();
    const g = buildIndexes(data);
    const ids = parentsOf(g, child.id).map((p) => p.id);
    expect(ids).to.have.members([father.id, mother.id]);
  });

  it('separates the genetic line from the legal one', () => {
    const { father, mother, child, data } = mixedAdoptionFamily();
    const g = buildIndexes(data);

    const all = parentsOf(g, child.id).map((p) => p.id);
    const biological = parentsOf(g, child.id, { biologicalOnly: true }).map((p) => p.id);

    expect(all).to.have.members([father.id, mother.id]);
    expect(biological).to.eql([father.id]);
    expect(childrenOf(g, mother.id, { biologicalOnly: true })).to.eql([]);
  });

  it('tells full siblings from half siblings', () => {
    const { childA, childB, data } = halfSiblingsFamily();
    const g = buildIndexes(data);

    const { full, half } = siblingsOf(g, childA.id);
    expect(full).to.eql([]);
    expect(half.map((p) => p.id)).to.eql([childB.id]);
  });

  it('lists the children of a union', () => {
    const { union, child, data } = minimalFamily();
    const g = buildIndexes(data);
    expect(childrenOfUnion(g, union).map((p) => p.id)).to.eql([child.id]);
  });

  it('treats a placeholder as a normal parent', () => {
    const { ghost, child, data } = familyWithPlaceholder();
    const g = buildIndexes(data);
    expect(parentsOf(g, child.id).map((p) => p.id)).to.include(ghost.id);
    expect(g.persons.get(ghost.id).isPlaceholder).to.equal(true);
  });
});

describe('traversal', () => {
  it('reports ancestors with their distance', () => {
    const { father, child, data } = minimalFamily();
    const g = buildIndexes(data);
    expect(ancestorsOf(g, child.id).get(father.id)).to.equal(1);
  });

  it('detects a cycle before it is created', () => {
    const { father, child, data } = minimalFamily();
    const g = buildIndexes(data);
    expect(wouldCreateCycle(g, child.id, father.id)).to.equal(true);
    expect(wouldCreateCycle(g, father.id, child.id)).to.equal(false);
  });

  // A loop through an adoption is still a loop.
  it('does not filter by link type when detecting cycles', () => {
    const { father, child, data } = mixedAdoptionFamily();
    data.parentChildren[0].type = ParentType.ADOPTED;
    const g = buildIndexes(data);
    expect(wouldCreateCycle(g, child.id, father.id)).to.equal(true);
  });

  it('finds the closest common ancestor', () => {
    const { father, childA, childB, data } = halfSiblingsFamily();
    const g = buildIndexes(data);
    const common = closestCommonAncestor(g, childA.id, childB.id, 8);
    expect(common.ancestorId).to.equal(father.id);
  });
});

describe('generations', () => {
  it('puts the focal person at level 0 and parents above', () => {
    const { father, mother, child, data } = minimalFamily();
    const g = buildIndexes(data);
    const levels = assignGenerations(g, child.id);

    expect(levels.get(child.id)).to.equal(0);
    expect(levels.get(father.id)).to.equal(-1);
    expect(levels.get(mother.id)).to.equal(-1);
  });

  // Both members of a union are forced into the same visual row, whatever
  // their age difference.
  it('normalises partners to the same level', () => {
    const { father, mother, data } = minimalFamily();
    const g = buildIndexes(data);
    const levels = assignGenerations(g, father.id);
    expect(levels.get(mother.id)).to.equal(levels.get(father.id));
  });

  it('honours the generation window', () => {
    const { father, child, data } = minimalFamily();
    const g = buildIndexes(data);
    const levels = assignGenerations(g, child.id, { up: 0, down: 0 });
    expect(levels.has(father.id)).to.equal(false);
  });

  it('shows the focal person their own siblings', () => {
    const { childA, childB, data } = halfSiblingsFamily();
    const g = buildIndexes(data);
    const levels = assignGenerations(g, childA.id, { up: 1, down: 1 });
    expect(levels.get(childB.id)).to.equal(0);
  });

  /**
   * The view is a pedigree, not a sweep of the whole generational band. A walk
   * bounded only by depth reaches an ancestor, then all of their children, then
   * those children's partners, then their children — and so on until it has the
   * entire archive. On 10,000 people that was 2,439 at one generation.
   */
  it('does not spread sideways into cousins', () => {
    const { father, motherA, motherB, childA, childB, data } = halfSiblingsFamily();

    // childB's mother is a different woman: reachable only by going up to the
    // shared father and back down. A pedigree view must not do that.
    const g = buildIndexes(data);
    const levels = assignGenerations(g, childA.id, { up: 4, down: 4 });

    expect(levels.get(father.id)).to.equal(-1);
    expect(levels.get(motherA.id)).to.equal(-1);
    expect(levels.get(childB.id)).to.equal(0, 'half sibling is still shown');
    expect(levels.has(motherB.id)).to.equal(false, "the half sibling's other parent is not");
  });

  it('brings each descendant their partner, so unions still render', () => {
    const { father, mother, child, data } = minimalFamily();
    const g = buildIndexes(data);
    const levels = assignGenerations(g, father.id, { up: 0, down: 1 });

    expect(levels.get(mother.id)).to.equal(0);
    expect(levels.get(child.id)).to.equal(1);
  });
});

describe('layout', () => {
  it('inserts a synthetic union node between partners', () => {
    const { union, data } = minimalFamily();
    const g = buildIndexes(data);
    const { rows, edges } = buildLayout(g, data.settings.focalPersonId);

    const unionNodes = rows
      .flatMap((r) => r.nodes)
      .filter((n) => n.type === NodeType.UNION);

    expect(unionNodes).to.have.lengthOf(1);
    expect(unionNodes[0].entityId).to.equal(union.id);

    // Two partner edges and one descent edge: 2 + N, not 2N.
    expect(edges.filter((e) => e.kind === 'partner')).to.have.lengthOf(2);
    expect(edges.filter((e) => e.kind === 'descent')).to.have.lengthOf(1);
  });

  it('returns nothing when there is no focal person', () => {
    const { data } = minimalFamily();
    const g = buildIndexes(data);
    expect(buildLayout(g, null).rows).to.eql([]);
  });

  /**
   * Ordering a row by birth date alone scattered siblings among other people's
   * spouses, so the bar joining them ran over three strangers and read as
   * though they were all siblings. Families have to stay contiguous.
   */
  describe('row ordering', () => {
    /** One couple, three married children, each with their own spouse. */
    const threeMarriedChildren = () => {
      const father = person('Father', { sex: Sex.MALE, born: '1900' });
      const mother = person('Mother', { sex: Sex.FEMALE, born: '1902' });
      const union = createUnion({ partner1Id: father.id, partner2Id: mother.id });

      const children = ['1925', '1928', '1931'].map((year, index) =>
        person(`Child${index}`, { born: year }),
      );
      const spouses = children.map((_, index) => person(`Spouse${index}`, { born: '1930' }));

      return {
        father,
        children,
        spouses,
        data: project({
          persons: [father, mother, ...children, ...spouses],
          unions: [
            union,
            ...children.map((child, index) =>
              createUnion({ partner1Id: child.id, partner2Id: spouses[index].id }),
            ),
          ],
          parentChildren: children.flatMap((child) => [
            createParentChild({ parentId: father.id, childId: child.id, unionId: union.id }),
            createParentChild({ parentId: mother.id, childId: child.id, unionId: union.id }),
          ]),
        }),
      };
    };

    const rowOf = (layout, level) =>
      layout.rows
        .find((row) => row.level === level)
        .nodes.filter((node) => node.type === NodeType.PERSON)
        .map((node) => node.entityId);

    it('keeps each couple together and in birth order', () => {
      const { father, children, spouses, data } = threeMarriedChildren();
      const g = buildIndexes(data);
      const order = rowOf(buildLayout(g, father.id, { up: 0, down: 1 }), 1);

      // Each child immediately followed by their own spouse, oldest first.
      expect(order).to.eql([
        children[0].id, spouses[0].id,
        children[1].id, spouses[1].id,
        children[2].id, spouses[2].id,
      ]);
    });

    /**
     * THE reason this engine assigns coordinates at all.
     *
     * Leaving placement to CSS centred every row on its own, with no
     * relationship between where a couple sat and where their children sat. A
     * couple could end up at one end of the tree and their children at the
     * other, with the bar joining them running the width of the screen.
     *
     * The target is the span of the children's own CARDS. Centring over their
     * blocks instead — which also hold their spouses — left the couple half a
     * couple to one side of the bar their line drops onto.
     */
    it('centres a couple over the cards of their children', () => {
      const { father, children, data } = threeMarriedChildren();
      const g = buildIndexes(data);
      const layout = buildLayout(g, father.id, { up: 0, down: 1 });

      const byId = new Map(layout.nodes.map((node) => [node.id, node]));
      const dot = layout.nodes.find((node) => node.type === NodeType.UNION);
      const kids = children.map((child) => byId.get(`p:${child.id}`));

      const left = Math.min(...kids.map((kid) => kid.x));
      const right = Math.max(...kids.map((kid) => kid.x + kid.width));

      expect(dot.x + dot.width / 2).to.be.closeTo((left + right) / 2, 0.5);
    });

    it('leaves a wider gap between families than between couples', () => {
      // The focal couple, two married children, and grandchildren on both
      // sides: the bottom row then holds two separate families.
      const focal = person('Focal', { born: '1900' });
      const spouse = person('Spouse', { born: '1902' });
      const focalUnion = createUnion({ partner1Id: focal.id, partner2Id: spouse.id });

      const branches = ['A', 'B'].map((tag, index) => {
        const child = person(`Child${tag}`, { born: `192${index * 2}` });
        const inLaw = person(`InLaw${tag}`, { born: '1925' });
        const union = createUnion({ partner1Id: child.id, partner2Id: inLaw.id });
        const kids = [0, 1].map((n) => person(`Kid${tag}${n}`, { born: `195${n}` }));
        return { child, inLaw, union, kids };
      });

      const g = buildIndexes(
        project({
          persons: [focal, spouse, ...branches.flatMap((b) => [b.child, b.inLaw, ...b.kids])],
          unions: [focalUnion, ...branches.map((b) => b.union)],
          parentChildren: [
            ...branches.flatMap((b) => [
              createParentChild({ parentId: focal.id, childId: b.child.id, unionId: focalUnion.id }),
              createParentChild({ parentId: spouse.id, childId: b.child.id, unionId: focalUnion.id }),
            ]),
            ...branches.flatMap((b) =>
              b.kids.flatMap((kid) => [
                createParentChild({ parentId: b.child.id, childId: kid.id, unionId: b.union.id }),
                createParentChild({ parentId: b.inLaw.id, childId: kid.id, unionId: b.union.id }),
              ]),
            ),
          ],
        }),
      );

      const row = buildLayout(g, focal.id, { up: 0, down: 2 }).rows.find((r) => r.level === 2).nodes;
      const gaps = row.slice(1).map((node, i) => node.x - (row[i].x + row[i].width));

      // Between two families, the gap is larger than any gap inside one.
      const widest = Math.max(...gaps);
      const rest = gaps.filter((gap) => gap !== widest);

      expect(rest.length).to.be.above(0);
      expect(widest).to.be.above(Math.max(...rest));
    });

    // The sibling comes first in the pair, not the person who married in.
    it('puts the blood relative on the side facing their siblings', () => {
      const { father, children, data } = threeMarriedChildren();
      const g = buildIndexes(data);
      const order = rowOf(buildLayout(g, father.id, { up: 0, down: 1 }), 1);

      for (const child of children) {
        expect(order.indexOf(child.id) % 2).to.equal(0, `${child.firstName} leads its pair`);
      }
    });

    /**
     * The focal row cannot be oriented by position, because the row above has
     * not been placed yet. Without a rule of its own, the focal person's
     * spouse sat between them and their siblings and the bar joining the
     * siblings had to reach over her.
     */
    it('puts the focal person ahead of their own spouse', () => {
      const { children, spouses, data } = threeMarriedChildren();
      const focal = children[1];

      const g = buildIndexes(data);
      const order = rowOf(buildLayout(g, focal.id, { up: 1, down: 0 }), 0);

      expect(order.indexOf(focal.id)).to.be.below(order.indexOf(spouses[1].id));

      // And the siblings are still there, in birth order, after the pair.
      expect(order.filter((id) => children.some((c) => c.id === id))).to.eql([
        children[0].id,
        children[1].id,
        children[2].id,
      ]);
    });

    /**
     * When two people marry, each partner's parents in the row above must
     * align with their child's position in the couple — even if the parents'
     * birth dates would otherwise sort them in the opposite direction.
     */
    it('orders ancestor couples to match their children and avoid crossing lines', () => {
      const focal = person('Child', { born: '1940' });
      // Mother born earlier (1910) -> placed on left
      const mother = person('Mother', { sex: Sex.FEMALE, born: '1910' });
      // Father born later (1915) -> placed on right
      const father = person('Father', { sex: Sex.MALE, born: '1915' });

      // Maternal grandparents born LATER than paternal grandparents
      const matGrandpa = person('MatGrandpa', { born: '1885' });
      const matGrandma = person('MatGrandma', { born: '1887' });
      const patGrandpa = person('PatGrandpa', { born: '1875' });
      const patGrandma = person('PatGrandma', { born: '1877' });

      const uParents = createUnion({ partner1Id: mother.id, partner2Id: father.id });
      const uMat = createUnion({ partner1Id: matGrandpa.id, partner2Id: matGrandma.id });
      const uPat = createUnion({ partner1Id: patGrandpa.id, partner2Id: patGrandma.id });

      const data = project({
        persons: [focal, mother, father, matGrandpa, matGrandma, patGrandpa, patGrandma],
        unions: [uParents, uMat, uPat],
        parentChildren: [
          createParentChild({ parentId: mother.id, childId: focal.id, unionId: uParents.id }),
          createParentChild({ parentId: father.id, childId: focal.id, unionId: uParents.id }),
          createParentChild({ parentId: matGrandpa.id, childId: mother.id, unionId: uMat.id }),
          createParentChild({ parentId: matGrandma.id, childId: mother.id, unionId: uMat.id }),
          createParentChild({ parentId: patGrandpa.id, childId: father.id, unionId: uPat.id }),
          createParentChild({ parentId: patGrandma.id, childId: father.id, unionId: uPat.id }),
        ],
        settings: { focalPersonId: focal.id, maxGenerationsUp: 2, maxGenerationsDown: 0 },
      });

      const g = buildIndexes(data);
      const layout = buildLayout(g, focal.id, { up: 2, down: 0 });

      const rowMinus2 = layout.rows
        .find((r) => r.level === -2)
        .nodes.filter((n) => n.type === NodeType.PERSON)
        .map((n) => n.entityId);

      // Maternal grandparents must sit to the left of paternal grandparents
      // because Mother is to the left of Father at level -1.
      expect(rowMinus2.indexOf(matGrandpa.id)).to.be.below(
        rowMinus2.indexOf(patGrandpa.id),
        'maternal grandparents stay on the left above mother',
      );
    });
  });

  /**
   * Someone who was with two people in turn.
   *
   * Laid out as [T1][·][T2][·][T3] the second dot lands between T2 and T3 and
   * says they are the couple, which they are not. T1 belongs in the middle.
   */
  describe('a person with two partners', () => {
    const remarried = () => {
      const t1 = person('T1', { sex: Sex.FEMALE, born: '1900' });
      const t2 = person('T2', { sex: Sex.MALE, born: '1898' });
      const t3 = person('T3', { sex: Sex.MALE, born: '1901' });

      const first = createUnion({ partner1Id: t1.id, partner2Id: t2.id });
      const second = createUnion({ partner1Id: t1.id, partner2Id: t3.id });

      return {
        t1, t2, t3, first, second,
        data: project({
          persons: [t1, t2, t3],
          unions: [first, second],
          settings: { focalPersonId: t1.id, maxGenerationsUp: 2, maxGenerationsDown: 2 },
        }),
      };
    };

    const nodesAt = (layout, level) =>
      layout.rows.find((row) => row.level === level).nodes;

    it('puts the shared person between the two partners', () => {
      const { t1, t2, t3, data } = remarried();
      const g = buildIndexes(data);
      const order = nodesAt(buildLayout(g, t1.id), 0)
        .filter((node) => node.type === NodeType.PERSON)
        .map((node) => node.entityId);

      expect(order).to.eql([t2.id, t1.id, t3.id]);
    });

    it('leaves each union dot between the two people it actually joins', () => {
      const { t1, t2, t3, first, second, data } = remarried();
      const g = buildIndexes(data);
      const nodes = nodesAt(buildLayout(g, t1.id), 0);

      const spanOf = (id) => {
        const node = nodes.find((n) => n.entityId === id);
        return [node.x, node.x + node.width];
      };

      const [, t2Right] = spanOf(t2.id);
      const [t1Left, t1Right] = spanOf(t1.id);
      const [t3Left] = spanOf(t3.id);
      const [firstLeft, firstRight] = spanOf(first.id);
      const [secondLeft, secondRight] = spanOf(second.id);

      // Each dot sits in the gap between its own two partners, and nothing
      // else lies in that gap.
      expect(firstLeft).to.be.at.least(t2Right);
      expect(firstRight).to.be.at.most(t1Left);
      expect(secondLeft).to.be.at.least(t1Right);
      expect(secondRight).to.be.at.most(t3Left);
    });

    it('still draws two partner edges per union, to the right people', () => {
      const { t1, t2, t3, first, second, data } = remarried();
      const g = buildIndexes(data);
      const { edges } = buildLayout(g, t1.id);

      const partnersOfUnion = (union) =>
        edges
          .filter((e) => e.kind === 'partner' && e.toNodeId === `u:${union.id}`)
          .map((e) => e.fromNodeId)
          .sort();

      expect(partnersOfUnion(first)).to.eql([`p:${t1.id}`, `p:${t2.id}`].sort());
      expect(partnersOfUnion(second)).to.eql([`p:${t1.id}`, `p:${t3.id}`].sort());
    });

    /** One partner keeps the old arrangement exactly: person first, then dot. */
    it('does not move anything when there is only one partner', () => {
      const { father, mother, data } = minimalFamily();
      const g = buildIndexes(data);
      const order = buildLayout(g, father.id, { up: 0, down: 0 })
        .rows.find((row) => row.level === 0)
        .nodes.filter((node) => node.type === NodeType.PERSON)
        .map((node) => node.entityId);

      expect(order).to.eql([father.id, mother.id]);
    });
  });
});
