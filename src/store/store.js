/**
 * Central store (architecture.md, store section).
 *
 * A singleton module that owns the state. Components NEVER talk to each other:
 * intent bubbles up as CustomEvent, state comes down as properties.
 *
 * Why a central store rather than local propagation: the whole tree re-renders
 * when the focal person changes. With local propagation the update order
 * becomes unpredictable.
 */

import { buildIndexes } from '../domain/graph/indexes.js';
import {
  validateAll,
  validateBlocking,
  blockingKeys,
  introducedBy,
  Severity,
} from '../domain/validation/engine.js';
import { mergeProjects } from '../domain/model/merge.js';
import { loadProject, writeProject } from '../storage/project-store.js';
import { rememberProject } from '../storage/handles.js';
import { photoUrl, releaseAll } from '../storage/media-cache.js';
import { AUTOSAVE_DEBOUNCE_MS, UNDO_STACK_SIZE, TRAIL_LENGTH } from '../config/limits.js';

class Store extends EventTarget {
  #project = null;
  #indexes = null;
  #issues = [];
  #blocking = new Set();
  #dirHandle = null;
  #saveTimer = null;
  #saving = false;
  #savePromise = null;
  #pendingSave = false;
  #dataDirty = false;
  #undo = [];
  #redo = [];
  /** Where the user has been, so "back" means something. Not an edit history. */
  #trail = [];
  #selectedPersonId = null;

  get project() {
    return this.#project;
  }
  get graph() {
    return this.#indexes;
  }
  get directoryHandle() {
    return this.#dirHandle;
  }
  get issues() {
    return this.#issues;
  }
  get isOpen() {
    return this.#project !== null;
  }
  get canUndo() {
    return this.#undo.length > 0;
  }
  get canRedo() {
    return this.#redo.length > 0;
  }

  get focalPersonId() {
    return this.#project?.settings.focalPersonId ?? null;
  }

  get selectedPersonId() {
    return this.#selectedPersonId ?? this.focalPersonId;
  }

  // --- Project lifecycle ---------------------------------------------------

  async open(dirHandle) {
    const project = await loadProject(dirHandle);
    this.#adopt(project, dirHandle);
    await rememberProject(project.project.id, project.project.title, dirHandle);
    this.#emit('open');
  }

  async adoptNew(project, dirHandle) {
    this.#adopt(project, dirHandle);
    this.#emit('open');
    await rememberProject(project.project.id, project.project.title, dirHandle);
  }

  /**
   * Resolves a photo path to something an <img> can show. Components ask for
   * this through the store rather than reaching into storage/ themselves.
   */
  photoUrl(path) {
    return photoUrl(this.#dirHandle, path);
  }

  close() {
    void this.flushSave();
    releaseAll();
    this.#project = null;
    this.#indexes = null;
    this.#issues = [];
    this.#dirHandle = null;
    this.#pendingSave = false;
    this.#dataDirty = false;
    this.#undo = [];
    this.#redo = [];
    this.#selectedPersonId = null;
    this.#emit('close');
  }

  #adopt(project, dirHandle) {
    this.#project = project;
    this.#dirHandle = dirHandle;
    this.#pendingSave = false;
    this.#dataDirty = false;
    this.#undo = [];
    this.#redo = [];
    this.#trail = [];
    this.#selectedPersonId = project.settings?.focalPersonId ?? null;
    this.#reindex();
  }

  // --- Mutations -----------------------------------------------------------

