# Architecture

> Related documents: [decisions.md](decisions.md) · [data-model.md](data-model.md) · [storage.md](storage.md) · [validation-rules.md](validation-rules.md) · [gedcom-mapping.md](gedcom-mapping.md)

How the code is organized: layers, data flow, and the tree layout engine.

---

## Dependency rule

Four layers. **Dependencies only point downwards.** Never the other way around, never diagonally upwards.

```
┌─────────────────────────────────────────────┐
│  UI          Web Components, CSS            │  ← touches the DOM
├─────────────────────────────────────────────┤
│  STORE       State, mutations, events       │
├─────────────────────────────────────────────┤
│  DOMAIN      Model, validation, layout,     │  ← pure functions
│              queries, GEDCOM                │
├─────────────────────────────────────────────┤
│  STORAGE     Persistence adapters           │  ← touches disk/IndexedDB
└─────────────────────────────────────────────┘
```

Practical consequences:

- **`domain/` imports nothing from the other layers.** No DOM, no IndexedDB, no store. They are pure functions over data structures, which is why they can be tested without a browser and run in a Worker
- **`storage/` does not know the store.** It receives and returns plain objects
- **The UI does not talk to `storage/`.** It always goes through the store
- An `import` that violates this is an architecture error, not a convenience. ESLint enforces it with `no-restricted-imports`

---

## Directory structure

```
src/
├─ main.js                    Entry point: capabilities, store, first render
├─ config/
│  ├─ limits.js               All thresholds and maximum sizes
│  └─ strings.js              UI literals (a single source, for future i18n)
│
├─ domain/                    ── PURE FUNCTIONS, NO SIDE EFFECTS ──
│  ├─ model/
│  │  ├─ person.js            Constructors and normalizers
│  │  ├─ union.js
│  │  ├─ parent-child.js
│  │  ├─ media.js
│  │  └─ schema.js            Shape validation + schemaVersion
│  ├─ date/
│  │  ├─ parse.js             raw → { kind, earliest, latest, precision }
│  │  ├─ format.js            Human-readable rendering
│  │  └─ compare.js           isBefore() → CERTAIN | POSSIBLE | IMPOSSIBLE
│  ├─ graph/
│  │  ├─ queries.js           Parents, children, siblings, spouses
│  │  ├─ traversal.js         BFS/DFS, ancestors, descendants, cycles
│  │  └─ generations.js       Level assignment from the focal person
│  ├─ validation/
│  │  ├─ engine.js            validateAll(graph) → ValidationIssue[]
│  │  └─ rules/               One file per rule in validation-rules.md
│  ├─ layout/
│  │  ├─ engine.js            Graph → LayoutTree (no DOM)
│  │  └─ edges.js             Which lines to draw and between which nodes
│  ├─ gedcom/
│  │  ├─ lexer.js             Text → typed lines
│  │  ├─ parser.js            Lines → record structure
│  │  ├─ import.js            Records → model
│  │  └─ export.js            Model → text
│  └─ migrations/
│     └─ v1-to-v2.js          Pure: (data) => data
│
├─ storage/                   ── SIDE EFFECTS: DISK AND INDEXEDDB ──
│  ├─ backend.js              Chooses the mode: DISK or BROWSER. Nothing else branches
│  ├─ file-dialog.js          Open and save, with or without File System Access
│  ├─ opfs.js                 Projects inside browser storage
│  ├─ names.js                The fixed names inside a project folder
│  ├─ error.js                StorageError, kept separate to avoid cycles
│  ├─ capabilities.js         Requirements check
│  ├─ project-store.js        Open, create, load and save the folder
│  ├─ idb.js                  Minimal IndexedDB wrapper
│  ├─ handles.js              DirectoryHandle persistence and permissions
│  ├─ media.js                Import pipeline: magic bytes, EXIF, hash
│  └─ zip/
│     ├─ write.js             CompressionStream + central directory + CRC32
│     └─ read.js              Central directory first, safeEntryPath
│
├─ store/
│  ├─ store.js                Singleton. State + mutations + EventTarget
│  ├─ actions.js              High-level operations
│  └─ selectors.js            Derived reads, memoized
│
├─ ui/
│  ├─ components/
│  │  ├─ app-root.js
│  │  ├─ tree-canvas.js       Orchestrates the tree render
│  │  ├─ person-card.js
│  │  ├─ union-node.js
│  │  ├─ tree-edges.js        SVG layer
│  │  ├─ person-editor.js     Form: save or cancel
│  │  ├─ relation-editor.js   Parents and partners: applied instantly
│  │  ├─ person-search.js     Search and pick a person (configurable event)
│  │  ├─ media-gallery.js
│  │  ├─ issue-panel.js       Review panel
│  │  └─ ...
│  ├─ styles/
│  │  ├─ tokens.css           Custom properties: color, spacing, typography
│  │  └─ sheets.js            Shared constructable stylesheets
│  └─ dom.js                  Safe helpers (never innerHTML with data)
│
└─ workers/
   ├─ validation.worker.js
   └─ layout.worker.js        Only if profiling justifies it
```

