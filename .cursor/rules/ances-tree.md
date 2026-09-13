---
description: Comprehensive rules and conventions for ances-tree
globs: '**/*'
---

# ances-tree Project Guidelines

- **Zero runtime dependencies**: Pure Vanilla JS, Web Components, native browser APIs.
- **Strict Layering**: UI -> Store -> Domain -> Storage.
  - `src/domain/` has no side effects, no DOM access, and no storage access.
- **CSP & Security**: No `innerHTML` with user data. Adopted stylesheets instead of inline styles.
- **Genealogy Graph Integrity**:
  - `ParentChild` represents an edge per parent (allows biological vs adoptive per parent).
  - Phantom persons generated on-demand only.
  - Anchor layout to the person with more visible unions.
  - `UnionType.MARRIED` with `endDate` denotes divorce/end of union (no `DIVORCED` enum).
  - Two distinct surname fields: `lastName` and `secondLastName`.
- **Language**: English for code, identifiers, tests, and commits.
- **Commands**:
  - Dev: `pnpm dev`
  - Build: `pnpm build`
  - Test: `CHROME_PATH=/usr/bin/google-chrome pnpm test`
  - Lint: `pnpm run lint`
