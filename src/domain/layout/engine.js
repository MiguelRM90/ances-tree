/**
 * Layout engine (architecture.md, layout section).
 *
 * NO DOM. It produces positioned nodes and the edges between them; painting is
 * the job of ui/components/tree-canvas.js. That separation is what allows the
 * layout to be tested without a browser.
 *
 *   Phase 0  Prune around the focal person -> generations.js
 *   Phase 1  Level assignment              -> generations.js
 *   Phase 2  Synthetic union nodes         -> here
 *   Phase 3  Ordering                      -> here
 *   Phase 4  Positioning                   -> here
 *
 * Phase 4 is the reason this file assigns coordinates at all.
 *
 * Leaving placement to CSS meant every row was centred on its own, with no
 * relationship between where a couple sat and where their children sat. A
 * couple could end up at one end of the tree and their children spread across
 * the other, and the bar joining them ran the width of the screen. No amount
 * of ordering fixes that, because ordering cannot move a row sideways.
 *
 * The rule here is the one every genealogy program uses: a couple is centred
 * over the block of their children.
 */

import { assignGenerations, groupByLevel } from '../graph/generations.js';
import {
  childrenOfUnion,
  sortByBirth,
  unionsOf,
  partnerIn,
  parentLinksOf,
  childLinksOf,
} from '../graph/queries.js';
import { LAYOUT } from '../../config/layout.js';

export const NodeType = { PERSON: 'person', UNION: 'union' };

/**
 * @typedef {Object} LayoutNode
 * @property {'person'|'union'} type
 * @property {string} id        node id, unique within the layout
 * @property {string} entityId
 * @property {number} level
 * @property {number} x, y, width, height   in pixels, from the top left
 *
 * @typedef {Object} LayoutEdge
 * @property {string} id
 * @property {'partner'|'descent'} kind
 * @property {string} fromNodeId
 * @property {string} toNodeId
 */

/**
 * @returns {{nodes: LayoutNode[], rows: Array<{level: number, nodes: LayoutNode[]}>,
 *            edges: LayoutEdge[], width: number, height: number, levels: Map<string, number>}}
 */
export function buildLayout(g, focalId, { up = 4, down = 4, metrics = LAYOUT } = {}) {
  const levels = assignGenerations(g, focalId, { up, down });
  const empty = { nodes: [], rows: [], edges: [], width: 0, height: 0, levels };
  if (levels.size === 0) return empty;

  const blocksByLevel = new Map(
    groupByLevel(levels).map(([level, ids]) => [level, buildBlocks(g, new Set(ids), metrics)]),
  );

  const ordered = orderRows(g, blocksByLevel, levels);
  link(g, ordered);
  place(ordered, metrics);

  return { ...emit(g, ordered, new Set(levels.keys()), metrics), levels };
}

// --- Phase 2: blocks -------------------------------------------------------

/**
 * A block is one person together with every visible partner they had. Blocks
 * are the unit that gets ordered and positioned, because a couple that drifts
 * apart in a row is a couple whose connecting line crosses everyone in between.
 *
 * With more than one partner the person goes in the MIDDLE, partners to either
 * side. Appending them in a row instead produced
 *
 *     [T1] · [T2] · [T3]
 *
 * where the second dot sits between T2 and T3 and reads as though THEY were the
 * couple. The edges were right the whole time; the arrangement lied about them.
 * Centred, each dot sits between the person and the partner it actually joins:
 *
 *     [T2] · [T1] · [T3]
 *
 * Three or more partners cannot all be adjacent on one line, so the outermost
 * ones do get a stem passing over a neighbour. Two is the case that happens —
 * a remarriage — and two is exact.
 */
function buildBlocks(g, ids, metrics) {
  const placed = new Set();
  const blocks = [];

  for (const person of anchorOrder(g, ids)) {
    if (placed.has(person.id)) continue;
    placed.add(person.id);

    // Gathered before any of it is placed: which side a partner goes on depends
    // on how many there turn out to be.
    const partners = [];
    for (const union of unionsOf(g, person.id)) {
      const partnerId = partnerIn(union, person.id);
      if (!ids.has(partnerId) || placed.has(partnerId)) continue;
      placed.add(partnerId);
      partners.push({ unionId: union.id, partnerId });
    }

    // Earlier unions inwards, so the row still reads left to right in time.
    const half = Math.floor(partners.length / 2);
    const before = partners.slice(0, half);
    const after = partners.slice(half);

    const items = [];
    for (const { unionId, partnerId } of [...before].reverse()) {
      items.push(
        { type: NodeType.PERSON, entityId: partnerId },
        { type: NodeType.UNION, entityId: unionId },
      );
    }

    const anchorOffset = widthBefore(items.length, metrics);
    items.push({ type: NodeType.PERSON, entityId: person.id });

    for (const { unionId, partnerId } of after) {
      items.push(
        { type: NodeType.UNION, entityId: unionId },
        { type: NodeType.PERSON, entityId: partnerId },
      );
    }

    blocks.push({
      id: person.id,
      items,
      members: [person.id, ...partners.map((p) => p.partnerId)],
      // Where this block's own person sits inside it. Everything that centres
      // one row over another aims at a person's card, and with partners on the
      // left that card is no longer at block.x.
      anchorOffset,
      birth: person.birth?.date?.earliest ?? null,
      width: widthOf(items, metrics),
      below: [],
      kids: [],
      parentBlock: null,
      x: 0,
    });
  }

  return blocks;
}

