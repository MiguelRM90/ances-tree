/**
 * Relationship editor: who someone's parents are, and who they were with.
 *
 * Kept out of the person editor on purpose. That dialog is a form — you change
 * fields, press Save, and Cancel undoes the lot. A relationship is not a field
 * on a person; it is an entity between two of them, and every change here takes
 * effect at once and is reversed with Undo like any other edit. Putting both
 * models in one dialog would mean Cancel undid half of what you did.
 *
 * Nothing here validates. Every change goes through the store, which refuses
 * anything that would leave the graph inconsistent — a loop in the lineage, a
 * third biological parent, the same pair twice — and the refusal comes back as
 * a readable message. What the interface does do is decline to OFFER a choice
 * that would be refused: the search for a new parent hides the person
 * themselves and everybody below them.
 */

import { el, emit, setChildren, debounce } from '../dom.js';
import { base, sheet } from '../styles/sheets.js';
import css from './relation-editor.css?inline';
import { S } from '../../config/strings.js';
import { UnionType, ParentType } from '../../domain/model/factories.js';
import { parseDate } from '../../domain/date/parse.js';
import { RELATION_EDIT_DEBOUNCE_MS } from '../../config/limits.js';
import {
  displayName,
  parentLinksOf,
  unionsOf,
  partnerIn,
  partnersOf,
  descendantIds,
} from '../../domain/graph/queries.js';
import './date-field.js';
import './person-search.js';

const styles = sheet(css);

export class RelationEditor extends HTMLElement {
  #dialog;
  #title;
  #parents;
  #couple;
  #partners;
  #search;
  #partnerSearch;
  #personId = null;
  /**
   * A getter rather than a snapshot. Every change rewrites the graph, so a copy
   * taken when the dialog opened would be one edit out of date from then on.
   */
  #getGraph = () => null;
  /** The parent link currently being reassigned, if any. */
  #replacing = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [base, styles];
    this.#dialog = this.#build();
    root.append(this.#dialog);
  }

  /**
   * @param {string} personId
   * @param {() => object} getGraph  reads the current indexed graph
   */
  open(personId, getGraph) {
    this.#personId = personId;
    this.#getGraph = getGraph;
    this.#replacing = null;
    this.#search.reset();
    this.#partnerSearch.reset();
    this.#render();
    this.#dialog.showModal();
  }

  close() {
    this.#search.reset();
    this.#partnerSearch.reset();
    this.#dialog.close();
  }

