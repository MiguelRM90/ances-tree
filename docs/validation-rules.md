# Validation rules

> Related documents: [data-model.md](data-model.md) (model and severities) · [decisions.md](decisions.md) · [storage.md](storage.md)

This document is the executable specification of the validations. Each rule has a **stable id, severity, trigger, message, and test cases**, and it translates almost literally into the test suite.

---

## Philosophy

> A family tree that refuses to save inconvenient data is useless. Users document what they find, not what they would like to find.

**Severity allocation criteria:**

| Severity | When | Behavior |
|---|---|---|
| `ERROR` | The data is **structurally impossible** or breaks referential integrity | Blocks saving that change |
| `WARNING` | The data is unlikely but may be true | It is saved. Warning shown on the person's record and in the review panel |
| `INFO` | Incomplete or improvable data | Only in the review panel |

Golden rule for temporal validations: **only `IMPOSSIBLE` produces `ERROR`.** If the intervals of two dates overlap, or information is missing, the result is `WARNING` at most. See `isBefore()` in [data-model.md](data-model.md#date-comparison).

---

## Engine contract

Validations are **pure functions**. They do not touch the DOM, do not read the global store, and do not throw exceptions: they receive data and return issues.

```js
/**
 * @typedef {Object} ValidationIssue
 * @property {string}  ruleId     - Stable id, e.g. 'CHILD_AFTER_MOTHER_DEATH'
 * @property {'ERROR'|'WARNING'|'INFO'} severity
 * @property {Array<{type: 'person'|'union'|'parentChild'|'media', id: string}>} subjects
 * @property {string}  messageKey - Message key, never already-translated text
 * @property {Object}  params     - Values to interpolate into the message
 */

/** @returns {ValidationIssue[]} */
function validateAll(graph) { /* ... */ }
```

- `messageKey` + `params`, never an already-assembled string: messages are rendered with `textContent`, so future i18n does not force a rewrite of the engine
- `subjects` lets the UI highlight all the entities involved, not just one
- Issues are **not persisted** in `family.json`. They are recomputed on load and after every mutation

### When they run

| Moment | Scope |
|---|---|
| Before confirming a mutation | Only the rules affected by the touched entities |
| When loading a project | Full, in a Worker if the graph is large |
| After importing a ZIP or GEDCOM | Full, and the summary is presented before accepting |
| On demand | "Review tree" panel |

**`ERROR` rules are evaluated before writing; `WARNING` and `INFO` rules after**, so as not to block interaction. A warning that takes 200 ms to appear bothers no one; a validation that delays saving does.

---

## Structural rules — `ERROR`

All of them block. They are integrity violations, not judgments about the data.

### `SELF_PARENT`
A person cannot be their own parent.
- **Trigger**: creating or editing a `ParentChild` with `parentId === childId`
- **Message**: *"A person cannot be their own parent."*
- **Tests**: `parentId === childId` → `ERROR` · different ids → no issue

### `SELF_UNION`
The two members of a union cannot be the same person.
- **Trigger**: `Union` with `partner1Id === partner2Id`
- **Message**: *"A union requires two different people."*

### `CYCLE`
An ancestor cannot be a descendant of their own descendants.
- **Trigger**: before confirming any new `ParentChild`. DFS from `childId` downwards looking for `parentId`
- **Message**: *"This would create a loop: {parentName} already descends from {childName}."*
- **Implementation note**: checked over the **complete** graph, without filtering by `type`. A cycle through an adoption is still a cycle
- **Tests**: A→B, attempt B→A → `ERROR` · A→B→C, attempt C→A → `ERROR` · A→B and A→C, attempt B→C → no issue (it is a link between siblings, absurd but not cyclic; `SIBLING_AS_PARENT` covers it as a warning)

### `DUPLICATE_EDGE`
There cannot be two `ParentChild` with the same `parentId` + `childId` pair.
- **Message**: *"This parent-child link already exists."*
- **Note**: if the user wants to change the type, they edit the existing link; they do not create another one

### `DUPLICATE_UNION`
There cannot be two `Union` with the same pair of people, in either order.
- **Message**: *"These two people are already linked by a union."*
- **Deliberate exception**: allowed if the `startDate`–`endDate` intervals do not overlap. Remarrying the same person happens

### `TOO_MANY_BIO_PARENTS`
Maximum of two `ParentChild` of type `BIOLOGICAL` per child.
- **Message**: *"A person cannot have more than two biological parents."*
- **Note**: there is no limit for `ADOPTED`, `FOSTER`, `STEP`, or `GUARDIAN`

### `DANGLING_REF`
Every reference by `id` must resolve to an existing entity.
- **Trigger**: on load and on import. It should not happen in normal use
- **Scope**: `ParentChild.parentId`/`childId`/`unionId`, `Union.partner1Id`/`partner2Id`, `MediaLink.targetId`, `settings.focalPersonId`
- **Recovery**: on import, instead of rejecting the whole file, the user is offered the option to discard the broken references, listing them

### `INVALID_ENUM`
Every enumeration field must contain one of its allowed values.
- **Trigger**: JSON or GEDCOM import
- **Recovery**: unknown `sex` → `U`; unknown `type` → `UNKNOWN` in `Union`, `BIOLOGICAL` in `ParentChild`, with a degradation `WARNING`

### `MEDIA_HASH_MISMATCH`
The content of a binary does not match its hash.
- **Trigger**: when importing a ZIP or opening a folder modified externally
- **Severity**: `ERROR` on that file (it is not linked), but it **does not block the full import**: it is reported and processing continues

---

## Temporal rules

All of them are evaluated with `isBefore()`. The "Severity" line indicates what happens depending on the result.

### `DEATH_BEFORE_BIRTH`
Death cannot precede birth.
- **Severity**: `IMPOSSIBLE` → `ERROR` · `POSSIBLE` → `WARNING` · `CERTAIN` → no issue
- **Tests**:
  - Born `1900`, dies `1890` → `ERROR`
  - Born `ABT 1900`, dies `1898` → `WARNING` (the `ABT 1900` interval is 1895–1905, it overlaps)
  - Born `1900`, dies `1970` → no issue
  - Born `1900`, death unknown → no issue

### `PARENT_TOO_YOUNG`
A biological parent must have been born at least **12 years** before their child.
- **Severity**: always `WARNING`, never an error. Teenage pregnancies are a historical fact
- **Threshold**: `MIN_PARENT_AGE = 12`, in `config/limits.js`
- **Scope**: only `type: 'BIOLOGICAL'`
- **Tests**: parent born 1900, child 1908 → `WARNING` · parent 1900, child 1925 → no issue · `ADOPTED` link with the same difference → no issue

### `PARENT_BORN_AFTER_CHILD`
A biological parent born **after** their child.
- **Severity**: `IMPOSSIBLE` → `ERROR` · otherwise → `WARNING`
- **Note**: it is the extreme case of the previous rule and it is structurally impossible, which is why it is separate

### `CHILD_AFTER_MOTHER_DEATH`
A child cannot be born more than **9 months** after the death of their biological mother.
- **Severity**: `IMPOSSIBLE` (with the margin applied) → `ERROR` · otherwise → `WARNING`
- **Margin**: `POSTHUMOUS_MARGIN_MONTHS = 9`. Accounts for immediate posthumous births
- **Scope**: biological mother, identified by `type: 'BIOLOGICAL'` and `sex: 'F'`. If `sex` is `U`, the rule does not apply
- **Tests**: mother dies `1900`, child born `1902` → `ERROR` · mother dies `MAY 1900`, child born `JAN 1901` → `WARNING` (within the margin) · mother dies `ABT 1900`, child born `1902` → `WARNING`

### `CHILD_LONG_AFTER_FATHER_DEATH`
Child born more than 9 months after the death of the biological father.
- **Severity**: always `WARNING`. Late posthumous fatherhood is possible today (assisted reproduction) and in old records it usually indicates a date error, not an impossibility

### `IMPLAUSIBLE_LIFESPAN`
Lifespan over **120 years**.
- **Severity**: always `WARNING`
- **Note**: it almost always reveals a mistranscribed date, which is exactly what the user wants to see

### `PARENT_TOO_OLD`
Biological mother over **55 years** old at the child's birth.
- **Severity**: always `WARNING`
- **Threshold**: `MAX_MOTHER_AGE = 55`

### `UNION_AFTER_DEATH`
A union cannot start after the death of one of its members.
- **Severity**: `IMPOSSIBLE` → `ERROR` · otherwise → `WARNING`

### `UNION_BEFORE_BIRTH`
A union cannot start before the birth of one of its members.
- **Severity**: `IMPOSSIBLE` → `ERROR` · otherwise → `WARNING`

### `UNION_TOO_YOUNG`
Member of a union under **12 years** old at `startDate`.
- **Severity**: always `WARNING`. Arranged child marriages are abundantly documented

### `UNION_END_BEFORE_START`
`endDate` earlier than `startDate`.
- **Severity**: `IMPOSSIBLE` → `ERROR` · otherwise → `WARNING`

### `EVENT_DATE_IN_FUTURE`
Date later than today.
- **Severity**: `WARNING`
- **Note**: the interval's `latest` is what gets compared, so `ABT 2026` does not trigger

---

## Coherence rules — `WARNING`

### `CONSANGUINEOUS_UNION`
The two members of a union with offspring share an ancestor.
- **Trigger**: when creating a `ParentChild` whose `unionId` connects two people with a common ancestor
- **Message**: *"{name1} and {name2} share a common ancestor: {ancestorName} ({generations} generations back)."*
- **Scope**: only `BIOLOGICAL` lines, up to `CONSANGUINITY_MAX_DEPTH = 8` generations
- **Explicitly does not block**: unions between relatives are a frequent historical fact and documenting them is part of the craft
- **Out of the MVP**: computing the coefficient. Here only the common ancestor is detected, which is a set intersection

### `SIBLING_AS_PARENT`
Someone is a parent of their own sibling.
- **Severity**: `WARNING`. It really happens, and in old records it is also a typical transcription error

### `UNION_BETWEEN_CLOSE_RELATIVES`
Union between people separated by fewer than 3 degrees (siblings, parent-child).
- **Severity**: `WARNING`, with a different message from `CONSANGUINEOUS_UNION` because it is more severe

### `PARTNER_AGE_GAP`
Age difference of more than 40 years between the members of a union.
- **Severity**: `INFO`

### `CONFLICTING_PARENT_TYPES`
The same parent linked to the same child with two incompatible types.
- **Note**: `DUPLICATE_EDGE` already blocks it at the structural level. This rule covers the case after an import with error recovery

---

## Completeness rules — `INFO`

These are not problems; they are suggestions for the review panel. **They never appear on the person's card**, only in the panel: turning the app into a to-do list that scolds the user is the fastest way to make them abandon it.

| ID | Description |
|---|---|
| `MISSING_BIRTH_DATE` | Person without a birth date |
| `MISSING_SURNAME` | Person without a surname |
| `MISSING_SEX` | `sex: 'U'` on a non-placeholder person |
| `NO_PARENTS` | Person with no recorded parent (the top leaf of the tree) |
| `ORPHAN_PERSON` | Person with no links at all: no parents, no children, no unions |
| `UNMATERIALIZED_PLACEHOLDER` | Placeholder person that has been linked for a long time without being materialized |
| `ORPHAN_MEDIA` | File on disk without a `MediaObject`, or `MediaObject` without links |
| `LIVING_PERSON_NO_DEATH` | Born more than 120 years ago with no death date |

`ORPHAN_MEDIA` is the one that feeds the maintenance operation described in [storage.md](storage.md#binaries).

---

## Edge cases that must be tested

A reminder of the scenarios that break naive implementations:

1. **All dates unknown** — no temporal rule must trigger or throw
2. **Date with only one bounded end** (`BEF 1900` → `earliest: null`) — the comparison must handle `null` in any position
3. **Placeholder person in the middle of a chain** — validations traverse it without requiring data from it
4. **Child with four parents** (two biological + two adoptive) — only the biological ones enter the temporal rules
5. **Two simultaneous unions** of the same person — allowed, no warning: bigamy and overlapping relationships are documented
6. **Disconnected graph** (several unrelated families in the same project) — valid and common
7. **Self-reference via `unionId`** — a `ParentChild` whose `unionId` points to a union that does not include its `parentId`: extended `DANGLING_REF`
8. **Graph of 10,000 people** — `validateAll` must complete without blocking the interface; hence the Worker