/** Width of `count` leading [partner, union] items, trailing gap included. */
const widthBefore = (count, metrics) =>
  (count / 2) * (metrics.cardWidth + metrics.unionSize + 2 * metrics.itemGap);

/**
 * Who each block gets built around: most partners first, then birth order.
 *
 * A block is anchored on the first of its people reached, and any partner
 * already placed is skipped. Reaching a remarried person's FIRST spouse first
 * therefore built [spouse · person] and then found nothing left to attach the
 * second marriage to — the union was not merely drawn in the wrong place, it
 * was never drawn at all, and the row read as a chain of three.
 *
 * Anchoring on the person with the most partners fixes that. sort is stable, so
 * everyone with a single partner keeps the birth order they had before.
 */
function anchorOrder(g, ids) {
  const people = sortByBirth([...ids].map((id) => g.persons.get(id)).filter(Boolean));

  const visiblePartners = (person) =>
    unionsOf(g, person.id).filter((union) => ids.has(partnerIn(union, person.id))).length;

  const counts = new Map(people.map((person) => [person.id, visiblePartners(person)]));
  return people.sort((a, b) => counts.get(b.id) - counts.get(a.id));
}

const widthOf = (items, metrics) =>
  items.reduce(
    (total, item) =>
      total + (item.type === NodeType.UNION ? metrics.unionSize : metrics.cardWidth),
    0,
  ) +
  (items.length - 1) * metrics.itemGap;

// --- Phase 3: ordering -----------------------------------------------------

/**
 * Puts each row in an order that keeps families together.
 *
 * Descendant rows follow the position of their parents; ancestor rows follow
 * the position of their children. Both radiate outwards from the focal row,
 * which is what makes a pedigree read correctly.
 */
function orderRows(g, blocksByLevel, levels) {
  const position = new Map();
  const result = new Map();

  const withLead = (block) => ({
    ...block,
    id: block.members[0],
    birth: g.persons.get(block.members[0])?.birth?.date?.earliest ?? null,
  });

  const commit = (level, blocks) => {
    result.set(level, blocks);
    blocks.forEach((block, index) => {
      const personIds = block.items
        .filter((item) => item.type === NodeType.PERSON)
        .map((item) => item.entityId);
      personIds.forEach((memberId, memberIndex) => {
        position.set(memberId, index + memberIndex / personIds.length);
      });
    });
  };

  const anchorOfPerson = (personId, linksOf, endOf) => {
    let nearest = Infinity;
    for (const link of linksOf(g, personId)) {
      const at = position.get(endOf(link));
      if (at !== undefined && at < nearest) nearest = at;
    }
    return nearest;
  };

  const anchorOf = (block, linksOf, endOf) =>
    Math.min(...block.members.map((id) => anchorOfPerson(id, linksOf, endOf)));

  /**
   * Within a couple, the one connected to the neighbouring row goes first.
   * Otherwise the married-in spouse sits between their partner and their
   * partner's siblings.
   */
  const orient = (block, rank) => {
    if (block.members.length !== 2) return block;

    const [first, second] = block.members;
    if (rank(first) <= rank(second)) return block;

    return withLead({ ...block, members: [second, first], items: [...block.items].reverse() });
  };

  const sortBy = (blocks, linksOf, endOf) =>
    [...blocks]
      .map((block) => orient(block, (id) => anchorOfPerson(id, linksOf, endOf)))
      .sort(
        (a, b) =>
          anchorOf(a, linksOf, endOf) - anchorOf(b, linksOf, endOf) || compareBirth(a, b),
      );

  const present = [...blocksByLevel.keys()].sort((a, b) => a - b);
  const lowest = present[0];
  const highest = present[present.length - 1];

  /**
   * The focal row cannot be oriented by position — the row above has not been
   * placed yet — but blood relation needs no positions: whoever has a parent
   * on screen is the sibling, and the sibling leads the pair.
   */
  const isBloodRelative = (personId) =>
    parentLinksOf(g, personId).some((link) => levels.has(link.parentId)) ? 0 : 1;

  commit(
    0,
    [...(blocksByLevel.get(0) ?? [])].map((block) => orient(block, isBloodRelative)).sort(compareBirth),
  );

  for (let level = 1; level <= highest; level += 1) {
    const blocks = blocksByLevel.get(level);
    if (blocks) commit(level, sortBy(blocks, parentLinksOf, (link) => link.parentId));
  }

  for (let level = -1; level >= lowest; level -= 1) {
    const blocks = blocksByLevel.get(level);
    if (blocks) commit(level, sortBy(blocks, childLinksOf, (link) => link.childId));
  }

  return [...result.entries()].sort((a, b) => a[0] - b[0]);
}

