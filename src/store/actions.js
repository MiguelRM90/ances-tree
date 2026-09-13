/**
 * High-level operations on the project.
 *
 * The UI never talks to storage/ directly (architecture.md > Regla de
 * dependencias): everything that touches the disk goes through here.
 */

import { store } from './store.js';
import {
  pickDirectory,
  newDirectory,
  createProjectIn,
  StorageError,
} from '../storage/project-store.js';
import { storageMode, StorageMode, isBrowserStorage } from '../storage/backend.js';
import {
  browserProjects,
  browserFolder,
  removeBrowserFolder,
  requestPersistence,
  storageEstimate,
} from '../storage/opfs.js';
import {
  handleFor,
  lastProjectId,
  permissionState,
  requestPermission,
  forgetProject,
  recentProjects,
  Permission,
} from '../storage/handles.js';
import {
  exportProject,
  exportGedcomFile,
  pickAndReadGedcom,
  pickArchive,
  inspectArchive,
  importAsNewProject,
  importByMerging,
  createProjectFrom,
} from '../storage/archive.js';
import { pickImages, importPhoto } from '../storage/media.js';
import { pickDocuments, importDocument } from '../storage/documents.js';
import { release, downloadMediaFile } from '../storage/media-cache.js';
import {
  createPerson,
  createUnion,
  createParentChild,
  mediaLink,
  MediaRole,
  ParentType,
} from '../domain/model/factories.js';
import { unionsOf, partnerIn, photosOf } from '../domain/graph/queries.js';

export { recentProjects, storageMode, StorageMode, isBrowserStorage, storageEstimate };

// --- Project lifecycle -----------------------------------------------------

/**
 * Creates a project.
 *
 * On disk the user chooses the folder; in browser storage one is made for them,
 * because there is nothing to choose. Requires a user gesture either way.
 */
export async function newProject(title) {
  const dirHandle = await newDirectory(title);
  if (!dirHandle) return { ok: false, cancelled: true };

  const project = await createProjectIn(dirHandle, title);
  await store.adoptNew(project, dirHandle);

  // Asked for at the moment the first archive is created, which is the only
  // point where the user has visibly committed something worth keeping.
  if (isBrowserStorage()) await requestPersistence();

  return { ok: true };
}

/** Opens an existing project from a folder on disk. DISK mode only. */
export async function openProject() {
  const dirHandle = await pickDirectory();
  if (!dirHandle) return { ok: false, cancelled: true };

  await store.open(dirHandle);
  return { ok: true };
}

// --- Browser storage -------------------------------------------------------

/**
 * The archives held in browser storage.
 *
 * In DISK mode this is always empty and the welcome screen offers the folder
 * picker instead: a folder the user chose is theirs to find again.
 */
export async function listBrowserProjects() {
  return isBrowserStorage() ? browserProjects() : [];
}

/** Opens one of them by folder name. */
export async function openBrowserProject(name) {
  const dirHandle = await browserFolder(name);
  if (!dirHandle) return { ok: false, reason: 'missing' };

  await store.open(dirHandle);
  return { ok: true };
}

/**
 * Deletes an archive from browser storage, permanently.
 *
 * There is no file manager behind this and no recycle bin in front of it, so
 * the caller is expected to have asked first. Closing the project comes before
 * the delete: writing to a folder that is being removed is a race.
 */
export async function deleteBrowserProject(name) {
  if (store.isOpen) store.close(); // flushes any pending save before the folder goes
  await removeBrowserFolder(name);
  return { ok: true };
}

export { requestPersistence };

/**
 * Reopens the last project using the stored handle.
 *
 * Called from a button, never on page load: requestPermission() requires a
 * user gesture.
 */
export async function reopenProject(projectId) {
  const id = projectId ?? (await lastProjectId());
  if (!id) return { ok: false, reason: 'none' };

  const handle = await handleFor(id);
  if (!handle) return { ok: false, reason: 'none' };

  let state = await permissionState(handle);
  if (state === Permission.PROMPT) state = await requestPermission(handle);
  if (state !== Permission.GRANTED) return { ok: false, reason: 'denied' };

  try {
    await store.open(handle);
    return { ok: true };
  } catch (error) {
    // Folder moved or deleted: the stored handle is worthless now.
    if (error instanceof StorageError && error.code !== 'FUTURE_VERSION') {
      await forgetProject(id);
    }
    return { ok: false, reason: 'missing', error };
  }
}

