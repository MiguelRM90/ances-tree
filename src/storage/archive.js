/**
 * ZIP export and import for a project folder (storage.md, ZIP section).
 *
 * With the project already living as a folder on disk, the ZIP is not the
 * persistence layer — it is the way to hand the archive to a relative as a
 * single file. Compressing the folder from the file explorer produces an
 * equally valid archive; what the app adds is a fresh manifest, the GEDCOM
 * (phase 2) and integrity checking.
 */

import { ZipWriter } from './zip/write.js';
import { openArchive, findEntry, ZipError } from './zip/read.js';
import { Crc32 } from './zip/crc32.js';
import { StorageError } from './error.js';
import { openFile, saveFile } from './file-dialog.js';
import {
  FAMILY_FILE,
  MANIFEST_FILE,
  GEDCOM_FILE,
  PHOTOS_DIR,
  DOCUMENTS_DIR,
  BACKUPS_DIR,
} from './names.js';
import { buildManifest, loadProject, writeProject, newDirectory } from './project-store.js';
import { parseProject } from '../domain/model/schema.js';
import { exportGedcom } from '../domain/gedcom/export.js';
import { importGedcom } from '../domain/gedcom/import.js';
import { decodeGedcom, readFileWithEncoding } from '../domain/gedcom/parser.js';
import {
  MAX_ZIP_ENTRIES,
  MAX_UNZIPPED_BYTES,
  MAX_GEDCOM_BYTES,
  MAX_JSON_BYTES,
} from '../config/limits.js';

export { GEDCOM_FILE, decodeGedcom, readFileWithEncoding };

const ZIP_TYPES = [{ description: 'AncesTree archive', accept: { 'application/zip': ['.zip'] } }];
const GEDCOM_TYPES = [
  { description: 'GEDCOM file', accept: { 'text/vnd.familysearch.gedcom': ['.ged'] } },
];

/**
 * Writes family.ged next to family.json, so the project folder always carries a
 * copy other genealogy software can read. Called on save and included in the
 * ZIP; the JSON remains the source of truth.
 */
