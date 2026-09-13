/**
 * Bounded cache of object URLs for photos.
 *
 * Two reasons this has to exist rather than each component making its own URL:
 *
 *  - A blob URL keeps its blob alive until it is revoked. Creating one per
 *    render, as the tree repaints on every focus change, leaks the whole photo
 *    each time (decisions.md, memory section).
 *  - Photos are immutable — the file name is the hash of the contents — so a
 *    URL stays valid for the whole session and is safe to reuse.
 *
 * The cache is bounded because an archive can hold tens of thousands of photos
 * and holding every one in memory would defeat the point of keeping them on
 * disk. Least-recently-used entries are revoked as new ones arrive.
 */

import { readMediaFile } from './media.js';

const MAX_ENTRIES = 120;

/** Map preserves insertion order, which is all an LRU needs. */
const urls = new Map();
const pending = new Map();
let currentDirHandle = null;

/**
 * Resolves a project-relative path to an object URL.
 * @returns {Promise<string|null>} null when the file is missing from disk
 */
export function mediaUrl(dirHandle, path) {
  if (!dirHandle || !path) return Promise.resolve(null);

  if (dirHandle !== currentDirHandle) {
    releaseAll();
    currentDirHandle = dirHandle;
  }

  const cached = urls.get(path);
  if (cached) {
    // Re-inserting moves it to the end: most recently used.
    urls.delete(path);
    urls.set(path, cached);
    return Promise.resolve(cached);
  }

  // Several callers can ask for the same file in one repaint; they share a read.
  const inFlight = pending.get(path);
  if (inFlight) return inFlight;

  const request = load(dirHandle, path).finally(() => pending.delete(path));
  pending.set(path, request);
  return request;
}

export const photoUrl = mediaUrl;
export const documentUrl = mediaUrl;

/**
 * Triggers a download for an attached media item (photo or document) with its caption name.
 */
export async function downloadMediaFile(dirHandle, mediaItem) {
  if (!dirHandle || !mediaItem?.path) return false;
  const file = await readMediaFile(dirHandle, mediaItem.path);
  const blob = mediaItem.mime ? new Blob([file], { type: mediaItem.mime }) : file;
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = mediaItem.caption || mediaItem.path.split('/').pop() || 'download';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

async function load(dirHandle, path) {
  let url;
  try {
    url = URL.createObjectURL(await readMediaFile(dirHandle, path));
  } catch {
    // A photo missing from disk is reported by the review panel, not by
    // throwing in the middle of a repaint.
    return null;
  }

  urls.set(path, url);
  evictOverflow();
  return url;
}

function evictOverflow() {
  while (urls.size > MAX_ENTRIES) {
    const [oldest, url] = urls.entries().next().value;
    URL.revokeObjectURL(url);
    urls.delete(oldest);
  }
}

/** Drops one entry, for a photo that has just been deleted or replaced. */
export function release(path) {
  const url = urls.get(path);
  if (!url) return;
  URL.revokeObjectURL(url);
  urls.delete(path);
}

/** Called when a project closes: nothing cached is valid any more. */
export function releaseAll() {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  currentDirHandle = null;
}
