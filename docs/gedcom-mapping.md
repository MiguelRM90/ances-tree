# GEDCOM ↔ Model Mapping

> Related documents: [data-model.md](data-model.md) (the native model) · [decisions.md](decisions.md#gedcom-import) (parser and security) · [storage.md](storage.md)

GEDCOM is **phase 2**, but this table is written **before the model is finalized**, because it determines which fields must exist. A field with no GEDCOM counterpart is not necessarily a mistake, but that has to be a conscious decision and not an oversight.

---

## Stance

**JSON is the source of truth. GEDCOM is a projection for exchanging data with other applications.**

Everything else follows from that:

- It is accepted that the exported GEDCOM **loses information**. What gets documented is *what* is lost
- A GEDCOM export→import cycle **is not lossless**. The faithful copy is the ZIP, and the user is told so in the export dialog
- The app state is never stored in GEDCOM alone

### Target version

**Default export: GEDCOM 5.5.1.** It is what all existing genealogy software reads, which is the only reason to export. 7.0 is offered as an alternative for those who need it.

**Import: autodetection** by reading `HEAD.GEDC.VERS`, supporting 5.5.1 and 7.0.

Differences to handle:

| | 5.5.1 | 7.0 |
|---|---|---|
| Encoding | ANSEL, ASCII, UNICODE, UTF-8 | **UTF-8 mandatory** |
| Line length | 255 characters → `CONC`/`CONT` | No practical limit |
| Extensions | Tags with a leading `_`, undeclared | Declared in `HEAD.SCHMA` with a URI |
| Line ending | `\r\n` usual | `\r\n` or `\n` |

ANSEL is an encoding from the 1980s that still shows up in real files and that no browser decodes natively. **If `CHAR ANSEL` appears, the user is warned that accented characters may arrive corrupted** and the file is imported as Latin-1, which is the least bad approximation; implementing a full ANSEL table is out of scope.

---

## File structure

```
0 HEAD
1 SOUR AncesTree
2 VERS 0.1.0
2 NAME AncesTree
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
1 DATE 15 AUG 2026
0 @I1@ INDI
...
0 @F1@ FAM
...
0 @O1@ OBJE
...
0 TRLR
```

The `xref`s (`@I1@`, `@F1@`, `@O1@`) are generated **sequentially and stably within a single export**, using an in-memory `UUID → xref` map. They are not persisted: the model's UUIDs are the real identity, and reusing xrefs across exports adds nothing.

---

## `Person` → `INDI`

| Model field | GEDCOM | Notes |
|---|---|---|
| `id` | `@I{n}@` | Via the UUID→xref map |
| `firstName` + surnames | `1 NAME Juan /García Pérez/` | Surnames go between slashes |
| `firstName` | `2 GIVN Juan` | Redundant but widely supported |
| `lastName` + `secondLastName` | `2 SURN García Pérez` | GEDCOM has **a single** surname field |
| `secondLastName` | `2 _SURN2 Pérez` | Extension: preserves the separation for our own round-trip |
| `alsoKnownAs[]` | additional `1 NAME ...` with `2 TYPE aka` | |
| `sex` | `1 SEX M` | Direct: `M`/`F`/`U`/`X`. This is why this enum was chosen |
| `nationality` | `1 NATI ES` | `NATI` is a standard 5.5.1 attribute |
| `birth.date` | `1 BIRT` / `2 DATE ...` | See *Dates* |
| `birth.place` | `2 PLAC Cuenca, España` | |
| `death.date` | `1 DEAT` / `2 DATE ...` | |
| `death.place` | `2 PLAC ...` | |
| `notes` | `1 NOTE ...` | With `CONC`/`CONT` if it exceeds 255 in 5.5.1 |
| linked `media` | `1 OBJE @O{n}@` | |
| — | `1 FAMC @F{n}@` | Family in which the person is a child. Derived from `ParentChild` |
| — | `1 FAMS @F{n}@` | Families in which the person is a spouse. Derived from `Union` |
| `createdAt` / `updatedAt` | `1 CHAN` / `2 DATE` | `updatedAt` only; GEDCOM has no creation date |

**Placeholder persons** (`isPlaceholder: true`): they are emitted as an `INDI` **without `NAME`**, which is the usual convention and what other applications expect. On re-import, an `INDI` with no `NAME`, dates, or notes is marked as `isPlaceholder`. This is a heuristic, not a guarantee, and is documented as such.

---

## `Union` → `FAM`

| Model field | GEDCOM | Notes |
|---|---|---|
| `id` | `@F{n}@` | |
| `partner1Id` / `partner2Id` | `1 HUSB @I{n}@` / `1 WIFE @I{n}@` | See problem below |
| `type: MARRIED` | `1 MARR` + `2 DATE` | |
| `type: PARTNERS` / `CASUAL` | `FAM` **without** `MARR` | See below |
| `startDate` | `1 MARR` / `2 DATE ...` | |
| `endDate` | `1 DIV` / `2 DATE ...` | |
| `notes` | `1 NOTE ...` | |
| children (via `ParentChild`) | `1 CHIL @I{n}@` | |

### Problem: `HUSB`/`WIFE` impose sex

GEDCOM 5.5.1 assumes a heterosexual marriage: `HUSB` must be `SEX M` and `WIFE` must be `SEX F`. The model makes no such assumption, and `partner1`/`partner2` carry no semantic meaning.

**Export strategy:**

1. If the sexes are `M` and `F`, they are assigned naturally
2. If they are the same or unknown, `HUSB` is assigned to `partner1Id` and `WIFE` to `partner2Id`, and an explanatory `NOTE` is emitted
3. On import, `HUSB`/`WIFE` feed `partner1Id`/`partner2Id` **without inferring sex from the tag**

Many applications will complain about case 2. This is a limitation of the format, not of the model, and the model will not be mutilated because of it.

### Problem: non-marital unions

5.5.1 has no standard way to say "unmarried partners". The most widespread convention is a `FAM` without a `MARR` event, which is what is done. To preserve the exact type in a round-trip, an extension tag is added (see below).

---

## `ParentChild` → `FAMC` / `FAMS` / `PEDI`

This is the most serious structural mismatch, and it should be understood before implementing.

**The model has one edge per parent. GEDCOM groups by family.** GEDCOM says "this individual is a child of this family", and the `PEDI` (pedigree) goes on the `FAMC` link, meaning it is **single for both parents of that family**. This is exactly the limitation that motivated redesigning `ParentChild`.

### Export

1. The `ParentChild` records of the same child are grouped by `unionId`
2. Each group produces a `1 FAMC @F{n}@` on the child's `INDI`
3. Links without a `unionId` (single parent) generate a synthetic `FAM` with a single `HUSB` or `WIFE`

```
0 @I3@ INDI
1 FAMC @F1@
2 PEDI birth
1 FAMC @F2@
2 PEDI adopted
```

`PEDI` values in 5.5.1: `birth`, `adopted`, `foster`, `sealing`.

| `ParentChild.type` | `PEDI` |
|---|---|
| `BIOLOGICAL` | `birth` |
| `ADOPTED` | `adopted` |
| `FOSTER` | `foster` |
| `STEP` | `foster` + extension (does not exist in 5.5.1) |
| `GUARDIAN` | `foster` + extension |

### The case GEDCOM cannot express

**Biological father + adoptive mother in the same family.** There is only one `PEDI` per `FAMC` link, so a choice has to be made.

Available mechanisms, in order of preference:

1. **GEDCOM 7.0** has the `ADOP` event with `FAMC` and an `ADOP` subtag whose value is `HUSB`, `WIFE`, or `BOTH`. It solves the case cleanly, and it is the strongest argument for offering 7.0 export
2. **In 5.5.1**, the `PEDI` of the majority link is emitted (biological if there is one), plus a human-readable `NOTE` describing the real situation, plus the extension tags for our own round-trip

### Import

- `FAMC` + `PEDI` → one `ParentChild` **for each** parent present in that `FAM`, all with the same `type`
- If there is an `ADOP` event with `FAMC`/`ADOP` (7.0), it is used to assign different types to each parent
- `certainty` does not exist in GEDCOM: it always comes in as `CONFIRMED`

---

## Dates

The model's `raw` field **is, essentially, the value of a GEDCOM `DATE`**. It was designed that way on purpose, and it makes this mapping almost trivial.

| `kind` | Emitted `DATE` |
|---|---|
| `EXACT` | `12 MAY 1912` |
| `PARTIAL` | `MAY 1912` / `1912` |
| `ABOUT` | `ABT 1885` |
| `ESTIMATED` | `EST 1885` |
| `CALCULATED` | `CAL 1885` |
| `BEFORE` | `BEF 1900` |
| `AFTER` | `AFT 1900` |
| `BETWEEN` | `BET 1900 AND 1905` |
| `UNKNOWN` | The entire `DATE` is omitted |

Formatting rules:

- Months as **three-letter uppercase English abbreviations**: `JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC`
- Day without a leading zero: `2 MAY 1912`, not `02 MAY 1912`
- On import, a `DATE` that matches no known pattern is stored **as-is in `raw`** with `kind: 'UNKNOWN'` and interval `[null, null]`. **It is never discarded**: it is user information even if the app cannot interpret it
- Alternative calendars (`@#DJULIAN@`, `@#DHEBREW@`, `@#DFRENCH R@`) are kept uninterpreted in `raw`, with a `WARNING`

---

## `MediaObject` → `OBJE`

In 5.5.1 it is emitted as a level-0 record and referenced from `INDI` and `FAM`:

```
0 @O1@ OBJE
1 FILE photos/a3/a3f2c1e9.jpg
2 FORM jpeg
2 TITL Abuela en la boda
1 NOTE Taken 1952
```

| Model field | GEDCOM |
|---|---|
| `path` | `1 FILE` — **relative path**, the same as in the folder and the ZIP |
| `mime` | `2 FORM jpeg` (`jpeg`, `png`, `webp`, `pdf`, `docx`, `xlsx`, etc.) |
| `caption` | `2 TITL` |
| `takenDate` | `1 NOTE` (5.5.1 has no media date) |
| `links[]` | `1 OBJE @O1@` on each `INDI`/`FAM` |

The relative path works because the `.ged` lives **inside the same folder or ZIP** as the `photos/` and `documents/` folders (see [storage.md](storage.md#project-folder-structure)). When importing a standalone `.ged`, with no binaries alongside it, the `OBJE` records are registered as missing media and the user is offered the chance to locate the folder.

**Security**: `FILE` is a path coming from an external file. It goes through the same `safeEntryPath()` as ZIP entries. A `FILE ../../../etc/passwd` or a `FILE file:///C:/...` is rejected.

---

## What does NOT fit in GEDCOM

These fields exist only in `family.json`. They are listed here to make clear why the ZIP —and not the `.ged`— is the real copy.

| Field | Export destination | Recoverable on re-import |
|---|---|---|
| `ParentChild.certainty` | `_CERT` extension | Only from our own GEDCOM |
| Exact `Union.type` (`PARTNERS` vs `CASUAL`) | `_UTYPE` extension | Same |
| `Person.isPlaceholder` | Heuristic (`INDI` without `NAME`) | Approximate |
| `MediaLink.role` (`PORTRAIT`/`ATTACHMENT`) | `_ROLE` extension | Own only |
| `MediaObject.hash` | `_HASH` extension | Own only |
| `MediaObject.exifStripped` | Lost | No |
| `GenealogicalDate.earliest/latest` | Recalculated from `raw` | Yes, derived |
| `settings` (focal person, generations) | Lost | No |
| `Person.createdAt` | Lost | No |
| `schemaVersion` | Lost | No |

### Extension tags

Our own extensions carry a `_` prefix in 5.5.1. Other applications silently ignore them, which is the desired behavior.

```
0 @I3@ INDI
1 FAMC @F1@
2 PEDI birth
2 _CERT PROBABLE
```

In 7.0 they are declared in `HEAD.SCHMA` with a URI, as the standard requires:

```
1 SCHMA
2 TAG _CERT https://github.com/<user>/AncesTree/terms#certainty
```

**Firm rule: no extension may be required to reconstruct the tree topology.** If an import ignores all `_` tags, the result must still be a correct tree, just with fewer nuances.

---

## The two surnames

GEDCOM has **a single surname field**, so both go inside it separated by a space — which is how a Spanish name is written anyway. Other applications read a correct full name.

The separation is preserved in the `_SURN2` extension, so that our own import can restore it. When importing a foreign GEDCOM, **no attempt is made to split the surname**: `De la Fuente` and `García Pérez` are indistinguishable, and getting it wrong would corrupt the record.

## Implementation plan

**Export before import.** Export is deterministic and is tested against the model itself; import has to face whatever other applications have produced, which is an open-ended problem.

| | Status |
|---|---|
| 5.5.1 export of `INDI` + `FAM` + dates | ✅ Done |
| `OBJE` export | ✅ Done |
| `family.ged` included in every exported ZIP | ✅ Done |
| Import: tolerant lexer and parser | ✅ Done |
| Import of `INDI` + `FAM` + `OBJE` | ✅ Done |
| 7.0 export | ❌ Pending |
| Test corpus with files from other applications | ❌ Pending |

**Round-trip verified on 10,000 people**: 2.87 MB of GEDCOM, exported and imported with **0 warnings**, and 9,971 people / 4,266 unions / 14,432 links identical on both sides. All names, all literal dates, the 591 placeholder persons, and the 8,442 nationalities survive.

The cycle uncovered two bugs that neither half would have found on its own: the export emitted **one `FAMC` per link instead of one per family** (a duplicate, invalid pointer, which came back as two sets of links), and it **did not write `NATI`** even though the import already read it. Writing both directions and pitting them against each other is what keeps them honest.

What does not come back is what is documented above: the per-partner `PEDI`. A child with a biological father and an adoptive mother returns with the same pedigree for both.

### Test corpus

Before considering the import good, it must be tested with real files exported by at least: **Gramps, Ancestry, MyHeritage, FamilySearch, and the reference GEDCOM 7 files**. Each one has its quirks. The test files go in `test/fixtures/gedcom/`, **anonymized**: a fixture with someone's real family data is a PII leak in a public repository.