export async function writeGedcom(dirHandle, project) {
  const handle = await dirHandle.getFileHandle(GEDCOM_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(exportGedcom(project));
  await writable.close();
}

/**
 * Reads a .ged the user picks and turns it into a project, without writing
 * anything. The caller shows the summary and decides what to do with it.
 */
export async function pickAndReadGedcom() {
  const file = await openFile({ types: GEDCOM_TYPES });
  if (!file) return null;

  if (file.size > MAX_GEDCOM_BYTES) {
    throw new StorageError('TOO_LARGE', 'That GEDCOM is larger than the allowed maximum');
  }

  const text = await readFileWithEncoding(file);
  const result = importGedcom(text, { title: file.name.replace(/\.ged$/i, '') });

  if (result.counts.persons === 0) {
    throw new StorageError('EMPTY_GEDCOM', 'No people found in that file');
  }

  return { ...result, fileName: file.name };
}

/** Exports a standalone .ged to wherever the platform can put one. Needs a gesture. */
export async function exportGedcomFile(project) {
  const result = await saveFile({
    suggestedName: `${safeFileName(project.project.title)}.ged`,
    types: GEDCOM_TYPES,
    mime: 'text/plain',
    write: async (writable) => {
      await writable.write(exportGedcom(project));
      await writable.close();
    },
  });

  return result.ok ? { ok: true, persons: project.persons.length } : result;
}

// --- Export ----------------------------------------------------------------

/**
 * Writes the whole project to a ZIP.
 *
 * The archive is streamed rather than assembled in memory, so its size is
 * bounded by storage and not by RAM — on a phone as much as on a desktop, since
 * the download fallback streams into a scratch file too (file-dialog.js).
 * Requires a user gesture.
 *
 * @returns {Promise<{ok: boolean, cancelled?: boolean, entries?: number}>}
 */
export async function exportProject(dirHandle, project) {
  let entries = 0;

  const result = await saveFile({
    suggestedName: `${safeFileName(project.project.title)}.zip`,
    types: ZIP_TYPES,
    mime: 'application/zip',
    write: async (writable) => {
      const zip = new ZipWriter(writable);
      const encoder = new TextEncoder();

      // The manifest goes first so a reader can identify the archive without
      // decompressing anything else.
      await zip.addBytes(MANIFEST_FILE, encoder.encode(stringify(buildManifest(project))));
      await zip.addBytes(FAMILY_FILE, encoder.encode(stringify(project)));

      // Regenerated rather than copied: whatever is stored may predate the last
      // edits, and an archive handed to a relative should carry a current GEDCOM.
      await zip.addBytes(GEDCOM_FILE, encoder.encode(exportGedcom(project)));
      entries = 3;

      for await (const { path, handle } of walk(dirHandle)) {
        // Skipped: rebuilt on export, or local history that should not travel.
        if (path === FAMILY_FILE || path === MANIFEST_FILE || path === GEDCOM_FILE) continue;
        if (path === BACKUPS_DIR || path.startsWith(`${BACKUPS_DIR}/`)) continue;

        await zip.addFile(path, await handle.getFile());
        entries += 1;
      }

      await zip.close();
    },
  });

  if (result.ok) {
    await writeGedcom(dirHandle, project).catch(() => {});
  }

  return result.ok ? { ok: true, entries } : result;
}

async function* walk(dirHandle, prefix = '') {
  for await (const [name, entry] of dirHandle.entries()) {
    const path = prefix === '' ? name : `${prefix}/${name}`;
    if (entry.kind === 'file') yield { path, handle: entry };
    else yield* walk(entry, path);
  }
}

// --- Import ----------------------------------------------------------------

/** Opens the file picker for an archive. Requires a user gesture. */
export function pickArchive() {
  return openFile({ types: ZIP_TYPES });
}

/**
 * Reads the central directory and family.json without extracting anything, so
 * the user can be shown what they are about to import and the limits can be
 * enforced before any content is touched.
 *
 * @returns {Promise<{archive: object, manifest: object|null, project: object, counts: object}>}
 */
export async function inspectArchive(file) {
  let archive;
  try {
    archive = await openArchive(file);
  } catch (cause) {
    if (cause instanceof ZipError) throw new StorageError(cause.code, cause.message, cause);
    throw cause;
  }

  if (archive.entries.length > MAX_ZIP_ENTRIES) {
    throw new StorageError('TOO_MANY_ENTRIES', `Archive holds more than ${MAX_ZIP_ENTRIES} files`);
  }

  // A zip bomb expands to gigabytes from a few kilobytes: the declared sizes
  // are checked before anything is decompressed.
  if (archive.totalBytes > MAX_UNZIPPED_BYTES) {
    throw new StorageError('TOO_LARGE', 'Archive expands beyond the allowed maximum');
  }

  const familyEntry = findEntry(archive, FAMILY_FILE);
  if (!familyEntry) {
    throw new StorageError('NOT_A_PROJECT', 'This ZIP has no family.json at its root');
  }

  const manifest = await readJsonEntry(archive, MANIFEST_FILE);
  let familyBytes;
  try {
    familyBytes = await archive.bytes(familyEntry, { maxBytes: MAX_JSON_BYTES });
  } catch (cause) {
    if (cause instanceof ZipError) throw new StorageError(cause.code, cause.message, cause);
    throw cause;
  }
  const parsed = parseProject(new TextDecoder().decode(familyBytes));
  if (!parsed.ok) {
    const code = parsed.errors.some((e) => e.code === 'FUTURE_VERSION')
      ? 'FUTURE_VERSION'
      : 'INVALID_PROJECT';
    throw new StorageError(code, parsed.errors.map((e) => e.message).join('; '));
  }

  return {
    archive,
    manifest,
    project: parsed.data,
    counts: {
      persons: parsed.data.persons.length,
      unions: parsed.data.unions.length,
      media: parsed.data.media.length,
      files: archive.entries.length,
      bytes: archive.totalBytes,
    },
  };
}

/**
 * Writes an already-built project into a folder the user picks.
 *
 * Used by the GEDCOM import: a .ged carries no photos, so there is nothing to
 * extract — only a graph to save somewhere.
 */
export async function createProjectFrom(project) {
  const dirHandle = await newDirectory(project.project.title);
  if (!dirHandle) return { ok: false, cancelled: true };

  if (await hasEntry(dirHandle, FAMILY_FILE)) {
    throw new StorageError('NOT_EMPTY', 'That folder already contains an AncesTree project');
  }

  await dirHandle.getDirectoryHandle(PHOTOS_DIR, { create: true });
  await dirHandle.getDirectoryHandle(DOCUMENTS_DIR, { create: true });
  await dirHandle.getDirectoryHandle(BACKUPS_DIR, { create: true });

  const saved = await writeProject(dirHandle, project);
  return { ok: true, project: saved, dirHandle };
}

/**
 * Extracts every entry into a folder chosen by the user, then opens it.
 *
 * This is the default strategy: it never touches anything that already exists.
 */
export async function importAsNewProject(inspection) {
  const dirHandle = await newDirectory(inspection.project.project.title);
  if (!dirHandle) return { ok: false, cancelled: true };

  if (await hasEntry(dirHandle, FAMILY_FILE)) {
    throw new StorageError('NOT_EMPTY', 'That folder already contains an AncesTree project');
  }

  const warnings = await extractAll(inspection.archive, dirHandle);
  const project = await loadProject(dirHandle);

  return { ok: true, project, dirHandle, warnings };
}

/**
 * Copies the media the current project is missing and returns the merged graph.
 *
 * Files are written before the graph is updated, so there is never a moment
 * where a MediaObject points at a file that is not on disk yet.
 */
export async function importByMerging(inspection, dirHandle, currentProject) {
  const { archive, project: incoming } = inspection;
  const known = new Set(currentProject.media.map((item) => item.path));
  const warnings = [];
  const budget = { remaining: MAX_UNZIPPED_BYTES };

  for (const item of incoming.media) {
    if (!item.path || known.has(item.path)) continue;
    const entry = findEntry(archive, item.path);
    if (!entry) {
      warnings.push({ path: item.path, reason: 'MISSING_IN_ARCHIVE' });
      continue;
    }
    warnings.push(...(await extractEntry(archive, entry, dirHandle, budget)));
  }

  return { ok: true, incoming, warnings };
}

// --- Extraction ------------------------------------------------------------

async function extractAll(archive, dirHandle) {
  const warnings = [];
  const budget = { remaining: MAX_UNZIPPED_BYTES };

  for (const entry of archive.entries) {
    if (entry.isDirectory) continue;
    warnings.push(...(await extractEntry(archive, entry, dirHandle, budget)));
  }

  return warnings;
}

/**
 * Writes one entry to disk, verifying its CRC-32 as it streams.
 *
 * Integrity is checked with the CRC the ZIP format already carries rather than
 * by re-hashing the file: it can be computed incrementally, so a 50 MB photo is
 * verified without ever being held in memory. WebCrypto has no streaming
 * SHA-256, so hash checking would have meant buffering every file.
 */
async function extractEntry(archive, entry, dirHandle, budget = { remaining: MAX_UNZIPPED_BYTES }) {
  const stream = await archive.stream(entry, { maxBytes: budget.remaining });
  const fileHandle = await resolveFile(dirHandle, entry.path);
  const writable = await fileHandle.createWritable();

  const crc = new Crc32();
  const tap = new TransformStream({
    transform(chunk, controller) {
      budget.remaining -= chunk.byteLength;
      if (budget.remaining < 0) {
        controller.error(
          new StorageError('TOO_LARGE', 'Archive expands beyond the allowed maximum'),
        );
        return;
      }
      crc.update(chunk);
      controller.enqueue(chunk);
    },
  });

  try {
    await stream.pipeThrough(tap).pipeTo(writable);
  } catch (cause) {
    if (cause instanceof ZipError) throw new StorageError(cause.code, cause.message, cause);
    throw cause;
  }

  // A mismatch is reported, not thrown: one damaged photo must not abort the
  // import of an entire family archive.
  return crc.value === entry.crc ? [] : [{ path: entry.path, reason: 'CRC_MISMATCH' }];
}

/** Creates the intermediate folders and returns the file handle. */
async function resolveFile(dirHandle, path) {
  const segments = path.split('/');
  const fileName = segments.pop();

  let current = dirHandle;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }

  return current.getFileHandle(fileName, { create: true });
}

// --- Helpers ---------------------------------------------------------------

async function readJsonEntry(archive, path) {
  const entry = findEntry(archive, path);
  if (!entry) return null;
  try {
    return JSON.parse(
      new TextDecoder().decode(await archive.bytes(entry, { maxBytes: MAX_JSON_BYTES })),
    );
  } catch {
    return null;
  }
}

async function hasEntry(dirHandle, name) {
  try {
    await dirHandle.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

const stringify = (value) => JSON.stringify(value, null, 2);

/** Keeps the family name recognisable while staying a valid file name. */
function safeFileName(title) {
  const cleaned = title.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim();
  return cleaned === '' ? 'family' : cleaned;
}
