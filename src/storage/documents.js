/**
 * Document import pipeline (storage.md, documents section).
 *
 *   1. Size checked before anything is read against MAX_DOCUMENT_BYTES
 *   2. Type validated by magic bytes and extension
 *   3. SHA-256 of the content becomes the file name
 *   4. An identical document already present is reused, not written again
 *   5. Written to documents/<xx>/<hash>.<ext>
 */

import { createMediaObject, MediaKind } from '../domain/model/factories.js';
import { StorageError } from './error.js';
import { openFiles } from './file-dialog.js';
import { DOCUMENTS_DIR } from './names.js';
import { MAX_DOCUMENT_BYTES } from '../config/limits.js';
import { sha256Hex, writeInto } from './media.js';

export const EXTENSION_MAP = {
  pdf: { mime: 'application/pdf', ext: 'pdf' },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
  },
  doc: { mime: 'application/msword', ext: 'doc' },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
  },
  xls: { mime: 'application/ms-excel', ext: 'xls' },
  odt: { mime: 'application/vnd.oasis.opendocument.text', ext: 'odt' },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', ext: 'ods' },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: 'pptx',
  },
  ppt: { mime: 'application/ms-powerpoint', ext: 'ppt' },
  txt: { mime: 'text/plain', ext: 'txt' },
  csv: { mime: 'text/csv', ext: 'csv' },
  rtf: { mime: 'application/rtf', ext: 'rtf' },
};

export const DOCUMENT_TYPES = [
  {
    description: 'Documents',
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/ms-excel': ['.xls'],
      'application/vnd.oasis.opendocument.text': ['.odt'],
      'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
      'application/ms-powerpoint': ['.ppt'],
      'text/plain': ['.txt'],
      'text/csv': ['.csv'],
      'application/rtf': ['.rtf'],
    },
  },
];

/**
 * Opens the picker for one or more documents. Requires a user gesture.
 */
export function pickDocuments() {
  return openFiles({ types: DOCUMENT_TYPES });
}

const matches = (head, bytes, at = 0) =>
  head.length >= at + bytes.length && bytes.every((byte, index) => head[at + index] === byte);

/**
 * Validates document type via magic bytes and declared extension.
 *
 * @param {Blob|File} file
 * @returns {Promise<{mime: string, ext: string}|null>}
 */
export async function detectDocumentType(file) {
  if (!file || file.size === 0) return null;
  const name = file.name || '';
  const ext = name.split('.').pop()?.toLowerCase();
  const info = EXTENSION_MAP[ext];
  if (!info) return null;

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (head.length < 4) return null;

  // %PDF-
  if (ext === 'pdf') {
    return matches(head, [0x25, 0x50, 0x44, 0x46], 0) ? info : null;
  }

  // PK\x03\x04 (zip containers for modern office files)
  if (['docx', 'xlsx', 'pptx', 'odt', 'ods'].includes(ext)) {
    return matches(head, [0x50, 0x4b, 0x03, 0x04], 0) ? info : null;
  }

  // OLE2 Compound Document
  if (['doc', 'xls', 'ppt'].includes(ext)) {
    return matches(head, [0xd0, 0xcf, 0x11, 0xe0], 0) ? info : null;
  }

  // {\rtf
  if (ext === 'rtf') {
    return matches(head, [0x7b, 0x5c, 0x72, 0x74, 0x66], 0) ? info : null;
  }

  // Plain text / CSV: ensure no binary NUL characters in the header
  if (ext === 'txt' || ext === 'csv') {
    for (let i = 0; i < head.length; i += 1) {
      if (head[i] === 0x00) return null;
    }
    return info;
  }

  return null;
}

/**
 * Imports one document into the project folder.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {File} file
 * @param {object[]} existingMedia
 * @returns {Promise<{media: object, reused: boolean}>}
 */
export async function importDocument(dirHandle, file, existingMedia = []) {
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new StorageError('DOCUMENT_TOO_LARGE', `${file.name} is larger than the allowed maximum`);
  }

  const type = await detectDocumentType(file);
  if (!type) {
    throw new StorageError('NOT_A_DOCUMENT', `${file.name} is not a supported document type`);
  }

  const hash = await sha256Hex(file);
  const path = `${DOCUMENTS_DIR}/${hash.slice(0, 2)}/${hash}.${type.ext}`;
  const already = existingMedia.find((item) => item.hash === hash);
  if (already) return { media: already, reused: true };

  await writeInto(dirHandle, path, file);

  return {
    media: createMediaObject({
      kind: MediaKind.DOCUMENT,
      path,
      hash,
      mime: type.mime,
      bytes: file.size,
      width: null,
      height: null,
      caption: file.name,
      takenDate: null,
      exifStripped: false,
    }),
    reused: false,
  };
}
