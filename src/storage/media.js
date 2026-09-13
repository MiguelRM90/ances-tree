/**
 * Photo import pipeline (storage.md, importing a photo).
 *
 *   1. size checked before anything is read
 *   2. type validated by magic bytes, never by extension or file.type
 *   3. takenDate lifted out of the EXIF before it is discarded
 *   4. metadata stripped by re-encoding through a canvas
 *   5. SHA-256 of the result becomes the file name
 *   6. an identical photo already present is reused, not written again
 *   7. written to photos/<xx>/<hash>.<ext>
 */

import { createMediaObject, MediaKind } from '../domain/model/factories.js';
import { parseDate } from '../domain/date/parse.js';
import { StorageError } from './error.js';
import { openFiles } from './file-dialog.js';
import { PHOTOS_DIR } from './names.js';
import { MAX_PHOTO_BYTES } from '../config/limits.js';

/**
 * Real signatures, checked against the file's own bytes. Both the extension
 * and file.type are supplied by whoever made the file, so neither is evidence.
 */
const SIGNATURES = [
  { mime: 'image/jpeg', ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  {
    mime: 'image/webp',
    ext: 'webp',
    bytes: [0x52, 0x49, 0x46, 0x46],
    at: 0,
    also: { at: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  },
];

const GEDCOM_MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

const IMAGE_TYPES = [
  {
    description: 'Photographs',
    accept: { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] },
  },
];

/**
 * Opens the picker for one or more photos. Requires a user gesture.
 *
 * On a phone the fallback input offers the camera alongside the gallery, which
 * is how a photograph of a photograph gets into the archive without a computer
 * anywhere in the chain.
 */
export function pickImages() {
  return openFiles({ types: IMAGE_TYPES });
}

/** @returns {{mime: string, ext: string}|null} */
export async function detectImageType(file) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());

  return (
    SIGNATURES.find(
      (signature) =>
        matches(head, signature.bytes, signature.at ?? 0) &&
        (!signature.also || matches(head, signature.also.bytes, signature.also.at)),
    ) ?? null
  );
}

const matches = (head, bytes, at) => bytes.every((byte, index) => head[at + index] === byte);

/**
 * Imports one photo into the project folder.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {File} file
 * @param {object[]} existingMedia   to reuse a photo that is already here
 * @param {{stripExif?: boolean}} options
 * @returns {Promise<{media: object, reused: boolean}>}
 */
export async function importPhoto(dirHandle, file, existingMedia = [], { stripExif = true } = {}) {
  if (file.size > MAX_PHOTO_BYTES) {
    throw new StorageError('PHOTO_TOO_LARGE', `${file.name} is larger than the allowed maximum`);
  }

  const type = await detectImageType(file);
  if (!type) {
    throw new StorageError('NOT_AN_IMAGE', `${file.name} is not a JPEG, PNG or WebP image`);
  }

  // Read before stripping: the capture date is genealogical information and
  // must not be thrown away with the rest of the metadata.
  const takenDate = await readExifDate(file);

  const prepared = stripExif ? await stripMetadata(file) : { blob: file, ...type };
  const hash = await sha256Hex(prepared.blob);

  const path = `${PHOTOS_DIR}/${hash.slice(0, 2)}/${hash}.${prepared.ext}`;
  const already = existingMedia.find((item) => item.hash === hash);
  if (already) return { media: already, reused: true };

  const size = await measure(prepared.blob);
  await writeInto(dirHandle, path, prepared.blob);

  return {
    media: createMediaObject({
      kind: MediaKind.PHOTO,
      path,
      hash,
      mime: prepared.mime,
      bytes: prepared.blob.size,
      width: size.width,
      height: size.height,
      caption: file.name,
      takenDate,
      exifStripped: stripExif,
    }),
    reused: false,
  };
}

/**
 * Re-encodes through a canvas, which discards every metadata block.
 *
 * imageOrientation: 'from-image' bakes the EXIF rotation into the pixels
 * first. Without it, stripping the metadata would also strip the orientation
 * flag and every portrait photo would come out lying on its side.
 */
