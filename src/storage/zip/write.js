/**
 * ZIP writer.
 *
 * Writes straight into a WritableStream, so with File System Access the archive
 * goes to disk as it is produced and the project size is not bounded by RAM
 * (storage.md, streaming write).
 *
 * Only one entry is ever held in memory, and only when it is being deflated.
 * Stored entries are streamed twice from disk: once to checksum, once to copy.
 */

import { Crc32, crc32OfBlob } from './crc32.js';
import {
  LOCAL_SIG,
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
  ZIP64_EOCD_SIZE,
  ZIP64_LOCATOR_SIZE,
  dosTime,
  dosDate,
  encodeName,
  deflateRaw,
  shouldDeflate,
} from './format.js';

export class ZipWriter {
  #writer;
  #offset = 0;
  #entries = [];

  /** @param {WritableStream} writable */
  constructor(writable) {
    this.#writer = writable.getWriter();
  }

  /** Adds an in-memory entry: family.json, manifest.json, the GEDCOM. */
  async addBytes(name, bytes, { date = new Date(), compress = true } = {}) {
    const useDeflate = compress && shouldDeflate(name);
    const payload = useDeflate ? await deflateRaw(bytes) : bytes;

    await this.#writeEntry({
      name,
      date,
      method: useDeflate ? METHOD_DEFLATE : METHOD_STORE,
      crc: new Crc32().update(bytes).value,
      uncompressedSize: bytes.length,
      compressedSize: payload.length,
      write: async () => this.#write(payload),
    });
  }

  /**
   * Adds a file from disk.
   *
   * Photos and PDFs are already compressed, so they are stored: that lets us
   * stream them straight through instead of loading them whole.
   */
  async addFile(name, file, { date } = {}) {
    if (shouldDeflate(name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await this.addBytes(name, bytes, { date: date ?? new Date(file.lastModified) });
      return;
    }

    await this.#writeEntry({
      name,
      date: date ?? new Date(file.lastModified),
      method: METHOD_STORE,
      crc: await crc32OfBlob(file),
      uncompressedSize: file.size,
      compressedSize: file.size,
      write: async () => this.#pipe(file),
    });
  }

  /** Writes the central directory and closes the stream. */
  async close() {
    const cdOffset = this.#offset;

    for (const entry of this.#entries) {
      await this.#write(centralHeader(entry));
    }

    const cdSize = this.#offset - cdOffset;
    const needsZip64 = this.#entries.length > MAX16 || cdOffset > MAX32 || cdSize > MAX32;

    if (needsZip64) {
      const zip64Offset = this.#offset;
      await this.#write(zip64Eocd(this.#entries.length, cdSize, cdOffset));
      await this.#write(zip64Locator(zip64Offset, this.#offset + ZIP64_LOCATOR_SIZE));
    }

    await this.#write(eocd(this.#entries.length, cdSize, cdOffset, needsZip64));
    await this.#writer.close();
  }

  async #writeEntry(entry) {
    const record = {
      ...entry,
      nameBytes: encodeName(entry.name),
      offset: this.#offset,
    };

    await this.#write(localHeader(record));
    await entry.write();

    this.#entries.push(record);
  }

  async #write(bytes) {
    await this.#writer.write(bytes);
    this.#offset += bytes.length;
  }

  async #pipe(blob) {
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await this.#write(value);
    }
  }
}

// --- Header construction ---------------------------------------------------

/** An entry needs ZIP64 when a size or its local offset overflows 32 bits. */
const entryNeedsZip64 = (entry) =>
  entry.uncompressedSize > MAX32 || entry.compressedSize > MAX32 || entry.offset > MAX32;

function localHeader(entry) {
  const zip64 = entry.uncompressedSize > MAX32 || entry.compressedSize > MAX32;
  const extraSize = zip64 ? 20 : 0;
  const buffer = new Uint8Array(LOCAL_HEADER_SIZE + entry.nameBytes.length + extraSize);
  const view = new DataView(buffer.buffer);

  view.setUint32(0, LOCAL_SIG, true);
  view.setUint16(4, zip64 ? 45 : 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entry.method, true);
  view.setUint16(10, dosTime(entry.date), true);
  view.setUint16(12, dosDate(entry.date), true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, zip64 ? MAX32 : entry.compressedSize, true);
  view.setUint32(22, zip64 ? MAX32 : entry.uncompressedSize, true);
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, extraSize, true);
  buffer.set(entry.nameBytes, LOCAL_HEADER_SIZE);

  if (zip64) {
    const at = LOCAL_HEADER_SIZE + entry.nameBytes.length;
    view.setUint16(at, ZIP64_EXTRA_ID, true);
    view.setUint16(at + 2, 16, true);
    view.setBigUint64(at + 4, BigInt(entry.uncompressedSize), true);
    view.setBigUint64(at + 12, BigInt(entry.compressedSize), true);
  }

  return buffer;
}

