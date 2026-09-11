---
trigger: always_on
description: Zero runtime dependencies rule (Vanilla JS)
---

# Zero Runtime Dependencies

1. **No Production Dependencies**:
   - `package.json` specifies `"dependencies": {}` and must remain empty.
   - Importing npm packages into application source code (`src/`) is strictly prohibited.
   - Everything must be built using native web platform APIs:
     - Components: Standard Web Components (`HTMLElement`, `customElements.define`, `adoptedStyleSheets`).
     - Storage: File System Access API, Origin Private File System (OPFS), IndexedDB.
     - ZIP Compression: Native stream APIs (`CompressionStream('deflate-raw')`, `DecompressionStream`).
     - Unique IDs: `crypto.randomUUID()`.
     - Dates & Strings: Internal logic in `src/domain/date/` without date-fns or moment.
     - GEDCOM: Native parser in `src/domain/gedcom/`.

2. **Development Dependencies**:
   - Libraries in `devDependencies` (Vite, ESLint, Web Test Runner, Prettier) are strictly for developer workflow and testing; they must never be packaged into runtime code.
