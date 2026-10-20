# Project technical decisions

> Related documents: [data-model.md](data-model.md) (data model) · [storage.md](storage.md) (storage, ZIP and PWA) · [architecture.md](architecture.md) (layers and layout) · [validation-rules.md](validation-rules.md) · [gedcom-mapping.md](gedcom-mapping.md)

## Philosophy

> Plain HTML, CSS and JavaScript. No frameworks, no runtime dependencies. The browser is the platform.

- If the browser supports something natively, no library is added for it
- Zero production dependencies
- Development tools (build, lint, test) are optional and never reach the end user

### Fundamental separation

**Where the app is served ≠ where the data lives.**

The application is a few hundred KB of HTML, CSS and JS. Family data always lives on the user's disk and never goes through any server, wherever the app is served from. This separation makes it possible to change hosting without touching anything in the data model.

---

## Language

**Rule:** everything in the repository is in English.

- **Code, comments, identifiers, model fields, filenames and commits**: English, no exceptions
- **Design documentation and AI context**: English, located in `docs/`, `AGENTS.md` and `.agents/`. It is versioned in the repository so that AI assistants and collaborators have the complete architecture and rules specifications.
- **`README.md`**: English as well, and published together with the rest of the documentation (`.gitignore` tracks `docs/`, `AGENTS.md` and `.agents/`). `README.es.md` is its Spanish translation, for Spanish-speaking visitors; both files must be updated together
- **UI**: **English and Spanish**, in `src/config/locales/`. The language is detected through `navigator.language` and there is a selector in the bar

Both dictionaries have exactly the same keys, and tests check it: a missing key does not throw an error, it **renders `undefined` in the interface**, which nobody notices until a user sees it. Switching language **reloads the page**: several components build their labels only once, when they are created, so repainting in place would leave parts in the previous language.

The preference is stored in `localStorage` — it is a short string, which is exactly what it is meant for. IndexedDB exists in this project only because folder handles are not serializable, and that reason does not apply here.

---

## Application distribution

### GitHub Pages (MVP)

- It only hosts the application. **It never contains family data**
- Vite's `base` is set to relative (`'./'`), allowing it to resolve both on GitHub Pages (`/ances-tree/`) and on standalone local servers
- A `.nojekyll` file is needed in the published root, or GitHub ignores directories starting with `_`

### PWA from day one

Service worker and manifest are implemented **from the start**, not added later: retrofitting them forces a rethink of routes, cache and versioning.

- After the first visit, the app works 100% offline
- Installable: its own icon, window without a browser bar
- Removes the dependency on GitHub Pages staying up
- On Safari, having the app installed is also what prevents the browser from deleting the data (see [storage.md](storage.md))

That last point stopped being a footnote the day the app started working on mobile. When there is no folder picker, the file lives in browser storage, and on iOS that is discarded after seven days without visits **unless it is on the home screen**. That is why `index.html` carries `apple-touch-icon` and the web app meta tags: there they are not decoration, they are what preserves the data.

### Two storage modes

