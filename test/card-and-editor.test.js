import { expect } from '@open-wc/testing';
import '../src/ui/components/person-card.js';
import '../src/ui/components/person-editor.js';
import '../src/ui/components/tree-canvas.js';
import '../src/ui/components/menu-button.js';
import { S } from '../src/config/strings.js';
import { store } from '../src/store/store.js';
import { createBrowserFolder, removeBrowserFolder } from '../src/storage/opfs.js';
import { buildIndexes } from '../src/domain/graph/indexes.js';
import { person, minimalFamily } from './fixtures/families.js';

describe('PersonCard marks', () => {
  it('renders no marks when a person has neither notes nor documents', () => {
    const card = document.createElement('person-card');
    card.person = person('Single Person', { notes: '' });

    const marks = card.shadowRoot.querySelector('.marks');
    expect(marks).to.be.null;
  });

  it('renders a note mark when a person has notes', () => {
    const card = document.createElement('person-card');
    const p = person('Noted Person');
    p.notes = 'Some research note.';
    card.person = p;

    const marks = card.shadowRoot.querySelector('.marks');
    expect(marks).to.not.be.null;

    const note = marks.querySelector('.note');
    expect(note).to.not.be.null;
    expect(marks.querySelector('.doc-mark')).to.be.null;
  });

  it('renders a document mark when a person has documents', () => {
    const card = document.createElement('person-card');
    const p = person('Documented Person');
    card.documents = [{ id: 'doc-1', path: 'documents/test.pdf', caption: 'Test PDF' }];
    card.person = p;

    const marks = card.shadowRoot.querySelector('.marks');
    expect(marks).to.not.be.null;

    const docMark = marks.querySelector('.doc-mark');
    expect(docMark).to.not.be.null;
    expect(marks.querySelector('.note')).to.be.null;

    const title = docMark.querySelector('title');
    expect(title.textContent).to.include('Test PDF');

    const button = card.shadowRoot.querySelector('button');
    expect(button.getAttribute('aria-label')).to.include('document');
  });

  it('renders both marks side by side when a person has notes and documents', () => {
    const card = document.createElement('person-card');
    const p = person('Both Person');
    p.notes = 'Important note';
    card.documents = [{ id: 'doc-1', path: 'documents/archive.pdf', caption: 'Archive' }];
    card.person = p;

    const marks = card.shadowRoot.querySelector('.marks');
    expect(marks).to.not.be.null;

    const docMark = marks.querySelector('.doc-mark');
    const noteMark = marks.querySelector('.note');
    expect(docMark).to.not.be.null;
    expect(noteMark).to.not.be.null;
  });
});

describe('PersonEditor photo lightbox', () => {
  it('allows clicking a photo to open the enlarged photo dialog', async () => {
    const editor = document.createElement('person-editor');
    document.body.append(editor);

    const photos = [
      { id: 'photo-1', path: 'photos/one.jpg', links: [] },
      { id: 'photo-2', path: 'photos/two.jpg', links: [] },
    ];

    editor.resolvePhoto = async (path) => `blob:http://localhost/${path}`;
    editor.open(person('Photo Person'), { photos });

    const thumbButtons = editor.shadowRoot.querySelectorAll('.shot-thumb');
    expect(thumbButtons.length).to.equal(2);

    const lightbox = editor.shadowRoot.querySelector('dialog.lightbox');
    expect(lightbox).to.not.be.null;
    expect(lightbox.open).to.be.false;

    // Click the first thumbnail to open the lightbox
    thumbButtons[0].click();
    expect(lightbox.open).to.be.true;

    // Verify navigation buttons and count
    const count = lightbox.querySelector('.lightbox-count');
    expect(count.hidden).to.be.false;
    expect(count.textContent).to.equal(S.editor.photoCount(1, 2));

    // Close button closes lightbox
    const closeBtn = lightbox.querySelector('.lightbox-close');
    closeBtn.click();
    expect(lightbox.open).to.be.false;

    editor.close();
    editor.remove();
  });
});

