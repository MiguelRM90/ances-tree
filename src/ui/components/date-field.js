/**
 * Composite control for a genealogical date.
 *
 * A selector picks the kind of date, and the right input appears for it: the
 * native date picker for an exact date, a month picker, a year box, two year
 * boxes for a range, or free GEDCOM text for anything exotic.
 *
 * The native pickers also settle the dd/mm vs mm/dd question: the browser shows
 * and accepts the order of the user's own locale, and hands back ISO either
 * way. The app never has to pick a convention.
 *
 * Whatever is entered ends up as a single GEDCOM-shaped `raw` string, which
 * remains the only thing the model stores.
 */

import { el, setChildren, emit } from '../dom.js';
import { base, sheet } from '../styles/sheets.js';
import css from './date-field.css?inline';
import { S } from '../../config/strings.js';
import { DateMode, MODE_INPUT, buildRaw, describeDate } from '../../domain/date/build.js';
import { parseDate, DateKind } from '../../domain/date/parse.js';
import { formatDate } from '../../domain/date/format.js';

const styles = sheet(css);

const MODE_ORDER = [
  DateMode.UNKNOWN,
  DateMode.EXACT,
  DateMode.MONTH,
  DateMode.YEAR,
  DateMode.ABOUT,
  DateMode.ESTIMATED,
  DateMode.BEFORE,
  DateMode.AFTER,
  DateMode.BETWEEN,
  DateMode.RAW,
];

export class DateField extends HTMLElement {
  #select;
  #slot;
  #preview;
  #inputs = {};
  #mode = DateMode.UNKNOWN;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [base, styles];

    this.#select = document.createElement('select');
    // The selector has no visible label of its own — it sits inside a fieldset
    // whose legend says "Born" or "Died" — so it needs an explicit one.
    this.#select.setAttribute('aria-label', S.a11y.dateKind);
    for (const mode of MODE_ORDER) {
      this.#select.append(el('option', { text: S.dateMode[mode], attrs: { value: mode } }));
    }
    this.#select.addEventListener('change', () => this.#setMode(this.#select.value));

    this.#slot = el('span', { class: 'controls-slot' });
    // The preview changes as the user types, so it is announced politely
    // rather than being silent decoration.
    this.#preview = el('div', {
      class: 'preview',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    root.append(
      el('div', { class: 'controls', children: [this.#select, this.#slot] }),
      this.#preview,
    );
  }

  /** @param {import('../../domain/date/parse.js').GenealogicalDate|null} date */
  set value(date) {
    const { mode, values } = describeDate(date);
    this.#select.value = mode;
    this.#setMode(mode, values);
  }

  /** The GEDCOM string to store. Empty when nothing usable was entered. */
  get raw() {
    return buildRaw(this.#mode, this.#values());
  }

  #setMode(mode, values = {}) {
    this.#mode = mode;
    this.#inputs = {};

    const kind = MODE_INPUT[mode];
    const fields = [];

    if (kind === 'date') fields.push(this.#input('date', 'date', values.date));
    if (kind === 'month') fields.push(this.#input('month', 'month', values.month));
    if (kind === 'year') fields.push(this.#yearInput('year', values.year));
    if (kind === 'year-range') {
      fields.push(
        this.#yearInput('from', values.from),
        el('span', { text: S.editor.rangeSeparator }),
        this.#yearInput('to', values.to),
      );
    }
    if (kind === 'text') {
      fields.push(this.#input('text', 'text', values.text, { placeholder: S.editor.dateHint }));
    }

    setChildren(this.#slot, fields);
    this.#refreshPreview();
  }

  #input(name, type, value, attrs = {}) {
    const input = document.createElement('input');
    input.type = type;
    input.value = value ?? '';
    for (const [key, attr] of Object.entries(attrs)) input.setAttribute(key, attr);
    input.addEventListener('input', () => this.#refreshPreview());

    this.#inputs[name] = input;
    return input;
  }

  #yearInput(name, value) {
    const input = this.#input(name, 'number', value, {
      min: '1',
      max: '9999',
      step: '1',
      placeholder: S.editor.year,
    });
    input.classList.add('year');
    return input;
  }

  #values() {
    return Object.fromEntries(
      Object.entries(this.#inputs).map(([name, input]) => [name, input.value]),
    );
  }

  #refreshPreview() {
    const raw = this.raw;

    if (raw === '') {
      this.#preview.textContent = '';
      this.#preview.classList.remove('unknown');
      emit(this, 'date:change', { raw });
      return;
    }

    const parsed = parseDate(raw);
    const unrecognised = parsed.kind === DateKind.UNKNOWN;

    this.#preview.textContent = unrecognised ? S.editor.dateUnrecognised : formatDate(parsed);
    this.#preview.classList.toggle('unknown', unrecognised);

    emit(this, 'date:change', { raw });
  }
}

customElements.define('date-field', DateField);
