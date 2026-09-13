/**
 * Constants and small helpers shared by the ZIP reader and writer.
 *
 * The format is implemented by hand on top of CompressionStream: a ZIP library
 * would be a runtime dependency, which this project does not allow, and third
 * party attack surface over personal data (decisions.md, ZIP section).
 */

export const LOCAL_SIG = 0x04034b50;
export const CD_SIG = 0x02014b50;
export const EOCD_SIG = 0x06054b50;
export const ZIP64_EOCD_SIG = 0x06064b50;
export const ZIP64_LOCATOR_SIG = 0x07064b50;

export const ZIP64_EXTRA_ID = 0x0001;

export const METHOD_STORE = 0;
export const METHOD_DEFLATE = 8;

export const MAX16 = 0xffff;
export const MAX32 = 0xffffffff;

export const LOCAL_HEADER_SIZE = 30;
export const CD_HEADER_SIZE = 46;
export const EOCD_SIZE = 22;
export const ZIP64_EOCD_SIZE = 56;
export const ZIP64_LOCATOR_SIZE = 20;

/**
 * Formats that are already compressed. Deflating them burns CPU for nothing —
 * often for a slightly larger result — so they are stored verbatim.
 */
const PRECOMPRESSED =
  /\.(jpe?g|png|gif|webp|avif|heic|pdf|zip|gz|mp[34]|mov|m4[av]|docx|xlsx|pptx|odt|ods)$/i;

export const shouldDeflate = (name) => !PRECOMPRESSED.test(name);

/** MS-DOS time and date, which is what the ZIP format stores. */
export function dosTime(date) {
  return (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
}

export function dosDate(date) {
  return ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}

export function fromDosDateTime(dosDateValue, dosTimeValue) {
  return new Date(
    1980 + ((dosDateValue >> 9) & 0x7f),
    ((dosDateValue >> 5) & 0x0f) - 1,
    dosDateValue & 0x1f,
    (dosTimeValue >> 11) & 0x1f,
    (dosTimeValue >> 5) & 0x3f,
    (dosTimeValue & 0x1f) * 2,
  );
}

export const encodeName = (name) => new TextEncoder().encode(name);
export const decodeName = (bytes) => new TextDecoder('utf-8').decode(bytes);

export async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function inflateRawStream(stream) {
  return stream.pipeThrough(new DecompressionStream('deflate-raw'));
}

/**
 * A ZIP entry can carry a malicious path such as `../../etc/passwd` (Zip Slip).
 * With File System Access this is not theoretical: we write to the real disk.
 *
 * Every path from an archive goes through here before being used.
 */
export function safeEntryPath(raw) {
  const normalized = String(raw).replace(/\\/g, '/');

  if (
    normalized === '' ||
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    throw new Error(`Unsafe path in archive: ${normalized}`);
  }

  return normalized;
}