/** Is there a recent project worth offering to reopen? */
export async function lastProjectSummary() {
  const id = await lastProjectId();
  if (!id) return null;
  const projects = await recentProjects();
  return projects.find((p) => p.id === id) ?? null;
}

// --- Archives --------------------------------------------------------------

/** Exports the open project to a ZIP. Requires a user gesture. */
export function exportArchive() {
  if (!store.isOpen) return Promise.resolve({ ok: false, reason: 'none' });
  return exportProject(store.directoryHandle, store.project);
}

/**
 * Exports a GEDCOM for other genealogy software.
 *
 * A projection of the project, not a copy of it: the format cannot hold
 * everything the model does (gedcom-mapping.md). The ZIP is the faithful copy.
 */
export function exportGedcom() {
  if (!store.isOpen) return Promise.resolve({ ok: false, reason: 'none' });
  return exportGedcomFile(store.project);
}

/**
 * Reads a GEDCOM into a project without writing anything, so the caller can
 * show what arrived before committing to it.
 */
export function beginGedcomImport() {
  return pickAndReadGedcom();
}

/** Saves an imported GEDCOM into a folder of its own and opens it. */
export async function finishGedcomImport(result) {
  const saved = await createProjectFrom(result.project);
  if (saved.ok) await store.adoptNew(saved.project, saved.dirHandle);
  return { ...saved, warnings: result.warnings, counts: result.counts };
}

/**
 * Picks an archive and reads what is inside it, without extracting anything.
 * The caller shows the summary and decides the strategy: the app always asks,
 * it never decides on its own (storage.md, merge on import).
 */
export async function beginImport() {
  const file = await pickArchive();
  if (!file) return null;
  return inspectArchive(file);
}

/** Extracts into a fresh folder and opens it. Nothing existing is touched. */
export async function finishImportAsNew(inspection) {
  const result = await importAsNewProject(inspection);
  if (result.ok) await store.adoptNew(result.project, result.dirHandle);
  return result;
}

/** Folds the archive into the open project: missing media first, then the graph. */
export async function finishImportByMerge(inspection) {
  const copied = await importByMerging(inspection, store.directoryHandle, store.project);
  if (!copied.ok) return copied;

  const merged = store.mergeIn(copied.incoming);
  return { ...copied, ...merged };
}

// --- Graph mutations -------------------------------------------------------

export function addPerson(fields = {}) {
  const person = createPerson(fields);
  const result = store.apply((p) => ({ ...p, persons: [...p.persons, person] }), {
    label: 'add person',
  });

  if (result.ok && store.focalPersonId === null) store.setFocalPerson(person.id);
  return result.ok ? { ...result, person } : result;
}

export function updatePerson(personId, changes) {
  return store.apply(
    (p) => ({
      ...p,
      persons: p.persons.map((person) =>
        person.id === personId
          ? { ...person, ...changes, updatedAt: new Date().toISOString() }
          : person,
      ),
    }),
    { label: 'edit person' },
  );
}

/** Adds a new parent for an existing person, in one mutation. */
export function addParentFor(childId) {
  const parent = createPerson();
  let link = createParentChild({ parentId: parent.id, childId });

  const result = store.apply(
    (p) => {
      const existing = p.parentChildren.filter((l) => l.childId === childId);
      if (existing.length === 1 && existing[0].type === ParentType.BIOLOGICAL) {
        const firstParentId = existing[0].parentId;
        const union = createUnion({ partner1Id: firstParentId, partner2Id: parent.id });
        link = { ...link, unionId: union.id };
        const updatedParentChildren = p.parentChildren.map((l) =>
          l.id === existing[0].id ? { ...l, unionId: union.id } : l,
        );
        return {
          ...p,
          persons: [...p.persons, parent],
          unions: [...p.unions, union],
          parentChildren: [...updatedParentChildren, link],
        };
      }

      return {
        ...p,
        persons: [...p.persons, parent],
        parentChildren: [...p.parentChildren, link],
      };
    },
    { label: 'add parent' },
  );

  return result.ok ? { ...result, person: parent, link } : result;
}

/** Adds a new partner and the union that joins them. */
export function addPartnerFor(personId) {
  const partner = createPerson();
  const union = createUnion({ partner1Id: personId, partner2Id: partner.id });

  const result = store.apply(
    (p) => ({
      ...p,
      persons: [...p.persons, partner],
      unions: [...p.unions, union],
    }),
    { label: 'add partner' },
  );

  return result.ok ? { ...result, person: partner, union } : result;
}

