import { el, setChildren } from '../dom.js';
import { S, locale } from '../../config/strings.js';
import { countriesByName, countryFlag } from '../../domain/model/countries.js';
import { supportsFlagEmoji } from '../flag-support.js';
import { base, sheet } from '../styles/sheets.js';
import css from './country-search.css?inline';

const styles = sheet(css);

export class CountrySearch extends HTMLElement {
  #input;
  #list;
  #countries;
  #value = '';
  #editingValue = '';
  #selectedDuringEdit = false;
  #active = -1;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [base, styles];

    this.#input = el('input', {
      attrs: {
        type: 'search',
        placeholder: S.editor.countrySearch,
        'aria-label': S.editor.countrySearch,
        role: 'combobox',
        'aria-expanded': 'false',
        'aria-controls': 'country-results',
        'aria-autocomplete': 'list',
      },
    });
    this.#list = el('ul', {
      class: 'results',
      attrs: { id: 'country-results', role: 'listbox', hidden: true },
    });

    const flags = supportsFlagEmoji();
    this.#countries = [
      { code: '', name: S.editor.noNationality, label: S.editor.noNationality },
      ...countriesByName(locale).map(({ code, name }) => ({
        code,
        name,
        label: flags ? `${countryFlag(code)}  ${name}` : `${name}  (${code})`,
      })),
    ];

    this.#input.addEventListener('focus', this.#onFocus);
    this.#input.addEventListener('input', this.#onInput);
    this.#input.addEventListener('keydown', this.#onKeyDown);
    this.#input.addEventListener('blur', this.#onBlur);
    root.append(this.#input, this.#list);
  }

  get value() {
    return this.#value;
  }

  set value(code) {
    const country = this.#countries.find((item) => item.code === code);
    this.#value = country?.code ?? '';
    this.#input.value = country?.label ?? '';
    this.#close();
  }

  #onFocus = () => {
    this.#editingValue = this.#value;
    this.#selectedDuringEdit = false;
    this.#input.value = '';
    this.#input.select();
    this.#render();
  };

  #onInput = () => {
    this.#value = '';
    this.#active = -1;
    this.#render();
  };

  #onBlur = () =>
    setTimeout(() => {
      if (this.#selectedDuringEdit) this.#close();
      else this.value = this.#editingValue;
    }, 150);

  #onKeyDown = (event) => {
    if (event.key === 'Escape') {
      this.value = this.#editingValue;
      return;
    }

    if (event.key === 'Enter') {
      const chosen = this.#filtered()[Math.max(0, this.#active)];
      if (chosen) {
        event.preventDefault();
        this.#choose(chosen);
      }
      return;
    }

    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    const results = this.#filtered();
    if (step === 0 || results.length === 0) return;

    event.preventDefault();
    this.#active = (this.#active + step + results.length) % results.length;
    this.#render();
  };

  #filtered() {
    const query = this.#input.value.trim().toLocaleLowerCase();
    return this.#countries.filter(
      ({ code, name }) =>
        query === '' ||
        code.toLocaleLowerCase().includes(query) ||
        name.toLocaleLowerCase().includes(query),
    );
  }

  #choose(country) {
    this.#selectedDuringEdit = true;
    this.value = country.code;
    this.#input.blur();
  }

  #close() {
    this.#list.hidden = true;
    this.#input.setAttribute('aria-expanded', 'false');
  }

  #render() {
    const results = this.#filtered();
    this.#active = Math.min(this.#active, results.length - 1);

    setChildren(
      this.#list,
      results.length === 0
        ? [el('li', { class: 'empty', text: S.search.noResults })]
        : results.map((country, index) => {
            const button = el('button', {
              attrs: { type: 'button' },
              children: [el('span', { class: 'name', text: country.label })],
            });
            button.addEventListener('mousedown', (event) => {
              event.preventDefault();
              this.#choose(country);
            });

            return el('li', {
              attrs: {
                role: 'option',
                'aria-selected': String(index === this.#active),
              },
              children: [button],
            });
          }),
    );

    this.#list.hidden = false;
    this.#input.setAttribute('aria-expanded', 'true');
  }
}

customElements.define('country-search', CountrySearch);
