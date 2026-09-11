---
trigger: always_on
description: Strict architectural layer hierarchy and domain purity rule
---

# Architectural Layers Rule (ances-tree)

In this project, dependencies **only point downwards**:

```
UI  ──>  STORE  ──>  DOMAIN  ──>  STORAGE
```

1. **`domain/` is 100% Pure**:
   - Forbidden to import anything from `ui/`, `store/`, or `storage/`.
   - Forbidden to access DOM objects (`window`, `document`, `HTMLElement`, `customElements`, `getBoundingClientRect`).
   - Forbidden to access storage APIs (`indexedDB`, `FileSystemHandle`, `localStorage`).
   - All calculations in `domain/` (coordinate layout, validation rules, dates, GEDCOM parsing) must be implemented as pure functions over data structures.

2. **`storage/` is Decoupled from State**:
   - `storage/` must never import `store/` or be aware of application events.
   - It receives plain data structures and returns promises with data read from disk or IndexedDB.

3. **`ui/` Never Invokes `storage/` Directly**:
   - All mutations or project loading operations go through actions dispatched in `store/actions.js`.

4. **The Layout Engine (`domain/layout/`) is Mathematical**:
   - It does not measure DOM elements. It never uses `getBoundingClientRect()`.
   - It computes and assigns discrete coordinates based purely on the tree geometry.