---

## The store

A single singleton module that owns the state. **Components never talk to each other.**

```js
class Store extends EventTarget {
  #state;   // { persons: Map, unions: Map, parentChildren: Map, media: Map, settings, issues }

  getState() { return this.#state; }           // frozen, read-only

  async apply(mutation) {
    const next = reduce(this.#state, mutation);
    const errors = validateMutation(next, mutation);   // ERROR rules only
    if (errors.length) return { ok: false, errors };

    this.#state = next;
    this.dispatchEvent(new CustomEvent('change', { detail: { mutation, next } }));
    scheduleSave();                                    // debounce, see storage.md
    scheduleValidation();                              // WARNING/INFO, in a Worker
    return { ok: true };
  }
}
```

**Data flow, in one line**: intent goes up via `CustomEvent`, state comes down as properties.

```
person-card ──CustomEvent('person:edit', {bubbles, composed})──▶ app-root
                                                                    │
                                                              store.apply(...)
                                                                    │
                          ◀──── 'change' event ─────────────────────┘
                                     │
                        subscribed components re-read from the store
```

**Why a central store and not propagation between components**: the tree is fully re-rendered when the focal person changes. With local propagation, every change would have to traverse the component hierarchy and the update order becomes unpredictable. With a central store there is a single source of truth and a single re-render moment.

### Collections as `Map`

In memory, the four collections are `Map`s indexed by `id`, plus derived indexes that are rebuilt on load:

```js
childrenByParent: Map<personId, ParentChild[]>
parentsByChild:   Map<personId, ParentChild[]>
unionsByPerson:   Map<personId, Union[]>
mediaByTarget:    Map<targetId, MediaObject[]>
```

