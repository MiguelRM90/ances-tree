# Data model

> Related documents: [decisions.md](decisions.md) (technical decisions) · [storage.md](storage.md) (where this physically lives) · [validation-rules.md](validation-rules.md) (detailed rules) · [gedcom-mapping.md](gedcom-mapping.md) (interoperability) · [architecture.md](architecture.md) · [vision.md](vision.md)

This document is **the project's data contract**. Everything else derives from it: the layout engine, validations, ZIP export, and the future GEDCOM mapping.

Identifiers and enumeration values are in **English**. JSON keys are `camelCase`.

---

## Principles

1. **One edge per link.** No relationships that group two parents under a single type: each parent↔child link is its own row with its own type.
2. **The `raw` of dates is the source of truth.** Derived fields (`earliest`, `latest`) are recalculated; they are never edited by hand.
3. **Almost everything is a warning, not an error.** Real genealogy is full of contradictory data. Only what is structurally impossible is blocked.
4. **IDs are opaque.** `crypto.randomUUID()`, with no semantic meaning, never reused.
5. **Binaries do not live in the JSON.** They are only referenced by relative path and hash.

---

## Schema versioning

```json
{ "schemaVersion": 2 }
```

- `schemaVersion` is **mandatory** in `family.json` from the first version
- On open: if it is lower than the current one, migrations are applied in a chain (`1→2→3`) before loading. If it is higher, **the file is rejected** with a clear message ("this project was created with a newer version")
- Each migration lives in its own module `migrations/vN-to-vM.js` and is a pure function `(data) => data`
- Before overwriting, a copy of the previous `family.json` is saved in `backups/`

This is the contract with the user ten years down the line: a file exported today must be openable in any future version.

### There are no migrations yet, on purpose

The schema **remains at version 1 and changes in place** while it is being designed. Writing a migration for every field while the shape is still moving is bookkeeping for versions that nobody ever had.

It works because **all fields so far are additive and have a safe default value**, and `normalizeProject` fills them in: a file written by an earlier build still opens. A test verifies this, and it is what keeps that property alive.

The migration chain —and the refusal to open a file from a later version— arrive **when v1 is published**, which is the moment a version number starts to mean something.

---

Country names are not stored: they come from `Intl.DisplayNames`, which the browser already provides, so the list is read in the user's language with no table to maintain. The flag is composed with regional indicator symbols — **Windows draws them as the two letters of the code instead of a flag**, and that is its own decision; both are readable, and both are better than bundling bitmaps for 249 countries.

**`v1-to-v2` does not attempt to split the existing surname.** `"De la Fuente"` and `"García Pérez"` are indistinguishable to any heuristic that splits on the space, and getting it wrong would silently corrupt a family's record. What was there is kept intact as the first surname and the second is left empty for the user to fill in.

---

## Structure of `family.json`

```json
{
  "schemaVersion": 1,
  "app": { "name": "AncesTree", "version": "0.1.0" },
  "project": {
    "id": "uuid",
    "title": "Familia Apellido1",
    "createdAt": "2026-08-15T10:00:00.000Z",
    "updatedAt": "2026-08-15T12:30:00.000Z"
  },
  "settings": {
    "focalPersonId": "uuid|null",
    "maxGenerationsUp": 4,
    "maxGenerationsDown": 4,
    "stripExifOnImport": true
  },
  "persons": [],
  "unions": [],
  "parentChildren": [],
  "media": []
}
```

The four collections are **flat arrays**. The entire tree topology is rebuilt in memory on load; the JSON contains no nested structures or circular references.

---

## Entities

