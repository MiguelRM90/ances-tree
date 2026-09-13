---
name: tree-layout-engine
description: >-
  Expert procedures and guidelines for the ances-tree layout engine, coordinate calculation,
  node positioning, and SVG edge connector routing. Use when working on graph layout,
  fixing line crossing bugs, modifying tree-canvas, or positioning nodes.
---

# Tree Layout Engine Skill

This skill guides modifications and debugging of the genealogy graph layout engine in `src/domain/layout/engine.js` and edge routing in `src/ui/edge-paths.js`.

## Core Architectural Rules

1. **NO DOM Access in Layout**:

   - `src/domain/layout/engine.js` is a pure function.
   - It **never** uses `document`, `window`, or `getBoundingClientRect()`.
   - Layout produces an abstract layout tree: `{ nodes, rows, edges, width, height, levels }` in mathematical coordinate space.
   - Painting is exclusively handled by `src/ui/components/tree-canvas.js` and `src/ui/edge-paths.js`.

2. **Phase Execution Pipeline**:

   - **Phase 0 & 1**: Level assignment and pruning around focal person (`src/domain/graph/generations.js`).
   - **Phase 2**: Synthetic union nodes insertion between spouses.
   - **Phase 3**: Node ordering per level to minimize edge crossings.
   - **Phase 4**: Discrete X/Y coordinate assignment (centering couples over their child blocks).

3. **Key Layout Concepts**:
   - **Couples centered over children**: A union and its spouses are positioned relative to the horizontal bounds of their children.
   - **Multiple Unions & Anchors**: When someone has multiple unions, anchor placement on the person with more visible unions (`anchorOffset`), ensuring the person sits in the middle so lines do not cross or imply unions between non-partners.
   - **Placeholders for Symmetry**: Invisible layout placeholders ensure visual balance without polluting the domain graph model.

## Edge Routing (`src/ui/edge-paths.js`)

- **Edge types**:
  - `partner`: Horizontal line connecting partners to the synthetic union node.
  - `descent`: Orthogonal step path descending from union node down to child nodes.
- When fixing line collisions or crossing bugs:
  - Check `test/edge-paths.test.js`.
  - Check `test/graph.test.js`.
  - Never introduce DOM measurements to resolve edge paths.

## Verification Checklist

- Run `pnpm test test/edge-paths.test.js test/graph.test.js` to ensure zero regressions in routing.
- Check `docs/architecture.md` (Motor de maquetación) for deep design background.
