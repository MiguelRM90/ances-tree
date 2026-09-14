/**
 * Paints the layout.
 *
 * The engine decides every position; this file only places the elements where
 * it says and draws the lines between them. Because the coordinates are known
 * up front, nothing here measures the DOM — which removed the whole class of
 * bugs that came from measuring at the wrong moment, or against the wrong box,
 * or before the browser had laid anything out.
 *
 * Accessibility: role="tree" with a roving tabindex, so the whole tree is a
 * single tab stop and the arrow keys move within it.
 */

import { el, clear } from '../dom.js';
import { base, sheet } from '../styles/sheets.js';
import css from './tree-canvas.css?inline';
import { S } from '../../config/strings.js';
import { LAYOUT, layoutProperties } from '../../config/layout.js';
import { buildLayout, NodeType } from '../../domain/layout/engine.js';
import { portraitOf, documentsOf, displayName } from '../../domain/graph/queries.js';
import './person-card.js';
import './union-node.js';
import './tree-edges.js';

const styles = sheet(css);

export class TreeCanvas extends HTMLElement {
  #graph = null;
  #focalId = null;
  #issuesFor = () => [];
  #resolvePhoto = null;
  #canvas;
  #edgesLayer;
  /** Focusable nodes by row, for keyboard navigation. */
  #grid = [];
  #cursor = { row: 0, column: 0 };
  #lit = null;
  #pinned = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [base, styles];

    const hint = el('p', { class: 'hint', text: S.a11y.treeHint, attrs: { id: 'tree-hint' } });

