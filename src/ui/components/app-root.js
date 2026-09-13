/**
 * Application root: decides which screen is shown and turns the components'
 * intent events into store calls.
 *
 * Components never talk to each other: intent bubbles up as CustomEvent, state
 * comes down as properties (architecture.md, store section).
 */

import { el, clear, setChildren } from '../dom.js';
import { base, sheet } from '../styles/sheets.js';
import css from './app-root.css?inline';
import { S, LOCALES, locale, setLocale } from '../../config/strings.js';
import { describeIssue } from '../issue-text.js';
import { photosOf, documentsOf, displayName } from '../../domain/graph/queries.js';
import { store } from '../../store/store.js';
import * as actions from '../../store/actions.js';
import './tree-canvas.js';
import './person-editor.js';
import './import-dialog.js';
import './app-notice.js';
import './person-search.js';
import './review-panel.js';
import './relation-editor.js';
import './menu-button.js';

const styles = sheet(css);

const STORAGE_NOTICE_KEY = 'ancestree.browserStorageExplained';

/** The last save, in the reader's own date format. Empty if never recorded. */
function formatSaved(iso) {
  if (!iso) return '';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(when);
}

/** Rounded to whatever unit keeps the number readable. */
function formatBytes(bytes) {
  const mb = bytes / 1e6;
  const unit = mb < 1 ? 'kilobyte' : mb < 1000 ? 'megabyte' : 'gigabyte';
  const value = mb < 1 ? bytes / 1e3 : mb < 1000 ? mb : mb / 1000;

  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

export class AppRoot extends HTMLElement {
  #main;
  #surface;
  #menus = [];
  #status;
  #toolbar;
  #notices;
  #buttons = {};
  #depth = {};
  #focal;
  #search;
  #storage = null;
  #storageExplained = false;
  #tree = null;
  #editor = null;
  #importer = null;
  #review = null;
  #relations = null;
  #pendingImport = null;
  #message = '';

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [base, styles];

    // Save state is a quiet, self-replacing line rather than a notification:
    // autosave fires constantly and must never demand attention.
    this.#status = el('span', {
      class: 'status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    // Says who the tree is centred on, so re-rooting stops looking arbitrary.
    this.#focal = el('span', { class: 'focal' });
    this.#search = document.createElement('person-search');

    // The stage does not scroll; the surface inside it does. That is what lets
    // the "centred on" label sit over the tree instead of scrolling away with
    // it.
    this.#surface = el('div', { class: 'surface' });
    this.#main = el('main', { children: [this.#surface, this.#focal] });
    this.#notices = document.createElement('app-notice');

    root.append(this.#header(), this.#main, this.#notices);
  }

  connectedCallback() {
    for (const type of ['open', 'close', 'change', 'trail']) {
      store.addEventListener(type, this.#render);
    }
    store.addEventListener('saving', this.#onSaving);
    store.addEventListener('saved', this.#onSaved);
    store.addEventListener('save-error', this.#onSaveError);

    this.addEventListener('person:focus', this.#onPersonFocus);
    this.addEventListener('person:save', this.#onPersonSave);
    this.addEventListener('person:delete', this.#onPersonDelete);
    this.addEventListener('import:merge', this.#onImportMerge);
    this.addEventListener('import:new', this.#onImportNew);
    this.addEventListener('person:reveal', this.#onPersonReveal);
    this.addEventListener('menu:open', this.#onMenuOpen);
    this.addEventListener('relation:change', this.#onRelationChange);
    this.addEventListener('photos:add', this.#onPhotosAdd);
    this.addEventListener('photo:portrait', this.#onPhotoPortrait);
    this.addEventListener('photo:remove', this.#onPhotoRemove);
    this.addEventListener('documents:add', this.#onDocumentsAdd);
    this.addEventListener('document:remove', this.#onDocumentRemove);
    this.addEventListener('document:download', this.#onDocumentDownload);

    this.#render();
  }

  disconnectedCallback() {
    for (const type of ['open', 'close', 'change', 'trail']) {
      store.removeEventListener(type, this.#render);
    }
    store.removeEventListener('saving', this.#onSaving);
    store.removeEventListener('saved', this.#onSaved);
    store.removeEventListener('save-error', this.#onSaveError);

    this.removeEventListener('person:focus', this.#onPersonFocus);
    this.removeEventListener('person:save', this.#onPersonSave);
    this.removeEventListener('person:delete', this.#onPersonDelete);
    this.removeEventListener('import:merge', this.#onImportMerge);
    this.removeEventListener('import:new', this.#onImportNew);
    this.removeEventListener('person:reveal', this.#onPersonReveal);
    this.removeEventListener('menu:open', this.#onMenuOpen);
    this.removeEventListener('relation:change', this.#onRelationChange);
    this.removeEventListener('photos:add', this.#onPhotosAdd);
    this.removeEventListener('photo:portrait', this.#onPhotoPortrait);
    this.removeEventListener('photo:remove', this.#onPhotoRemove);
    this.removeEventListener('documents:add', this.#onDocumentsAdd);
    this.removeEventListener('document:remove', this.#onDocumentRemove);
    this.removeEventListener('document:download', this.#onDocumentDownload);
  }

  /** The requirements screen is set by main.js before anything else starts. */
  set unsupported(detail) {
    this.#showUnsupported(detail);
  }

  // --- Chrome --------------------------------------------------------------

  #header() {
    const make = (key, label, onClick) => {
      const button = el('button', { text: label, attrs: { type: 'button' } });
      button.addEventListener('click', onClick);
      this.#buttons[key] = button;
      return button;
    };

    this.#toolbar = el('div', {
      class: 'actions-inline',
      attrs: { role: 'toolbar', 'aria-label': S.a11y.toolbar },
      children: [
        make('back', S.toolbar.back, () => store.goBack()),
        make('edit', S.toolbar.edit, () => this.#editFocal()),
        make('relations', S.relations.open, () => this.#editRelations()),

        // Two families of actions behind one label each. Eleven buttons in a
        // row was a wall; this is the same reach, one click deeper.
        this.#menu(S.toolbar.add, [
          { label: S.toolbar.addParent, action: () => this.#add(actions.addParentFor) },
          { label: S.toolbar.addPartner, action: () => this.#add(actions.addPartnerFor) },
          { label: S.toolbar.addChild, action: () => this.#add(actions.addChildFor) },
        ]),

        el('div', { class: 'divider' }),
        make('undo', S.toolbar.undo, () => store.undo()),
        make('redo', S.toolbar.redo, () => store.redo()),
        el('div', { class: 'divider' }),
        make('review', S.toolbar.review, () => this.#openReview()),

        this.#menu(S.toolbar.transfer, [
          { label: S.toolbar.exportZip, action: () => this.#exportArchive() },
          { label: S.toolbar.importZip, action: () => this.#startImport() },
          {
            label: S.toolbar.exportGedcom,
            action: () => this.#exportGedcom(),
            separatorBefore: true,
          },
          { label: S.toolbar.importGedcom, action: () => this.#importGedcom() },
        ]),

        el('div', { class: 'divider' }),
        this.#depthPicker('up', S.toolbar.ancestors, S.toolbar.generationsUp),
        this.#depthPicker('down', S.toolbar.descendants, S.toolbar.generationsDown),
        el('div', { class: 'divider' }),
        this.#languagePicker(),
      ],
    });

    this.#buttons.back.title = S.toolbar.backTo;

    return el('header', {
      children: [
        el('h1', { text: S.app.name }),
        this.#toolbar,
        el('div', { class: 'spacer' }),
        this.#search,
        this.#storageBadge(),
        this.#status,
      ],
    });
  }

  /**
   * Where the archive is being kept, when the answer is "not on your disk".
   *
   * A standing label rather than a one-off warning: the difference between the
   * two storage modes is permanent, so a notice that can be dismissed and
   * forgotten is not enough. Pressing it explains the consequences in full.
   */
  #storageBadge() {
    if (!actions.isBrowserStorage()) return null;

    this.#storage = el('button', {
      class: 'badge',
      text: S.browserStorage.badge,
      attrs: { type: 'button', title: S.browserStorage.title },
    });

    this.#storage.addEventListener('click', () => void this.#explainStorage());
    return this.#storage;
  }

  /**
   * The same explanation, unprompted, the first time an archive is opened on
   * this device — and only the first time. After that the badge carries it: a
   * warning repeated every session stops being read by session three.
   */
  #maybeExplainStorage() {
    if (!actions.isBrowserStorage() || this.#storageExplained) return;
    this.#storageExplained = true;

    try {
      if (localStorage.getItem(STORAGE_NOTICE_KEY)) return;
      localStorage.setItem(STORAGE_NOTICE_KEY, '1');
    } catch {
      // A browser refusing localStorage is a browser likely to drop the archive
      // as well, so failing to remember means showing it, not hiding it.
    }

    void this.#explainStorage();
  }

  async #explainStorage() {
    const [persisted, estimate] = await Promise.all([
      actions.requestPersistence(),
      actions.storageEstimate(),
    ]);

    this.#notices.show({
      severity: 'warning',
      title: S.browserStorage.title,
      detail: [
        S.browserStorage.body,
        S.browserStorage.advice,
        persisted ? S.browserStorage.persisted : S.browserStorage.notPersisted,
        estimate ? S.browserStorage.usage(formatBytes(estimate.usage)) : '',
        persisted ? '' : S.browserStorage.installHint,
      ]
        .filter(Boolean)
        .join(' '),
    });
  }

  #onMenuOpen = (event) => {
    for (const menu of this.#menus) {
      if (menu !== event.detail.source) menu.close();
    }
  };

  /** One open menu at a time. */
  #menu(label, items) {
    const menu = document.createElement('menu-button');
    menu.label = label;
    menu.items = items;
    this.#menus.push(menu);
    return menu;
  }

  /**
   * The language of the interface, not of the archive.
   *
   * Changing it reloads the page: several components build their labels once,
   * when they are created, so repainting in place would leave some of them in
   * the old language.
   */
  #languagePicker() {
    const select = document.createElement('select');
    select.setAttribute('aria-label', S.toolbar.language);
    select.title = S.toolbar.language;

    for (const { code, label } of LOCALES) {
      select.append(el('option', { text: label, attrs: { value: code } }));
    }

    select.value = locale;
    select.addEventListener('change', () => setLocale(select.value));

    return el('label', { class: 'depth', children: [select] });
  }

  /** How many generations are drawn in one direction. */
  #depthPicker(key, label, description) {
    const select = document.createElement('select');
    select.setAttribute('aria-label', description);
    select.title = description;

    for (let depth = 0; depth <= 8; depth += 1) {
      select.append(el('option', { text: String(depth), attrs: { value: depth } }));
    }

    select.addEventListener('change', () =>
      actions.setGenerationWindow({ [key]: Number(select.value) }),
    );

    this.#depth[key] = select;
    return el('label', { class: 'depth', children: [el('span', { text: label }), select] });
  }

  #syncToolbar() {
    const open = store.isOpen && store.focalPersonId !== null;
    this.#toolbar.hidden = !open;
    this.#focal.hidden = !open;
    this.#search.hidden = !open;
    if (!open) return;

    this.#search.graph = store.graph;
    this.#buttons.back.disabled = !store.canGoBack;
    this.#buttons.undo.disabled = !store.canUndo;
    this.#buttons.redo.disabled = !store.canRedo;

    this.#depth.up.value = String(store.project.settings.maxGenerationsUp);
    this.#depth.down.value = String(store.project.settings.maxGenerationsDown);

    const name = displayName(store.graph.persons.get(store.focalPersonId));
    this.#focal.title = `${S.toolbar.centredOn} ${name}`;
    setChildren(this.#focal, [
      el('span', { text: `${S.toolbar.centredOn} ` }),
      el('b', { text: name }),
    ]);
  }

  #onSaving = () => this.#setStatus(S.tree.saving);
  #onSaved = () => this.#setStatus(S.tree.saved);

  #onSaveError = () => {
    this.#setStatus('');
    this.#notices.show({ severity: 'error', title: S.tree.saveError });
  };

  #setStatus(text) {
    this.#status.textContent = text;
  }

  // --- Intent handlers -----------------------------------------------------

  /**
   * Clicking a person centres the tree on them. Clicking the person who is
   * already centred opens the editor — one click, two obvious meanings, and no
   * extra affordance on every card.
   */
  #onPersonFocus = (event) => {
    const { personId } = event.detail;
    if (personId === store.focalPersonId) this.#editPerson(personId);
    else store.setFocalPerson(personId);
  };

  #onPersonSave = (event) => {
    const { personId, changes } = event.detail;
    const result = actions.updatePerson(personId, changes);
    if (!result.ok) this.#reportBlocked(result.errors);
  };

  #onPersonDelete = (event) => {
    actions.removeEntity('person', event.detail.personId);
  };

  #add(action) {
    const focalId = store.focalPersonId;
    if (focalId === null) return;

    const result = action(focalId);
    if (!result.ok) {
      this.#reportBlocked(result.errors);
      return;
    }
    // A new relative starts blank, so the editor opens straight away: creating
    // an unnamed person and leaving the user to find them is not useful.
    this.#editPerson(result.person.id, { isNew: true });
  }

  #editFocal() {
    if (store.focalPersonId !== null) this.#editPerson(store.focalPersonId);
  }

  #editPerson(personId, { isNew = false } = {}) {
    const person = store.graph?.persons.get(personId);
    if (!person) return;

    if (!this.#editor) {
      this.#editor = document.createElement('person-editor');
      this.#editor.resolvePhoto = (path) => store.photoUrl(path);
      this.shadowRoot.append(this.#editor);
    }
    this.#editor.open(person, {
      photos: photosOf(store.graph, personId),
      documents: documentsOf(store.graph, personId),
      issues: store.issuesFor(personId),
      graph: store.graph,
      isNew,
    });
  }

  /**
   * Who this person's parents were, and who they were with.
   *
   * The graph is passed as a getter, not a snapshot: every change inside the
   * dialog rewrites it, and a copy taken on open would be one edit stale from
   * the first click onwards.
   */
  #editRelations() {
    if (store.focalPersonId === null) return;

    if (!this.#relations) {
      this.#relations = document.createElement('relation-editor');
      this.shadowRoot.append(this.#relations);
    }

    this.#relations.open(store.focalPersonId, () => store.graph);
  }

  /**
   * The relationship editor names an action; the store performs it.
   *
   * Every one of them can be refused — a loop in the lineage, a third
   * biological parent — and a refusal has to be said out loud, because the
   * dialog has already repainted the control back to what the data says and
   * would otherwise look as though nothing had happened.
   */
  #onRelationChange = (event) => {
    const { action, args } = event.detail;
    const result = actions[action]?.(...args);
    if (result && result.ok === false && result.errors) this.#reportBlocked(result.errors);
  };

  /**
   * Jumping to someone named in a note. Closes the editor first: the point of
   * the jump is to look at the tree.
   */
  #onPersonReveal = (event) => {
    this.#editor?.close();
    store.setFocalPerson(event.detail.personId);
  };

  // --- Photos --------------------------------------------------------------

  #onPhotosAdd = (event) => {
    const { personId } = event.detail;

    void this.#guarded(async () => {
      const result = await actions.addPhotosFor(personId);
      if (result.cancelled) return;

      this.#editor?.refreshPhotos(photosOf(store.graph, personId));
      this.#reportPhotoImport(result);
    });
  };

  #onPhotoPortrait = (event) => {
    const { mediaId, personId } = event.detail;
    actions.setPortrait(mediaId, personId);
    this.#editor?.refreshPhotos(photosOf(store.graph, personId));
  };

  #onPhotoRemove = (event) => {
    const { mediaId, personId } = event.detail;
    actions.removePhotoFrom(mediaId, personId);
    this.#editor?.refreshPhotos(photosOf(store.graph, personId));
  };

  /** One unreadable file must not hide the fact that the others worked. */
  #reportPhotoImport({ added = 0, reused = 0, failed = [] }) {
    const detail = [
      reused > 0 ? S.editor.photosReused(reused) : '',
      failed.length > 0 ? S.editor.photosFailed(failed.length) : '',
    ]
      .filter(Boolean)
      .join(' · ');

    if (added === 0 && reused === 0) {
      this.#notices.show({
        severity: 'error',
        title: failed[0]?.message ?? S.editor.photosFailed(failed.length),
      });
      return;
    }

    this.#notices.show({
      severity: failed.length > 0 ? 'warning' : 'success',
      title: S.editor.photosAdded(added),
      detail,
    });
  }

  // --- Documents -----------------------------------------------------------

  #onDocumentsAdd = (event) => {
    const { personId } = event.detail;

    void this.#guarded(async () => {
      const result = await actions.addDocumentsFor(personId);
      if (result.cancelled) return;

      this.#editor?.refreshDocuments(documentsOf(store.graph, personId));
      this.#reportDocumentImport(result);
    });
  };

  #onDocumentRemove = (event) => {
    const { mediaId, personId } = event.detail;
    actions.removeDocumentFrom(mediaId, personId);
    this.#editor?.refreshDocuments(documentsOf(store.graph, personId));
  };

  #onDocumentDownload = (event) => {
    const { mediaId } = event.detail;
    void this.#guarded(async () => {
      await actions.downloadDocument(mediaId);
    });
  };

  #reportDocumentImport({ added = 0, reused = 0, failed = [] }) {
    const detail = [
      reused > 0 ? S.editor.documentsReused(reused) : '',
      failed.length > 0 ? S.editor.documentsFailed(failed.length) : '',
    ]
      .filter(Boolean)
      .join(' · ');

    if (added === 0 && reused === 0) {
      this.#notices.show({
        severity: 'error',
        title: failed[0]?.message ?? S.editor.documentsFailed(failed.length),
      });
      return;
    }

    this.#notices.show({
      severity: failed.length > 0 ? 'warning' : 'success',
      title: S.editor.documentsAdded(added),
      detail,
    });
  }

  /**
   * Blocking errors are rare by design — only structurally impossible data —
   * so when one happens it must say what actually went wrong, in words, naming
   * the people involved. Never the raw rule id.
   */
  #reportBlocked(errors = []) {
    const issue = errors[0];

    if (!issue) {
      this.#notices.show({
        severity: 'error',
        title: S.notice.changeRejected,
        detail: S.notice.changeRejectedDetail,
      });
      return;
    }

    const { title, detail } = describeIssue(issue, store.graph);
    this.#notices.show({ severity: 'error', title, detail });
  }

  // --- Archives ------------------------------------------------------------

  #exportArchive() {
    this.#notices.show({ title: S.archive.exporting });

    void this.#guarded(async () => {
      const result = await actions.exportArchive();
      if (result.cancelled) this.#notices.clearTransient();
      else if (result.ok) {
        this.#notices.show({ severity: 'success', title: S.archive.exported(result.entries) });
      }
    });
  }

  #exportGedcom() {
    void this.#guarded(async () => {
      const result = await actions.exportGedcom();
      if (result.cancelled || !result.ok) return;

      // The lossiness is stated every time rather than buried in a document:
      // someone exporting a GEDCOM is about to hand it to another application.
      this.#notices.show({
        severity: 'success',
        title: S.archive.gedcomWritten(result.persons),
        detail: S.archive.gedcomLossy,
      });
    });
  }

  /**
   * A GEDCOM is read whole and turned into a project in memory, then saved
   * into a folder of its own. It never merges into an open archive: the ids in
   * a foreign file mean nothing here, so everything would arrive as a
   * duplicate.
   */
  #importGedcom() {
    void this.#guarded(async () => {
      const result = await actions.beginGedcomImport();
      if (!result) return;

      const saved = await actions.finishGedcomImport(result);
      if (saved.cancelled) return;

      const detail = [
        result.warnings.length > 0 ? S.archive.gedcomWarnings(result.warnings.length) : '',
        result.encoding !== 'UTF-8' ? S.archive.gedcomEncoding(result.encoding) : '',
        result.counts.media > 0 ? S.archive.gedcomPhotos : '',
      ]
        .filter(Boolean)
        .join(' · ');

      this.#notices.show({
        severity: result.warnings.length > 0 ? 'warning' : 'success',
        title: S.archive.gedcomRead(result.counts),
        detail,
      });
    });
  }

  #openReview() {
    if (!this.#review) {
      this.#review = document.createElement('review-panel');
      this.shadowRoot.append(this.#review);
    }
    this.#review.open(store.issues, store.graph);
  }

  /**
   * Import happens in two steps: read what is inside the archive, then let the
   * user pick the strategy. Nothing is written before that choice.
   */
  #startImport() {
    void this.#guarded(async () => {
      const inspection = await actions.beginImport();
      if (!inspection) return;

      this.#pendingImport = inspection;

      if (!this.#importer) {
        this.#importer = document.createElement('import-dialog');
        this.shadowRoot.append(this.#importer);
      }
      this.#importer.open(inspection, store.isOpen);
    });
  }

  #onImportMerge = () => this.#finishImport(actions.finishImportByMerge);
  #onImportNew = () => this.#finishImport(actions.finishImportAsNew);

  #finishImport(strategy) {
    const inspection = this.#pendingImport;
    if (!inspection) return;
    this.#pendingImport = null;

    void this.#guarded(async () => {
      const result = await strategy(inspection);
      if (result?.cancelled) return;

      if (!result?.ok) {
        this.#reportBlocked(result?.errors);
        return;
      }

      const damaged = result.warnings?.length ?? 0;

      this.#notices.show({
        severity: damaged > 0 ? 'warning' : 'success',
        title: result.added ? S.archive.merged(result.added) : S.archive.imported,
        detail: damaged > 0 ? S.archive.damaged(damaged) : '',
      });
    });
  }

  /** Turns a failure into a readable notice instead of an unhandled rejection. */
  async #guarded(operation) {
    try {
      return await operation();
    } catch (error) {
      this.#notices.show({ severity: 'error', title: error?.message ?? String(error) });
      return null;
    }
  }

  // --- Screens -------------------------------------------------------------

  #render = () => {
    this.#syncToolbar();

    if (!store.isOpen) {
      // Never `void`: a rejection here used to leave a blank page and no trace
      // of why, because the only screen the user could have reached was the one
      // that failed to build.
      this.#showWelcome().catch((error) =>
        this.#notices.show({ severity: 'error', title: error?.message ?? String(error) }),
      );
      return;
    }

    this.#maybeExplainStorage();

    if (store.focalPersonId === null) {
      this.#showEmptyProject();
      return;
    }

    if (!this.#tree) this.#tree = document.createElement('tree-canvas');
    if (this.#surface.firstElementChild !== this.#tree) clear(this.#surface).append(this.#tree);

    this.#tree.render({
      graph: store.graph,
      focalId: store.focalPersonId,
      issuesFor: (id) => store.issuesFor(id),
      resolvePhoto: (path) => store.photoUrl(path),
    });
  };

  #showWelcome() {
    return actions.isBrowserStorage() ? this.#showBrowserWelcome() : this.#showDiskWelcome();
  }

  async #showDiskWelcome() {
    const last = await actions.lastProjectSummary();

    const buttons = [
      el('button', { class: 'primary', text: S.welcome.newProject, attrs: { type: 'button' } }),
      el('button', { text: S.welcome.openProject, attrs: { type: 'button' } }),
      el('button', { text: S.welcome.importArchive, attrs: { type: 'button' } }),
    ];

    buttons[0].addEventListener('click', () =>
      this.#run(() => actions.newProject(S.welcome.defaultName)),
    );
    buttons[1].addEventListener('click', () => this.#run(() => actions.openProject()));
    buttons[2].addEventListener('click', () => this.#startImport());

    if (last) {
      const reopen = el('button', {
        text: `${S.welcome.reopen} ${last.title}`,
        attrs: { type: 'button' },
      });
      // requestPermission() needs a user gesture: only from this button.
      reopen.addEventListener('click', () => this.#run(() => actions.reopenProject(last.id)));
      buttons.push(reopen);
    }

    clear(this.#surface).append(
      el('div', {
        class: 'screen',
        children: [
          el('h2', { text: S.app.name }),
          el('p', { text: S.app.tagline }),
          el('p', { text: S.welcome.pickFolderHint }),
          this.#message ? el('p', { class: 'error', text: this.#message }) : null,
          el('div', { class: 'actions', children: buttons }),
        ],
      }),
    );
  }

  /**
   * The welcome screen where there is no folder picker.
   *
   * With no filesystem to point at, the app has to be the thing that remembers
   * what archives exist — so this screen is a list rather than three buttons,
   * and it is read from the folders themselves, not from a cache.
   *
   * It also has to say where the data actually is. Somebody who thinks their
   * research is on their phone the way a photograph is on their phone will not
   * think to export, and that is exactly who loses it.
   */
  async #showBrowserWelcome() {
    const projects = await actions.listBrowserProjects();

    const name = el('input', {
      class: 'name',
      attrs: {
        type: 'text',
        placeholder: S.welcome.defaultName,
        'aria-label': S.welcome.newProject,
        maxlength: '60',
        autocomplete: 'off',
      },
    });

    const create = el('button', {
      class: 'primary',
      text: S.welcome.newProject,
      attrs: { type: 'button' },
    });
    create.addEventListener('click', () =>
      this.#run(() => actions.newProject(name.value.trim() || S.welcome.defaultName)),
    );

    const importZip = el('button', { text: S.welcome.importArchive, attrs: { type: 'button' } });
    importZip.addEventListener('click', () => this.#startImport());

    clear(this.#surface).append(
      el('div', {
        // Two names, two entries: el() hands the list to classList.add, which
        // throws on a string with a space in it.
        class: ['screen', 'listing'],
        children: [
          el('h2', { text: S.app.name }),
          el('p', { text: S.app.tagline }),
          el('p', { class: 'hint', text: S.welcome.browserHint }),
          this.#message ? el('p', { class: 'error', text: this.#message }) : null,

          projects.length > 0 ? el('h3', { text: S.welcome.archives }) : null,
          projects.length > 0
            ? el('ul', {
                class: 'archives',
                children: projects.map((project) => this.#archiveRow(project)),
              })
            : el('p', { text: S.welcome.noArchives }),

          el('div', {
            class: 'actions',
            children: [el('div', { class: 'named', children: [name, create] }), importZip],
          }),
        ],
      }),
    );
  }

  #archiveRow({ name, title, persons, savedAt }) {
    const open = el('button', {
      class: 'archive',
      attrs: { type: 'button' },
      children: [
        el('b', { text: title }),
        el('span', {
          class: 'meta',
          text: S.welcome.archiveMeta(persons, formatSaved(savedAt)),
        }),
      ],
    });
    open.addEventListener('click', () => this.#run(() => actions.openBrowserProject(name)));

    const remove = el('button', {
      class: 'danger',
      text: S.welcome.deleteArchive,
      attrs: { type: 'button', 'aria-label': S.welcome.deleteArchiveLabel(title) },
    });

    // A native confirm, on purpose. This is the only action in the app with no
    // undo behind it and, in browser storage, quite possibly no copy either.
    remove.addEventListener('click', () => {
      if (!globalThis.confirm(S.welcome.confirmDelete(title))) return;
      void this.#run(() => actions.deleteBrowserProject(name));
    });

    return el('li', { children: [open, remove] });
  }

  #showEmptyProject() {
    const add = el('button', {
      class: 'primary',
      text: S.tree.addFirstPerson,
      attrs: { type: 'button' },
    });

    add.addEventListener('click', () => {
      const result = actions.addPerson();
      if (result.ok) this.#editPerson(result.person.id, { isNew: true });
    });

    clear(this.#surface).append(
      el('div', {
        class: 'screen',
        children: [
          el('p', { text: S.tree.empty }),
          el('div', { class: 'actions', children: [add] }),
        ],
      }),
    );
  }

  #showUnsupported({ missing = [], fileProtocol = false } = {}) {
    this.#toolbar.hidden = true;
    clear(this.#surface).append(
      el('div', {
        class: 'screen',
        children: [
          el('h2', { text: S.unsupported.title }),
          el('p', { text: fileProtocol ? S.unsupported.fileProtocol : S.unsupported.body }),
          el('p', { text: S.unsupported.supported }),
          missing.length > 0
            ? el('p', {
                children: [
                  el('span', { text: `${S.unsupported.missing} ` }),
                  el('code', { text: missing.join(', ') }),
                ],
              })
            : null,
        ],
      }),
    );
  }

  async #run(operation) {
    this.#message = '';
    try {
      const result = await operation();
      if (result?.ok === false && result.reason === 'denied') {
        this.#message = S.welcome.deniedFolder;
      } else if (result?.ok === false && result.reason === 'missing') {
        // In browser storage there is no folder to go and find again, so the
        // advice to choose it once more would be nonsense.
        this.#message = actions.isBrowserStorage()
          ? S.welcome.missingArchive
          : S.welcome.missingFolder;
      }
    } catch (error) {
      // The UI catches at the edge and turns failures into something
      // actionable. A raw stack trace is never shown.
      this.#message = error?.message ?? String(error);
    }
    if (!store.isOpen) {
      await this.#showWelcome().catch((error) => {
        this.#message = error?.message ?? String(error);
      });
    }
  }
}

customElements.define('app-root', AppRoot);
