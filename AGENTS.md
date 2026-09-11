# AGENTS.md — Master Instructions for Autonomous Agents and AIs

> This document is the primary reference for any AI agent (Antigravity, OpenAI Codex, GitHub Copilot, Cursor, etc.) working on the **ances-tree** repository.

---

## 1. Vision and Core Philosophy

**ances-tree** is a static web application designed to build and maintain a complete family genealogical archive directly inside the user's browser.
- **No accounts, no backend, no subscriptions**.
- **Data never leaves the user's device**.
- **Public code (GitHub) ≠ Private data (user's local storage)**.
- Deployed on GitHub Pages (`/ances-tree/`) and installable as a 100% offline PWA.

---

## 2. The Five Inviolable Rules

1. **Zero Runtime Dependencies**:
   - Strictly forbidden to install production libraries or frameworks (no React/Vue, lodash, JSZip, date-fns, external GEDCOM parsers, etc.).
   - Use web platform standards exclusively: Web Components (`HTMLElement`), File System Access API, Origin Private File System (OPFS), IndexedDB, native `CompressionStream`, `crypto.randomUUID()`.
   - Development dependencies (`devDependencies` in `package.json`: Vite, ESLint, Web Test Runner, Prettier) must never leak into production code.

2. **No `innerHTML` with User Data**:
   - In this project, **everything is user data**: first names, last names, dates, notes, imported GEDCOM values, photo filenames, etc.
   - Always use `textContent`, `createElement`, or safe DOM manipulation.

3. **Strict Downward Layer Dependencies**:
   ```
   UI (Web Components, CSS)  ──>  touches the DOM
      │
      ▼
   STORE (State, mutations)  ──>  singleton, EventTarget
      │
      ▼
   DOMAIN (Logic, validation, layout, GEDCOM) ──>  100% pure functions
      │
      ▼
   STORAGE (DISK / OPFS persistence, ZIP, IDB) ──>  touches disk / IndexedDB
   ```
   - `domain/` **MUST NEVER** import anything from `ui/`, `store/`, or `storage/`. It does not touch the DOM or IndexedDB.
   - `storage/` does not know about `store`. It receives and returns plain data structures.
   - `ui/` never invokes `storage/` directly; it always triggers actions through `store/`.

4. **Almost Everything is `WARNING`, Not `ERROR`**:
   - Real historical genealogy is full of gaps, contradictory dates, consanguineous marriages, and uncertain records.
   - Only structurally impossible graph operations are blocked (`BLOCKED`/`FATAL`): ancestry cycles, self-parenthood, dangling references, more than 2 biological parents. Everything else emits warnings (`WARNING`), but allows saving.

5. **The Original `raw` Date String is Never Lost or Overwritten**:
   - Genealogical dates can be "*about 1885*", "*before May 1912*", "*between 1900 and 1905*".
   - `raw` is the immutable source of truth entered by the user. The `earliest` and `latest` fields are derived and dynamically recalculated.

---

## 3. Language and Conventions

- **Source Code**: **All code in `src/`, `test/`, and scripts is strictly written in English** (variable names, functions, classes, comments, commit messages, filenames).
- **UI Strings**: NEVER hardcoded in HTML markup. Defined in internationalization dictionaries under `src/config/locales/` (`en.js` and `es.js`).
- **Design Specifications**: Maintained in Spanish inside the [`docs/`](docs/README.md) directory for technical reference.

### Code Style
- Web Components extending `HTMLElement` with hyphenated names (`person-card`, `tree-canvas`).
- Private class fields and methods use native JavaScript `#` (`#state`, `#render()`), never underscores (`_`).
- Constructable stylesheets at module level (`import css from './component.css?inline'` with `adoptedStyleSheets`), **never inline `<style>` tags** to comply with strict Content Security Policy (CSP).
- JSON object keys in `camelCase`; constants and enums in `SCREAMING_SNAKE_CASE`.
- Unique IDs always generated with `crypto.randomUUID()`.
- Numeric thresholds and limits centralized in `src/config/limits.js`.

---

## 4. Project Structure

```
ances-tree/
├── docs/                   # Complete design specifications (in Spanish)
│   ├── README.md           # Documentation index and overview
│   ├── vision.md           # Vision, privacy, and scope
│   ├── architecture.md     # Architecture details and layout engine
│   ├── data-model.md       # Data contract: Person, Union, ParentChild
│   ├── decisions.md        # Technical decisions and CSP
│   ├── storage.md          # Persistence: DISK vs OPFS and ZIP format
│   ├── validation-rules.md # Catalog of validation rules
│   └── gedcom-mapping.md   # Bidirectional GEDCOM 5.5.1 / 7.0 mapping
├── src/
│   ├── main.js             # Application entrypoint
│   ├── config/             # Limits (limits.js) and i18n (locales/en.js, es.js)
│   ├── domain/             # Pure functions (model, date, graph, layout, gedcom, validation)
│   ├── storage/            # Decoupled persistence (backend, project-store, zip, opfs, idb)
│   ├── store/              # Centralized reactive state (store.js, actions.js)
│   └── ui/                 # Web Components (components/) and global styles (styles/)
├── test/                   # Real browser tests (Web Test Runner)
├── scripts/                # Stress testing and generator scripts (10,000 people)
├── index.html              # HTML shell with CSP injected by Vite
└── vite.config.js          # Build configuration (base: '/ances-tree/')
```

---

## 5. Dual Storage Architecture (`DISK` vs `BROWSER`)

- **`DISK` Mode**: Activated on browsers with File System Access API (Chromium desktop). The user selects a real folder on their disk. No browser storage quotas or eviction.
- **`BROWSER` Mode**: Activated on Firefox, Safari, and mobile devices. Uses the Origin Private File System (OPFS).
- **Isolation**: Mode selection occurs exclusively in `src/storage/backend.js` and file pickers in `src/storage/file-dialog.js`. All downstream storage code operates identically against `FileSystemDirectoryHandle`. **Do not branch with browser detection elsewhere in the codebase**.

---

## 6. Common Commands

```bash
# Vite dev server at http://localhost:5173/ances-tree/
npm run dev

# Run tests in real browser (Web Test Runner)
# On Linux set CHROME_PATH=/usr/bin/google-chrome if not discovered automatically:
CHROME_PATH=/usr/bin/google-chrome npm test

# Linter (ESLint + eslint-plugin-wc)
npm run lint

# Code formatting (Prettier)
npm run format

# Production build (Vite -> dist/)
npm run build

# Large-scale stress testing
npm run stress:generate
npm run stress:bench
```

---

## 7. Supplementary Documentation

Before modifying specific subsystems, consult the relevant design document:
- **Data model or dates**: [docs/data-model.md](docs/data-model.md)
- **Persistence, ZIP export, or folder permissions**: [docs/storage.md](docs/storage.md)
- **Tree layout or SVG edge routing**: [docs/architecture.md](docs/architecture.md)
- **Validation rules or genealogical constraints**: [docs/validation-rules.md](docs/validation-rules.md)
- **GEDCOM importer/exporter**: [docs/gedcom-mapping.md](docs/gedcom-mapping.md)
- **Technical decisions or CSP**: [docs/decisions.md](docs/decisions.md)
