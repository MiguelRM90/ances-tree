---
trigger: always_on
description: Code conventions, language policy, and Web Components standards
---

# Code Conventions and Standards

1. **Codebase Language**:
   - All code, identifiers, function and variable names, classes, comments, file names, tests, and commit messages must be written exclusively in **English**.
   - UI text is managed via i18n in `src/config/locales/` (`en.js` and `es.js`). Never hardcode text strings inside components or markup.

2. **Web Components**:
   - Extend `HTMLElement` and define custom elements with `customElements.define('component-name', ComponentClass)`.
   - Private properties and methods use native JavaScript `#` (`#privateField`), not underscores (`_`).
   - Attach listeners in `connectedCallback` and always remove them in `disconnectedCallback` to prevent memory leaks.
   - Declare observed attributes using static getter `observedAttributes` and handle updates in `attributeChangedCallback`.

3. **Constants and Numeric Limits**:
   - Never scatter magic numbers or threshold constants through the codebase. All limits reside in `src/config/limits.js`.

4. **Unique Identifiers**:
   - Always use `crypto.randomUUID()` to generate IDs for persons, unions, media, and family relations.

5. **Mandatory Tests and Documentation Review**:
   - Before considering any task or change complete, **always verify both tests and documentation**:
     - **Automated Tests**: Run `pnpm test` and `pnpm run lint`. Add or update test suites covering any new features, edge cases, or bug fixes.
     - **Documentation**: Review relevant design documents in `docs/` and `README.md`. Update any impacted specifications, metrics (e.g., test counts), or usage guidelines to ensure code and docs remain in sync.
