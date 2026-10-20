# Specifications and Design Documentation — AncesTree

This directory contains the complete technical specifications, data contracts, design decisions, and models of the **ances-tree** project.

This documentation is meant to be consulted by both human developers and Artificial Intelligence agents (Antigravity, Claude Code, Cursor, Copilot, etc.) before making structural changes to the code.

---

## Document Map

| Document                                   | Description and Scope                                                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [vision.md](vision.md)                     | **Vision, Principles, and Scope**: Core philosophy (_public code, private data, no backend_), strict privacy, and MVP scope.                                            |
| [architecture.md](architecture.md)         | **Layered Architecture and Components**: The 4 strict layers (UI → Store → Domain → Storage), folder structure, and design of the tree layout engine.                   |
| [data-model.md](data-model.md)             | **The Data Contract**: Structure of `Person`, `Union`, `ParentChild`, `Media`, the imprecise date model (`DateValue`), ranges, and severities.                          |
| [decisions.md](decisions.md)               | **Technical Decision Log**: Why pure Web Components with no runtime dependencies, the dual storage model, strict CSP, and conventions.                                  |
| [storage.md](storage.md)                   | **Physical Storage and Persistence**: `DISK` (File System Access API) vs `BROWSER` (OPFS) modes, folder/ZIP structure, automatic backups, and security.                 |
| [validation-rules.md](validation-rules.md) | **Validation Rules**: Complete catalog of rules with identifier, severity (`BLOCKED` vs `WARNING`), and test cases.                                                     |
| [gedcom-mapping.md](gedcom-mapping.md)     | **GEDCOM 5.5.1 / 7.0 Mapping**: Bidirectional transformation, fidelity, handling of extensions, and which data is preserved or adapted.                                 |

---

## The Five Fundamental Architecture Rules

1. **Zero runtime dependencies**: No frameworks, no helper libraries (no lodash, no JSZip, no external GEDCOM parsers). Everything is implemented with native web platform APIs.
2. **`innerHTML` with user data is forbidden**: All data (names, dates, notes, imported GEDCOM, file names) is treated as untrusted. Use `textContent`, `createElement`, or safe template bindings.
3. **Strict one-way dependency flow**: `UI → Store → Domain → Storage`. The `domain/` module is 100% pure and never imports the DOM, IndexedDB, or the Store.
4. **Almost everything is `WARNING`, not `ERROR`**: In historical genealogy, uncertainty is the norm. Only structurally corrupting inconsistencies are blocked (`BLOCKED`/`FATAL`): graph cycles, excess biological parents, etc.
5. **The original `raw` text of a date is never modified or lost**: The `earliest` and `latest` values are derived and recalculated from `raw`.