On disk they remain plain arrays ([data-model.md](data-model.md#structure-of-familyjson)). The conversion happens on load and on save, and it is the only place where it exists.

### Undo / redo

A stack of mutations together with their inverses. Each mutation knows how to undo itself; full copies of the state are not stored.

```js
{ type: 'person:update', personId, before: {...}, after: {...} }
```

Limit of 50 steps. The stack **is not persisted**: when the project is reopened, the history starts empty.

---

## Layout engine

The most delicate part of the project. It is split into **strict phases** and only the last one touches the DOM.

### Phase 0 — Focus cropping

From `settings.focalPersonId`, **a pedigree view** is selected, and everything else is discarded **before** computing anything:

- **Upwards**: parents, their parents, etc., up to `maxGenerationsUp`. Both parents come in together, so couples remain intact
- **Sideways, exactly once**: the focal person's siblings
- **Downwards**: children, their children, etc., up to `maxGenerationsDown`, each with their partner — without the partner, the union node and the next generation would make no sense

**What is NOT reached matters as much as what is**: it does not expand laterally through the network of cousins.

> **This distinction is the whole point.** A BFS bounded only by generation looks reasonable and is not: from one person it reaches an ancestor, then all of that ancestor's children, then their partners, then those partners' children, and so on until it sweeps the entire generational band. Measured on a 10,000-person file: **±1 generation reached 2,439 people and ±4 reached 9,981** — the entire file. Bounding depth without bounding width bounds nothing.
>
> With the pedigree view, the same focal person with ±4 shows **36 people and 62 nodes**, within the budget of 200.

**Out of scope for now**: an "extended family" view that does include cousins, as an explicit user option. The engine supports it; what it cannot be is the default behavior.

### Phase 1 — Generation assignment

- The focal person is level `0`
- Parents at `−1`, children at `+1`, recursively
- **Union normalization**: both members of a union are forced to the same level. The level of whichever is closer to the focal person prevails
- Conflicts (someone reachable by two paths with different levels, common in consanguineous unions) are resolved by the **shortest path to the focal person**; on a tie, by the descending path

### Phase 2 — Union nodes

Unions do **not** connect cards to each other. A synthetic node is inserted between the two members, from which a single vertical line goes down to the children.

```
  [ Father ]───●───[ Mother ]        ← ● is the union node
               │
       ┌───────┼───────┐
    [Child1] [Child2] [Child3]
```

Without that node, N children × 2 parents produce 2N crossing lines. With it, 2 + N.

### Phase 3 — Ordering and placeholders

Within each row:

- Siblings are sorted by birth date; those with an unknown date go last
- Family branches are sorted to minimize crossings (median heuristic on the parents' barycenter)
- **Layout placeholders** are inserted: empty, invisible elements that reserve space between branches to avoid overlaps and keep symmetry

> **Do not confuse** these with the model's ghost persons ([data-model.md](data-model.md#ghost-persons-placeholders)). These are purely visual and do not exist outside the layout.

### Phase 4 — Positioning

**The engine assigns the X coordinate of each node.** The measurements live in `src/config/layout.js` and the canvas republishes them as custom properties, so that there is a single definition.

> **Reversed decision.** This document used to say *"Coordinates are NOT computed by hand: CSS places the boxes"*. That was wrong for a family tree and had to be undone.
>
> With flexbox, **each row centers itself on its own**, with no relationship between where a couple ends up and where its children end up. A couple could end up at one end of the tree and its descendants at the other, with the bar joining them crossing the entire screen. Sorting the rows helps, but cannot move a row laterally: it is a limitation of the box model, not an implementation flaw.

Two rules, one for each half of the hourglass. Using a single one for both was the mistake that left only one family in seven properly centered:

- **Downwards**: the couple is centered over its children. Each subtree receives its own band (`spreadDown`), so it is exact and nothing can collide
- **Upwards**: the ancestors are centered over the couple. A couple has two sets of grandparents, so **the group is centered**, not each block — treating them as ordinary children would make both want the same spot

The centering target is the **span of the children's cards**, not that of their blocks: a block also contains the spouse, and centering on blocks left the couple 124 px — half a couple — off from the bar their line drops to.

Measured on 10,000 people: **85% of families centered with less than 1 px of error**, median 0.

### Phase 5 — SVG routing

A `<svg>` layer of the exact size of the tree, with orthogonal `<path>` routes. One route per sibling group, grouped by generational level and assigned to staggered descending tracks from left to right to avoid horizontal collisions and so that neighboring families are never collinear.

**Nothing measures the DOM.** The coordinates come from phase 4, so there is no `getBoundingClientRect`, no `requestAnimationFrame`, and no recalculation on `resize`.

It is worth stating because it used to be the other way around, and four different bugs came out of that: measuring before the browser had laid out, measuring against the wrong ancestor, an SVG narrower than the tree it covered, and a stale measurement after scrolling. None of those can happen to a coordinate that was never measured.

The geometry lives in `src/ui/edge-paths.js`, separate from the component that paints and covered by tests on synthetic rectangles.

### Phase 6 — Transitions

When the focal person changes, `document.startViewTransition()` if available, with clean degradation if not. Cards that survive the change carry a `view-transition-name` derived from their `id`, so that they move instead of flickering.

---

## IndexedDB schema

Database `ancestree`, version `1`:

| Object store | Key | Indexes | Contents |
|---|---|---|---|
| `projects` | `id` | `openedAt` | Recent projects: id, title, folder name |
| `handles` | `key` | — | `FileSystemDirectoryHandle` of each project |

**IndexedDB does not store family data.** The graph lives in `family.json` inside the project folder — on the user's disk or in browser storage, depending on the mode ([storage.md](storage.md#decision-two-storage-modes)) — and in memory while working. This eliminates the conflict between encryption and indexes.

In `BROWSER` mode the file list is **not** read from IndexedDB but from the folders themselves: they are the truth, and someone who cleared IndexedDB but not their storage would otherwise see that they have nothing while the data is still there.

### Why IndexedDB and not `localStorage`

It is the obvious question, and the answer is blunt: **a `FileSystemDirectoryHandle` is an object, not a string**. It survives structured cloning and nothing else — `JSON.stringify` of a handle returns `{}`.

IndexedDB is the **only** place in the browser where a handle can be stored, and storing it is what allows your folder to be reopened instead of asking for it every session. Recent projects would fit in `localStorage`, but having two mechanisms to save twenty lines is not worth it when the database is already open.

> There used to be a third store, `prefs`, with the id of the last opened project. It was removed: the last project is simply the most recent one in `projects`, so it was one more store and one more thing to keep in sync for information that was already there.

Versioning is done **only** in `onupgradeneeded`, with cumulative migrations.

---

## Performance budget

Measurable targets. If something misses them, profile before optimizing by eye.

| Metric | Target |
|---|---|
| Focal person change → tree painted | < 150 ms with 200 visible nodes |
| Opening a 10,000-person project | < 2 s until interactive |
| `validateAll` over 10,000 people | < 1 s, in a Worker, without blocking the UI |
| Import of 1,000 photos | With visible progress and cancellable |
| App shell size (compressed) | < 150 KB |

Three decisions underpin this: the focus cropping of Phase 0, validation in a Worker, and keeping binaries out of the graph.

---

## Errors

- **`domain/` never throws on invalid data.** It returns results: `{ ok, errors }` or `ValidationIssue[]`. Exceptions are reserved for programming bugs
- **`storage/` does throw**, because I/O failures are truly exceptional: permission denied, vanished folder, exhausted quota
- The UI catches at the boundary and translates into actionable messages. **A stack trace or a raw browser message is never shown**
- Import errors are **accumulated** and presented as a summary, with the option to continue or cancel. It never aborts on the first failure

---

## Tests

| Layer | How |
|---|---|
| `domain/` | Pure unit tests. This is where the bulk goes: dates, validations, graph queries, layout, GEDCOM |
| `storage/` | Web Test Runner in a real browser. `BROWSER` mode is tested entirely against the real OPFS, including export without a save dialog (`test/browser-storage.test.js`). The folder picker cannot be automated, so the `DISK` path is tested manually with a checklist |
| `store/` | Mutation tests + emitted event |
| `ui/` | Web Test Runner. Mount component, fire event, check DOM |

**Mandatory fixtures**, in `test/fixtures/`:

- Minimal tree (3 people, 1 union)
- Tree with mixed adoption (biological father + adoptive mother) — the case that motivated the design of `ParentChild`
- Tree with a consanguineous union
- Tree with ghost persons
- 10,000-person tree, generated, for performance tests
- GEDCOM from at least five different applications ([gedcom-mapping.md](gedcom-mapping.md#test-corpus))

All **anonymized**: a fixture with real family data is a PII leak in a public repository.

---

## Accessibility

It is not a later phase. It is decided now because it conditions the markup:

- Person cards are **real `<button>`s**, not `div`s with `onclick`. Focus, keyboard, and screen reader support come for free
- The tree carries `role="tree"` with `aria-level` matching the generational level
- The SVG layer is `aria-hidden="true"`: it is decoration. Relationships are expressed in the accessible DOM through `aria-describedby`
- Full keyboard navigation: arrows between siblings, up/down between generations, `Enter` to focus
- Contrast comes from `tokens.css`, with a palette verified against WCAG AA
- `prefers-reduced-motion` is respected in view transitions

**There are three widths**: desktop, narrow window (1200 and 900 px), and phone (640 px). On a phone the toolbar **is not slimmed down any further** — each control is the only way to reach what it does, and hiding one would leave a function unreachable. It scrolls horizontally in its own row, with the search box below at full width, because searching is how you get anywhere in a tree that does not fit on screen.

Dialogs become sheets anchored to the bottom edge, measured in `dvh` and not `vh`: on a mobile device the address bar slides in and out, and `100vh` is the height *without* it — which is exactly how you end up with the buttons of a long form off-screen.

Touch targets grow to 44 px, except the union dot: enlarging it would move all the lines in the tree, since the layout engine places unions by coordinate instead of measuring them. There the tap area grows with an out-of-flow pseudo-element, and the dot stays as it is.
