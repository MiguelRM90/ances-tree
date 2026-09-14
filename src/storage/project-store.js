/**
 * Reading and writing the project folder (storage.md).
 *
 * The WHOLE project is a folder. family.json is read when opening, kept in
 * memory while working, and rewritten on save.
 *
 * Nothing here knows whether that folder is on the user's disk or inside the
 * browser's own storage. It is handed a FileSystemDirectoryHandle and both
 * backends provide one (backend.js).
 */

import { parseProject, validateProject } from '../domain/model/schema.js';
import { createProject, APP_VERSION } from '../domain/model/factories.js';
import { MAX_JSON_BYTES, BACKUP_COPIES } from '../config/limits.js';
import { StorageError } from './error.js';
import { isBrowserStorage } from './backend.js';
import { createBrowserFolder } from './opfs.js';
import { FAMILY_FILE, MANIFEST_FILE, PHOTOS_DIR, DOCUMENTS_DIR, BACKUPS_DIR } from './names.js';

export { StorageError };
export { FAMILY_FILE, MANIFEST_FILE, PHOTOS_DIR, DOCUMENTS_DIR, BACKUPS_DIR };

/**
 * A folder for a project that does not exist yet.
 *
 * On disk the user picks one, which is also how they decide where their archive
 * lives. In browser storage there is nothing to pick, so one is created from the
 * title — the price of the app running at all where there is no folder picker.
 *
 * Requires a user gesture.
 */
export async function newDirectory(title) {
  if (isBrowserStorage()) return createBrowserFolder(title);
  return pickDirectory();
}

/** Opens the folder picker. DISK mode only. Requires a user gesture. */
export async function pickDirectory() {
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite', id: 'ancestree-project' });
  } catch (cause) {
    if (cause.name === 'AbortError') return null; // user cancelled
    throw new StorageError('PICKER_FAILED', 'Could not open the folder picker', cause);
  }
}

/** Creates the structure of a new project inside an empty folder. */
export async function createProjectIn(dirHandle, title) {
  const existing = await fileIfExists(dirHandle, FAMILY_FILE);
  if (existing) {
    throw new StorageError('NOT_EMPTY', 'That folder already contains an AncesTree project');
  }

  const project = createProject({ title });
  await dirHandle.getDirectoryHandle(PHOTOS_DIR, { create: true });
  await dirHandle.getDirectoryHandle(DOCUMENTS_DIR, { create: true });
  await dirHandle.getDirectoryHandle(BACKUPS_DIR, { create: true });
  await writeProject(dirHandle, project);

  return project;
}

/**
 * Loads an existing project.
 *
 * A folder without family.json is not one of ours, which is the only check
 * that matters while the schema is still being designed.
 */
export async function loadProject(dirHandle) {
  // No version check while the schema is still being designed: every field so
  // far is additive with a safe default, so a folder written by an older build
  // opens fine. The refusal comes back when v1 ships.
  const file = await fileIfExists(dirHandle, FAMILY_FILE);
  if (!file) throw new StorageError('NOT_A_PROJECT', 'No family.json in that folder');

  if (file.size > MAX_JSON_BYTES) {
    throw new StorageError('TOO_LARGE', 'family.json is larger than the allowed maximum');
  }

  const result = parseProject(await file.text());
  if (!result.ok) {
    throw new StorageError('INVALID_PROJECT', result.errors.map((e) => e.message).join('; '));
  }

  return result.data;
}

/**
 * Writes family.json in full, plus the manifest.
 *
 * The whole file is rewritten on every save: it is small, and a complete write
 * avoids an entire class of partial-consistency bugs. createWritable() writes
 * to a temporary file and commits on close(), so a failure half-way does not
 * corrupt the existing file.
 */
export async function writeProject(dirHandle, project) {
  const shaped = validateProject(project);
  if (!shaped.ok) {
    throw new StorageError('INVALID_PROJECT', shaped.errors.map((e) => e.message).join('; '));
  }

  await rotateBackup(dirHandle);

  const payload = {
    ...project,
    project: { ...project.project, updatedAt: new Date().toISOString() },
  };

  await writeFile(dirHandle, FAMILY_FILE, JSON.stringify(payload, null, 2));
  await writeFile(dirHandle, MANIFEST_FILE, JSON.stringify(buildManifest(payload), null, 2));

  return payload;
}

export function buildManifest(project) {
  return {
    schemaVersion: project.schemaVersion,
    projectId: project.project.id,
    title: project.project.title,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    encrypted: false,
    counts: {
      persons: project.persons.length,
      unions: project.unions.length,
      parentChildren: project.parentChildren.length,
      media: project.media.length,
    },
  };
}

/** Rotating copy before overwriting. Keeps the last BACKUP_COPIES. */
async function rotateBackup(dirHandle) {
  const current = await fileIfExists(dirHandle, FAMILY_FILE);
  if (!current) return;

  const backups = await dirHandle.getDirectoryHandle(BACKUPS_DIR, { create: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  await writeFile(backups, `family-${stamp}.json`, await current.text());

  const names = [];
  for await (const [name, entry] of backups.entries()) {
    if (entry.kind === 'file' && name.startsWith('family-')) names.push(name);
  }
  names.sort();
  for (const name of names.slice(0, Math.max(0, names.length - BACKUP_COPIES))) {
    await backups.removeEntry(name);
  }
}

async function writeFile(dirHandle, name, contents) {
  const handle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close(); // atomic commit
}

async function fileIfExists(dirHandle, name) {
  try {
    const handle = await dirHandle.getFileHandle(name);
    return await handle.getFile();
  } catch (cause) {
    if (cause.name === 'NotFoundError') return null;
    throw new StorageError('READ_FAILED', `Could not read ${name}`, cause);
  }
}
