/**
 * GEDCOM lexer and parser (decisions.md, GEDCOM import).
 *
 * Real GEDCOM files are dirty. Every rule below exists because files in the
 * wild break it: mixed line endings, a byte-order mark, blank lines, values
 * that begin with meaningful spaces, `@@` as an escaped at-sign, and vendors
 * that invent tags. Aborting on the first bad line would reject most real
 * archives, so errors are collected and the import continues.
 */

/** LEVEL [XREF] TAG [VALUE] — the value may contain anything at all. */
const LINE = /^\s*(\d+)\s+(?:(@[^@\s]+@)\s+)?([A-Za-z0-9_]+)(?:\s(.*))?$/;

/**
 * @typedef {Object} GedcomNode
 * @property {string} tag
 * @property {string} xref     '' when the record is not addressable
 * @property {string} value
 * @property {GedcomNode[]} children
 * @property {number} line     for error messages
 */

/**
 * @returns {{records: GedcomNode[], errors: Array<{line: number, text: string, reason: string}>,
 *            encoding: string, version: string}}
 */
export function parseGedcom(text) {
  const errors = [];
  const records = [];
  const stack = [];

  // A byte-order mark survives more round trips than anyone expects.
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);

  lines.forEach((raw, index) => {
    if (raw.trim() === '') return;

    const match = LINE.exec(raw);
    if (!match) {
      errors.push({ line: index + 1, text: raw.slice(0, 120), reason: 'MALFORMED' });
      return;
    }

    const level = Number(match[1]);
    const node = {
      tag: match[3].toUpperCase(),
      xref: match[2] ?? '',
      value: unescapeAt(match[4] ?? ''),
      children: [],
      line: index + 1,
    };

    // CONC continues the previous value; CONT starts a new line within it.
    // Both carry text that may legitimately begin with spaces, which is why
    // the value is taken raw rather than trimmed.
    if (node.tag === 'CONC' || node.tag === 'CONT') {
      const target = stack[level - 1];
      if (!target) {
        errors.push({ line: index + 1, text: raw.slice(0, 120), reason: 'ORPHAN_CONTINUATION' });
        return;
      }
      target.value += node.tag === 'CONT' ? `\n${node.value}` : node.value;
      return;
    }

    stack.length = level;

    if (level === 0) records.push(node);
    else if (stack[level - 1]) stack[level - 1].children.push(node);
    else errors.push({ line: index + 1, text: raw.slice(0, 120), reason: 'ORPHAN_LEVEL' });

    stack[level] = node;
  });

  const head = records.find((record) => record.tag === 'HEAD');

  return {
    records,
    errors,
    encoding: childValue(head, 'CHAR') || 'UNKNOWN',
    version: childValue(child(head, 'GEDC'), 'VERS') || 'UNKNOWN',
  };
}

/** `@@` is how a literal at-sign is written inside a value. */
const unescapeAt = (value) => value.replace(/@@/g, '@');

export const child = (node, tag) => node?.children.find((c) => c.tag === tag) ?? null;
export const children = (node, tag) => node?.children.filter((c) => c.tag === tag) ?? [];
export const childValue = (node, tag) => child(node, tag)?.value ?? '';

/**
 * Decodes raw GEDCOM bytes into a string, handling BOMs, UTF-16 (LE/BE) with or
 * without a BOM, and legacy 5.5.1 `1 CHAR` declarations (`UNICODE`, `ANSEL`,
 * `ANSI`, `ASCII`, `UTF-8`).
 *
 * Historically in GEDCOM 5.5.1, `1 CHAR UNICODE` meant 16-bit UCS-2 / UTF-16
 * (typically Little Endian from PAF and Windows tools), not UTF-8.
 *
 * @param {Uint8Array | ArrayBuffer} input
 * @returns {string}
 */
export function decodeGedcom(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const encoding = detectGedcomEncoding(bytes);
  return new TextDecoder(encoding).decode(bytes);
}

/**
 * Reads a File or Blob containing a GEDCOM archive and decodes its text using
 * BOM, UTF-16 heuristics, and `1 CHAR` header inspection.
 *
 * @param {Blob} file
 * @returns {Promise<string>}
 */
export async function readFileWithEncoding(file) {
  const buffer = await file.arrayBuffer();
  return decodeGedcom(new Uint8Array(buffer));
}

function detectGedcomEncoding(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return 'utf-16le';
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return 'utf-16be';
  }

  const utf16Heuristic = detectBomlessUtf16(bytes);
  if (utf16Heuristic) return utf16Heuristic;

  const head = new TextDecoder('iso-8859-1').decode(bytes.subarray(0, 4096));
  const declared = /(?:^|\r\n|\r|\n)1\s+CHAR\s+(\S+)/i.exec(head)?.[1]?.toUpperCase() ?? 'UTF-8';

  if (declared === 'UNICODE' || declared === 'UTF-16' || declared === 'UTF-16LE') {
    return 'utf-16le';
  }
  if (declared === 'UTF-16BE') {
    return 'utf-16be';
  }
  if (declared === 'ANSEL' || declared === 'ANSI' || declared === 'ASCII' || declared === 'IBMPC') {
    return 'windows-1252';
  }
  return 'utf-8';
}

function detectBomlessUtf16(bytes) {
  const sampleLength = Math.min(bytes.length & ~1, 512);
  if (sampleLength < 4) return null;

  const pairs = sampleLength >> 1;
  let evenNulls = 0;
  let oddNulls = 0;

  for (let i = 0; i < sampleLength; i += 2) {
    if (bytes[i] === 0x00) evenNulls += 1;
    if (bytes[i + 1] === 0x00) oddNulls += 1;
  }

  if (oddNulls / pairs > 0.3 && evenNulls / pairs < 0.05) return 'utf-16le';
  if (evenNulls / pairs > 0.3 && oddNulls / pairs < 0.05) return 'utf-16be';
  return null;
}
