import { expect } from '@open-wc/testing';
import { store } from '../src/store/store.js';
import * as actions from '../src/store/actions.js';
import { createBrowserFolder, removeBrowserFolder } from '../src/storage/opfs.js';
import {
  createProjectIn,
  loadProject,
  writeProject,
  BACKUPS_DIR,
  FAMILY_FILE,
  StorageError,
} from '../src/storage/project-store.js';
import { parseProject } from '../src/domain/model/schema.js';
import { person, project, minimalFamily } from './fixtures/families.js';

describe('Phase 1 — Data integrity and persistence', function () {
  this.timeout(15_000);

  const created = [];

  async function scratchFolder(title) {
    const dirHandle = await createBrowserFolder(title);
    created.push(dirHandle.name);
    return dirHandle;
  }

  afterEach(async () => {
    store.close();
    while (created.length > 0) {
      await removeBrowserFolder(created.pop()).catch(() => {});
    }
  });

  async function listBackups(dirHandle) {
    try {
      const backups = await dirHandle.getDirectoryHandle(BACKUPS_DIR);
      const names = [];
      for await (const [name, entry] of backups.entries()) {
        if (entry.kind === 'file' && name.startsWith('family-')) names.push(name);
      }
      return names.sort();
    } catch {
      return [];
    }
  }

  it('1.1 queues a follow-up save when an edit happens while a save is already in progress', async () => {
    const dirHandle = await scratchFolder('Concurrent save');
    await createProjectIn(dirHandle, 'Concurrent save');
    const a = person('Alice');
    await store.adoptNew(project({ persons: [a] }), dirHandle);

    // Start first save (without awaiting yet) and mutate immediately while it is in flight
    actions.updatePerson(a.id, { firstName: 'Alicia' });
    const firstSave = store.save();

    // Mutate again while store.#saving is true
    actions.updatePerson(a.id, { firstName: 'Alicia Maria' });
    const secondSave = store.save();

    await Promise.all([firstSave, secondSave]);

    const onDisk = await loadProject(dirHandle);
    expect(onDisk.persons[0].firstName).to.equal('Alicia Maria');
  });

  it('1.2 cancels the pending debounce timer when flushing on visibilitychange', async () => {
    const dirHandle = await scratchFolder('Visibility flush');
    await createProjectIn(dirHandle, 'Visibility flush');
    const a = person('Carlos');
    await store.adoptNew(project({ persons: [a] }), dirHandle);

    let saveCount = 0;
    const onSaved = () => {
      saveCount += 1;
    };
    store.addEventListener('saved', onSaved);

    try {
      // Edit schedules a debounced save (2000ms)
      actions.updatePerson(a.id, { firstName: 'Carlos II' });

      // Flushing immediately should save once and clear the timer so it does not fire again
      await store.flushSave();
      expect(saveCount).to.equal(1);

      const onDisk = await loadProject(dirHandle);
      expect(onDisk.persons[0].firstName).to.equal('Carlos II');
    } finally {
      store.removeEventListener('saved', onSaved);
    }
  });

  it('1.3 navigating focalPersonId or generation window does not rotate backups', async () => {
    const dirHandle = await scratchFolder('Navigation no backup');
    await createProjectIn(dirHandle, 'Navigation no backup');
    const { mother, data } = minimalFamily();
    await store.adoptNew(data, dirHandle);
    await store.save();

    const backupsBefore = await listBackups(dirHandle);

    // Wait >1s so any new backup stamp would get a different second and not overwrite
    await new Promise((r) => setTimeout(r, 1100));

    store.setFocalPerson(mother.id);
    actions.setGenerationWindow({ up: 2, down: 2 });
    await store.save();

    const backupsAfter = await listBackups(dirHandle);
    expect(backupsAfter.length).to.equal(
      backupsBefore.length,
      'changing view settings must not rotate genealogy backups',
    );
    expect(store.focalPersonId).to.equal(mother.id);

    const reloaded = await loadProject(dirHandle);
    expect(reloaded.settings.focalPersonId).to.equal(mother.id);
    expect(reloaded.settings.maxGenerationsUp).to.equal(2);
  });

  it('1.4 backup filenames include seconds so saves in different seconds do not collide', async () => {
    const dirHandle = await scratchFolder('Backup seconds');
    await createProjectIn(dirHandle, 'Backup seconds');
    const { data } = minimalFamily();
    await writeProject(dirHandle, data);

    const backups = await listBackups(dirHandle);
    expect(backups).to.have.lengthOf(1);
    // family-YYYY-MM-DDTHHmmss.json -> stamp is 17 characters (e.g. 2026-10-20T082530)
    expect(backups[0]).to.match(/^family-\d{4}-\d{2}-\d{2}T\d{6}\.json$/);
  });

  it('1.5 refuses to open or overwrite a project with a future schemaVersion (FUTURE_VERSION)', async () => {
    const futureJson = JSON.stringify({
      schemaVersion: 999,
      project: { id: 'future-id', title: 'Future Archive' },
      persons: [],
      unions: [],
      parentChildren: [],
      media: [],
    });

    const parsed = parseProject(futureJson);
    expect(parsed.ok).to.equal(false);
    expect(parsed.errors[0].code).to.equal('FUTURE_VERSION');

    const dirHandle = await scratchFolder('Future folder');
    const fileHandle = await dirHandle.getFileHandle(FAMILY_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(futureJson);
    await writable.close();

    let caught = null;
    try {
      await loadProject(dirHandle);
    } catch (error) {
      caught = error;
    }

    expect(caught).to.be.instanceOf(StorageError);
    expect(caught.code).to.equal('FUTURE_VERSION');
  });
});
