import { expect } from '@open-wc/testing';
import { storageMode, StorageMode } from '../src/storage/backend.js';
import { permissionState, Permission } from '../src/storage/handles.js';
import {
  createBrowserFolder,
  browserFolder,
  browserProjects,
  removeBrowserFolder,
} from '../src/storage/opfs.js';
import {
  createProjectIn,
  loadProject,
  writeProject,
  FAMILY_FILE,
  PHOTOS_DIR,
} from '../src/storage/project-store.js';
import { importPhoto, readMediaFile } from '../src/storage/media.js';
import { exportProject, exportGedcomFile, inspectArchive } from '../src/storage/archive.js';
import { minimalFamily } from './fixtures/families.js';

/**
 * These run against the real origin private file system, not a stub.
 *
 * That is the point. The claim under test is that the storage layer works on an
 * OPFS handle exactly as it does on one from the user's own disk — and only the
 * real thing can show that.
 */

const created = [];

async function scratchProject(title) {
  const dirHandle = await createBrowserFolder(title);
  created.push(dirHandle.name);
  return dirHandle;
}

/** OPFS outlives the page, so a leftover folder would leak into the next run. */
afterEach(async () => {
  while (created.length > 0) {
    await removeBrowserFolder(created.pop()).catch(() => {});
  }
});

describe('storage backend detection', () => {
  it('prefers the disk wherever File System Access exists', () => {
    // The disk has to win: it is the only mode where the archive is a folder
    // the user can see, copy and back up.
    expect(storageMode()).to.equal(StorageMode.DISK);
  });

  it('falls back to browser storage when there is no folder picker', () => {
    const real = window.showDirectoryPicker;
    Object.defineProperty(window, 'showDirectoryPicker', {
      value: undefined,
      configurable: true,
    });

    try {
      expect(storageMode()).to.equal(StorageMode.BROWSER);
    } finally {
      Object.defineProperty(window, 'showDirectoryPicker', {
        value: real,
        configurable: true,
        writable: true,
      });
    }

    expect(storageMode()).to.equal(StorageMode.DISK);
  });
});

describe('permissions on a handle the browser owns', () => {
  it('reports a folder in browser storage as writable', async () => {
    const dirHandle = await scratchProject('Permission check');
    expect(await permissionState(dirHandle)).to.equal(Permission.GRANTED);
  });

  /**
   * queryPermission is a Chromium extension to the spec, and Chromium puts it
   * on OPFS handles too, where it answers "granted". Safari and Firefox have
   * the file system but not that method at all.
   *
   * So both shapes have to mean the same thing, and the second one cannot be
   * produced in this browser — hence the stand-in.
   */
  it('treats a handle with no permission API at all as granted', async () => {
    expect(await permissionState({ name: 'as-safari-presents-it' })).to.equal(Permission.GRANTED);
  });

  it('still denies a missing handle', async () => {
    expect(await permissionState(null)).to.equal(Permission.DENIED);
  });
});

describe('a project inside browser storage', function () {
  this.timeout(10_000);
  it('is created, written and read back by the same code as one on disk', async () => {
    const dirHandle = await scratchProject('Gil Muñoz');

    const created = await createProjectIn(dirHandle, 'Gil Muñoz');
    expect(created.project.title).to.equal('Gil Muñoz');

    // The folder layout is the layout, whichever backend it sits on.
    await dirHandle.getFileHandle(FAMILY_FILE);
    await dirHandle.getDirectoryHandle(PHOTOS_DIR);

    const { data } = minimalFamily();
    await writeProject(dirHandle, { ...data, project: created.project });

    const reloaded = await loadProject(dirHandle);
    expect(reloaded.persons).to.have.lengthOf(3);
    expect(reloaded.project.title).to.equal('Gil Muñoz');
  });

  it('folds accents into the folder name rather than dropping them', async () => {
    const dirHandle = await scratchProject('Muñoz');
    expect(dirHandle.name).to.equal('munoz');
  });

  it('keeps two families of the same name apart', async () => {
    const first = await scratchProject('Gil');
    const second = await scratchProject('Gil');

    expect(first.name).to.equal('gil');
    expect(second.name).to.equal('gil-1');
  });

  it('lists what is actually there, read from each manifest', async () => {
    const dirHandle = await scratchProject('Listed family');
    const created = await createProjectIn(dirHandle, 'Listed family');

    const { data } = minimalFamily();
    await writeProject(dirHandle, { ...data, project: created.project });

    const listed = (await browserProjects()).find((p) => p.name === dirHandle.name);

    expect(listed).to.not.equal(undefined);
    expect(listed.title).to.equal('Listed family');
    expect(listed.persons).to.equal(3);
    expect(listed.savedAt).to.be.a('string');
  });

  it('ignores a folder that is not one of ours', async () => {
    const root = await navigator.storage.getDirectory();
    const projects = await root.getDirectoryHandle('projects', { create: true });
    await projects.getDirectoryHandle('not-a-project', { create: true });

    try {
      const names = (await browserProjects()).map((p) => p.name);
      expect(names).to.not.include('not-a-project');
    } finally {
      await projects.removeEntry('not-a-project', { recursive: true });
    }
  });

  it('reopens by name, and reports a name that has gone', async () => {
    const dirHandle = await scratchProject('Reopened');
    await createProjectIn(dirHandle, 'Reopened');

    const again = await browserFolder(dirHandle.name);
    expect(again).to.not.equal(null);
    expect((await loadProject(again)).project.title).to.equal('Reopened');

    expect(await browserFolder('never-existed')).to.equal(null);
  });

  it('deletes everything under it', async () => {
    const dirHandle = await createBrowserFolder('Doomed');
    await createProjectIn(dirHandle, 'Doomed');

    await removeBrowserFolder(dirHandle.name);
    expect(await browserFolder(dirHandle.name)).to.equal(null);
  });
});

