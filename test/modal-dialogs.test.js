import { expect } from '@open-wc/testing';
import '../src/ui/components/person-editor.js';
import '../src/ui/components/relation-editor.js';
import '../src/ui/components/review-panel.js';
import '../src/ui/components/import-dialog.js';
import { person, project } from './fixtures/families.js';
import { buildIndexes } from '../src/domain/graph/indexes.js';
import { S } from '../src/config/strings.js';

describe('Modal Dialogs Backdrop and Cancellation Behaviour', () => {
  describe('PersonEditor', () => {
    let editor;

    beforeEach(() => {
      editor = document.createElement('person-editor');
      document.body.append(editor);
    });

    afterEach(() => {
      editor.remove();
    });

    it('does not close when clicking on the dialog backdrop', () => {
      const p = person('John');
      editor.open(p);

      const dialog = editor.shadowRoot.querySelector('dialog:not(.lightbox)');
      expect(dialog.open).to.be.true;

      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(dialog.open).to.be.true;
    });

    it('closes when clicking the cancel button', () => {
      const p = person('John');
      editor.open(p);

      const dialog = editor.shadowRoot.querySelector('dialog:not(.lightbox)');
      expect(dialog.open).to.be.true;

      const buttons = editor.shadowRoot.querySelectorAll('button');
      const cancelBtn = Array.from(buttons).find((b) => b.textContent === S.editor.cancel);
      expect(cancelBtn).to.not.be.undefined;

      cancelBtn.click();
      expect(dialog.open).to.be.false;
    });

    it('closes when pressing Escape (cancel event)', () => {
      const p = person('John');
      editor.open(p);

      const dialog = editor.shadowRoot.querySelector('dialog:not(.lightbox)');
      expect(dialog.open).to.be.true;

      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      expect(dialog.open).to.be.false;
    });

    it('does not close photo lightbox on backdrop click, only via close button or Escape', () => {
      const p = person('Photo Person');
      const photos = [{ id: 'photo-1', path: 'photos/one.jpg', links: [] }];
      editor.resolvePhoto = async (path) => `blob:http://localhost/${path}`;
      editor.open(p, { photos });

      const thumbButtons = editor.shadowRoot.querySelectorAll('.shot-thumb');
      thumbButtons[0].click();

      const lightbox = editor.shadowRoot.querySelector('dialog.lightbox');
      expect(lightbox.open).to.be.true;

      lightbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(lightbox.open).to.be.true;

      lightbox.dispatchEvent(new Event('cancel', { cancelable: true }));
      expect(lightbox.open).to.be.false;
    });
  });

  describe('RelationEditor', () => {
    let relationEditor;

    beforeEach(() => {
      relationEditor = document.createElement('relation-editor');
      document.body.append(relationEditor);
    });

    afterEach(() => {
      relationEditor.remove();
    });

    it('does not close when clicking on the dialog backdrop', () => {
      const focal = person('Focal');
      const graph = buildIndexes(project({ persons: [focal] }));
      relationEditor.open(focal.id, () => graph);

      const dialog = relationEditor.shadowRoot.querySelector('dialog');
      expect(dialog.open).to.be.true;

      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(dialog.open).to.be.true;
    });

    it('closes when clicking the done button', () => {
      const focal = person('Focal');
      const graph = buildIndexes(project({ persons: [focal] }));
      relationEditor.open(focal.id, () => graph);

      const dialog = relationEditor.shadowRoot.querySelector('dialog');
      expect(dialog.open).to.be.true;

      const buttons = relationEditor.shadowRoot.querySelectorAll('button');
      const doneBtn = Array.from(buttons).find((b) => b.textContent === S.relations.done);
      expect(doneBtn).to.not.be.undefined;

      doneBtn.click();
      expect(dialog.open).to.be.false;
    });

    it('closes when pressing Escape (cancel event)', () => {
      const focal = person('Focal');
      const graph = buildIndexes(project({ persons: [focal] }));
      relationEditor.open(focal.id, () => graph);

      const dialog = relationEditor.shadowRoot.querySelector('dialog');
      expect(dialog.open).to.be.true;

      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      expect(dialog.open).to.be.false;
    });
  });

  describe('ReviewPanel', () => {
    let reviewPanel;

    beforeEach(() => {
      reviewPanel = document.createElement('review-panel');
      document.body.append(reviewPanel);
    });

    afterEach(() => {
      reviewPanel.remove();
    });

    it('does not close when clicking on the dialog backdrop', () => {
      const focal = person('Focal');
      const graph = buildIndexes(project({ persons: [focal] }));
      reviewPanel.open([], graph);

      const dialog = reviewPanel.shadowRoot.querySelector('dialog');
      expect(dialog.open).to.be.true;

      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(dialog.open).to.be.true;
    });

    it('closes when clicking the close button', () => {
      const focal = person('Focal');
      const graph = buildIndexes(project({ persons: [focal] }));
      reviewPanel.open([], graph);

      const dialog = reviewPanel.shadowRoot.querySelector('dialog');
      expect(dialog.open).to.be.true;

      const buttons = reviewPanel.shadowRoot.querySelectorAll('button');
      const closeBtn = Array.from(buttons).find((b) => b.textContent === S.review.close);
      expect(closeBtn).to.not.be.undefined;

      closeBtn.click();
      expect(dialog.open).to.be.false;
    });

    it('closes when pressing Escape (cancel event)', () => {
      const focal = person('Focal');
      const graph = buildIndexes(project({ persons: [focal] }));
      reviewPanel.open([], graph);

      const dialog = reviewPanel.shadowRoot.querySelector('dialog');
      expect(dialog.open).to.be.true;

      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      expect(dialog.open).to.be.false;
    });
  });

  describe('ImportDialog', () => {
    let importDialog;

    beforeEach(() => {
      importDialog = document.createElement('import-dialog');
      document.body.append(importDialog);
    });

    afterEach(() => {
      importDialog.remove();
    });

    it('does not close when clicking on the dialog backdrop', () => {
      const inspection = {
        manifest: { title: 'Test Archive' },
        counts: { persons: 5, unions: 2, parentChildren: 4, media: 1, bytes: 1024 },
      };
      importDialog.open(inspection, true);

      const dialog = importDialog.shadowRoot.querySelector('dialog');
      expect(dialog.open).to.be.true;

      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(dialog.open).to.be.true;
    });

    it('closes when clicking the cancel button', () => {
      const inspection = {
        manifest: { title: 'Test Archive' },
        counts: { persons: 5, unions: 2, parentChildren: 4, media: 1, bytes: 1024 },
      };
      importDialog.open(inspection, true);

      const dialog = importDialog.shadowRoot.querySelector('dialog');
      expect(dialog.open).to.be.true;

      const buttons = importDialog.shadowRoot.querySelectorAll('button');
      const cancelBtn = Array.from(buttons).find((b) => b.textContent === S.editor.cancel);
      expect(cancelBtn).to.not.be.undefined;

      cancelBtn.click();
      expect(dialog.open).to.be.false;
    });

    it('closes when pressing Escape (cancel event)', () => {
      const inspection = {
        manifest: { title: 'Test Archive' },
        counts: { persons: 5, unions: 2, parentChildren: 4, media: 1, bytes: 1024 },
      };
      importDialog.open(inspection, true);

      const dialog = importDialog.shadowRoot.querySelector('dialog');
      expect(dialog.open).to.be.true;

      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      expect(dialog.open).to.be.false;
    });
  });
});
