import { expect } from '@open-wc/testing';
import '../src/ui/components/person-card.js';
import '../src/ui/components/person-editor.js';
import { S } from '../src/config/strings.js';
import { person } from './fixtures/families.js';

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
