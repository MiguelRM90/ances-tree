ANCESTREE — VISION AND SCOPE
===========================

Related documents:
  decisions.md         Technical decisions and security
  data-model.md        Data model and dates
  storage.md           Storage, ZIP and PWA
  architecture.md      Layers, store and layout engine
  validation-rules.md  Validation rules in detail
  gedcom-mapping.md    GEDCOM mapping
  AGENTS.md            Master instructions for agents and AIs

This document defines WHAT is being built and WHY. The how lives in the other three.


WHAT IT IS
----------
A web application to build and maintain a family genealogical tree, in which the
data never leaves the user's machine and the resulting archive can be handed to a
relative as a folder or a ZIP.

No accounts. No backend. No subscription. Nobody else gets to see your
grandmother's photos.


FOUNDING PRINCIPLE
------------------
    Code         → public   (GitHub)
    Data         → private  (user's disk)
    Application  → static web
    Backend      → none

Corollary that orders everything else:

    Where the app is served  ≠  where the data lives

The app is a few hundred KB. The data always lives on the user's disk, wherever
the app is served from. Changing the hosting does not touch the data model.


TECHNOLOGY STACK
----------------
  - Plain HTML
  - Plain CSS, no frameworks or preprocessors
  - SVG for the kinship lines
  - Modern, plain JavaScript (Vanilla JS)
  - Web Components as the unit of composition
  - Zero runtime dependencies

Details and rationale: decisions.md


DISTRIBUTION
------------
  - GitHub Pages for the MVP. It only hosts the application, never family data
  - Installable PWA from day one: after the first visit it works 100% offline,
    with its own icon and without depending on GitHub staying up
  - Opening the HTML with a double click (file://) is NOT supported, and does not
    need to be: the data is local anyway. The reason is in decisions.md


STORAGE
-------
The entire project is ONE FOLDER ON DISK, managed with the File System Access
API. No browser quota, no eviction, no photo limit.

IndexedDB only stores folder handles, recent projects and interface
preferences. Never family data.

TWO MODES. On desktop Chromium (Chrome, Edge, Opera, Brave, Vivaldi) the archive
is a folder chosen by the user, with no quota or eviction. In any other browser —
Firefox, Safari and all mobile ones — it lives in the browser's own storage, which
does have a quota, can be evicted and is not visible in a file manager.
Everything works the same, but the application says so: permanent badge, notice
the first time, and the ZIP as the copy that is truly yours.

Disk mode always wins when it is available. They are not equivalent and are not
presented as if they were. If neither is available, the app does not start: it
shows a requirements screen.

The project folder and the ZIP have EXACTLY the same structure: compressing the
folder with the file explorer produces a valid ZIP, and vice versa.

Full structure, hash sharding, merge on import and limits: storage.md

    FamilySurname1/
    ├─ family.json     Graph + app-specific settings
    ├─ manifest.json   Metadata and integrity
    ├─ family.ged      GEDCOM (phase 2)
    ├─ photos/
    ├─ documents/
    └─ backups/


FORMATS
-------
  Data              JSON (source of truth)
  Interoperability  GEDCOM 5.5.1 / 7.0 (phase 2)
  Photos            JPEG, PNG
  Documents         PDF (stored and downloaded; no preview in the MVP)

JSON is the native format and the one that rules. GEDCOM is a projection for
exchanging with other applications, and not everything the app stores fits in it.


USAGE FLOW
----------
    Open the app (web or installed)
            ↓
    Choose a project folder on disk (remembered between sessions)
            ↓
    Work. Automatic saving
            ↓
    Export ZIP, or simply compress the folder
            ↓
    A relative opens it on their machine and keeps working


WORKING LANGUAGE
----------------
  - Code, identifiers, model fields, commits and design documentation → English
  - UI → English and Spanish through i18n dictionaries, with no hardcoded
    strings in the markup


DATA MODEL (summary)
--------------------
The full model, with types, enums and validations, is in data-model.md.
The essentials:

  Person        id, firstName, lastName, sex, birth, death, isPlaceholder, ...
  Union         id, partner1Id, partner2Id, type, startDate, endDate
  ParentChild   id, parentId, childId, type, unionId, certainty
  MediaObject   id, kind, path, hash, links, ...

A decision worth understanding here, because it changes the shape of the tree:
ParentChild is ONE EDGE PER PARENT, not one row per couple. It is the only way
to express a child with a biological father and an adoptive mother, which is an
explicitly required case.


DOMAIN RULES
------------
All of them are detailed, with id and severity, in data-model.md. The summary:

  - A person can form N unions over their lifetime
  - A child can have biological parents and, in addition, adoptive parents or
    legal guardians, distinguishing the type of bond so as not to mix genetic
    lines with relatives
  - Full siblings share both parents; half siblings, only one
  - When a parent is unknown, a PLACEHOLDER PERSON (isPlaceholder) can be created
    to keep the tree structure. They are created on demand, NEVER in cascade:
    applying "every person has two parents" literally would produce an infinite
    regression
  - A person cannot be their own parent, nor an ancestor a descendant of their
    own descendants (DFS before confirming any link)
  - Unions between relatives are allowed: they are a frequent historical fact. If
    there are children, the common ancestor is flagged. Computing the inbreeding
    coefficient is outside the MVP

Dates: real genealogy is full of partial dates ("May 1912", "about 1885"). The
original text is stored as the source of truth plus a derived interval for
sorting and validating, following the standard GEDCOM modifiers (ABT, EST, CAL,
BEF, AFT, BET...AND). Unknown = empty.

Severity: almost everything is a WARNING, not an error. Only what is
structurally impossible is blocked. A tree that refuses to save uncomfortable
data is useless: the user documents what they find, not what they would like to
find.


UI ARCHITECTURE AND TREE LAYOUT
-------------------------------
  - Level-based structure: people are laid out in horizontal rows according to
    their generational rank (N, N+1, N-1) relative to the focal person (level 0),
    with the oldest generations at the top and the most recent at the bottom

  - Offset normalization: both members of a union are forced onto the same visual
    row, regardless of their age difference

  - Synthetic union nodes: unions do not connect the cards to each other, but to
    an intermediate node from which a single descending vertical line leaves and
    branches horizontally towards the children

  - Layout placeholders: the engine inserts empty, invisible elements between
    branches within each row to avoid overlaps and keep symmetry. (Nothing to do
    with the placeholder persons of the model: this is purely visual)

  - Hybrid HTML + SVG rendering:
      · Person cards and union nodes → native HTML elements with flexbox/grid,
        for CSS, accessibility and click events
      · Kinship lines → a full-screen absolute <svg> layer with orthogonal
        <path> routes

  - Focus navigation: rendering is limited to a maximum number of generations
    above and below the focal person. Clicking any node makes it the focus and
    the whole tree is recalculated. This is what keeps a large tree from sinking
    performance

  - Line recalculation: SVG coordinates are recalculated with
    getBoundingClientRect() after any DOM modification and on the resize event
    (with debounce or requestAnimationFrame). Drawing must be invoked strictly
    inside a requestAnimationFrame() immediately after the cards are inserted or
    updated in the DOM

  - Review the native View Transitions API for an SPA-like finish


STATUS
------
Done:
  - Complete model: people (two surnames), unions, parent-child links,
    placeholder persons
  - Genealogical dates with modifiers and interval-based validation
  - Layout engine with own coordinates: couples centered over their children,
    ancestors centered over the couple
  - Navigable tree with focal person, search, back button, pinnable kinship
    highlighting
  - Photos with EXIF stripping, hash deduplication and portraits
  - Automatic saving, rotating backups, schema migrations
  - ZIP export and import (own format, no libraries)
  - GEDCOM 5.5.1 export
  - Installable PWA, AA accessibility verified by tests

  - GEDCOM 5.5.1 import and export, with verified round-trip
  - Nationality with flag
  - Review panel for the whole archive, filterable and navigable
  - PNG icons so the PWA is installable

Pending, in order of value:
  - PDF documents: model ready, no interface
  - Sources and citations (where each piece of data comes from)
  - Optional passphrase encryption
  - Notify the user when there is a new version of the app
  - Corpus of GEDCOM files from other applications to test the import

Later:
  - Inbreeding coefficient
  - Duplicate detection on import
  - Place as an entity with hierarchy and coordinates
  - Arbitrary events beyond birth and death
  - Additional UI languages beyond English and Spanish

Build order: first everything on JSON. GEDCOM comes afterwards, but the mapping
table is written before closing the model, because it determines which fields
exist.