/**
 * Adds a child of an existing person.
 *
 * When that person has exactly one union, the partner is linked as the second
 * parent and both links carry its unionId — which is what makes the sibling
 * rules work later (data-model.md > Consultas derivadas). With zero or several
 * unions the second parent is ambiguous, so only one link is created.
 */
export function addChildFor(parentId) {
  const child = createPerson();
  const unions = unionsOf(store.graph, parentId);
  const union = unions.length === 1 ? unions[0] : null;

  const links = [createParentChild({ parentId, childId: child.id, unionId: union?.id ?? null })];
  if (union) {
    links.push(
      createParentChild({
        parentId: partnerIn(union, parentId),
        childId: child.id,
        unionId: union.id,
      }),
    );
  }

  const result = store.apply(
    (p) => ({
      ...p,
      persons: [...p.persons, child],
      parentChildren: [...p.parentChildren, ...links],
    }),
    { label: 'add child' },
  );

  return result.ok ? { ...result, person: child } : result;
}

// --- Relationships ---------------------------------------------------------

/**
 * Editing relationships needs no validation of its own.
 *
 * Every one of these goes through store.apply, which refuses any change that
 * introduces a blocking error — a person as their own parent, a loop in the
 * lineage, the same pair linked twice, a third biological parent, a reference
 * to something that is not there. So "it must not be left in an unstable
 * state" is not a promise made again here; it is the same guarantee every
 * other mutation already gets, and the caller reports the refusal.
 */

/** Links two existing people in a union. */
export function addUnion(person1Id, person2Id, overrides = {}) {
  const union = createUnion({ partner1Id: person1Id, partner2Id: person2Id, ...overrides });

  const result = store.apply(
    (project) => {
      const parentIds = new Set([person1Id, person2Id]);
      const sharedChildren = new Set();
      const biologicalByChild = new Map();

      for (const link of project.parentChildren) {
        if (link.type !== ParentType.BIOLOGICAL || !parentIds.has(link.parentId)) continue;
        const parents = biologicalByChild.get(link.childId) ?? new Set();
        parents.add(link.parentId);
        biologicalByChild.set(link.childId, parents);
        if (parents.size === parentIds.size) sharedChildren.add(link.childId);
      }

      return {
        ...project,
        unions: [...project.unions, union],
        parentChildren: project.parentChildren.map((link) =>
          sharedChildren.has(link.childId) &&
          link.type === ParentType.BIOLOGICAL &&
          parentIds.has(link.parentId)
            ? { ...link, unionId: union.id }
            : link,
        ),
      };
    },
    { label: 'add union' },
  );

  return result.ok ? { ...result, union } : result;
}

/** Type, dates or notes of a union. A marriage that ended has an endDate. */
export function updateUnion(unionId, changes) {
  return store.apply(
    (project) => ({
      ...project,
      unions: project.unions.map((union) =>
        union.id === unionId ? { ...union, ...changes } : union,
      ),
    }),
    { label: 'edit union' },
  );
}

/** Which parent a link points at, or what kind of parent they are. */
export function updateParentLink(linkId, changes) {
  return store.apply(
    (project) => ({
      ...project,
      parentChildren: project.parentChildren.map((link) =>
        link.id === linkId ? { ...link, ...changes } : link,
      ),
    }),
    { label: 'edit parent' },
  );
}

/** Links an existing person to an existing child. */
export function addParentLink(
  childId,
  parentId,
  { type = ParentType.BIOLOGICAL, createUnion: shouldCreateUnion = true } = {},
) {
  let link = createParentChild({ parentId, childId, type });

  const result = store.apply(
    (project) => {
      const existing = project.parentChildren.filter((l) => l.childId === childId);
      if (
        shouldCreateUnion &&
        type === ParentType.BIOLOGICAL &&
        existing.length === 1 &&
        existing[0].type === ParentType.BIOLOGICAL
      ) {
        const firstParentId = existing[0].parentId;
        let union = project.unions.find(
          (u) =>
            (u.partner1Id === firstParentId && u.partner2Id === parentId) ||
            (u.partner1Id === parentId && u.partner2Id === firstParentId),
        );
        let unions = project.unions;
        if (!union) {
          union = createUnion({ partner1Id: firstParentId, partner2Id: parentId });
          unions = [...project.unions, union];
        }

        link = { ...link, unionId: union.id };
        const updatedParentChildren = project.parentChildren.map((l) =>
          l.id === existing[0].id ? { ...l, unionId: union.id } : l,
        );

        return {
          ...project,
          unions,
          parentChildren: [...updatedParentChildren, link],
        };
      }

      return { ...project, parentChildren: [...project.parentChildren, link] };
    },
    { label: 'add parent' },
  );

  return result.ok ? { ...result, link } : result;
}