  /**
   * Applies a mutation. Returns { ok } or { ok: false, errors } without
   * throwing: domain/ never throws on invalid data, only on programming bugs.
   *
   * @param {(project: object) => object} mutate  must return a new project
   */
  apply(mutate, { label = 'change', record = true } = {}) {
    if (!this.#project) return { ok: false, errors: [] };

    const before = this.#project;
    const next = mutate(before);

    // ERROR rules only before writing. Warnings are computed afterwards so
    // interaction is never held up. And only errors this change INTRODUCES can
    // block it — see introducedBy().
    const introduced = introducedBy(this.#blocking, validateBlocking(buildIndexes(next)));
    if (introduced.length > 0) return { ok: false, errors: introduced };

    if (record) {
      this.#undo.push({ label, before });
      if (this.#undo.length > UNDO_STACK_SIZE) this.#undo.shift();
      this.#redo = [];
    }

    this.#project = next;
    this.#dataDirty = true;
    this.#reindex();
    this.#emit('change', { label });
    this.#scheduleSave();

    return { ok: true };
  }

  undo() {
    this.#travel(this.#undo, this.#redo, 'undo');
  }
  redo() {
    this.#travel(this.#redo, this.#undo, 'redo');
  }

  #travel(from, to, label) {
    const step = from.pop();
    if (!step) return;
    to.push({ label, before: this.#project });
    this.#project = step.before;
    this.#dataDirty = true;
    this.#reindex();
    this.#emit('change', { label });
    this.#scheduleSave();
  }

  /**
   * Folds an imported project into the open one. Entities already present keep
   * the local version (domain/model/merge.js).
   */
  mergeIn(incoming) {
    let summary = null;

    const result = this.apply(
      (current) => {
        const merged = mergeProjects(current, incoming);
        summary = { added: merged.added, kept: merged.kept };
        return merged.project;
      },
      { label: 'import' },
    );

    return { ...result, ...summary };
  }

  get canGoBack() {
    return this.#trail.length > 0;
  }

  /**
   * Updates view settings (focal person, generation depth) without cloning,
   * reindexing or revalidating the genealogical graph, and without rotating
   * genealogy backups on disk.
   */
  updateSettings(changes, { label = 'settings' } = {}) {
    if (!this.#project) return { ok: false, errors: [] };

    const settings = { ...this.#project.settings, ...changes };
    this.#project = { ...this.#project, settings };
    if (this.#indexes) this.#indexes.settings = settings;

    this.#emit('change', { label });
    this.#scheduleSave();
    return { ok: true };
  }

  /**
   * Centres the tree on someone, remembering where we came from.
   *
   * Kept apart from undo: moving around is not an edit, and mixing the two
   * would mean "undo" sometimes reverses a change and sometimes just walks
   * backwards, which is the kind of ambiguity that makes people stop trusting
   * the button.
   */
  setFocalPerson(personId, { remember = true } = {}) {
    const previous = this.focalPersonId;
    if (personId === previous) {
      this.setSelectedPerson(personId);
      return { ok: true };
    }

    this.#selectedPersonId = personId;
    const result = this.updateSettings({ focalPersonId: personId }, { label: 'focus' });

    if (result.ok && remember && previous !== null) {
      this.#trail.push(previous);
      if (this.#trail.length > TRAIL_LENGTH) this.#trail.shift();
      this.#emit('trail');
    }

    return result;
  }

  /**
   * Selects a person for toolbar and inspector actions without re-rooting the
   * tree layout.
   */
  setSelectedPerson(personId) {
    if (!this.#project) return { ok: false };
    if (personId !== null && !this.#indexes?.persons.has(personId)) return { ok: false };
    if (this.selectedPersonId === personId) return { ok: true };

    this.#selectedPersonId = personId;
    this.#emit('selection', { personId: this.selectedPersonId });
    return { ok: true };
  }

  /** Steps back to whoever was centred before. */
  goBack() {
    const previous = this.#trail.pop();
    if (previous === undefined) return { ok: false };

    const result = this.setFocalPerson(previous, { remember: false });
    this.#emit('trail');
    return result;
  }

  #reindex() {
    this.#indexes = buildIndexes(this.#project);
    if (this.#selectedPersonId !== null && !this.#indexes.persons.has(this.#selectedPersonId)) {
      this.#selectedPersonId = this.focalPersonId;
    }
    this.#issues = validateAll(this.#indexes);

    // The blocking errors the project already carries. Anything in here is
    // pre-existing damage, not something the next edit did.
    this.#blocking = blockingKeys(this.#issues);
  }

  issuesFor(entityId) {
    return this.#issues.filter((i) => i.subjects.some((s) => s.id === entityId));
  }

  hasBlockingIssues() {
    return this.#issues.some((i) => i.severity === Severity.ERROR);
  }

  // --- Saving --------------------------------------------------------------

  #scheduleSave() {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      void this.save();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  /**
   * Cancels any pending debounced save and writes immediately if there are
   * unsaved changes or an active timer.
   */
  flushSave() {
    if (this.#saveTimer !== null) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
      return this.save();
    }
    if (this.#saving) return this.save();
    return Promise.resolve();
  }

  async save() {
    if (this.#saveTimer !== null) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }

    if (!this.#project || !this.#dirHandle) return;

    if (this.#saving) {
      this.#pendingSave = true;
      return this.#savePromise;
    }

    this.#saving = true;
    this.#savePromise = this.#runSaveLoop();
    return this.#savePromise;
  }

  async #runSaveLoop() {
    try {
      do {
        this.#pendingSave = false;
        const project = this.#project;
        const dirHandle = this.#dirHandle;
        if (!project || !dirHandle) break;

        const rotate = this.#dataDirty;
        this.#dataDirty = false;

        this.#emit('saving');
        try {
          const saved = await writeProject(dirHandle, project, { rotate });
          if (this.#project === project && this.#dirHandle === dirHandle) {
            this.#project = saved;
          }
          this.#emit('saved');
        } catch (error) {
          if (rotate) this.#dataDirty = true;
          this.#emit('save-error', { error });
          break;
        }
      } while (this.#pendingSave && this.#project !== null && this.#dirHandle !== null);
    } finally {
      this.#saving = false;
      this.#savePromise = null;
    }
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

export const store = new Store();

// Forced save when the tab is hidden: the debounce must never cost data.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void store.flushSave();
  });
}
