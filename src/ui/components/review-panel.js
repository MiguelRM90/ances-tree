/**
 * Every note in the archive, in one list.
 *
 * The validator finds hundreds of things across ten thousand people, and until
 * now the only way to read them was to open persons one at a time and hope to
 * land on one. Going through an archive is a sitting, not a scavenger hunt.
 *
 * Each named person is a button that centres the tree on them, so the panel is
 * a way of working rather than a report.
 */

import { el, setChildren, emit } from '../dom.js';
import { base, sheet } from '../styles/sheets.js';
import css from './review-panel.css?inline';
import { S } from '../../config/strings.js';
import { describeIssue } from '../issue-text.js';
import { Severity } from '../../domain/validation/engine.js';

const styles = sheet(css);

/** Worst first: an error is a blocked save, a note is a suggestion. */
const ORDER = [Severity.ERROR, Severity.WARNING, Severity.INFO];

/** Long lists are capped: nobody reads past a few hundred in one go. */
const SHOWN = 300;

export class ReviewPanel extends HTMLElement {
  #dialog;
  #body;
  #filters;
  #issues = [];
  #graph = null;
  #severity = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [base, styles];
    this.#dialog = this.#build();
    root.append(this.#dialog);
  }

  open(issues, graph) {
    this.#issues = issues;
    this.#graph = graph;
    this.#severity = null;
    this.#render();
    this.#dialog.showModal();
  }

  close() {
    this.#dialog.close();
  }

  #build() {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'review-title');

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) this.close();
    });

    this.#filters = el('div', { class: 'filters', attrs: { role: 'group' } });
    this.#body = el('div', { class: 'body' });

    const close = el('button', { text: S.review.close, attrs: { type: 'button' } });
    close.addEventListener('click', () => this.close());

    dialog.append(
      el('header', {
        children: [
          el('h2', { text: S.review.title, attrs: { id: 'review-title' } }),
          this.#filters,
        ],
      }),
      this.#body,
      el('footer', { children: [close] }),
    );

    return dialog;
  }

  #render() {
    this.#renderFilters();

    const shown = this.#issues.filter(
      (issue) => this.#severity === null || issue.severity === this.#severity,
    );

    if (shown.length === 0) {
      setChildren(this.#body, [el('p', { class: 'empty', text: S.review.nothing })]);
      return;
    }

    const list = el('ul', {
      children: shown.slice(0, SHOWN).map((issue) => this.#row(issue)),
    });

    setChildren(this.#body, [
      list,
      shown.length > SHOWN
        ? el('p', { class: 'empty', text: S.review.more(shown.length - SHOWN) })
        : null,
    ]);
  }

  #renderFilters() {
    const counts = Object.fromEntries(
      ORDER.map((severity) => [
        severity,
        this.#issues.filter((i) => i.severity === severity).length,
      ]),
    );

    const make = (severity, label) => {
      const button = el('button', {
        text:
          severity === null ? `${label} ${this.#issues.length}` : `${label} ${counts[severity]}`,
        attrs: { type: 'button', 'aria-pressed': String(this.#severity === severity) },
      });
      button.addEventListener('click', () => {
        this.#severity = severity;
        this.#render();
      });
      return button;
    };

    setChildren(this.#filters, [
      make(null, S.review.all),
      make(Severity.ERROR, S.review.errors),
      make(Severity.WARNING, S.review.warnings),
      make(Severity.INFO, S.review.notes),
    ]);
  }

  #row(issue) {
    const { title, context, people } = describeIssue(issue, this.#graph);

    const chips = people.map((person) => {
      const button = el('button', {
        text: person.name,
        attrs: { type: 'button', title: S.editor.showPerson(person.name) },
      });
      button.addEventListener('click', () => {
        this.close();
        emit(this, 'person:reveal', { personId: person.id });
      });
      return button;
    });

    return el('li', {
      attrs: { 'data-severity': issue.severity },
      children: [
        el('p', { class: 'what', text: [title, context].filter(Boolean).join(' ') }),
        chips.length > 0 ? el('div', { class: 'who', children: chips }) : null,
      ],
    });
  }
}

customElements.define('review-panel', ReviewPanel);