/**
 * Makes a child descend from a COUPLE rather than from one person.
 *
 * This is the operation the interface was missing. Adding a parent and then
 * giving that parent a partner leaves the child attached to one of them only —
 * which is correct, since nothing said the partner was the other parent, but
 * there was no way to say afterwards that they were.
 *
 * Both partners end up as parents: the one already linked keeps their link and
 * gains the unionId, the other gets a link created. A parent from outside the
 * union is left exactly as they were, because they may well be a real third
 * link — an adoptive parent alongside a biological couple.
 *
 * Passing null detaches the child from the couple without removing anybody:
 * the parents stay, they simply stop being recorded as a pair here.
 */
export function setChildUnion(childId, unionId) {
  const union = unionId ? store.graph?.unions.get(unionId) : null;
  if (unionId && !union) return { ok: false, reason: 'none' };

  const partnerIds = union ? [union.partner1Id, union.partner2Id] : [];

  return store.apply(
    (project) => {
      const linked = new Set(
        project.parentChildren.filter((link) => link.childId === childId).map((l) => l.parentId),
      );

      const updated = project.parentChildren.map((link) => {
        if (link.childId !== childId) return link;
        if (!union) return link.unionId === null ? link : { ...link, unionId: null };
        return partnerIds.includes(link.parentId) ? { ...link, unionId } : link;
      });

      const added = partnerIds
        .filter((parentId) => !linked.has(parentId))
        .map((parentId) => createParentChild({ parentId, childId, unionId }));

      return { ...project, parentChildren: [...updated, ...added] };
    },
    { label: 'set couple' },
  );
}

/**
 * How many generations the tree renders around the centred person.
 *
 * This is the only real defence against a huge archive: the window bounds how
 * much is on screen, and therefore how much has to be laid out and painted.
 * Not recorded in the undo history — it is a view setting, not an edit.
 */
export function setGenerationWindow({ up, down }) {
  return store.apply(
    (project) => ({
      ...project,
      settings: {
        ...project.settings,
        maxGenerationsUp: up ?? project.settings.maxGenerationsUp,
        maxGenerationsDown: down ?? project.settings.maxGenerationsDown,
      },
    }),
    { label: 'view depth', record: false },
  );
}

// --- Photos ----------------------------------------------------------------

/**
 * Adds one or more photos to a person.
 *
 * Files are written to disk first and the graph is updated afterwards, in a
 * single mutation: there is never a moment where a MediaObject points at a file
 * that does not exist yet.
 *
 * @returns {Promise<{ok: boolean, added?: number, reused?: number, failed?: object[]}>}
 */
export async function addPhotosFor(personId) {
  if (!store.isOpen) return { ok: false, reason: 'none' };

  const files = await pickImages();
  if (files.length === 0) return { ok: false, cancelled: true };

  const stripExif = store.project.settings.stripExifOnImport;
  const known = store.project.media;

  const fresh = [];
  const reused = [];
  const failed = [];

  for (const file of files) {
    try {
      const result = await importPhoto(store.directoryHandle, file, [...known, ...fresh], {
        stripExif,
      });
      (result.reused ? reused : fresh).push(result.media);
    } catch (error) {
      // One unreadable file must not lose the rest of the selection.
      failed.push({ name: file.name, message: error.message });
    }
  }

  const attaching = [...fresh, ...reused];
  if (attaching.length === 0) return { ok: false, failed };

  const hasPortrait = photosOf(store.graph, personId).length > 0;

  const result = store.apply(
    (project) => {
      const byId = new Map(project.media.map((item) => [item.id, item]));

      for (const [index, item] of attaching.entries()) {
        const existing = byId.get(item.id) ?? item;
        const alreadyLinked = existing.links.some((link) => link.targetId === personId);

        // The first photo a person gets becomes their portrait.
        const role = !hasPortrait && index === 0 ? MediaRole.PORTRAIT : MediaRole.ATTACHMENT;

        byId.set(item.id, {
          ...existing,
          links: alreadyLinked ? existing.links : [...existing.links, mediaLink(personId, role)],
        });
      }

      return { ...project, media: [...byId.values()] };
    },
    { label: 'add photos' },
  );

  return { ...result, added: fresh.length, reused: reused.length, failed };
}

