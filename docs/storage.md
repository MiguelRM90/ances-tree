# Storage

> Related documents: [data-model.md](data-model.md) (what gets stored) · [decisions.md](decisions.md) (technical and security decisions) · [architecture.md](architecture.md) (IndexedDB schema) · [gedcom-mapping.md](gedcom-mapping.md) · [vision.md](vision.md)

This document defines **the contract with the disk**: where the data lives, how it is written, and how it is transported.

---

## Principle

> **Where the app is served ≠ where the data lives.**

The application is a few hundred KB served from GitHub Pages and cached by the service worker. Family data lives **in a folder on the user's disk** and never passes through any server.

---

## Decision: two storage modes

> **This decision was reversed.** For most of the project the rule was "File System Access or it doesn't start", and mobile was left out entirely. The reason for the change is documented below, just like the layout engine, because the original reasoning is still correct — it just wasn't the only option available.

**There are two backends, chosen by capability:**

| Mode | Where the archive lives | Requires |
|---|---|---|
| `DISK` | A folder chosen by the user | `showDirectoryPicker`, `showSaveFilePicker`, `showOpenFilePicker` |
| `BROWSER` | Origin private file system | `navigator.storage.getDirectory` |

**`DISK` always wins when available.** They are not equivalent and are not presented as if they were.

### Why `DISK` alone was not enough

The original reasoning: 50,000 photos × ~3 MB ≈ **150 GB**. No browser quota covers that, and keeping someone's family archive in a store the browser can evict is unacceptable. This is still true.

What was not true was the conclusion that there was therefore nothing to offer on a phone. A typical family archive is hundreds of photos, not fifty thousand; and the use case that originated the project — *"zip it and send it to a relative"* — is served much better if that relative can open it on the phone in their hand.

### What made the change cheap

Nothing below the file pickers knows which mode it is in. Both backends return a `FileSystemDirectoryHandle`, and all the storage code was written against that interface: `getFileHandle`, `getDirectoryHandle`, `createWritable`, `entries`, `removeEntry`. `project-store.js`, `media.js`, and `media-cache.js` were not touched.

The real coupling was **nine calls** to the pickers, concentrated in four files. They now live in two modules:

- **`storage/backend.js`** — decides the mode. Nothing else branches on it.
- **`storage/file-dialog.js`** — `openFile`, `openFiles`, `saveFile`. File System Access where it exists; `<input type="file">` and `<a download>` where it doesn't.

### The save fallback does not accumulate in memory

`saveFile` without a save dialog does **not** build a Blob in RAM. It writes to a temporary file inside OPFS with `createWritable()` and downloads *that*, so a 2 GB ZIP with photos is written the same way on a phone as on a desktop: chunk by chunk. The cost is transient disk, not memory.

**The temporary file is not deleted when the download starts.** A blob URL over an OPFS file is a reference to those bytes, not a copy; deleting the file breaks the download in progress. It is left in place and swept on the next export, which also cleans up after a tab that was closed halfway. There is a test that fails — with `TypeError: Failed to fetch` — if the order is reversed.

### Honesty about durability

In `BROWSER` mode the application **says where the archive is**, more than once:

- Permanent badge in the header, in amber (not red: it is a caveat, not a failure)
- Full notice the first time an archive is opened on that device, shown only once, remembered in `localStorage`
- The deletion confirmation text says there is probably no other copy
- Clicking the badge shows: `persist()` status, space used and, if it has not been granted, the suggestion to add it to the home screen

`navigator.storage.persist()` is requested when the first archive is created. Chromium grants it silently to an installed or heavily used site; Safari has never granted it and discards storage after seven days without visits unless the site is on the home screen. That is why the answer is **reported, not trusted**: what truly preserves the data is exporting a ZIP.

### Support

Verified in August 2026:

