---
name: storage-archive
description: >-
  Procedures for managing dual-mode persistence (DISK vs BROWSER/OPFS), project folder structure,
  streaming ZIP creation/extraction, IndexedDB handle management, and automated backups.
  Use when touching persistence layers, handling file handles, or debugging archive operations.
---

# Storage & Archive Skill

This skill governs the persistence architecture in `src/storage/`.

## The Dual-Mode Architecture

The application operates in one of two modes based strictly on browser capability:

| Mode | Target Location | Requirement | Behavior |
|---|---|---|---|
| `DISK` | User-selected directory on local disk | `showDirectoryPicker`, `showSaveFilePicker` (Chromium desktop) | Infinite space, persistent, user-visible folder. Preferred mode. |
| `BROWSER` | Origin Private File System (OPFS) | `navigator.storage.getDirectory` (Firefox, Safari, mobile) | Sandboxed in browser storage, exportable via ZIP. |

### The Isolation Rule
- **Mode decisions occur ONLY in `src/storage/backend.js`**.
- File dialogues and download fallbacks are abstracted ONLY in `src/storage/file-dialog.js`.
- All other modules (`project-store.js`, `media.js`, `media-cache.js`, `archive.js`) interact with standard `FileSystemDirectoryHandle` and must NOT branch based on device or browser mode.

## Project Folder & ZIP Structure
Every archive maintains an identical physical hierarchy whether on disk or zipped:
```
FamilyProject/
├── family.json     # Graph entities, focal person, app metadata
├── manifest.json   # Schema version and integrity hashes
├── family.ged      # Interoperability GEDCOM export
├── photos/         # Binary photos sharded by hash
├── documents/      # PDF/document attachments
└── backups/        # Rotated automatically on save (max depth in limits.js)
```

## Pure JS Streaming ZIP (`src/storage/zip/`)
- `write.js`: Uses native `CompressionStream('deflate-raw')` and computes CRC32. Writes files chunk-by-chunk directly into the output stream without buffering multi-gigabyte archives into RAM.
- `read.js`: Reads the ZIP central directory first to parse structure, then decompresses entries with `safeEntryPath` checks to prevent Zip Slip directory traversal vulnerabilities.
- **Temporary file hygiene**: Fallback file downloads use a temporary file inside OPFS. Never delete the temp file immediately when triggering download; blob URLs reference the OPFS file handle and deletion cancels active downloads. Temp files are swept on next export.

## IndexedDB Boundaries (`src/storage/idb.js`)
- IndexedDB stores ONLY:
  1. Serialized `FileSystemHandle` instances for recently opened projects.
  2. Recent project registry and metadata.
  3. UI preferences (e.g. locale).
- **NEVER store family graph data or entities inside IndexedDB**. `family.json` is the sole source of truth.

## Verification
- Run tests: `npm test test/archive.test.js test/browser-storage.test.js test/media.test.js`
- Reference specification: `docs/storage.md`