function centralHeader(entry) {
  const zip64 = entryNeedsZip64(entry);

  // The ZIP64 extra field carries only the values that overflowed, in a fixed
  // order: uncompressed size, compressed size, local header offset.
  const extraValues = [];
  if (zip64) {
    if (entry.uncompressedSize > MAX32) extraValues.push(entry.uncompressedSize);
    if (entry.compressedSize > MAX32) extraValues.push(entry.compressedSize);
    if (entry.offset > MAX32) extraValues.push(entry.offset);
  }

  const extraSize = extraValues.length > 0 ? 4 + extraValues.length * 8 : 0;
  const buffer = new Uint8Array(CD_HEADER_SIZE + entry.nameBytes.length + extraSize);
  const view = new DataView(buffer.buffer);

  view.setUint32(0, CD_SIG, true);
  view.setUint16(4, 0x031e, true); // made by: UNIX, spec 3.0
  view.setUint16(6, zip64 ? 45 : 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, entry.method, true);
  view.setUint16(12, dosTime(entry.date), true);
  view.setUint16(14, dosDate(entry.date), true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.compressedSize > MAX32 ? MAX32 : entry.compressedSize, true);
  view.setUint32(24, entry.uncompressedSize > MAX32 ? MAX32 : entry.uncompressedSize, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, extraSize, true);
  view.setUint16(32, 0, true); // comment length
  view.setUint16(34, 0, true); // disk number
  view.setUint16(36, 0, true); // internal attributes
  view.setUint32(38, 0o644 << 16, true); // external attributes
  view.setUint32(42, entry.offset > MAX32 ? MAX32 : entry.offset, true);
  buffer.set(entry.nameBytes, CD_HEADER_SIZE);

  if (extraSize > 0) {
    const at = CD_HEADER_SIZE + entry.nameBytes.length;
    view.setUint16(at, ZIP64_EXTRA_ID, true);
    view.setUint16(at + 2, extraValues.length * 8, true);
    extraValues.forEach((value, index) => {
      view.setBigUint64(at + 4 + index * 8, BigInt(value), true);
    });
  }

  return buffer;
}

function zip64Eocd(count, cdSize, cdOffset) {
  const buffer = new Uint8Array(ZIP64_EOCD_SIZE);
  const view = new DataView(buffer.buffer);

  view.setUint32(0, ZIP64_EOCD_SIG, true);
  view.setBigUint64(4, BigInt(ZIP64_EOCD_SIZE - 12), true);
  view.setUint16(12, 0x031e, true);
  view.setUint16(14, 45, true);
  view.setUint32(16, 0, true);
  view.setUint32(20, 0, true);
  view.setBigUint64(24, BigInt(count), true);
  view.setBigUint64(32, BigInt(count), true);
  view.setBigUint64(40, BigInt(cdSize), true);
  view.setBigUint64(48, BigInt(cdOffset), true);

  return buffer;
}

function zip64Locator(zip64EocdOffset) {
  const buffer = new Uint8Array(ZIP64_LOCATOR_SIZE);
  const view = new DataView(buffer.buffer);

  view.setUint32(0, ZIP64_LOCATOR_SIG, true);
  view.setUint32(4, 0, true);
  view.setBigUint64(8, BigInt(zip64EocdOffset), true);
  view.setUint32(16, 1, true);

  return buffer;
}

function eocd(count, cdSize, cdOffset, zip64) {
  const buffer = new Uint8Array(EOCD_SIZE);
  const view = new DataView(buffer.buffer);

  view.setUint32(0, EOCD_SIG, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, zip64 ? MAX16 : count, true);
  view.setUint16(10, zip64 ? MAX16 : count, true);
  view.setUint32(12, zip64 ? MAX32 : cdSize, true);
  view.setUint32(16, zip64 ? MAX32 : cdOffset, true);
  view.setUint16(20, 0, true);

  return buffer;
}