| Browser | Mode |
|---|---|
| Chrome / Edge / Opera / Brave / Vivaldi (desktop) | `DISK` |
| Firefox (desktop) | `BROWSER` |
| Safari (macOS) | `BROWSER` |
| Chrome on Android, Safari on iOS | `BROWSER` |

There is one more requirement beyond the backend: **`FileSystemFileHandle.createWritable()`**. Safari had OPFS for two years before it could write in streaming mode outside a worker, and without that every photo and every export would have to be accumulated in memory. It is checked on the prototype, without writing anything.

If either of the two is missing, the **requirements screen** is shown and the app does not start. A family archive app that sometimes loses data is still worse than one that doesn't open.

Detection is always **by capability, never by user-agent**.

### What does disappear from the project

- Storing the graph in IndexedDB, which means encryption no longer collides with the indexes
- A second data model: `BROWSER` uses exactly the same folder structure

---

## Architecture: everything in the folder

**The entire project is a folder on disk.** There is no copy of the graph in the browser.

- `family.json` is read on open, lives in memory while working, and is rewritten on save
- Photos and documents are written once, when imported, and never touched again
- **IndexedDB stores exactly two things**: the list of recent projects and their `FileSystemDirectoryHandle`s. Never family data. It cannot be replaced by `localStorage`, because a handle is not serializable to text — the reasoning is in [architecture.md](architecture.md#why-indexeddb-and-not-localstorage)
- **`family.ged` is regenerated** alongside `family.json` on every export, so the folder always carries a copy readable by other programs

This is what lets the user back up, sync, and share their archive with the tools they already use, without asking the application for permission.

---

## Project folder structure

**Identical to the ZIP's.** It is the same thing: compressing the folder with the file explorer produces a ZIP that is valid for the app, and unzipping an exported ZIP produces a project folder that opens directly.

```
FamilySurname1/
├─ family.json           Full graph (see data-model.md)
├─ manifest.json         Project metadata and integrity
├─ family.ged            GEDCOM (generated on export; phase 2)
├─ photos/
│  ├─ a3/
│  │  └─ a3f2c1...e9.jpg
│  └─ b7/
│     └─ b7d4a0...11.jpg
├─ documents/
│  └─ 4c/
│     └─ 4c88fe...02.pdf
└─ backups/
   └─ family-2026-08-15T103000.json
```

### Hash-based names and sharding

Binaries are named by the **SHA-256 of their content**, spread across subfolders by the first two characters of the hash.

Four reasons, all practical:

1. **Free deduplication**: the same photo added twice takes up space once
2. **No name collisions**: two different `grandfather.jpg` files coexist without awkward renaming
3. **Neutralizes malicious names**: the user's file name never reaches the file system
4. **Performance**: a folder with 50,000 entries takes forever to list; sharding spreads it across 256

The original name is kept in `MediaObject.caption`, which is where it makes sense: it is information, not a path.

### `manifest.json`

```json
{
  "schemaVersion": 1,
  "projectId": "uuid",
  "title": "Familia Apellido1",
  "exportedAt": "2026-08-15T12:30:00.000Z",
  "appVersion": "0.1.0",
  "encrypted": false,
  "counts": { "persons": 412, "unions": 190, "media": 3204 },
  "totalBytes": 8123456789
}
```

It is read **before** anything else when opening or importing: it allows validating the version, warning about the size, and detecting that a folder or ZIP does not belong to this app without reading anything else.

---

## Remembering the folder between sessions

A `FileSystemDirectoryHandle` is **structured-cloneable**, so it is stored in IndexedDB and retrieved in the next session. The user does not have to look for their folder every time.

```js
// When opening a project
await idb.put('handles', { key: projectId, handle: dirHandle });

// On startup
const saved = await idb.get('handles', lastProjectId);
if (saved) {
  let perm = await saved.handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'prompt') {
    // requestPermission() requires a user gesture: it is triggered from the
    // "Reopen <project>" button, never automatically on load.
    perm = await saved.handle.requestPermission({ mode: 'readwrite' });
  }
  if (perm === 'granted') open(saved.handle);
}
```

**Cases to handle:**

| Situation | Behavior |
|---|---|
| Permission denied | The user is offered to choose the folder again. Nothing is lost |
| Folder moved or deleted | The handle fails on read. Clear message + folder picker |
| Folder modified externally | Reloaded from disk on reopen. No merge is attempted |
| Several tabs on the same project | Detected with a lock on `manifest.json`, and the second one opens read-only |

---

## Writing and autosave

### `family.json`

It is rewritten **in full** on every save. It is small —a few MB in the worst realistic case— and full writes avoid a whole class of partial-consistency bugs.

- **Debounce of ~2 seconds** after the last change, plus a forced save on `visibilitychange`
- `createWritable()` writes to a temporary file and commits on `close()`, so a failure mid-write does not corrupt the existing file
- Before overwriting, a copy is rotated into `backups/`, keeping the last `BACKUP_COPIES`

```js
const writable = await fileHandle.createWritable();
await writable.write(JSON.stringify(data, null, 2));
await writable.close(); // atomic commit
```

### Binaries

They are written only once, when imported, and never modified: they are immutable by definition, their name is their hash. Deleting a `MediaObject` marks the file as orphaned; actual cleanup is done in an explicit maintenance operation, never automatically.

### Photo import pipeline

1. Check size against the maximum **before reading anything**
2. Validate the real type by **magic bytes**, not by extension or `file.type`
3. Extract `takenDate` and orientation from EXIF
4. **Strip EXIF** by re-encoding through `canvas` → `toBlob()`, reapplying the orientation read in the previous step (otherwise portrait photos come out rotated)
5. Compute the SHA-256 of the result with `crypto.subtle.digest`
6. If the hash already exists, nothing is written: the `MediaObject` is reused
7. Write to `photos/<xx>/<hash>.<ext>` (keeping `.jpg`, `.png`, or `.webp`) and create the `MediaObject`

The reason for step 4 is in [decisions.md](decisions.md#photographs-exif-metadata): family photos carry geolocation.

### Document import pipeline

1. Check size against `MAX_DOCUMENT_BYTES` (100 MB) **before reading anything**
2. Validate the real type by checking binary signatures (%PDF, Office/OpenDocument zip containers, OLE2, RTF, plain text without null bytes) and allowed extension
3. Compute the SHA-256 of the file with `crypto.subtle.digest`
4. If the hash already exists, nothing is written: the `MediaObject` is reused
5. Write to `documents/<xx>/<hash>.<ext>` and create the `MediaObject` (`kind: 'DOCUMENT'`), keeping the original name in `caption`

---

## ZIP

With the folder on disk, the ZIP stops being the persistence and becomes **the sharing mechanism**: a single file to send to a relative.

In fact, compressing the folder with the file explorer produces an equally valid ZIP. The app's export adds the updated `manifest.json`, the GEDCOM, and the integrity check.

### No libraries

It is implemented on native APIs, per [decisions.md](decisions.md#zip):

- `CompressionStream('deflate-raw')` / `DecompressionStream('deflate-raw')`
- Own local header, central directory, and CRC32
- **ZIP64** whenever the total exceeds 4 GB or 65,535 entries, which with tens of thousands of photos is the normal case, not the exception

### Streaming write

The ZIP is written **directly to disk as it is generated**, so the project size is not limited by RAM:

```js
const handle = await showSaveFilePicker({ suggestedName: 'FamiliaApellido1.zip' });
const writable = await handle.createWritable();
// entries are written as they are compressed; there is never a complete Blob in memory
```

### Import

1. Read the **central directory** first: it gives the list of entries and their sizes without decompressing anything
2. Validate against `MAX_ZIP_ENTRIES` and `MAX_UNZIPPED_BYTES` before touching the content
3. Normalize **every** path with `safeEntryPath()` — it writes to the real disk, so Zip Slip is not theoretical
4. Read and validate `manifest.json` and `schemaVersion`
5. **Verify the CRC-32 of each entry** while writing to disk; report discrepancies as a warning, without aborting the import
6. Choose a merge strategy

> **Change from the initial design**: integrity verification uses the **CRC-32 that the ZIP format itself already carries per entry**, rather than recomputing the SHA-256 against the file name. Technical reason: WebCrypto **has no incremental SHA-256**, so hashing would force loading each whole file into memory; the CRC can be computed in streaming, so a 50 MB photo is verified without taking up RAM. Moreover, the CRC covers the real risk —file corruption— while the SHA against the name covered a much smaller one: someone renaming files by hand.

---

## Merge on import

Importing over a project that already has data is one of the things that is hardest to retrofit, so it is decided now. The app **always asks**, never decides on its own:

| Strategy | Status | Behavior |
|---|---|---|
| **Open as new project** | ✅ Implemented | Default. Extracted to an empty folder chosen by the user and touches nothing existing |
| **Merge** | ✅ Implemented | Adds what doesn't exist, matching by `id`. **On conflict the local version wins.** Missing binaries are copied first, then the graph is updated, so there is never a moment with a `MediaObject` pointing to a nonexistent file |
| **Replace** | ❌ Discarded | See below |

**Why "Replace" is discarded**: it is the only destructive one, it needed its own confirmation flow, and it is equivalent to "open as new project" followed by deleting the old folder from the file explorer — with the advantage that this way the user sees what they are deleting. It adds nothing that cannot be done better outside the app.

**On the conflict criterion in the merge**: the local copy wins. Overwriting an edit the user has just made here with an older copy from someone else's ZIP would be the worse surprise of the two.

On merging: `id`s are UUIDs, so two projects created separately **never coincide** even if they describe the same person. Merging by `id` only solves the real case —the same project that has diverged between two machines— and that is exactly what a family passing the ZIP around needs.

**Duplicate detection by name and date similarity is out of the MVP.** It is a data quality problem, not a storage one, and deserves its own review interface.

---

## PWA and service worker

Implemented from the start (see [decisions.md](decisions.md#pwa-from-day-one)).

- **The service worker caches only the app shell**: HTML, CSS, JS, icons. **Never user data** — the data is on disk, not in the cache
- *Cache-first* strategy for versioned assets, *network-first* for `index.html`
- The cache name carries the build version; when a new version activates, the previous ones are deleted
- When there is a new version the user is notified and the app reloads **only with their consent**: reloading during an unsaved edit is unacceptable
- `manifest.webmanifest` enables installation, which gives a dedicated window and icon

---

## Encryption

Taken from [decisions.md](decisions.md#encryption-optional-not-by-default), as far as it affects the disk:

- **Binaries are always stored in the clear.** They are the user's files, in their folder, opened with their photo viewer
- Encryption is **optional**, enabled with a passphrase, and **only affects `family.json`**
- If the project is encrypted, the `family.json` inside the ZIP is too, and `manifest.json` declares it with `"encrypted": true`. The manifest is never encrypted: it must be readable to know what is being opened
- The PBKDF2 salt is stored in `manifest.json`. It is not secret
- When working with the folder on disk, the graph lives decrypted in memory and is encrypted only on write. **There is no conflict with database indexes**, because there is no database: another simplification that comes from the decision above

---

## Configurable limits

All in `src/config/limits.js`, not scattered through the code:

| Constant | Initial value |
|---|---|
| `MAX_PHOTO_BYTES` | 50 MB |
| `MAX_DOCUMENT_BYTES` | 100 MB |
| `MAX_JSON_BYTES` | 200 MB |
| `MAX_GEDCOM_BYTES` | 200 MB |
| `MAX_UNZIPPED_BYTES` | 5 GB |
| `MAX_ZIP_ENTRIES` | 100,000 |
| `AUTOSAVE_DEBOUNCE_MS` | 2,000 |
| `BACKUP_COPIES` | 10 |