function compareBirth(a, b) {
  if (a.birth === b.birth) return 0;
  if (a.birth === null) return 1;
  if (b.birth === null) return -1;
  return a.birth < b.birth ? -1 : 1;
}

// --- Phase 4: positioning --------------------------------------------------

/**
 * Records, for every block, which blocks on the row below descend from it.
 *
 * `kids` is the subset that this block alone owns, used to lay the descendant
 * side out as a tree. `below` is unfiltered and used going upwards, where a
 * block can legitimately be shared: one couple has two sets of grandparents,
 * and both of them sit above it.
 */
function link(g, ordered) {
  const blockOfPerson = new Map();
  for (const [level, blocks] of ordered) {
    for (const block of blocks) {
      for (const memberId of block.members) blockOfPerson.set(memberId, { level, block });
    }
  }

  for (const [level, blocks] of ordered) {
    for (const block of blocks) {
      for (const memberId of block.members) {
        for (const link_ of parentLinksOf(g, memberId)) {
          const above = blockOfPerson.get(link_.parentId);
          if (!above || above.level !== level - 1) continue;

          if (!above.block.below.includes(block)) above.block.below.push(block);
          block.parentBlock ??= above.block;
        }
      }
    }
  }

  // The descendant side is a strict tree: a block hangs off exactly one.
  for (const [, blocks] of ordered) {
    for (const block of blocks) {
      block.kids = block.below.filter((child) => child.parentBlock === block);
    }
  }
}

/**
 * Assigns x to every block.
 *
 * The two halves of the chart need opposite rules, and using one for both was
 * the mistake that left only one family in seven properly centred:
 *
 *  - Downwards, a couple is centred over their children. Each subtree is given
 *    a band of its own, so this is exact — nothing can collide.
 *  - Upwards, a couple's ancestors are centred over the couple. One couple has
 *    two sets of grandparents, so it is the GROUP that gets centred, not each
 *    block; treating them as ordinary children would have made both want the
 *    same spot.
 */
function place(ordered, metrics) {
  const byLevel = new Map(ordered);
  const present = [...byLevel.keys()].sort((a, b) => a - b);

  // --- Downwards, from the focal row ---------------------------------------
  let cursor = 0;
  for (const block of byLevel.get(0) ?? []) {
    positionDown(block, cursor, metrics);
    cursor += spreadDown(block, metrics) + metrics.siblingGap;
  }

  // --- Upwards, one row at a time ------------------------------------------
  for (let level = -1; level >= present[0]; level -= 1) {
    positionUp(byLevel.get(level) ?? [], metrics);
  }

  // Everything shifted so the leftmost edge is the padding.
  const leftmost = Math.min(...ordered.flatMap(([, blocks]) => blocks.map((b) => b.x)));
  for (const [, blocks] of ordered) {
    for (const block of blocks) block.x += metrics.padding - leftmost;
  }
}

/** Width of the band this block and everything under it needs. */
function spreadDown(block, metrics) {
  if (block.spread !== undefined) return block.spread;

  const children = block.kids.reduce(
    (total, child, index) =>
      total + spreadDown(child, metrics) + (index > 0 ? metrics.siblingGap : 0),
    0,
  );

  block.spread = Math.max(block.width, children);
  return block.spread;
}

function positionDown(block, left, metrics) {
  const spread = spreadDown(block, metrics);

  const children = block.kids.reduce(
    (total, child, index) =>
      total + spreadDown(child, metrics) + (index > 0 ? metrics.siblingGap : 0),
    0,
  );

  let x = left + (spread - children) / 2;
  for (const child of block.kids) {
    positionDown(child, x, metrics);
    x += spreadDown(child, metrics) + metrics.siblingGap;
  }

  block.x = centredOver(block, block.kids, left, spread, metrics);
}

/**
 * Where a block sits so its stem lands in the middle of the bar below it.
 *
 * The target is the span of the children's own CARDS, not of their whole
 * blocks. A child block also holds that child's spouse, so centring over the
 * blocks put the parents half a couple — 124 px — to one side of the bar their
 * line actually drops onto. Close enough to look like a mistake, which it was.
 *
 * The result is clamped to the band reserved for this subtree, so pursuing a
 * tidy stem can never push a family into its neighbour.
 */