The rule used to be "File System Access or it doesn't start". It was reverted: there is a second backend on top of the origin private file system, and the full detail — why, what it cost, and how the user is told that this copy is more fragile — is in [storage.md](storage.md#decision-two-storage-modes).

What matters here is the shape it took: **the mode is decided in one module (`storage/backend.js`) and applied in another (`storage/file-dialog.js`), and nothing else branches on it.** Everything below receives a `FileSystemDirectoryHandle` and does not know where it came from. An `if (isMobile)` scattered across the storage layer would have been the same work and a permanent source of divergence between platforms.

### What is NOT done: opening the HTML with a double click

Serving the app through `file://` is ruled out, and it is worth understanding why, because it is an idea that keeps coming back:

- **ES modules do not load**: the origin is `null` and the browser blocks them through CORS. That kills the module and Web Components architecture
- **IndexedDB is unreliable**: behavior varies by browser, and in Firefox each file has a different origin
- **No service worker**: it requires HTTPS or localhost

**Documented emergency exit**: if a single self-contained `.html` is ever needed to hand to a relative offline, a special build is generated with all the CSS and JS inline as a _classic script_ (no `import`). Modules, service worker and reliable IndexedDB are given up. It is a degraded mode, not the main path.

---

## Web Components

- All components extend `HTMLElement` and are registered with `customElements.define`
- Names always contain a hyphen (`person-card`, `tree-canvas`)
- Private properties use `#` (private class fields, ES2022)
- Listeners are registered in `connectedCallback` and cleaned up in `disconnectedCallback`
- `attributeChangedCallback` + `observedAttributes` are used for declarative reactivity
- Shadow DOM only when real style encapsulation is needed

### Styles: real CSS files + constructable stylesheets

Each component keeps its styles in a **sibling `.css` file** and imports it with Vite's `?inline`, which returns the file's text at build time:

```
src/ui/components/person-card.js
src/ui/components/person-card.css
```

```js
import { base, sheet } from '../styles/sheets.js';
import css from './person-card.css?inline';

const styles = sheet(css);

class PersonCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).adoptedStyleSheets = [base, styles];
  }
}
```

**Why files and not template literals**: a `sheet(\`...\`)` is de facto CSS-in-JS, exactly what the project's philosophy rules out. With real files, syntax highlighting, autocompletion, Prettier and the CSS linter work. `?inline` is a build-time transformation: it adds nothing to the runtime.

### Flags drawn in CSS

Windows **does not include flag glyphs** in `Segoe UI Emoji` — a deliberate Microsoft decision to avoid taking a position in territorial disputes — so `🇪🇸` comes out as two loose letters. It affects every application on the system, not just this one.

`src/ui/flag-support.js` **measures** this (it compares the width of the indicator pair against that of the two letters separately) instead of looking at the user agent, so the day someone installs a font with flags, they appear on their own.

Where there are no glyphs, `src/ui/styles/flags.css` draws the flag with gradients: most are color bands, which a `linear-gradient` reproduces exactly. Two deliberate limits:

- Flags with a coat of arms, canton or emblem are drawn **with their bands only**. Spain without the coat of arms and Mexico without the eagle are still Spain and Mexico at fourteen pixels, and both exist as official variants without arms
- Whatever cannot be drawn honestly — the Union Jack, Brazil, off-center Nordic crosses — gets the neutral rectangle. **The two-letter code is always there**, so a missing flag costs nothing; a wrong one does

Reasons, in order of importance:

1. **CSP**: a `<style>` inside a shadow root **does** count as inline style for `style-src`; the shadow root does not exempt it. Constructable stylesheets fall outside that check
2. **Performance**: the CSSOM is parsed once and shared among all instances. With hundreds of person cards on screen, the difference is measurable

### Communication between components

- **A central store** (singleton module) owns the state. Components never talk to each other directly
- The store exposes mutation methods and notifies changes through `EventTarget`; components subscribe in `connectedCallback` and unsubscribe in `disconnectedCallback`
- Components emit intent upward with `CustomEvent` (`bubbles: true, composed: true`); state always flows down as properties or attributes
- Reason: the whole tree is re-rendered when the focal person changes. A local propagation model between components becomes unmanageable in that scenario

---

## Tooling (development only)

| Tool                            | Purpose                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------- |
| **Vite**                        | Dev server and build, fast HMR. `base: './'`, `build.target: 'esnext'`          |
| **ESLint** + `eslint-plugin-wc` | Linting, with rules specific to Web Components                                   |
| **Prettier**                    | Consistent formatting                                                            |
| **Web Test Runner**             | Tests in a real browser, designed for Web Components                             |

### Development dependencies

- Although there are no runtime dependencies, development ones are also an attack vector (supply chain)
- Pin exact versions in `package.json` (`"vite": "5.2.1"`, not `"^5"`)
- Review dependencies periodically with `pnpm audit`

---

## Threat model

Before the concrete measures, it is worth being explicit about what this app protects against and what it does not. Everything else follows from here.

**What it protects against:**

- Family data leaving the user's machine: there is no backend, no telemetry, no network
- Another user of the same machine reading the data, **only if** passphrase encryption is enabled
- Malicious content in imported files (ZIP, GEDCOM, JSON, images) that tries to execute code or write outside the project folder

**What it does NOT protect against:**

- **An XSS in the app itself.** If an attacker runs JavaScript on the origin, they have access to everything the app has access to. No client-side encryption fixes this
- A compromised machine (keylogger, malware with disk access)
- What the user does with the exported ZIP once it leaves the app

**Practical consequence**: the strict CSP and discipline with `innerHTML` are the real defense. Encryption is a secondary layer, useful only against disk reading by third parties.

---

## Security

### XSS (Cross-Site Scripting)

- **Never use `innerHTML` with external or user data** — it is the most common entry point for XSS
- For dynamic content, use `textContent` or `createElement` + `appendChild`
- If `innerHTML` is unavoidable (controlled HTML, as in `render()`), the content must always be hardcoded or sanitized
- Native sanitizer when available: `Document.parseHTMLUnsafe` + `Sanitizer API` (still experimental, watch support)

```js
// ❌ Dangerous if `value` comes from outside
el.innerHTML = `<span>${value}</span>`;

// ✅ Safe
el.textContent = value;
```

**In this app, "external data" includes everything**: person names, notes, file names, values read from IndexedDB and any field of an imported GEDCOM.

### Attributes and external data

- Validate and escape any value coming from `getAttribute` before using it in the DOM
- Do not trust `dataset` or URL parameters without validation

### Content Security Policy (CSP)

**Starting limitation**: with GitHub Pages there is no server of our own, so **HTTP headers cannot be sent**. The CSP has to go in a `<meta http-equiv="Content-Security-Policy">`, which means giving up `frame-ancestors`, `report-uri` and `sandbox`, which only work as a header. It is an accepted limitation, not an oversight.

- Avoid `unsafe-inline` in scripts: the Vite build generates modules as external files, so it is achievable
- Component styles go in constructable stylesheets, not inline `<style>` (see above)
- `object-src 'none'` and `frame-src 'none'` unless PDF preview is implemented (see below)
- `connect-src 'self'` — the app talks to no one
- `img-src 'self' blob:` — photos are displayed from blob URLs

### File upload

- Validate the type by **actual content** (magic bytes), not by extension or `file.type`: both are controlled by the user
- Limit size before processing: `if (file.size > MAX_BYTES) return`
- Never render the file name directly in the DOM with `innerHTML`
- Files are processed in memory (FileReader / ArrayBuffer), never executed

### Photographs: EXIF metadata

Family photos carry **geolocation, date and device model** in the EXIF. If the ZIP is shared, that is PII leaked without the user knowing.

- When importing a photo, the user is offered to **strip the metadata** (option enabled by default, reversible by the user)
- Stripping is done by re-encoding through `canvas` → `toBlob()`, which discards all the EXIF
- **Careful**: that also discards the `orientation` flag. The orientation must be read before re-encoding and applied to the resulting image, or portrait photos come out rotated
- The capture date, if extracted, is stored in the model (`MediaObject.takenDate`) before stripping: it is useful genealogical data that must not be lost

### PDF documents

Decision: **in the MVP, PDFs are stored and downloaded, not previewed inside the app.**

Previewing requires an `<iframe>` or `<embed>` with a blob URL, which forces opening `object-src` / `frame-src` in the CSP and trusting the browser's PDF viewer with a file of unknown origin. The benefit does not justify it in the first version. If it is implemented later, it is done in a new tab on the blob URL, never embedded in the app.

### ZIP

**No library is used.** The format is implemented by hand on top of native APIs:

- Compression and decompression with `CompressionStream('deflate-raw')` and `DecompressionStream('deflate-raw')`
- The rest is local header, central directory and CRC32 — about 150 lines
- Reason: JSZip would be a runtime dependency, forbidden by the project's philosophy, and also third-party attack surface over personal data

When **reading** a ZIP:

- A ZIP can contain malicious paths like `../../etc/passwd` (Zip Slip). With File System Access this stops being theoretical: it writes to the real disk. **Normalize and validate every path** before using it, and reject any entry that contains `..`, starts with `/` or has a drive letter
- Limit the number of entries and the uncompressed size before extracting (a ZIP bomb decompresses GBs from a few KB)
- Reject entries whose declared size does not match the real one
- Do not execute or evaluate any extracted content

```js
const MAX_UNZIPPED = 5 * 1024 * 1024 * 1024; // 5 GB
const MAX_ENTRIES = 100_000;

function safeEntryPath(raw) {
  const normalized = raw.replace(/\\/g, '/');
  if (normalized.includes('..') || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw new Error(`Unsafe path in archive: ${normalized}`);
  }
  return normalized;
}
```

Structure and streaming-write details are in [storage.md](storage.md).

### Encryption (optional, not by default)

The approach of storing in a real folder of the user (see [storage.md](storage.md)) **greatly simplifies this section**: if photos live in a folder that the user opens with their viewer, encrypting them is counterproductive.

**Decision:**

- Photos and documents are **always stored in the clear**. They are the user's files, on their disk
- Encryption is **optional and only affects `family.json`** (the graph, which is where the structured PII is)
- **Without a passphrase, there is no encryption.** A key generated by the app and stored next to the data protects nothing relevant: against XSS it is useless (the attacker calls `decrypt()` all the same) and against disk reading it only adds a step. It is honesty, not negligence
- **With a passphrase**: `PBKDF2` with a high iteration count and a random salt per project → 256-bit `AES-GCM` key. Unique IV per operation with `crypto.getRandomValues`, never reused with the same key
- **Passphrase-free alternative that does add value**: the WebAuthn **`prf` extension**, which derives a stable key from the device's authenticator (biometrics or PIN). It is the only way to have real encryption without the user remembering anything. It is out of the MVP but the format must leave room for it

If a `CryptoKey` is ever handled:

```js
// The key is stored as a CryptoKey object in IndexedDB (it is structured-cloneable),
// NOT as exported material.
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
  passphraseKey,
  { name: 'AES-GCM', length: 256 },
  false, // ⬅ NOT extractable: not even an XSS can exfiltrate it, only use it while the tab lives
  ['encrypt', 'decrypt'],
);
```

> Never `extractable: true`. Storing the `CryptoKey` directly is always preferable to storing the key material.

**ZIP consistency**: if the project has a passphrase, the `family.json` inside the ZIP is encrypted too. A plaintext ZIP exported from an encrypted project would break the whole model. Photos remain in the clear in both cases, and the user is told this when exporting.

### JSON import

- Always parse with `JSON.parse` inside a `try/catch`
- **Validate against the schema** in [data-model.md](data-model.md) before using anything: do not assume that fields exist or are of the expected type
- Check `schemaVersion` and apply migration if needed; reject unknown future versions
- If the JSON contains strings that will be rendered, treat them as external data
- Reject files that exceed a maximum size before parsing

```js
// ❌ Dangerous
const data = JSON.parse(rawText);
el.innerHTML = data.firstName;

// ✅ Safe
const data = JSON.parse(rawText);
if (typeof data.firstName !== 'string') throw new Error('Invalid format');
el.textContent = data.firstName;
```

### GEDCOM import

- GEDCOM (`.ged`) is plain text with a line-based structure: `LEVEL [XREF] TAG [VALUE]` — do not use `DOMParser` or any XML parser
- Custom parser, written by hand
- Validate line by line: numeric level, allowlisted tag, maximum value length
- The values of `NAME`, `NOTE`, `ADDR`, etc. are free text and contain PII: treat them as external data before rendering
- Reject files that exceed a maximum size before parsing
- GEDCOM 5.5.1 is the most widespread; GEDCOM 7.0 requires UTF-8 — detect and validate the encoding when reading

**Real-world GEDCOM files come dirty.** The parser must:

- Accept `\r\n`, `\r` and `\n`, and skip blank lines
- Discard the initial BOM if present
- Handle `CONC` and `CONT`, whose value may start with significant spaces
- Accept `@@` as an escape for a literal `@` inside a value
- **Accumulate errors instead of aborting on the first bad line**, and present the user with a summary with the option to "import with warnings" or cancel

```js
// LEVEL [XREF] TAG [VALUE] — the value can contain anything, including leading spaces
const GEDCOM_LINE = /^(\d+)\s+(?:(@[^@\s]+@)\s+)?([A-Za-z0-9_]+)(?:\s(.*))?$/;

const errors = [];
for (const [i, line] of lines.entries()) {
  if (line.trim() === '') continue;
  const match = GEDCOM_LINE.exec(line);
  if (!match) errors.push({ line: i + 1, text: line.slice(0, 120) });
}
```

### Memory management (personal data)

- Data lives in memory while the app is open — minimize the time it stays referenced
- Do not keep sensitive data in module variables or long-lived closures beyond the store
- Release references explicitly when they are no longer needed (`record = null`)
- **Revoke photo blob URLs with `URL.revokeObjectURL()`** when unmounting the component that uses them: otherwise they pile up and the tab eats hundreds of MB while browsing the tree
- Do not log PII to the console or any logging system

---

## What is out

- React, Vue, Angular, Svelte or similar
- Utility libraries (lodash, etc.) — use what the language offers
- **ZIP libraries** (JSZip and similar) — implemented on top of `CompressionStream`
- **GEDCOM parsing libraries** — custom parser
- CSS-in-JS or preprocessors — native CSS with custom properties (`--var`)
- Polyfills unless justified and documented here
- Any runtime network call
