import { expect } from '@open-wc/testing';
import { createBrowserFolder, removeBrowserFolder } from '../src/storage/opfs.js';
import { createProjectIn } from '../src/storage/project-store.js';
import { importPhoto, readMediaFile } from '../src/storage/media.js';
import { parseDate } from '../src/domain/date/parse.js';
import { formatDate } from '../src/domain/date/format.js';
import { displayName } from '../src/domain/graph/queries.js';
import { createPerson, createPlaceholder, createProject } from '../src/domain/model/factories.js';
import { createSampleProject } from '../src/domain/model/sample-family.js';
import { buildIndexes } from '../src/domain/graph/indexes.js';
import { validateAll, validateBlocking } from '../src/domain/validation/engine.js';
import { exportGedcom } from '../src/domain/gedcom/export.js';
import { importGedcom } from '../src/domain/gedcom/import.js';
import { store } from '../src/store/store.js';
import * as actions from '../src/store/actions.js';
import * as dom from '../src/ui/dom.js';

describe('Phase 3 — Quality, i18n, and Maintainability', function () {
  this.timeout(15_000);

  const created = [];

  async function scratchFolder(title) {
    const dirHandle = await createBrowserFolder(title);
    created.push(dirHandle.name);
    return dirHandle;
  }

  afterEach(async () => {
    if (store.isOpen) store.close();
    while (created.length > 0) {
      await removeBrowserFolder(created.pop()).catch(() => {});
    }
  });

  it('3.1 preserves format and transparency for PNG and WebP images when stripping metadata', async () => {
    const dirHandle = await scratchFolder('Phase3 Media');
    await createProjectIn(dirHandle, 'Phase3 Media');

    // Draw a 4x4 image where only (0,0) is opaque and (3,3) is completely transparent
    const canvas = new OffscreenCanvas(4, 4);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 4, 4);
    ctx.fillStyle = 'rgba(255, 0, 0, 1)';
    ctx.fillRect(0, 0, 1, 1);

    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
    const pngFile = new File([pngBlob], 'coat-of-arms.png', { type: 'image/png' });

    const pngResult = await importPhoto(dirHandle, pngFile, [], { stripExif: true });
    expect(pngResult.media.mime).to.equal('image/png');
    expect(pngResult.media.path).to.match(/\.png$/);

    // Verify transparency is preserved in the stored file
    const savedPng = await readMediaFile(dirHandle, pngResult.media.path);
    const bitmap = await createImageBitmap(savedPng);
    const verifyCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const verifyCtx = verifyCanvas.getContext('2d');
    verifyCtx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const transparentPixel = verifyCtx.getImageData(3, 3, 1, 1).data;
    expect(transparentPixel[3]).to.equal(0);

    // Also verify WebP preserves image/webp format
    const webpBlob = await canvas.convertToBlob({ type: 'image/webp' });
    const webpFile = new File([webpBlob], 'portrait.webp', { type: 'image/webp' });
    const webpResult = await importPhoto(dirHandle, webpFile, [], { stripExif: true });
    expect(webpResult.media.mime).to.equal('image/webp');
    expect(webpResult.media.path).to.match(/\.webp$/);
  });

  it('3.2 localizes date qualifiers in formatDate and default names in displayName for Spanish', () => {
    expect(formatDate(parseDate('ABT 1885'), 'es')).to.equal('hacia 1885');
    expect(formatDate(parseDate('EST 1885'), 'es')).to.equal('estimada 1885');
    expect(formatDate(parseDate('CAL 1885'), 'es')).to.equal('calculada 1885');
    expect(formatDate(parseDate('BEF 1900'), 'es')).to.equal('antes de 1900');
    expect(formatDate(parseDate('AFT 1900'), 'es')).to.equal('después de 1900');
    expect(formatDate(parseDate('BET 1900 AND 1905'), 'es')).to.equal('entre 1900 y 1905');

    const unnamed = createPerson();
    const unknown = createPlaceholder();
    expect(displayName(unnamed, 'es')).to.equal('Sin nombre');
    expect(displayName(unknown, 'es')).to.equal('Desconocida');
    expect(displayName(unnamed, 'en')).to.equal('Unnamed');
    expect(displayName(unknown, 'en')).to.equal('Unknown');
  });

  it('3.3 escapes @ signs and sanitizes single-line newlines in exportGedcom', () => {
    const p = createPerson({
      firstName: 'Ana',
      lastName: 'García',
      birth: {
        date: parseDate('1900'),
        place: 'Madrid @ Centro\n0 @I999@ INDI\n1 NAME Injected /Person/',
      },
      notes: 'Email: ana@example.com and literal @@ in note',
    });

    const proj = createProject({ title: 'Test' });
    proj.persons.push(p);

    const ged = exportGedcom(proj, { now: new Date(Date.UTC(2026, 0, 1)) });
    const imported = importGedcom(ged);

    // Line injection in PLAC must not create a second INDI record
    expect(imported.project.persons).to.have.lengthOf(1);
    expect(imported.project.persons[0].birth.place).to.include('Madrid @ Centro');
    // Notes with @ and @@ must round-trip without losing @ characters
    expect(imported.project.persons[0].notes).to.equal(
      'Email: ana@example.com and literal @@ in note',
    );
  });

  it('3.4 preserves structural sharing of untouched entities in store.apply and unifies formatBytes in dom.js', async () => {
    const dirHandle = await scratchFolder('Phase3 Sharing');
    const p1 = createPerson({ firstName: 'First' });
    const p2 = createPerson({ firstName: 'Second' });
    const initial = await createProjectIn(dirHandle, 'Phase3 Sharing');
    initial.persons.push(p1, p2);

    await store.adoptNew(initial, dirHandle);
    const refBefore = store.project.persons[1];

    actions.updatePerson(p1.id, { firstName: 'First Updated' });
    const refAfter = store.project.persons[1];

    // Untouched person p2 should share the exact same reference rather than being deep-cloned
    expect(refAfter).to.equal(refBefore);

    // Unified formatBytes helper in dom.js
    expect(dom.formatBytes).to.be.a('function');
    expect(dom.formatBytes(0)).to.equal('0 B');
    expect(dom.formatBytes(512)).to.equal('512 B');
    expect(dom.formatBytes(2048)).to.include('2');
  });

  it('3.5 service worker does not call skipWaiting unconditionally during install', async () => {
    const response = await fetch('/public/sw.js');
    const source = await response.text();

    // Extract the install handler block and message handler block
    const installMatch = /addEventListener\(\s*'install'[\s\S]*?\}\s*\);/.exec(source);
    const messageMatch = /addEventListener\(\s*'message'[\s\S]*?\}\s*\);/.exec(source);

    expect(installMatch).to.not.equal(null);
    expect(installMatch[0]).to.not.include('skipWaiting');

    expect(messageMatch).to.not.equal(null);
    expect(messageMatch[0]).to.include('skip-waiting');
    expect(messageMatch[0]).to.include('skipWaiting');
  });

  it('3.6 builds and opens the one-click sample family archive with rich genealogical features', async () => {
    const sample = createSampleProject({ locale: 'es' });
    expect(sample.persons).to.have.lengthOf(16);
    expect(sample.unions).to.have.lengthOf(6);

    const graph = buildIndexes(sample);
    expect(validateBlocking(graph)).to.have.lengthOf(0);

    const issues = validateAll(graph);
    expect(issues.some((i) => i.ruleId === 'CONSANGUINEOUS_UNION')).to.equal(true);

    const result = await actions.openSampleProject('es');
    created.push(result.folderName);

    expect(result.ok).to.equal(true);
    expect(store.isOpen).to.equal(true);
    expect(store.graph.persons.get(store.focalPersonId).firstName).to.equal('Elena');
    expect(store.graph.persons.size).to.equal(16);
  });
});
