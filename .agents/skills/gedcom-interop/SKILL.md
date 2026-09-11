---
name: gedcom-interop
description: >-
  Procedures for reading, parsing, importing, exporting, and round-tripping GEDCOM 5.5.1 and 7.0 files
  using native Vanilla JS without external dependencies. Use when debugging GEDCOM imports,
  adding GEDCOM tag mappings, or working on data exchange.
---

# GEDCOM Interoperability Skill

This skill covers working with the native GEDCOM parser and generator in `src/domain/gedcom/`:
- `parser.js`: Streaming lines into tagged hierarchical records.
- `import.js`: Converting GEDCOM records into domain entities (`Person`, `Union`, `ParentChild`).
- `export.js`: Serializing domain models into valid GEDCOM 5.5.1 / 7.0 text.

## Core Architectural Rules

1. **JSON is Truth; GEDCOM is a Projection**:
   - The native `family.json` in the user's archive is the source of truth.
   - GEDCOM export is inherently lossy for features not natively supported by the standard (e.g. detailed media metadata, two Spanish surnames as distinct entities, custom validation states).
   - Never rely on GEDCOM as the sole backup or storage format.

2. **No External Parsers**:
   - GEDCOM parsing must remain zero-dependency.
   - Handled natively in `parser.js` via line-by-line scanning conforming to level-tag-value hierarchy.

3. **Character Encodings**:
   - GEDCOM 5.5.1 allows `UTF-8`, `ASCII`, and legacy `ANSEL`.
   - GEDCOM 7.0 requires strict `UTF-8`.
   - If `CHAR ANSEL` is encountered, issue a user warning regarding accented characters and fall back to Latin-1 approximations.

4. **Line Splitting and Continuation**:
   - GEDCOM 5.5.1 enforces 255-character line length limits via `CONT` and `CONC`.
   - `parser.js` must accurately reassemble strings with `CONC` (direct continuation without newline) and `CONT` (continuation with newline).

## Common Tag Mappings
- Individual: `0 @I1@ INDI`
  - Name: `1 NAME First /LastName SecondLastName/`
  - Birth: `1 BIRT` -> `2 DATE`, `2 PLAC`
  - Death: `1 DEAT` -> `2 DATE`, `2 PLAC`
  - Sex: `1 SEX M|F|U`
- Family: `0 @F1@ FAM`
  - Husband/Wife: `1 HUSB @I1@`, `1 WIFE @I2@`
  - Marriage: `1 MARR` -> `2 DATE`, `2 PLAC`
  - Divorce: `1 DIV` -> `2 DATE` (represented as `UnionType.MARRIED` with `endDate` in model)
  - Children: `1 CHIL @I3@`

## Verification
- Run tests: `npm test test/gedcom.test.js test/gedcom-import.test.js`
- Reference specifications: `docs/gedcom-mapping.md`

