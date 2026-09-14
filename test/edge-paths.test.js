import { expect } from '@open-wc/testing';
import { descentPaths, partnerPath, BAR_GAP, BAR_STEP } from '../src/ui/edge-paths.js';

/**
 * Three separate bugs have shipped in the line geometry, each looking like
 * "the lines are a bit wrong" and none of them pointing at its own cause.
 * These tests work on synthetic rectangles, so they catch the next one.
 */

const box = (cx, top, height = 76, width = 192, nodeId = `n:${cx}`) => ({
  nodeId,
  cx,
  top,
  bottom: top + height,
  left: cx - width / 2,
  right: cx + width / 2,
});

/** Every point the path visits, so a stroke can be followed end to end. */
const commands = (d) => d.trim().split(/\s+(?=[MHV])/);

/** The x positions a horizontal run covers, as [from, to]. */
function spans(d) {
  const runs = [];
  let x = 0;

  for (const part of commands(d)) {
    const [op, ...args] = part.split(/\s+/).map((t) => (Number.isNaN(Number(t)) ? t : Number(t)));
    if (op === 'M') x = args[0];
    if (op === 'H') {
      runs.push([Math.min(x, args[0]), Math.max(x, args[0])]);
      x = args[0];
    }
  }

  return runs;
}

const edge = (from, to) => ({ kind: 'descent', fromNodeId: from, toNodeId: to });

describe('descent paths', () => {
  /**
   * The bug that prompted these tests: skipping the bar for an only child left
   * the stroke leaving the parents and the stroke entering the child as two
   * disconnected verticals whenever the union was not directly above the child.
   */
  it('connects a lone child whose parents are not directly above them', () => {
    const boxes = new Map([
      ['u:1', box(247, 20, 12, 12)],
      ['p:child', box(375, 170)],
    ]);

    const [path] = descentPaths([edge('u:1', 'p:child')], boxes);
    const covered = spans(path.d);

    expect(covered).to.have.lengthOf(1, 'a horizontal run joins the two verticals');
    expect(covered[0][0]).to.be.at.most(247);
    expect(covered[0][1]).to.be.at.least(375);
  });

  it('needs no horizontal run when the child sits directly below', () => {
    const boxes = new Map([
      ['u:1', box(300, 20, 12, 12)],
      ['p:child', box(300, 170)],
    ]);

    const [path] = descentPaths([edge('u:1', 'p:child')], boxes);
    expect(spans(path.d)).to.eql([]);
  });

  it('spans every child, and the parents too when they sit outside', () => {
    const boxes = new Map([
      ['u:1', box(900, 20, 12, 12)],
      ['p:a', box(100, 170)],
      ['p:b', box(300, 170)],
    ]);

    const [path] = descentPaths([edge('u:1', 'p:a'), edge('u:1', 'p:b')], boxes);

    const [[left, right]] = spans(path.d);
    expect(left).to.equal(100);
    expect(right).to.equal(900);
  });

  it('draws one path per set of siblings', () => {
    const boxes = new Map([
      ['u:1', box(100, 20, 12, 12)],
      ['u:2', box(500, 20, 12, 12)],
      ['p:a', box(80, 170)],
      ['p:b', box(160, 170)],
      ['p:c', box(500, 170)],
    ]);

    const paths = descentPaths([edge('u:1', 'p:a'), edge('u:2', 'p:c'), edge('u:1', 'p:b')], boxes);

    expect(paths.map((p) => p.id)).to.eql(['descent:u:1', 'descent:u:2']);
  });

  // Bars on one continuous line made a whole row read as a single sibling set.
  it('staggers neighbouring families so their bars are not collinear', () => {
    const boxes = new Map([
      ['u:1', box(100, 20, 12, 12)],
      ['u:2', box(400, 20, 12, 12)],
      ['u:3', box(700, 20, 12, 12)],
      ['p:a', box(100, 170)],
      ['p:b', box(400, 170)],
      ['p:c', box(700, 170)],
    ]);

    const heights = descentPaths(
      [edge('u:1', 'p:a'), edge('u:2', 'p:b'), edge('u:3', 'p:c')],
      boxes,
    ).map((path) => Number(/V (\d+)/.exec(path.d)[1]));

    expect(new Set(heights).size).to.equal(3);
    expect(heights[0]).to.equal(170 - BAR_GAP);
    expect(heights[1]).to.equal(170 - BAR_GAP - BAR_STEP);
  });

  it('puts the bar above the children, never below them', () => {
    const boxes = new Map([
      ['u:1', box(100, 20, 12, 12)],
      ['p:a', box(300, 170)],
    ]);

    const [path] = descentPaths([edge('u:1', 'p:a')], boxes);
    const barY = Number(/V (\d+)/.exec(path.d)[1]);

    expect(barY).to.be.below(170);
    expect(barY).to.be.above(32, 'and below the parents, not above them');
  });

  it('ignores an edge whose endpoints were never measured', () => {
    const boxes = new Map([['u:1', box(100, 20, 12, 12)]]);
    expect(descentPaths([edge('u:1', 'p:missing')], boxes)).to.eql([]);
  });

  // Pointing at a person lights up the bar they hang from, so each path has to
  // know which cards belong to it.
  it('records which children hang off each bar', () => {
    const boxes = new Map([
      ['u:1', box(100, 20, 12, 12, 'u:1')],
      ['p:a', box(80, 170, 76, 192, 'p:a')],
      ['p:b', box(160, 170, 76, 192, 'p:b')],
    ]);

    const [path] = descentPaths([edge('u:1', 'p:a'), edge('u:1', 'p:b')], boxes);
    expect(path.children).to.eql(['p:a', 'p:b']);
  });

  it('ignores partner edges', () => {
    const boxes = new Map([
      ['p:a', box(100, 20)],
      ['u:1', box(200, 20, 12, 12)],
    ]);

    expect(descentPaths([{ kind: 'partner', fromNodeId: 'p:a', toNodeId: 'u:1' }], boxes)).to.eql(
      [],
    );
  });
});

describe('partner paths', () => {
  it('leaves from the edge of the card facing the union node', () => {
    const left = box(100, 20);
    const dot = box(220, 20, 12, 12);

    expect(partnerPath(left, dot)).to.equal(`M ${left.right} 58 L 220 58`);
  });

  it('leaves from the other edge when the union node is to the left', () => {
    const right = box(340, 20);
    const dot = box(220, 20, 12, 12);

    expect(partnerPath(right, dot)).to.equal(`M ${right.left} 58 L 220 58`);
  });
});
