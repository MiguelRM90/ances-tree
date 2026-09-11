<!-- Written in English: this is the one document that ships with the code. The
     working specification lives alongside it in Spanish and stays local. -->

# AncesTree

A family tree you keep yourself.

Build and keep a family's genealogical archive in the browser. No accounts, no
subscription, no backend: **the data never leaves your machine**. When you want
to share it with a relative, you hand them a folder or a ZIP.

> **Status: in development.** It works end to end, but the data format is still
> being designed and can change between builds.

---

## How it works

    Code         public   (this repository)
    Data         private  (your device)
    Application  a static web page
    Backend      none

The application is a few hundred kilobytes served from GitHub Pages and
installable as a PWA, so it runs offline afterwards. On a desktop your archive is
an ordinary folder you can see, back up and compress with the tools you already
use; on a phone the browser keeps it for you and you export a ZIP to take a copy
out. Either way it has the same shape:

```
FamilyName/
├─ family.json     the tree
├─ family.ged      GEDCOM, for other genealogy software
├─ manifest.json   metadata
├─ photos/
├─ documents/
└─ backups/        rotated automatically before every save
```

Zipping that folder produces a file another relative can open and carry on with.

---

## What it does

- **Privacy by construction.** There is no server to send anything to. The code
  is public and auditable.
- **No practical limit on photographs** on the desktop: binaries go to your
  disk rather than to a browser storage quota.
- **Runs on a phone too**, keeping the archive in browser storage where there is
  no folder to pick — and saying so plainly, because that storage is weaker.
- **Dates as they really are**: *about 1885*, *May 1912*, *before 1900*,
  *between 1900 and 1905* — with validation that understands uncertainty
  instead of demanding precision nobody has.
- **Two surnames**, kept separate, as Spanish records write them. It is what
  makes a line traceable.
- **Honest genealogy**: adoptions and guardianships distinguished from the
  biological line, unknown parents, unions between relatives. The application
  warns; it does not refuse.
- **Relationships are editable**: what kind of union it was and when it ended,
  who a child's parents are, and whether they descend from a couple or
  from one person. Anything that would corrupt the tree is refused, with a
  reason.
- **Interoperable**: GEDCOM 5.5.1 in and out, with the full cycle verified over
  a 10,000-person archive.
- **Accessible**: keyboard navigation, screen reader support, and a colour
  palette checked against WCAG AA by the test suite.
- **English and Spanish** interface.
- **Zero runtime dependencies.** Plain HTML, CSS and JavaScript — including the
  ZIP reader and writer, the GEDCOM parser and the tree layout engine.

---

## Where your archive is kept

There are two storage modes, chosen by what the browser can do — never by
sniffing which browser it is.

**On a desktop Chromium browser** (Chrome, Edge, Opera, Brave, Vivaldi) the
archive is **a folder you pick on your own disk**, through the File System
Access API. No size limit beyond the disk itself. You can see it in your file
manager, back it up and zip it with the tools you already use. This is the mode
the app prefers wherever it is available.

**Everywhere else** — Firefox, Safari, and every mobile browser — the archive is
kept in **storage the browser owns**. Everything works: editing, photographs,
search, import and export. But that storage is not a folder you can see, it goes
if you clear site data, and some browsers discard it after a few weeks without a
visit. The app says so, in the header and the first time you open an archive.

> On a phone, **export a ZIP now and again and keep it somewhere you chose.**
> That copy is the one that is really yours. Adding AncesTree to your home
> screen also makes the browser far less likely to discard its storage.

Either way the archive has the same shape, and a ZIP written on a phone opens on
a desktop and the other way round.

If the browser cannot do either — or cannot write files in chunks, which older
Safari could not — the app shows a requirements screen rather than starting.
A family archive app that sometimes loses the data is worse than one that
refuses to open.

---

## Running it

```bash
npm install
npm run dev      # http://localhost:5173/ances-tree/
npm test         # 265 tests, in a real browser
npm run lint
npm run build    # dist/, ready for GitHub Pages
```

The `/ances-tree/` in the URL is not optional: the build is configured for a
project page of that name.

### Trying it at scale

```bash
npm run stress:generate   # a synthetic 10,000-person archive
npm run stress:bench      # timings against the performance budget
```

The generator builds a structurally realistic tree — ten generations, fuzzy
dates, adoptions, unknown parents, marriages between cousins — so the numbers
mean something. Open the folder it writes with **Open a folder**.

---

## Layout

```
src/
├─ domain/     pure functions: model, dates, graph, validation, layout, GEDCOM
├─ storage/    disk, browser storage, ZIP, IndexedDB
├─ store/      state, mutations, events
└─ ui/         Web Components
```

Dependencies only ever point downwards: `ui → store → domain → storage`, and
`domain/` imports no DOM at all, which is what lets most of the code be tested
without a browser. ESLint enforces it.

---

## Licence

MIT. See [LICENSE](LICENSE).
