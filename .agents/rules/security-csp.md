---
trigger: always_on
description: Content Security Policy (CSP) and XSS prevention security rule
---

# Security and Content Security Policy (CSP)

The project enforces a strict Content Security Policy in production:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'
```

1. **`innerHTML` with User Data is Strictly Forbidden**:
   - Given names, surnames, dates, notes, imported GEDCOM fields, and file names from IndexedDB are all untrusted user data and must never be injected using `innerHTML`.
   - Always use `textContent`, `setAttribute`, or imperative element creation (`document.createElement`).

2. **No Inline CSS**:
   - `style-src 'self'` forbids inline `style="..."` attributes and dynamically injected `<style>` tags.
   - Every component must encapsulate its styles using constructable stylesheets (`adoptedStyleSheets = [sheet(css)]`) imported with Vite's `?inline` query.

3. **No Unsafe Code Execution**:
   - The use of `eval()`, `new Function()`, `setTimeout(string)`, etc., is strictly prohibited.

4. **Data Privacy**:
   - No telemetry, analytics, or network requests to external servers are allowed.
   - Family data must never leave the user's local machine.