### `Person`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` (UUID) | |
| `firstName` | `string` | May be `""` if unknown |
| `lastName` | `string` | **First surname** (the father's). May be `""` |
| `secondLastName` | `string` | **Second surname** (the mother's). May be `""` |
| `alsoKnownAs` | `string[]` | Nicknames, married names, spelling variants |
| `sex` | `"M" \| "F" \| "U" \| "X"` | The GEDCOM `SEX` values. `U` = unknown |
| `nationality` | `string` | ISO 3166-1 alpha-2 (`"ES"`), or `""`. An unrecognized code is discarded on load |
| `birth` | `LifeEvent \| null` | |
| `death` | `LifeEvent \| null` | |
| `isPlaceholder` | `boolean` | Ghost person (see below) |
| `notes` | `string` | Free text |
| `createdAt` | `string` (ISO 8601) | |
| `updatedAt` | `string` (ISO 8601) | |

**On the two surnames**: in Spain a person carries the father's first surname and the mother's first surname, and **knowing which is which is what makes it possible to follow a line**. Storing `"García Pérez"` as a single string throws that information away: it becomes impossible to tell a compound surname (`"De la Fuente"`) from two surnames, and impossible to know which one a child inherits.

`displayName()` joins them in the order they are spoken: *Ramón García Pérez*.

**On `sex`**: the GEDCOM enum is used rather than a free field, so that interoperability requires no translation. It is a biological record datum, not a statement of identity; if a separate gender identity field is needed in the future, it is added without touching this one.

### `LifeEvent`

```json
{
  "date": { /* GenealogicalDate */ },
  "place": "Cuenca, Castilla-La Mancha, España"
}
```

`place` is **a free string in v1**, like the GEDCOM `PLAC` tag. Turning it into a `Place` entity with hierarchy and coordinates is a clean `v1→v2` migration and is not worth bringing forward.

### `Union`

A union between two people. It is what the original vision called `Relationship`.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` (UUID) | |
| `partner1Id` | `string` (Person.id) | |
| `partner2Id` | `string` (Person.id) | |
| `type` | `"MARRIED" \| "PARTNERS" \| "CASUAL" \| "UNKNOWN"` | |
| `startDate` | `GenealogicalDate \| null` | Wedding or start of the relationship |
| `endDate` | `GenealogicalDate \| null` | Divorce or separation |
| `notes` | `string` | |

- The `partner1`/`partner2` order **has no semantic meaning**; it exists only to give the key stability. The UI must not assume roles from it
- A person can form **N unions** over their lifetime
- A union can exist **without children** (it is valid genealogical information)

### `ParentChild`

**The most important change from the original design.** One row per parent→child link, not one row per couple.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` (UUID) | |
| `parentId` | `string` (Person.id) | |
| `childId` | `string` (Person.id) | |
| `type` | `"BIOLOGICAL" \| "ADOPTED" \| "FOSTER" \| "STEP" \| "GUARDIAN"` | |
| `unionId` | `string \| null` | Union in whose context the link occurs |
| `certainty` | `"CONFIRMED" \| "PROBABLE" \| "DISPUTED"` | Defaults to `CONFIRMED` |

**Why one edge per parent.** The previous design (`parent1Id`, `parent2Id`, a single `type`) could not express the explicitly required case of a child with a **biological father and an adoptive mother**: the `type` was shared by both. With one edge per link, each parent carries their own type and their own certainty. It also naturally allows:

- A child with only one known parent (a single row)
- A child with four parents (two biological + two adoptive)
- Distinguishing genetic lines from legal lines with a simple query by `type`

**What `unionId` is for.** It is what makes it possible to resolve the sibling rule. Two links that share a `unionId` describe the two members of the same couple as parents of the same child. It is optional: a link can exist without an associated union (single parent, or unknown couple).

### `MediaObject`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` (UUID) | |
| `kind` | `"PHOTO" \| "DOCUMENT"` | |
| `path` | `string` | Relative path within the project, e.g. `photos/a3/a3f2...jpg` |
| `hash` | `string` | SHA-256 in hex of the content. It is the file's real identity |
| `mime` | `string` | Validated by magic bytes, not by extension |
| `bytes` | `number` | |
| `width`, `height` | `number \| null` | Only for `PHOTO` |
| `caption` | `string` | |
| `takenDate` | `GenealogicalDate \| null` | Extracted from EXIF before stripping it |
| `links` | `MediaLink[]` | Which entities it is associated with |
| `exifStripped` | `boolean` | Traceability of what was done on import |

```json
// MediaLink
{ "targetType": "person" | "union", "targetId": "uuid", "role": "PORTRAIT" | "ATTACHMENT" }
```

- The same file can be linked to several people (a group photo)
- The name on disk derives from the **hash**, not from the original name: it eliminates collisions, deduplicates automatically, and neutralizes malicious file names. The original name, if you want to keep it, goes in `caption`
- The folder structure and the hash-prefix sharding are in [storage.md](storage.md)

---

## Genealogical dates

The problem: real genealogy is full of partial or approximate dates — *"May 1912"*, *"1888"*, *"around 1885"*, *"between 1900 and 1905"*. A JavaScript `Date` cannot represent any of that.

**Solution: `raw` as the source of truth, plus a derived interval for sorting and validating.**

```json
{
  "raw": "ABT 1885",
  "kind": "ABOUT",
  "earliest": "1880-01-01",
  "latest": "1890-12-31",
  "precision": "YEAR"
}
```

| Field | Role |
|---|---|
| `raw` | What the user typed or what came in the GEDCOM. **Never lost or rewritten** |
| `kind` | Modifier recognized when parsing `raw` |
| `earliest` / `latest` | Derived interval `[earliest, latest]`. `null` at an end = unbounded on that side |
| `precision` | `"DAY" \| "MONTH" \| "YEAR" \| "NONE"` |

**`kind` values**, aligned with the standard GEDCOM modifiers:

| `kind` | GEDCOM | `raw` example | Derived interval |
|---|---|---|---|
| `EXACT` | — | `12 MAY 1912` | `[1912-05-12, 1912-05-12]` |
| `PARTIAL` | — | `MAY 1912` | `[1912-05-01, 1912-05-31]` |
| `ABOUT` | `ABT` | `ABT 1885` | `[1880-01-01, 1890-12-31]` (±5 years) |
| `ESTIMATED` | `EST` | `EST 1885` | `[1875-01-01, 1895-12-31]` (±10 years) |
| `CALCULATED` | `CAL` | `CAL 1885` | Like `EXACT`, marked as derived |
| `BEFORE` | `BEF` | `BEF 1900` | `[null, 1899-12-31]` |
| `AFTER` | `AFT` | `AFT 1900` | `[1901-01-01, null]` |
| `BETWEEN` | `BET…AND` | `BET 1900 AND 1905` | `[1900-01-01, 1905-12-31]` |
| `UNKNOWN` | — | `""` | `[null, null]` |

The `ABOUT` and `ESTIMATED` margins are a project convention, configurable in a single place.

**Unknown = empty.** `raw: ""` with `kind: "UNKNOWN"`. A date field is never `undefined`; either the whole event is `null`, or the date is explicitly unknown.

### Date comparison

Comparing two genealogical dates does not return a boolean, but one of three states. **All temporal validation uses this function**, never `<` directly:

```js
/** @returns {'CERTAIN'|'POSSIBLE'|'IMPOSSIBLE'} — can A be before B? */
function isBefore(a, b) {
  if (a.latest !== null && b.earliest !== null && a.latest < b.earliest) return 'CERTAIN';
  if (a.earliest !== null && b.latest !== null && a.earliest > b.latest) return 'IMPOSSIBLE';
  return 'POSSIBLE'; // the intervals overlap, or information is missing
}
```

The rule that connects this with the validations: **only `IMPOSSIBLE` can produce an error; overlap never does.**

---

## Ghost persons (placeholders)

The conceptual rule is that every person has two parents. Applied literally it would produce an infinite regress: each ghost would in turn need two parents.

**Operational rule:**

- Ghosts are created **on demand**, never in cascade. Only when the user needs to express "there was a mother here, but I don't know who she was" to complete a union or a line
- `isPlaceholder: true`, with no mandatory name or dates
- **They never generate their own parents automatically**
- The UI draws them differently (dashed border, no photo) and allows "materializing" them: turning them into a real person while keeping the `id` and all existing links
- They do not count toward statistics or the consanguinity calculation
- When exporting to GEDCOM they are emitted as `INDI` without `NAME`, which is the usual convention

---

## Derived queries

None of this is stored; it is computed in memory from the four collections.

**A person's parents**: rows of `parentChildren` with `childId === personId`. Filtering by `type: "BIOLOGICAL"` gives the genetic line; unfiltered, the family line.

**Siblings**: let `P(x)` be the set of biological `parentId`s of `x`.

- **Full siblings**: `P(a)` and `P(b)` coincide and have two elements. More precise alternative when there is a `unionId`: both share the same pair `(unionId, parentId×2)`
- **Half siblings**: `|P(a) ∩ P(b)| === 1`
- Adoptive siblings are computed the same way but over non-biological links, and are presented as a separate category

**Generational level**: BFS from the focal person (level 0), `−1` toward parents and `+1` toward children. The two members of a union are forced to the same level, with the one closest to the focal person prevailing.

**Cycle detection**: DFS over the `parentChildren` edges before confirming any new link.

---

## Validations

Each rule has a **stable id, severity, and message**. The full list with test cases will go in `validation-rules.md`; here we keep the framework and the foundational rules.

### Severities

| Severity | Behavior |
|---|---|
| **`ERROR`** | Blocks saving. Reserved for what is structurally impossible |
| **`WARNING`** | Saved anyway. A notice is shown on the record and in a review panel |
| **`INFO`** | Only appears in the review panel |

**Allocation criterion**: if a datum can be real however odd it looks, it is a `WARNING`. A family tree that refuses to save inconvenient data is useless; the user documents what they find, not what they would like to find.

### Structural rules — `ERROR`

| ID | Rule |
|---|---|
| `SELF_PARENT` | A person cannot be their own parent |
| `CYCLE` | An ancestor cannot be a descendant of their own descendants (DFS before confirming the link) |
| `DUPLICATE_EDGE` | There cannot be two `ParentChild` with the same `parentId` + `childId` |
| `SELF_UNION` | `partner1Id` and `partner2Id` cannot be the same person |
| `DANGLING_REF` | Every reference by `id` must resolve to an existing entity |
| `TOO_MANY_BIO_PARENTS` | A maximum of two `BIOLOGICAL` parents per child |

### Temporal rules — `WARNING` unless impossible

All are evaluated with `isBefore()`, and **they only fire as `ERROR` if the result is `IMPOSSIBLE`**; with interval overlap they are `WARNING`:

| ID | Rule | Note |
|---|---|---|
| `DEATH_BEFORE_BIRTH` | Death cannot precede birth | `ERROR` if `IMPOSSIBLE` |
| `PARENT_TOO_YOUNG` | A biological parent must have been born at least 12 years before their child | Configurable threshold. Always `WARNING` |
| `CHILD_AFTER_MOTHER_DEATH` | A child cannot be born after the death of the biological mother | `ERROR` if `IMPOSSIBLE`. 9-month margin after death for posthumous births |
| `CHILD_LONG_AFTER_FATHER_DEATH` | Child born more than 9 months after the death of the biological father | Always `WARNING` |
| `IMPLAUSIBLE_LIFESPAN` | Lifespan over 120 years | Always `WARNING` |
| `PARENT_TOO_OLD` | Biological mother over 55 years old at the child's birth | Always `WARNING` |
| `UNION_AFTER_DEATH` | Union started after the death of one of the members | `ERROR` if `IMPOSSIBLE` |

### Consanguinity

- The system **allows** unions between relatives: they are a frequent historical fact
- If two people with common ancestors have offspring, a `WARNING` (`CONSANGUINEOUS_UNION`) is emitted indicating the closest common ancestor
- **Calculating the consanguinity coefficient is out of scope for the MVP.** It is an algorithm in its own right (traversing all paths between common ancestors) and blocks nothing. Detecting a shared common ancestor does make it in, because it is a simple set intersection

---

## Out of scope in v1

They are documented here so that the schema leaves room and migrations are clean:

- **Sources and citations** (GEDCOM `SOUR`): where each datum comes from. It is the first thing that will be added in v2
- **`Place` as an entity** with hierarchy and coordinates
- **Arbitrary events** beyond birth and death (baptism, census, emigration)
- **Calculation of the consanguinity coefficient**
- **Duplicate detection** on import