function centredOver(block, children, left, spread, metrics) {
  if (children.length === 0) return left + (spread - block.width) / 2;

  const first = children[0];
  const last = children[children.length - 1];
  const bar = (cardLeft(first) + cardLeft(last) + metrics.cardWidth) / 2;

  return clamp(bar - block.width / 2 - block.anchorOffset, left, left + spread - block.width);
}

/** The left edge of a block's own person, which is not always its left edge. */
const cardLeft = (block) => block.x + block.anchorOffset;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/**
 * Places one row of ancestors over the row below, which is already fixed.
 *
 * Blocks sharing a child are laid side by side and the group as a whole is
 * centred over that child. Groups are then swept left to right so they cannot
 * overlap.
 */
function positionUp(blocks, metrics) {
  const groups = new Map();

  for (const block of blocks) {
    // Blocks with nothing below them are their own group and keep their order.
    const anchor = block.below[0] ?? block;
    const group = groups.get(anchor);
    if (group) group.push(block);
    else groups.set(anchor, [block]);
  }

  const laid = [...groups.entries()].map(([, members]) => {
    const width = members.reduce(
      (total, block, index) => total + block.width + (index > 0 ? metrics.siblingGap : 0),
      0,
    );

    // Centred over EVERYTHING below them, not just the first one — a couple
    // with four children belongs over the middle of the four — and over the
    // children's own cards rather than their blocks, so the stem lands in the
    // middle of the bar it descends to.
    const children = members.flatMap((block) => block.below);
    const left = Math.min(...children.map((child) => cardLeft(child)));
    const right = Math.max(...children.map((child) => cardLeft(child) + metrics.cardWidth));

    // The group is centred, then shifted so it is the FIRST member's own person
    // that lands over the middle — not whichever partner happens to start it.
    return { members, width, desired: (left + right) / 2 - width / 2 - members[0].anchorOffset };
  });

  laid.sort((a, b) => a.desired - b.desired);

  let edge = -Infinity;
  for (const group of laid) {
    let x = Math.max(group.desired, edge);
    for (const block of group.members) {
      block.x = x;
      x += block.width + metrics.siblingGap;
    }
    edge = x - metrics.siblingGap + metrics.familyGap;
  }

  // The row is stored in the order it will be drawn.
  blocks.length = 0;
  blocks.push(...laid.flatMap((group) => group.members));
}

// --- Emitting --------------------------------------------------------------

function emit(g, ordered, visible, metrics) {
  const nodes = [];
  const rows = [];
  const edges = [];
  const drawnUnions = new Set();

  const topLevel = ordered[0][0];

  for (const [level, blocks] of ordered) {
    const y = metrics.padding + (level - topLevel) * (metrics.cardHeight + metrics.rowGap);
    const rowNodes = [];

    for (const block of blocks) {
      let x = block.x;

      for (const item of block.items) {
        const isUnion = item.type === NodeType.UNION;
        const width = isUnion ? metrics.unionSize : metrics.cardWidth;
        const height = isUnion ? metrics.unionSize : metrics.cardHeight;

        rowNodes.push({
          type: item.type,
          id: `${isUnion ? 'u' : 'p'}:${item.entityId}`,
          entityId: item.entityId,
          level,
          x,
          // The dot sits on the centre line of the cards beside it.
          y: isUnion ? y + (metrics.cardHeight - height) / 2 : y,
          width,
          height,
        });

        x += width + metrics.itemGap;

        if (!isUnion) continue;

        const union = g.unions.get(item.entityId);
        drawnUnions.add(union.id);

        edges.push(
          edge('partner', `p:${union.partner1Id}`, `u:${union.id}`),
          edge('partner', `p:${union.partner2Id}`, `u:${union.id}`),
        );

        for (const child of childrenOfUnion(g, union)) {
          if (visible.has(child.id)) edges.push(edge('descent', `u:${union.id}`, `p:${child.id}`));
        }
      }
    }

    rows.push({ level, nodes: rowNodes });
    nodes.push(...rowNodes);
  }

  // A parent whose union is not on screen: the line descends straight from
  // their card instead of from a union node.
  for (const link_ of g.parentChildren.values()) {
    if (!visible.has(link_.parentId) || !visible.has(link_.childId)) continue;
    if (link_.unionId && drawnUnions.has(link_.unionId)) continue;
    edges.push(edge('descent', `p:${link_.parentId}`, `p:${link_.childId}`));
  }

  return {
    nodes,
    rows,
    edges,
    width: Math.max(...nodes.map((n) => n.x + n.width)) + metrics.padding,
    height: Math.max(...nodes.map((n) => n.y + n.height)) + metrics.padding,
  };
}

const edge = (kind, fromNodeId, toNodeId) => ({
  id: `${kind}:${fromNodeId}->${toNodeId}`,
  kind,
  fromNodeId,
  toNodeId,
});