async function stripMetadata(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    return { blob, mime: 'image/jpeg', ext: 'jpg' };
  } finally {
    bitmap.close();
  }
}

async function measure(blob) {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

export async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Reads one file back out of the project folder. */
export async function readMediaFile(dirHandle, path) {
  const segments = path.split('/');
  const name = segments.pop();

  let current = dirHandle;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment);
  }

  return (await current.getFileHandle(name)).getFile();
}

export async function writeInto(dirHandle, path, blob) {
  const segments = path.split('/');
  const name = segments.pop();

  let current = dirHandle;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }

  const writable = await (await current.getFileHandle(name, { create: true })).createWritable();
  await writable.write(blob);
  await writable.close();
}

// --- EXIF ------------------------------------------------------------------

/**
 * Minimal EXIF reader: only the capture date, which is the one tag worth
 * keeping. A full EXIF parser would be a lot of code to extract information
 * this app has no use for.
 *
 * @returns {object|null} a genealogical date, or null
 */
export async function readExifDate(file) {
  const view = new DataView(await file.slice(0, 128 * 1024).arrayBuffer());
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not a JPEG

  let at = 2;
  while (at + 4 <= view.byteLength) {
    if (view.getUint8(at) !== 0xff) return null;

    const marker = view.getUint8(at + 1);
    if (marker === 0xda) return null; // start of scan: no EXIF before the pixels

    const length = view.getUint16(at + 2);

    // APP1 carrying "Exif\0\0"
    if (marker === 0xe1 && at + 10 <= view.byteLength && view.getUint32(at + 4) === 0x45786966) {
      return readTiffDate(view, at + 10);
    }

    at += 2 + length;
  }

  return null;
}

function readTiffDate(view, base) {
  if (base + 8 > view.byteLength) return null;

  const marker = view.getUint16(base);
  if (marker !== 0x4949 && marker !== 0x4d4d) return null;
  const little = marker === 0x4949;

  const ifd0 = base + view.getUint32(base + 4, little);

  // 0x9003 DateTimeOriginal lives in the Exif sub-IFD; 0x0132 DateTime is the
  // fallback in IFD0 and is usually the same value.
  const exifPointer = findTag(view, base, ifd0, 0x8769, little);
  const fromExif =
    exifPointer === null
      ? null
      : readAscii(view, base, findTagOffset(view, base, base + exifPointer, 0x9003, little));

  return toGenealogicalDate(
    fromExif ?? readAscii(view, base, findTagOffset(view, base, ifd0, 0x0132, little)),
  );
}

function eachEntry(view, ifd, visit, little) {
  if (ifd + 2 > view.byteLength) return null;
  const count = view.getUint16(ifd, little);

  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > view.byteLength) break;
    const result = visit(view.getUint16(entry, little), entry);
    if (result !== undefined) return result;
  }

  return null;
}

const findTag = (view, base, ifd, tag, little) =>
  eachEntry(
    view,
    ifd,
    (found, entry) => (found === tag ? view.getUint32(entry + 8, little) : undefined),
    little,
  );

/** @returns {{offset: number, length: number}|null} */
const findTagOffset = (view, base, ifd, tag, little) =>
  eachEntry(
    view,
    ifd,
    (found, entry) =>
      found === tag
        ? {
            offset: base + view.getUint32(entry + 8, little),
            length: view.getUint32(entry + 4, little),
          }
        : undefined,
    little,
  );

function readAscii(view, base, location) {
  if (!location || location.offset + location.length > view.byteLength) return null;

  let text = '';
  for (let index = 0; index < location.length; index += 1) {
    const code = view.getUint8(location.offset + index);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }

  return text;
}

/** EXIF writes dates as 'YYYY:MM:DD HH:MM:SS'. */
function toGenealogicalDate(text) {
  const match = /^(\d{4}):(\d{2}):(\d{2})/.exec(text ?? '');
  if (!match) return null;

  const [, year, month, day] = match.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return parseDate(`${day} ${GEDCOM_MONTHS[month - 1]} ${year}`);
}
