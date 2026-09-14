/**
 * SVG layer for the kinship lines (architecture.md, layout phase 5).
 *
 * Hybrid rendering: the cards are native HTML with flex/grid, and the lines are
 * drawn in this absolute layer with orthogonal <path> routes.
 *
 * Nothing here measures the DOM. The layout engine assigns every coordinate,
 * so the boxes arrive already known.
 *
 * That is worth stating because it used to be the opposite, and four separate
 * bugs came out of it: measuring before the browser had laid anything out,
 * measuring against the wrong ancestor, an SVG narrower than the tree it
 * covered, and a stale measurement after a scroll. None of those can happen to
 * a coordinate that was never measured.
 */

import { svg, clear } from '../dom.js';
import { partnerPath, descentPaths } from '../edge-paths.js';
import { base, sheet } from '../styles/sheets.js';
import css from './tree-edges.css?inline';

const styles = sheet(css);

export class TreeEdges extends HTMLElement {
  #svg;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [base, styles];
    this.#svg = svg('svg', { xmlns: 'http://www.w3.org/2000/svg' });
    root.append(this.#svg);
  }

  connectedCallback() {
    // Pure decoration: the relationships are already in the accessible DOM.
    // Attributes are touched here, not in the constructor, because the element
    // may not be ready yet (wc/no-constructor-attributes).
    this.setAttribute('aria-hidden', 'true');
  }

  /**
   * @param {Array<{id: string, kind: string, fromNodeId: string, toNodeId: string}>} edges
   * @param {Map<string, object>} boxes  node id -> box, from the layout engine
   * @param {{width: number, height: number}} size
   */
  paint(edges, boxes, size) {
    this.#svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
    this.style.width = `${size.width}px`;
    this.style.height = `${size.height}px`;
    clear(this.#svg);

    for (const edge of edges) {
      if (edge.kind !== 'partner') continue;

      const from = boxes.get(edge.fromNodeId);
      const to = boxes.get(edge.toNodeId);
      if (!from || !to) continue;

      this.#svg.append(
        svg('path', { d: partnerPath(from, to), class: 'partner', 'data-edge-id': edge.id }),
      );
    }

    for (const path of descentPaths(edges, boxes)) {
      this.#svg.append(
        svg('path', {
          d: path.d,
          class: 'descent',
          'data-edge-id': path.id,
          'data-children': path.children.join(' '),
        }),
      );
    }
  }

  /**
   * Lights up one family's lines.
   *
   * With several families sharing a row, tracing a line by eye to find out
   * whose child someone is takes real effort. Pointing at them should answer
   * it.
   *
   * @param {string|null} nodeId  a person, whose bar is lit, or a union node,
   *   whose own bar is lit
   * @param {{pinned?: boolean}} [options]
   * @returns {string[]} the node ids the lit bar descends from
   */
  highlight(nodeId, { pinned = false } = {}) {
    let source = [];

    for (const path of this.#svg.querySelectorAll('path.descent')) {
      const from = path.dataset.edgeId.replace(/^descent:/, '');
      const owns =
        nodeId !== null && (from === nodeId || path.dataset.children.split(' ').includes(nodeId));

      path.classList.toggle('lit', owns);
      path.classList.toggle('pinned', owns && pinned);
      if (owns) source = [from];
    }

    return source;
  }
}

customElements.define('tree-edges', TreeEdges);