/**
 * Exporting where there is no save dialog.
 *
 * This is the path every phone takes, and the one that decides whether the
 * promise made on the welcome screen — export a ZIP and that copy is yours —
 * is true. So the archive is not merely produced here; it is read back and
 * checked, with the save picker taken away for the duration.
 */
describe('exporting without a save dialog', function () {
  this.timeout(10_000);
  /** Runs `body` with showSaveFilePicker hidden, capturing the download. */
  async function withoutSaveDialog(body) {
    const realPicker = window.showSaveFilePicker;
    const realClick = HTMLAnchorElement.prototype.click;
    const downloads = [];

    Object.defineProperty(window, 'showSaveFilePicker', {
      value: undefined,
      configurable: true,
    });
    HTMLAnchorElement.prototype.click = function capture() {
      downloads.push({ href: this.href, name: this.download });
    };

    try {
      await body();
      return downloads;
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
      Object.defineProperty(window, 'showSaveFilePicker', {
        value: realPicker,
        configurable: true,
        writable: true,
      });
    }
  }

  /**
   * The scratch file is swept AFTER the download has been read, never before.
   *
   * Written the other way round first, and both tests failed with "Failed to
   * fetch": a blob URL over a file in the origin private file system is a
   * reference to those bytes, so removing the file pulls the download out from
   * under itself. Which is precisely why file-dialog.js leaves its scratch
   * files behind and sweeps them on the next export instead.
   */
  afterEach(async () => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('.downloads', { recursive: true }).catch(() => {});
  });

  it('streams a ZIP to a download that opens again as a project', async () => {
    const dirHandle = await scratchProject('Exported family');
    const created = await createProjectIn(dirHandle, 'Exported family');

    const { data } = minimalFamily();
    const saved = await writeProject(dirHandle, { ...data, project: created.project });

    let result;
    const downloads = await withoutSaveDialog(async () => {
      result = await exportProject(dirHandle, saved);
    });

    expect(result.ok).to.equal(true);
    expect(downloads).to.have.lengthOf(1);
    expect(downloads[0].name).to.equal('Exported family.zip');

    // The bytes that would have reached the user, read back as an archive.
    const blob = await (await fetch(downloads[0].href)).blob();
    const inspection = await inspectArchive(blob);

    expect(inspection.project.persons).to.have.lengthOf(3);
    expect(inspection.counts.files).to.equal(result.entries);
    expect(inspection.manifest.title).to.equal('Exported family');
  });

  it('writes a GEDCOM the same way', async () => {
    const dirHandle = await scratchProject('Gedcom family');
    const created = await createProjectIn(dirHandle, 'Gedcom family');

    const { data } = minimalFamily();
    const saved = await writeProject(dirHandle, { ...data, project: created.project });

    let result;
    const downloads = await withoutSaveDialog(async () => {
      result = await exportGedcomFile(saved);
    });

    expect(result).to.include({ ok: true, persons: 3 });
    expect(downloads[0].name).to.equal('Gedcom family.ged');

    const text = await (await fetch(downloads[0].href)).text();
    expect(text).to.contain('0 HEAD');
    expect(text.trim()).to.match(/0 TRLR$/);
  });
});

describe('photos in browser storage', function () {
  this.timeout(10_000);
  it('writes and reads a photo through the sharded path', async function () {
    const dirHandle = await scratchProject('With photos');
    await createProjectIn(dirHandle, 'With photos');

    // Drawn here rather than checked in: a fixture holding a real family
    // photograph would be a PII leak in a public repository.
    const canvas = new OffscreenCanvas(4, 4);
    canvas.getContext('2d').fillRect(0, 0, 4, 4);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const file = new File([blob], 'pixel.png', { type: 'image/png' });

    const { media, reused } = await importPhoto(dirHandle, file, []);
    expect(reused).to.equal(false);
    expect(media.path).to.match(/^photos\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/);

    const back = await readMediaFile(dirHandle, media.path);
    expect(back.size).to.be.greaterThan(0);

    // The same photo again is recognised by its hash, not written twice.
    expect((await importPhoto(dirHandle, file, [media])).reused).to.equal(true);
  });
});