  #build() {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'relations-title');
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });

    this.#title = el('h2', { attrs: { id: 'relations-title' } });
    this.#parents = el('ul', { class: 'rows' });
    this.#couple = document.createElement('select');
    this.#partners = el('ul', { class: 'rows' });

    this.#couple.setAttribute('aria-label', S.relations.couple);
    this.#couple.addEventListener('change', () =>
      this.#act('setChildUnion', this.#personId, this.#couple.value || null),
    );

    this.#search = document.createElement('person-search');
    this.#search.eventName = 'relation:pick';
    this.#search.placeholder = S.relations.addParent;
    this.addEventListener('relation:pick', this.#onPick);

    this.#partnerSearch = document.createElement('person-search');
    this.#partnerSearch.eventName = 'relation:pick-partner';
    this.#partnerSearch.placeholder = S.relations.addPartner;
    this.addEventListener('relation:pick-partner', this.#onPickPartner);

    const done = el('button', {
      class: 'primary',
      text: S.relations.done,
      attrs: { type: 'button' },
    });
    done.addEventListener('click', () => this.close());

    dialog.append(
      el('div', {
        class: 'body',
        children: [
          this.#title,
          fieldset(S.relations.parents, [
            this.#parents,
            el('p', { class: 'note', text: S.relations.addParentHint }),
            this.#search,
          ]),
          fieldset(S.relations.couple, [
            this.#couple,
            el('p', { class: 'note', text: S.relations.coupleHint }),
          ]),
          fieldset(S.relations.partners, [
            this.#partners,
            el('p', { class: 'note', text: S.relations.addPartnerHint }),
            this.#partnerSearch,
          ]),
        ],
      }),
      el('footer', { children: [done] }),
    );

    return dialog;
  }

  // --- Rendering -----------------------------------------------------------

  #render() {
    const graph = this.#getGraph();
    const person = graph?.persons.get(this.#personId);
    if (!person) return;

    this.#title.textContent = S.relations.title(displayName(person));

    this.#search.graph = graph;
    this.#search.exclude = descendantIds(graph, this.#personId);

    const excludePartners = new Set(descendantIds(graph, this.#personId));
    for (const partner of partnersOf(graph, this.#personId)) {
      excludePartners.add(partner.id);
    }
    this.#partnerSearch.graph = graph;
    this.#partnerSearch.exclude = excludePartners;

    this.#renderParents(graph);
    this.#renderCouple(graph);
    this.#renderPartners(graph);
  }

  #renderParents(graph) {
    const links = parentLinksOf(graph, this.#personId);

    setChildren(
      this.#parents,
      links.length === 0
        ? [el('li', { class: 'empty', text: S.relations.noParents })]
        : links.map((link) => this.#parentRow(graph, link)),
    );
  }

  #parentRow(graph, link) {
    const name = this.#nameOf(graph, link.parentId);

    // Reassigning reuses the same search rather than adding a second control:
    // the row becomes a search box until somebody is chosen, or it is cancelled.
    if (this.#replacing === link.id) {
      const search = document.createElement('person-search');
      search.eventName = 'relation:pick';
      search.placeholder = S.relations.replacing(name);
      search.graph = graph;
      search.exclude = descendantIds(graph, this.#personId);

      const cancel = el('button', { text: S.relations.cancel, attrs: { type: 'button' } });
      cancel.addEventListener('click', () => {
        this.#replacing = null;
        this.#render();
      });

      return el('li', { class: 'replacing', children: [search, cancel] });
    }

    const kind = enumSelect(ParentType, S.parentType, link.type, S.relations.parentType);
    kind.addEventListener('change', () =>
      this.#act('updateParentLink', link.id, { type: kind.value }),
    );

    const change = el('button', {
      text: S.relations.change,
      attrs: { type: 'button', 'aria-label': S.relations.changeParent(name) },
    });
    change.addEventListener('click', () => {
      this.#replacing = link.id;
      this.#render();
    });

    const remove = el('button', {
      class: 'danger',
      text: S.relations.remove,
      attrs: { type: 'button', 'aria-label': S.relations.removeParent(name) },
    });
    remove.addEventListener('click', () => this.#act('removeEntity', 'parentChild', link.id));

    return el('li', {
      children: [
        el('span', { class: 'who', text: name }),
        kind,
        el('span', { class: 'row-actions', children: [change, remove] }),
      ],
    });
  }

  /**
   * Which couple this person descends from.
   *
   * The choices are the unions of whoever is already recorded as a parent —
   * the only ones that can be true without contradicting what is there. This
   * is the control that answers "I added a father, then gave him a wife, and
   * now the child hangs off him alone".
   */
  #renderCouple(graph) {
    const links = parentLinksOf(graph, this.#personId);
    const seen = new Set();
    const options = [];

    for (const link of links) {
      for (const union of unionsOf(graph, link.parentId)) {
        if (seen.has(union.id)) continue;
        seen.add(union.id);
        options.push(union);
      }
    }

    setChildren(this.#couple, [
      el('option', { text: S.relations.noCouple, attrs: { value: '' } }),
      ...options.map((union) =>
        el('option', {
          text: S.relations.coupleOf(
            this.#nameOf(graph, union.partner1Id),
            this.#nameOf(graph, union.partner2Id),
          ),
          attrs: { value: union.id },
        }),
      ),
    ]);

    this.#couple.value = links.find((link) => link.unionId)?.unionId ?? '';
    this.#couple.disabled = options.length === 0;
  }

  #renderPartners(graph) {
    const unions = unionsOf(graph, this.#personId);

    setChildren(
      this.#partners,
      unions.length === 0
        ? [el('li', { class: 'empty', text: S.relations.noPartners })]
        : unions.map((union) => this.#partnerRow(graph, union)),
    );
  }

  #partnerRow(graph, union) {
    const name = this.#nameOf(graph, partnerIn(union, this.#personId));

    const kind = enumSelect(UnionType, S.unionType, union.type, S.relations.unionType);
    kind.addEventListener('change', () => this.#act('updateUnion', union.id, { type: kind.value }));

    const remove = el('button', {
      class: 'danger',
      text: S.relations.remove,
      attrs: { type: 'button', 'aria-label': S.relations.removeUnion(name) },
    });
    remove.addEventListener('click', () => this.#act('removeEntity', 'union', union.id));

    return el('li', {
      class: 'union',
      children: [
        el('span', { class: 'who', text: name }),
        kind,
        el('span', { class: 'row-actions', children: [remove] }),
        el('div', {
          class: 'dates',
          children: [
            this.#unionDate(union, 'startDate', S.relations.started),
            // A marriage that ended is a marriage with an end date, not a
            // separate kind of union — which is also how it leaves in a
            // GEDCOM, as MARR alongside DIV.
            this.#unionDate(union, 'endDate', S.relations.ended),
          ],
        }),
      ],
    });
  }

  #unionDate(union, field, labelText) {
    const control = document.createElement('date-field');
    control.value = union[field] ?? null;

    // Debounced, and it does NOT repaint. date:change fires on every keystroke,
    // and rebuilding the row underneath would take the cursor with it.
    const apply = debounce(() => {
      const raw = control.raw;
      this.#send('updateUnion', union.id, { [field]: raw === '' ? null : parseDate(raw) });
    }, RELATION_EDIT_DEBOUNCE_MS);

    control.addEventListener('date:change', apply);

    return el('label', { children: [el('span', { text: labelText }), control] });
  }

  // --- Intent --------------------------------------------------------------

  #onPick = (event) => {
    // Stopped here: the toolbar's search uses a different event, but app-root
    // listens on itself and must not read this one as a request to move.
    event.stopPropagation();

    const { personId } = event.detail;
    const link = this.#replacing;
    this.#replacing = null;

    if (link) this.#act('updateParentLink', link, { parentId: personId });
    else this.#act('addParentLink', this.#personId, personId);
  };

  #onPickPartner = (event) => {
    event.stopPropagation();
    const { personId } = event.detail;
    this.#act('addUnion', this.#personId, personId);
  };

  /**
   * Asks for a change and repaints.
   *
   * The host owns the store; this component only names what was asked for. It
   * repaints either way, because a change that was refused still has to put the
   * control back to what the data actually says.
   */
  #act(action, ...args) {
    this.#send(action, ...args);
    this.#search.reset();
    this.#partnerSearch.reset();
    this.#render();
  }

  #send(action, ...args) {
    emit(this, 'relation:change', { action, args });
  }

  #nameOf(graph, personId) {
    const person = graph.persons.get(personId);
    return person ? displayName(person) : S.relations.unknownPerson;
  }
}

function enumSelect(values, labels, current, ariaLabel) {
  const node = document.createElement('select');
  for (const value of Object.values(values)) {
    node.append(el('option', { text: labels[value], attrs: { value } }));
  }
  node.value = current;
  node.setAttribute('aria-label', ariaLabel);
  return node;
}

function fieldset(legend, children) {
  const node = document.createElement('fieldset');
  node.append(el('legend', { text: legend }), ...children);
  return node;
}

customElements.define('relation-editor', RelationEditor);
