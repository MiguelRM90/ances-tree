# GitHub Copilot Instructions for ances-tree

ances-tree is an offline-first, client-only genealogy application running purely in the browser without any backend or accounts.

## Core Rules for Copilot Code Suggestions
1. **Zero External Dependencies**: Do NOT import or suggest third-party npm libraries in `src/`. Only standard Web APIs are allowed.
2. **Security & CSP**: Do not use `innerHTML` when handling user data (names, dates, notes, GEDCOM records). Use `textContent` or `document.createElement()`. Do not generate inline `<style>` tags; use constructable stylesheets (`adoptedStyleSheets`).
3. **Layer Separation**:
   - `src/domain/`: Pure algorithms only. Never touch `window`, `document`, DOM elements, `indexedDB`, or `store`.
   - `src/ui/`: Web Components extending `HTMLElement`.
   - `src/store/`: Central state and actions.
   - `src/storage/`: Native disk and OPFS adapters.
4. **Dates**: Never discard or overwrite `raw` in date structures.
5. **Language**: English for all code, variable names, comments, and commit messages.
6. **Component Conventions**:
   - Use `#` for private class properties and methods.
   - Attach listeners in `connectedCallback` and remove them in `disconnectedCallback`.
   - Use `crypto.randomUUID()` for unique identifiers.

