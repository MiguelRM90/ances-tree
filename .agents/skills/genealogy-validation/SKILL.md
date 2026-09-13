---
name: genealogy-validation
description: >-
  Procedures for managing the validation engine, genealogical rules, severity levels,
  and date comparisons. Use when adding validation rules, resolving validation errors,
  or working with fuzzy/uncertain historical dates.
---

# Genealogy Validation Skill

This skill governs the validation engine in `src/domain/validation/` and the date handling in `src/domain/date/`.

## The Severity Philosophy

In historical genealogy, uncertainty, contradictions, and non-traditional family structures are normal. An archive application that blocks user input for improbable data is useless.

| Severity            | Definition                                                    | Application Behavior                                                             | Examples                                                                                              |
| ------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `BLOCKED` / `ERROR` | Structurally impossible or corrupts the graph                 | Rejected immediately by `store.apply`. Graph mutation is refused.                | `CYCLE`, `SELF_PARENT`, `DUPLICATE_EDGE`, `DANGLING_REF`, `TOO_MANY_BIO_PARENTS` (>2).                |
| `WARNING`           | Biologically or temporally improbable, but structurally valid | Saved without restriction. Emits warning badge on card and in validation drawer. | Child born after mother's death, birth before 1800 without source, extreme parental age (<12 or >70). |
| `INFO`              | Incomplete or recommended data                                | Saved. Displayed in audit drawer.                                                | Missing birth date, solitary person without connections.                                              |

## Contract of the Validation Engine (`engine.js`)

Validation rules are **pure functions**:

```javascript
/**
 * @typedef {Object} ValidationIssue
 * @property {string} ruleId - Stable ID (e.g. 'CHILD_BORN_AFTER_DEATH')
 * @property {'ERROR'|'WARNING'|'INFO'} severity
 * @property {Array<{type: 'person'|'union'|'parentChild'|'media', id: string}>} subjects
 * @property {string} messageKey - Key from locale dict, NEVER translated string
 * @property {Object} params - Values to interpolate
 */
```

- **Never persist validation issues**: Issues are dynamic, recalculated upon load and after mutations.
- **`messageKey` + `params`**: Text is rendered securely via `textContent` using keys from `src/config/locales/`.

## Three-State Date Comparison (`src/domain/date/compare.js`)

Historical dates have uncertainty (`exact`, `about`, `before`, `after`, `range`).
Comparing two dates with `isBefore(d1, d2)` returns one of three outcomes:

- `CERTAIN`: $d1$ is definitely before $d2$ (no interval overlap).
- `POSSIBLE`: Intervals overlap or one date is open-ended. **Produces at most a `WARNING`, never an `ERROR`**.
- `IMPOSSIBLE`: $d1$ is definitely after $d2$. Only `IMPOSSIBLE` can trigger a temporal `ERROR`.

## Verification

- Run tests: `pnpm test test/validation.test.js test/date.test.js`
- Reference specification: `docs/validation-rules.md` and `docs/data-model.md`
