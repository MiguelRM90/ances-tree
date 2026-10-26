# GEDCOM Audit & Interoperability Roadmap

> Tracking document for GEDCOM 5.5.1 / 7.0 parser, importer, and exporter improvements in **AncesTree**.

## Completed

- [x] **Item 0: UTF-16 (`LE`/`BE`) and `1 CHAR UNICODE` / `ANSEL` / `ANSI` encoding detection**
  - Implemented `decodeGedcom` and `readFileWithEncoding` in `src/domain/gedcom/parser.js`.
  - Added BOM detection (`FF FE`, `FE FF`, `EF BB BF`), null-byte heuristics for BOM-less UTF-16, and `1 CHAR` header inspection.

## Pending Fixes & Improvements

- [x] **Item 1: Deduplicate `1 CHIL` records in exported `FAM` blocks (`src/domain/gedcom/export.js`)**

  - **Bug**: Because the internal model stores one `ParentChild` link per parent, a child of a two-parent union has two links with the same `unionId`. `writeFamily` iterates over `family.children` directly, emitting `1 CHIL @I3@` **twice** for every child of a couple.
  - **Fix**: Deduplicate child IDs per family when emitting `1 CHIL` lines in `writeFamily`.

- [x] **Item 2: Restore `_REL` (`STEP` and `GUARDIAN` parent types) on GEDCOM import (`src/domain/gedcom/import.js`)**

  - **Bug**: `export.js` writes `2 PEDI foster` and `2 _REL STEP` (or `GUARDIAN`), but `import.js` ignores `_REL`, degrading step-parents and guardians to `FOSTER` on round-trip.
  - **Fix**: Read `childValue(famc, '_REL')` in `import.js` and restore `ParentType.STEP` / `ParentType.GUARDIAN` when valid.

- [x] **Item 3: Support `1 CHIL` fallback when `1 FAMC` is omitted on `INDI` (`src/domain/gedcom/import.js`)**

  - **Bug**: Many third-party GEDCOM files link children only inside `0 @F1@ FAM` (`1 CHIL @I3@`) without the reciprocal `1 FAMC @F1@` on the `0 @I3@ INDI` record (or vice versa). Currently `import.js` only reads `FAMC` on `INDI`, losing parent-child links in files that only use `CHIL`.
  - **Fix**: After processing `FAMC` links on individuals, inspect `1 CHIL` entries in `FAM` records and create `ParentChild` links for any parent-child pair not already linked to that family.

- [x] **Item 4: Round-trip media capture dates (`takenDate`) via `OBJE` notes (`src/domain/gedcom/import.js`)**

  - **Bug**: `export.js` writes `1 NOTE Taken <date>` on `OBJE` records when `item.takenDate.raw` is present, but `readObject` in `import.js` ignores it.
  - **Fix**: Parse `1 NOTE Taken <date>` (or `2 DATE` under `FILE`/`OBJE` if present in external GEDCOMs) back into `takenDate` in `readObject`.

- [x] **Item 5: Preserve GEDCOM calendar escapes (`@#DJULIAN@`, etc.) when escaping `@` (`src/domain/gedcom/export.js`)**

  - **Bug**: `Writer.line` blindly replaces all `@` with `@@` in non-pointer values, corrupting standard GEDCOM calendar escapes like `@#DJULIAN@ 15 MAR 1582` into `@@#DJULIAN@@ 15 MAR 1582`.
  - **Fix**: Preserve leading `@#D...@` calendar escape prefixes on `DATE` tags while still escaping literal `@` characters elsewhere.

- [x] **Item 6: Code-point safe line splitting for `CONC` and tolerant leading whitespace in `parser.js`**

  - **Bug A**: `split()` in `export.js` slices by UTF-16 code units (`text.slice`), which can split a 4-byte UTF-8 character (surrogate pair / emoji) in half across a `CONC` boundary.
  - **Bug B**: Indented GEDCOM lines (e.g. `  1 NAME ...` from legacy exporters) fail the `^(\d+)` regex in `parser.js`.
  - **Fix**: Slice strings by Unicode code points (`Array.from(text)`) in `export.js` and allow optional leading whitespace before the level number in `parser.js`.

- [x] **Item 7: Strip synthetic `HUSB/WIFE` ordering note on round-trip, restore `HEAD.NOTE` project title, and support top-level `@N@ NOTE` pointers & inline `1 OBJE` (`src/domain/gedcom/import.js`)**
  - **Bug A**: `export.js` emits `1 NOTE HUSB/WIFE assigned by record order, not by sex.` on same-sex or unknown-sex unions; `import.js` imported that technical note into `union.notes`.
  - **Bug B**: Third-party exporters (Gramps, FamilySearch, Ancestry) frequently emit top-level `0 @N1@ NOTE ...` referenced via `1 NOTE @N1@`, as well as inline `1 OBJE` blocks inside `INDI` without a level-0 `@O1@` pointer.
  - **Fix**: Ignore the synthetic `HUSB/WIFE` note when reading `FAM` notes, restore `HEAD.NOTE` as the default project title, dereference `@N...@` note pointers, and read inline `1 OBJE` media records.
