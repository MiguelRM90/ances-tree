/**
 * A button that opens a short list of actions.
 *
 * The toolbar had grown to eleven buttons in a row, most of which belong to two
 * or three families. Folding each family behind one label keeps the whole thing
 * readable without hiding anything more than one click deep.
 *
 * Keyboard: Enter, Space or Down opens and lands on the first item; the arrows
 * move; Escape closes and gives focus back to the trigger, which is what makes
 * a menu escapable rather than a trap.
 */

import { el, setChildren, emit } from '../dom.js';
import { base, sheet } from '../styles/sheets.js';
import css from './menu-button.css?inline';

const styles = sheet(css);

export class MenuButton extends HTMLElement {
  #trigger;
  #menu;
  #items = [];

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [base, styles];

    this.#trigger = el('button', {
      class: 'trigger',
      attrs: { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
    });

    this.#menu = el('ul', { class: 'menu', attrs: { role: 'menu', hidden: true } });

    root.append(this.#trigger, this.#menu);
  }

  connectedCallback() {
    this.#trigger.addEventListener('click', this.#toggle);
    this.#trigger.addEventListener('keydown', this.#onTriggerKey);
    this.#menu.addEventListener('keydown', this.#onMenuKey);
    document.addEventListener('pointerdown', this.#onOutside);
  }

  disconnectedCallback() {
    this.#trigger.removeEventListener('click', this.#toggle);
    this.#trigger.removeEventListener('keydown', this.#onTriggerKey);
    this.#menu.removeEventListener('keydown', this.#onMenuKey);
    document.removeEventListener('pointerdown', this.#onOutside);
  }

  set label(text) {
    this.#trigger.textContent = text;
  }

  /** @param {Array<{label: string, action: Function, separatorBefore?: boolean}>} items */
  set items(items) {
    this.#items = items;

    setChildren(
      this.#menu,
      items.flatMap((item) => {
        const button = el('button', {
          text: item.label,
          attrs: { type: 'button', role: 'menuitem' },
        });
        button.addEventListener('click', () => {
          this.close();
          item.action();
        });

        const entry = el('li', { attrs: { role: 'none' }, children: [button] });
        return item.separatorBefore
          ? [el('li', { attrs: { role: 'none' }, children: [el('hr')] }), entry]
          : [entry];
      }),
    );
  }

  get open() {
    return !this.#menu.hidden;
  }

  close({ restoreFocus = false } = {}) {
    if (!this.open) return;
    this.#menu.hidden = true;
    this.#trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.#trigger.focus();
  }

  #show(focusFirst) {
    // Only one menu at a time: opening this one asks the others to stand down.
    emit(this, 'menu:open', { source: this });

    this.#menu.hidden = false;
    this.#trigger.setAttribute('aria-expanded', 'true');
    if (focusFirst) this.#buttons()[0]?.focus();
  }

  #toggle = () => (this.open ? this.close() : this.#show(false));

  #buttons = () => [...this.#menu.querySelectorAll('button')];

  #onTriggerKey = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    this.#show(true);
  };

  #onMenuKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close({ restoreFocus: true });
      return;
    }

    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;

    event.preventDefault();
    const buttons = this.#buttons();
    const at = buttons.indexOf(this.#menu.querySelector('button:focus'));
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  };

  #onOutside = (event) => {
    if (this.open && !event.composedPath().includes(this)) this.close();
  };
}

customElements.define('menu-button', MenuButton);
