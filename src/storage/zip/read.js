/**
 * ZIP reader.
 *
 * The central directory is read FIRST: it gives the full entry list and their
 * sizes without decompressing anything, which is what lets the limits be
 * enforced before touching any content (storage.md, import section).
 *
 * Entries are exposed as streams, so extracting a large photo never holds it
 * in memory.
 */

import {
  CD_SIG,
  EOCD_SIG,
  ZIP64_EOCD_SIG,
  ZIP64_LOCATOR_SIG,
  ZIP64_EXTRA_ID,
  METHOD_STORE,
  METHOD_DEFLATE,
  MAX16,
  MAX32,
  LOCAL_HEADER_SIZE,
  CD_HEADER_SIZE,
  EOCD_SIZE,
  ZIP64_LOCATOR_SIZE,
  decodeName,
  inflateRawStream,
  fromDosDateTime,
  safeEntryPath,
} from './format.js';

export class ZipError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * @typedef {Object} ZipEntry
 * @property {string} path            already validated with safeEntryPath()
 * @property {number} compressedSize
 * @property {number} uncompressedSize
 * @property {number} method
 * @property {number} crc
 * @property {Date}   date
 * @property {number} localOffset
 * @property {boolean} isDirectory
 */

/**
 * Opens an archive and reads its central directory.
 * @param {Blob} blob
 * @returns {Promise<{entries: ZipEntry[], totalBytes: number, stream: Function, bytes: Function}>}
 */
export async function openArchive(blob) {
  const eocd = await findEocd(blob);
  const entries = await readCentralDirectory(blob, eocd);

  return {
    entries,
    totalBytes: entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0),
    stream: (entry) => entryStream(blob, entry),
    bytes: (entry) => entryBytes(blob, entry),
  };
}

/** Finds an entry by exact path, or null. */
export const findEntry = (archive, path) =>
  archive.entries.find((entry) => entry.path === path) ?? null;

// --- End of central directory ----------------------------------------------

async function findEocd(blob) {
  // The EOCD sits at the very end, unless there is a trailing comment (max 64K).
  const tailSize = Math.min(blob.size, EOCD_SIZE + MAX16);
  const tail = new DataView(await blob.slice(blob.size - tailSize).arrayBuffer());

  for (let at = tail.byteLength - EOCD_SIZE; at >= 0; at -= 1) {
    if (tail.getUint32(at, true) !== EOCD_SIG) continue;

    const base = {
      count: tail.getUint16(at + 10, true),
      cdSize: tail.getUint32(at + 12, true),
      cdOffset: tail.getUint32(at + 16, true),
    };

    const locatorAt = at - ZIP64_LOCATOR_SIZE;
    const hasZip64 = locatorAt >= 0 && tail.getUint32(locatorAt, true) === ZIP64_LOCATOR_SIG;

    if (!hasZip64) return base;

    const zip64Offset = Number(tail.getBigUint64(locatorAt + 8, true));
    return readZip64Eocd(blob, zip64Offset, base);
  }

  throw new ZipError('NOT_A_ZIP', 'No ZIP end-of-central-directory record found');
}

async function readZip64Eocd(blob, offset, fallback) {
  const view = new DataView(await blob.slice(offset, offset + 56).arrayBuffer());
  if (view.getUint32(0, true) !== ZIP64_EOCD_SIG) return fallback;

  return {
    count: Number(view.getBigUint64(32, true)),
    cdSize: Number(view.getBigUint64(40, true)),
    cdOffset: Number(view.getBigUint64(48, true)),
  };
}

// --- Central directory -----------------------------------------------------

async function readCentralDirectory(blob, eocd) {
  const buffer = await blob.slice(eocd.cdOffset, eocd.cdOffset + eocd.cdSize).arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const entries = [];
  let at = 0;

  while (at + CD_HEADER_SIZE <= view.byteLength) {
    if (view.getUint32(at, true) !== CD_SIG) break;

    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);

    const name = decodeName(bytes.subarray(at + CD_HEADER_SIZE, at + CD_HEADER_SIZE + nameLength));
    const extra = bytes.subarray(
      at + CD_HEADER_SIZE + nameLength,
      at + CD_HEADER_SIZE + nameLength + extraLength,
    );

    const entry = {
      compressedSize: view.getUint32(at + 20, true),
      uncompressedSize: view.getUint32(at + 24, true),
      localOffset: view.getUint32(at + 42, true),
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      date: fromDosDateTime(view.getUint16(at + 14, true), view.getUint16(at + 12, true)),
      isDirectory: name.endsWith('/'),
    };

    applyZip64Extra(entry, extra);

    // Zip Slip is not theoretical here: we write to the real disk.
    entry.path = entry.isDirectory ? name.slice(0, -1) : safeEntryPath(name);

    entries.push(entry);
    at += CD_HEADER_SIZE + nameLength + extraLength + commentLength;
  }

  if (entries.length === 0 && eocd.count > 0) {
    throw new ZipError('BAD_CENTRAL_DIRECTORY', 'The central directory could not be read');
  }

  return entries;
}

/**
 * Reads back the values that overflowed 32 bits. They appear in a fixed order
 * and only when the base field held the 0xFFFFFFFF sentinel.
 */
function applyZip64Extra(entry, extra) {
  const needed =
    entry.uncompressedSize === MAX32 ||
    entry.compressedSize === MAX32 ||
    entry.localOffset === MAX32;
  if (!needed || extra.length === 0) return;

  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let at = 0;

  while (at + 4 <= extra.length) {
    const id = view.getUint16(at, true);
    const size = view.getUint16(at + 2, true);

    if (id === ZIP64_EXTRA_ID) {
      let field = at + 4;
      if (entry.uncompressedSize === MAX32) {
        entry.uncompressedSize = Number(view.getBigUint64(field, true));
        field += 8;
      }
      if (entry.compressedSize === MAX32) {
        entry.compressedSize = Number(view.getBigUint64(field, true));
        field += 8;
      }
      if (entry.localOffset === MAX32) {
        entry.localOffset = Number(view.getBigUint64(field, true));
      }
      return;
    }

    at += 4 + size;
  }
}

// --- Entry payload ---------------------------------------------------------

/**
 * The local header repeats the name and extra field, and their lengths can
 * differ from the central directory ones, so the data offset is resolved here
 * rather than assumed.
 */
async function dataOffset(blob, entry) {
  const header = new DataView(
    await blob.slice(entry.localOffset, entry.localOffset + LOCAL_HEADER_SIZE).arrayBuffer(),
  );

  const nameLength = header.getUint16(26, true);
  const extraLength = header.getUint16(28, true);

  return entry.localOffset + LOCAL_HEADER_SIZE + nameLength + extraLength;
}

async function entryStream(blob, entry) {
  const start = await dataOffset(blob, entry);
  const slice = blob.slice(start, start + entry.compressedSize);

  if (entry.method === METHOD_STORE) return slice.stream();
  if (entry.method === METHOD_DEFLATE) return inflateRawStream(slice.stream());

  throw new ZipError('UNSUPPORTED_METHOD', `Compression method ${entry.method} is not supported`);
}

async function entryBytes(blob, entry) {
  const stream = await entryStream(blob, entry);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
