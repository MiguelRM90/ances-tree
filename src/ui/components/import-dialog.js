/**
 * Import strategy chooser.
 *
 * The app always asks and never decides on its own (storage.md, merge on
 * import). The dialog shows what is actually inside the archive first, so the
 * choice is made with the numbers in view rather than blind.
 */

import { el, emit } from '../dom.js';
import { base, sheet } from '../styles/sheets.js';
import css from './import-dialog.css?inline';
import { S } from '../../config/strings.js';

const styles = sheet(css);

export class ImportDialog extends HTMLElement {
  #dialog;
  #card;
  #choices;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [base, styles];
    this.#dialog = this.#build();
    root.append(this.#dialog);
  }

  /**
   * @param {object} inspection  result of storage/archive.js inspectArchive()
   * @param {boolean} canMerge   whether a project is currently open
   */
  open(inspection, canMerge) {
    const title = inspection.manifest?.title ?? S.archive.unnamedArchive;

    this.#card.replaceChildren(
      el('span', { class: 'title', text: title }),
      el('span', { class: 'summary', text: S.archive.summary(inspection.counts) }),
      el('span', { class: 'summary', text: formatBytes(inspection.counts.bytes) }),
    );

    this.#choices.firstElementChild.hidden = !canMerge;
    this.#dialog.showModal();
  }

  close() {
    this.#dialog.close();
  }

  #build() {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'import-title');

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) this.close();
    });

    this.#card = el('div', { class: 'card' });

    const merge = choiceButton(S.archive.mergeHere, S.archive.mergeHint);
    const asNew = choiceButton(S.archive.openAsNew, S.archive.openAsNewHint);

    merge.addEventListener('click', () => {
      this.close();
      emit(this, 'import:merge');
    });
    asNew.addEventListener('click', () => {
      this.close();
      emit(this, 'import:new');
    });

    this.#choices = el('div', { class: 'choices', children: [merge, asNew] });

    const cancel = el('button', { text: S.editor.cancel, attrs: { type: 'button' } });
    cancel.addEventListener('click', () => this.close());

    dialog.append(
      el('div', {
        class: 'body',
        children: [
          el('h2', { text: S.archive.importTitle, attrs: { id: 'import-title' } }),
          this.#card,
          el('p', { class: 'summary', text: S.archive.chooseStrategy }),
          this.#choices,
        ],
      }),
      el('footer', { children: [cancel] }),
    );

    return dialog;
  }
}

function choiceButton(label, hint) {
  return el('button', {
    class: 'choice',
    attrs: { type: 'button' },
    children: [
      el('span', { class: 'label', text: label }),
      el('span', { class: 'hint', text: hint }),
    ],
  });
}

function formatBytes(bytes) {
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

customElements.define('import-dialog', ImportDialog);
