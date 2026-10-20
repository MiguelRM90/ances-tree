/**
 * Search for a person by name.
 *
 * The tree only ever shows the few dozen people around whoever is centred, so
 * without this there is no way to reach someone you are not already standing
 * next to.
 *
 * Built as a combobox: arrow keys move through the results, Enter picks one,
 * Escape closes. The results are buttons, so pointer and keyboard reach the
 * same thing rather than the keyboard getting a second implementation.
 */

import { el, setChildren, emit, debounce } from '../dom.js';
import { base, sheet } from '../styles/sheets.js';
import css from './person-search.css?inline';
import { S, locale } from '../../config/strings.js';
import { SEARCH_DEBOUNCE_MS, SEARCH_RESULTS } from '../../config/limits.js';
import { searchPeople } from '../../domain/graph/search.js';

const styles = sheet(css);

export class PersonSearch extends HTMLElement {
  #input;
  #list;
  #graph = null;
  #results = [];
  #active = -1;
  #event = 'person:reveal';
  #exclude = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [base, styles];

    this.#input = document.createElement('input');
    this.#input.type = 'search';
    this.#input.placeholder = S.search.placeholder;
    this.#input.setAttribute('aria-label', S.search.label);
    this.#input.setAttribute('role', 'combobox');
    this.#input.setAttribute('aria-expanded', 'false');
    this.#input.setAttribute('aria-controls', 'results');
    this.#input.setAttribute('aria-autocomplete', 'list');

    this.#list = el('ul', {
      class: 'results',
      attrs: { id: 'results', role: 'listbox', hidden: true },
    });

    root.append(this.#input, this.#list);
  }

  connectedCallback() {
    this.#input.addEventListener('input', this.#onInput);
    this.#input.addEventListener('keydown', this.#onKeyDown);
    this.#input.addEventListener('blur', this.#onBlur);
  }

  disconnectedCallback() {
    this.#input.removeEventListener('input', this.#onInput);
    this.#input.removeEventListener('keydown', this.#onKeyDown);
    this.#input.removeEventListener('blur', this.#onBlur);
  }

  set graph(value) {
    this.#graph = value;
    this.#close();
  }

  /**
   * What choosing a result means here.
   *
   * The toolbar's search navigates; the same control inside the relationship
   * editor picks somebody to link. One implementation, because a second search
   * box would be a second set of keyboard behaviour to get right.
   */
  set eventName(type) {
    this.#event = type || 'person:reveal';
  }

  /** People this search must not offer. Used to keep a lineage acyclic. */
  get exclude() {
    return this.#exclude;
  }

  set exclude(ids) {
    this.#exclude = ids ?? null;
  }

  set placeholder(text) {
    this.#input.placeholder = text;
    this.#input.setAttribute('aria-label', text);
  }

  /** Empties the box without firing anything. */
  reset() {
    this.#input.value = '';
    this.#results = [];
    this.#close();
  }

  #onInput = debounce(() => {
    if (!this.#graph) return;

    // Over-fetched and then filtered: asking for N and discarding some would
    // quietly return fewer than N results for no reason the user can see.
    const found = searchPeople(this.#graph, this.#input.value, {
      limit: this.#exclude ? SEARCH_RESULTS + this.#exclude.size : SEARCH_RESULTS,
      locale,
    });

    this.#results = (this.#exclude ? found.filter((p) => !this.#exclude.has(p.id)) : found).slice(
      0,
      SEARCH_RESULTS,
    );
    this.#active = -1;
    this.#render();
  }, SEARCH_DEBOUNCE_MS);

  // A click on a result fires before blur closes the list, so the close waits
  // a frame.
  #onBlur = () => setTimeout(() => this.#close(), 150);

  #onKeyDown = (event) => {
    if (event.key === 'Escape') {
      this.#close();
      return;
    }

    if (event.key === 'Enter') {
      const chosen = this.#results[Math.max(0, this.#active)];
      if (chosen) {
        event.preventDefault();
        this.#choose(chosen);
      }
      return;
    }

    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || this.#results.length === 0) return;

    event.preventDefault();
    this.#active = (this.#active + step + this.#results.length) % this.#results.length;
    this.#render();
  };

  #choose(result) {
    this.reset();
    emit(this, this.#event, { personId: result.id });
  }

  #close() {
    this.#list.hidden = true;
    this.#input.setAttribute('aria-expanded', 'false');
  }

  #render() {
    const typed = this.#input.value.trim() !== '';

    if (!typed) {
      this.#close();
      return;
    }

    if (this.#results.length === 0) {
      setChildren(this.#list, [el('li', { class: 'empty', text: S.search.noResults })]);
    } else {
      setChildren(
        this.#list,
        this.#results.map((result, index) => {
          const button = el('button', {
            attrs: { type: 'button' },
            children: [
              el('span', { class: 'name', text: result.name }),
              result.lifespan ? el('span', { class: 'dates', text: result.lifespan }) : null,
            ],
          });

          // mousedown, not click: blur would otherwise close the list first.
          button.addEventListener('mousedown', (event) => {
            event.preventDefault();
            this.#choose(result);
          });

          return el('li', {
            attrs: {
              role: 'option',
              'aria-selected': String(index === this.#active),
              'data-placeholder': result.isPlaceholder || null,
            },
            children: [button],
          });
        }),
      );
    }

    this.#list.hidden = false;
    this.#input.setAttribute('aria-expanded', 'true');
  }
}

customElements.define('person-search', PersonSearch);