describe('Focus and selection decoupling', () => {
  it('emits person:select on single click, person:focus on double-click, and person:edit on edit mark click', () => {
    const card = document.createElement('person-card');
    const p = person('Elena Gómez');
    card.person = p;
    document.body.append(card);

    const events = [];
    for (const type of ['person:select', 'person:focus', 'person:edit']) {
      card.addEventListener(type, (e) => events.push({ type, id: e.detail.personId }));
    }

    const button = card.shadowRoot.querySelector('button');
    button.click();
    expect(events).to.deep.equal([{ type: 'person:select', id: p.id }]);

    events.length = 0;
    button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
    expect(events).to.deep.equal([{ type: 'person:focus', id: p.id }]);

    events.length = 0;
    const editMark = card.shadowRoot.querySelector('.edit-mark');
    expect(editMark).to.not.be.null;
    editMark.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(events).to.deep.equal([{ type: 'person:edit', id: p.id }]);

    card.remove();
  });

  it('updates selected card in-place in TreeCanvas without recreating DOM elements', () => {
    const { data: project, child, father } = minimalFamily();
    const graph = buildIndexes(project);
    const canvas = document.createElement('tree-canvas');
    document.body.append(canvas);

    canvas.render({
      graph,
      focalId: child.id,
      selectedId: child.id,
      issuesFor: () => [],
      resolvePhoto: async () => null,
    });

    const childCardBefore = canvas.shadowRoot.querySelector(
      `person-card[data-node-id="p:${child.id}"]`,
    );
    const fatherCardBefore = canvas.shadowRoot.querySelector(
      `person-card[data-node-id="p:${father.id}"]`,
    );

    expect(childCardBefore.hasAttribute('focal')).to.be.true;
    expect(childCardBefore.hasAttribute('selected')).to.be.true;
    expect(fatherCardBefore.hasAttribute('focal')).to.be.false;
    expect(fatherCardBefore.hasAttribute('selected')).to.be.false;

    canvas.setSelected(father.id);

    const childCardAfter = canvas.shadowRoot.querySelector(
      `person-card[data-node-id="p:${child.id}"]`,
    );
    const fatherCardAfter = canvas.shadowRoot.querySelector(
      `person-card[data-node-id="p:${father.id}"]`,
    );

    expect(childCardAfter).to.equal(childCardBefore);
    expect(fatherCardAfter).to.equal(fatherCardBefore);
    expect(childCardAfter.hasAttribute('focal')).to.be.true;
    expect(childCardAfter.hasAttribute('selected')).to.be.false;
    expect(fatherCardAfter.hasAttribute('selected')).to.be.true;

    canvas.remove();
  });

  it('supports disabling individual items in MenuButton', () => {
    const menu = document.createElement('menu-button');
    let called = 0;
    menu.label = 'History';
    menu.items = [
      { label: 'Undo', action: () => (called += 1), disabled: true },
      { label: 'Redo', action: () => (called += 10) },
    ];
    document.body.append(menu);

    const buttons = menu.shadowRoot.querySelectorAll('.menu button');
    expect(buttons[0].disabled).to.be.true;
    expect(buttons[1].disabled).to.be.false;

    buttons[0].click();
    expect(called).to.equal(0);

    menu.setItemDisabled(0, false);
    expect(buttons[0].disabled).to.be.false;
    buttons[0].click();
    expect(called).to.equal(1);

    menu.remove();
  });

  it('keeps store.selectedPersonId independent from store.focalPersonId until focal changes', async () => {
    const { data: project, child, father, mother } = minimalFamily();
    const dirHandle = await createBrowserFolder('Selection Test');
    await store.adoptNew(project, dirHandle);

    expect(store.focalPersonId).to.equal(child.id);
    expect(store.selectedPersonId).to.equal(child.id);

    let selectionEvents = 0;
    const onSelect = () => (selectionEvents += 1);
    store.addEventListener('selection', onSelect);

    store.setSelectedPerson(father.id);
    expect(store.focalPersonId).to.equal(child.id);
    expect(store.selectedPersonId).to.equal(father.id);
    expect(selectionEvents).to.equal(1);

    store.setFocalPerson(mother.id);
    expect(store.focalPersonId).to.equal(mother.id);
    expect(store.selectedPersonId).to.equal(mother.id);

    store.removeEventListener('selection', onSelect);
    store.close();
    await removeBrowserFolder(dirHandle.name).catch(() => {});
  });
});