    this.#canvas = el('div', {
      class: 'canvas',
      attrs: { role: 'tree', 'aria-label': S.a11y.tree, 'aria-describedby': 'tree-hint' },
    });

    this.#edgesLayer = document.createElement('tree-edges');
    root.append(hint, this.#canvas);
  }

  connectedCallback() {
    // The engine owns the sizes; the components read them back from here, so
    // there is one definition rather than two that drift apart.
    for (const [property, value] of Object.entries(layoutProperties())) {
      this.style.setProperty(property, value);
    }

    // No resize listener: positions no longer depend on the viewport at all.
    this.#canvas.addEventListener('keydown', this.#onKeyDown);
    this.#canvas.addEventListener('pointerover', this.#onPointOver);
    this.#canvas.addEventListener('pointerleave', this.#onPointOut);
    this.#canvas.addEventListener('focusin', this.#onPointOver);
    this.#canvas.addEventListener('union:pin', this.#onPin);
  }

  disconnectedCallback() {
    this.#canvas.removeEventListener('keydown', this.#onKeyDown);
    this.#canvas.removeEventListener('pointerover', this.#onPointOver);
    this.#canvas.removeEventListener('pointerleave', this.#onPointOut);
    this.#canvas.removeEventListener('focusin', this.#onPointOver);
    this.#canvas.removeEventListener('union:pin', this.#onPin);
  }

  /**
   * @param {{graph: object, focalId: string|null, issuesFor: Function,
   *          resolvePhoto: Function}} view
   */
  render(view) {
    this.#graph = view.graph;
    this.#focalId = view.focalId;
    this.#issuesFor = view.issuesFor ?? (() => []);
    this.#resolvePhoto = view.resolvePhoto ?? null;
    this.#paint();
  }

  #paint() {
    // Re-rooting throws away every card, so whoever had keyboard focus loses
    // it. If the user was working inside the tree, focus follows them to the
    // new centre; if the change came from a dialog, it is left alone.
    const hadFocus = this.shadowRoot.activeElement !== null;

    clear(this.#canvas);
    this.#grid = [];
    this.#pinned = null;
    this.#lit = null;

    if (!this.#graph || !this.#focalId) return;

    const layout = buildLayout(this.#graph, this.#focalId, {
      up: this.#graph.settings.maxGenerationsUp,
      down: this.#graph.settings.maxGenerationsDown,
      metrics: LAYOUT,
    });

    this.#canvas.style.width = `${layout.width}px`;
    this.#canvas.style.height = `${layout.height}px`;

    const topLevel = layout.rows.length > 0 ? layout.rows[0].level : 0;

    for (const row of layout.rows) {
      const focusable = [];

      for (const node of row.nodes) {
        const element = this.#nodeElement(node, node.level - topLevel + 1);
        element.style.left = `${node.x}px`;
        element.style.top = `${node.y}px`;
        focusable.push(element);
        this.#canvas.append(element);
      }

      this.#grid.push(focusable);
    }

    // The edge layer covers the whole canvas and is drawn from the same
    // coordinates the nodes were placed with. No measuring, no timing.
    this.#canvas.append(this.#edgesLayer);
    this.#edgesLayer.paint(layout.edges, boxesOf(layout), layout);

    this.#placeCursorOnFocal();
    this.#revealFocal(hadFocus);
  }

  #nodeElement(node, level) {
    if (node.type === NodeType.UNION) {
      const union = this.#graph.unions.get(node.entityId);
      const unionEl = document.createElement('union-node');
      unionEl.dataset.nodeId = node.id;
      unionEl.union = union;
      unionEl.level = level;
      unionEl.focusable = false;
      unionEl.partners = [union.partner1Id, union.partner2Id].map((id) =>
        displayName(this.#graph.persons.get(id)),
      );
      return unionEl;
    }

    const person = this.#graph.persons.get(node.entityId);
    const card = document.createElement('person-card');
    card.dataset.nodeId = node.id;
    card.toggleAttribute('focal', person.id === this.#focalId);
    card.graph = this.#graph;
    card.level = level;
    card.focusable = false;
    card.resolvePhoto = this.#resolvePhoto;
    card.portrait = portraitOf(this.#graph, person.id)?.path ?? null;
    card.documents = documentsOf(this.#graph, person.id);
    card.person = person;
    card.issues = this.#issuesFor(person.id);
    return card;
  }

  // --- Highlighting --------------------------------------------------------

  #onPointOver = (event) => {
    if (this.#pinned) return; // a pin outranks whatever the pointer is over
    const card = event.target.closest('person-card');
    this.#light(card?.dataset.nodeId ?? null);
  };

  #onPointOut = () => {
    if (!this.#pinned) this.#light(null);
  };

  /** Clicking a union node keeps its family lit; clicking it again lets go. */
  #onPin = (event) => {
    const { nodeId } = event.detail;
    this.#pinned = this.#pinned === nodeId ? null : nodeId;

    this.#light(this.#pinned, { force: true });
    this.#syncPins();
  };

  #syncPins() {
    for (const node of this.#canvas.querySelectorAll('union-node')) {
      node.pinned = node.dataset.nodeId === this.#pinned;
    }
  }

  #light(nodeId, { force = false } = {}) {
    if (nodeId === this.#lit && !force) return;
    this.#lit = nodeId;

    const source = this.#edgesLayer.highlight(nodeId, { pinned: this.#pinned !== null });
    const related = new Set(source.flatMap((id) => this.#cardsOf(id)));

    for (const row of this.#grid) {
      for (const node of row) {
        if (node.tagName === 'PERSON-CARD') {
          node.toggleAttribute('related', related.has(node.dataset.nodeId));
        }
      }
    }
  }

  /** A union node stands for two people; a bare card stands for itself. */
  #cardsOf(nodeId) {
    if (!nodeId.startsWith('u:')) return [nodeId];
    const union = this.#graph.unions.get(nodeId.slice(2));
    return union ? [`p:${union.partner1Id}`, `p:${union.partner2Id}`] : [];
  }

  // --- Keyboard navigation -------------------------------------------------

  /** The tab stop starts on the focal person, which is where attention is. */
  #placeCursorOnFocal() {
    for (const [row, nodes] of this.#grid.entries()) {
      const column = nodes.findIndex((node) => node.hasAttribute('focal'));
      if (column !== -1) {
        this.#cursor = { row, column };
        nodes[column].focusable = true;
        return;
      }
    }

    if (this.#grid[0]?.[0]) {
      this.#cursor = { row: 0, column: 0 };
      this.#grid[0][0].focusable = true;
    }
  }

  /**
   * Brings the centred person into view.
   *
   * Re-rooting rebuilds the entire layout, so without this the person just
   * clicked can land anywhere — often off-screen.
   */
  #revealFocal(restoreFocus = false) {
    const card = this.#grid[this.#cursor.row]?.[this.#cursor.column];
    if (!card) return;

    card.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    if (restoreFocus) card.focus({ preventScroll: true });
  }

  #onKeyDown = (event) => {
    if (event.key === 'Escape' && this.#pinned) {
      event.preventDefault();
      this.#pinned = null;
      this.#light(null, { force: true });
      this.#syncPins();
      return;
    }

    const moves = {
      ArrowRight: () => this.#step(1),
      ArrowLeft: () => this.#step(-1),
      ArrowDown: () => this.#stepRow(1),
      ArrowUp: () => this.#stepRow(-1),
      Home: () => this.#moveTo(this.#cursor.row, 0),
      End: () => this.#moveTo(this.#cursor.row, Infinity),
    };

    const move = moves[event.key];
    if (!move) return;

    event.preventDefault();
    move();
  };

  #step(delta) {
    this.#moveTo(this.#cursor.row, this.#cursor.column + delta);
  }

  /**
   * Moving between generations keeps the horizontal position: it lands on the
   * node nearest the current one, which is almost always the relative meant.
   */
  #stepRow(delta) {
    const row = this.#cursor.row + delta;
    const target = this.#grid[row];
    if (!target || target.length === 0) return;

    const current = this.#grid[this.#cursor.row]?.[this.#cursor.column];
    if (!current) return;

    const x = centreOf(current);
    let best = 0;
    let bestDistance = Infinity;

    for (const [index, node] of target.entries()) {
      const distance = Math.abs(centreOf(node) - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }

    this.#moveTo(row, best);
  }

  #moveTo(row, column) {
    const nodes = this.#grid[row];
    if (!nodes || nodes.length === 0) return;

    const clamped = Math.max(0, Math.min(nodes.length - 1, column));
    const previous = this.#grid[this.#cursor.row]?.[this.#cursor.column];

    if (previous) previous.focusable = false;

    this.#cursor = { row, column: clamped };
    nodes[clamped].focusable = true;
    nodes[clamped].focus();
  }
}

/** The boxes the line geometry works from, straight out of the layout. */
function boxesOf(layout) {
  return new Map(
    layout.nodes.map((node) => [
      node.id,
      {
        nodeId: node.id,
        cx: node.x + node.width / 2,
        top: node.y,
        bottom: node.y + node.height,
        left: node.x,
        right: node.x + node.width,
      },
    ]),
  );
}

const centreOf = (element) => element.offsetLeft + element.offsetWidth / 2;

customElements.define('tree-canvas', TreeCanvas);