/**
 * Adds one or more documents to a person.
 *
 * @returns {Promise<{ok: boolean, added?: number, reused?: number, failed?: object[]}>}
 */
export async function addDocumentsFor(personId) {
  if (!store.isOpen) return { ok: false, reason: 'none' };

  const files = await pickDocuments();
  if (files.length === 0) return { ok: false, cancelled: true };

  const known = store.project.media;
  const fresh = [];
  const reused = [];
  const failed = [];

  for (const file of files) {
    try {
      const result = await importDocument(store.directoryHandle, file, [...known, ...fresh]);
      (result.reused ? reused : fresh).push(result.media);
    } catch (error) {
      failed.push({ name: file.name, message: error.message });
    }
  }

  const attaching = [...fresh, ...reused];
  if (attaching.length === 0) return { ok: false, failed };

  const result = store.apply(
    (project) => {
      const byId = new Map(project.media.map((item) => [item.id, item]));

      for (const item of attaching) {
        const existing = byId.get(item.id) ?? item;
        const alreadyLinked = existing.links.some((link) => link.targetId === personId);

        byId.set(item.id, {
          ...existing,
          links: alreadyLinked
            ? existing.links
            : [...existing.links, mediaLink(personId, MediaRole.ATTACHMENT)],
        });
      }

      return { ...project, media: [...byId.values()] };
    },
    { label: 'add documents' },
  );

  return { ...result, added: fresh.length, reused: reused.length, failed };
}

/** Promotes one photo to be the person's portrait. */
export function setPortrait(mediaId, personId) {
  return store.apply(
    (project) => ({
      ...project,
      media: project.media.map((item) => ({
        ...item,
        links: item.links.map((link) =>
          link.targetId !== personId
            ? link
            : { ...link, role: item.id === mediaId ? MediaRole.PORTRAIT : MediaRole.ATTACHMENT },
        ),
      })),
    }),
    { label: 'set portrait' },
  );
}

/**
 * Detaches a photo or document from a person.
 *
 * The file on disk is left alone: it may still belong to someone else, and a
 * photo of a group is exactly the case where it does. Files nobody references
 * any more are surfaced as ORPHAN_MEDIA and removed by an explicit maintenance
 * pass, never silently (storage.md, binaries).
 */
export function removePhotoFrom(mediaId, personId) {
  const item = store.graph?.media.get(mediaId);
  const stillUsed = item?.links.some((link) => link.targetId !== personId);
  if (item && !stillUsed) release(item.path);

  return store.apply(
    (project) => ({
      ...project,
      media: project.media
        .map((media) =>
          media.id !== mediaId
            ? media
            : { ...media, links: media.links.filter((link) => link.targetId !== personId) },
        )
        .filter((media) => media.links.length > 0),
    }),
    { label: 'remove photo' },
  );
}

export const removeDocumentFrom = removePhotoFrom;

/** Triggers download of an attached media document or photo. */
export async function downloadDocument(mediaId) {
  if (!store.isOpen) return false;
  const item = store.graph?.media.get(mediaId);
  if (!item) return false;
  return downloadMediaFile(store.directoryHandle, item);
}

export function removeEntity(kind, id) {
  return store.apply(
    (p) => {
      if (kind === 'person') {
        const removedUnionIds = new Set(
          p.unions.filter((u) => u.partner1Id === id || u.partner2Id === id).map((u) => u.id),
        );

        return {
          ...p,
          persons: p.persons.filter((x) => x.id !== id),
          unions: p.unions.filter((u) => !removedUnionIds.has(u.id)),
          parentChildren: p.parentChildren
            .filter((l) => l.parentId !== id && l.childId !== id)
            .map((l) => (removedUnionIds.has(l.unionId) ? { ...l, unionId: null } : l)),
          settings:
            p.settings.focalPersonId === id
              ? { ...p.settings, focalPersonId: nextFocalAfter(p, id) }
              : p.settings,
        };
      }

      if (kind === 'union') {
        return {
          ...p,
          unions: p.unions.filter((x) => x.id !== id),
          parentChildren: p.parentChildren.map((l) =>
            l.unionId === id ? { ...l, unionId: null } : l,
          ),
        };
      }

      return { ...p, parentChildren: p.parentChildren.filter((x) => x.id !== id) };
    },
    { label: `remove ${kind}` },
  );
}

/** Deleting the focal person must not leave the tree without a root. */
function nextFocalAfter(project, removedId) {
  const survivor = project.persons.find((p) => p.id !== removedId);
  return survivor?.id ?? null;
}
