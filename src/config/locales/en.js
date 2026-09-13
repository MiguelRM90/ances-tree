/** English UI strings. The shape here is the contract every locale follows. */

export const en = {
  app: {
    name: 'AncesTree',
    tagline: 'A family tree you keep yourself.',
  },

  unsupported: {
    title: 'This browser is not supported',
    body:
      'AncesTree needs somewhere durable to keep a family archive, and a way to write files to it a ' +
      'piece at a time. This browser offers neither.',
    supported: 'Use a current version of Chrome, Edge, Firefox or Safari.',
    missing: 'Missing capabilities:',
    fileProtocol:
      'AncesTree cannot run from a file:// URL. Serve it over http(s) or install it as an app.',
  },

  welcome: {
    newProject: 'New family',
    openProject: 'Open a folder',
    importArchive: 'Import a ZIP',
    reopen: 'Reopen',
    pickFolderHint: 'Choose an empty folder. AncesTree will create the project files inside it.',
    defaultName: 'My family',
    deniedFolder: 'Permission to that folder was not granted.',
    missingFolder: 'That folder is no longer available. Choose it again.',

    // Browser storage: there is no folder picker, so the app keeps the list.
    archives: 'Your archives',
    noArchives: 'No archives yet. Start one, or import a ZIP somebody sent you.',
    archiveMeta: (persons, savedAt) => {
      const who = `${persons} ${persons === 1 ? 'person' : 'people'}`;
      return savedAt ? `${who} · saved ${savedAt}` : who;
    },
    deleteArchive: 'Delete',
    deleteArchiveLabel: (title) => `Delete ${title}`,
    confirmDelete: (title) =>
      `Delete “${title}” for good?\n\nIt exists in this browser only. Unless you have exported a ZIP, ` +
      'there is no other copy, and this cannot be undone.',
    missingArchive: 'That archive is no longer there.',
    browserHint:
      'Your archive is kept by the browser on this device. Export a ZIP to keep a copy of your own.',
  },

  /** Said plainly and more than once, because this storage really is weaker. */
  browserStorage: {
    badge: 'In browser storage',
    title: 'This archive lives inside your browser',
    body:
      'This device has no folder picker, so AncesTree keeps the archive in storage the browser owns. ' +
      'Clearing site data deletes it, and some browsers discard it after a few weeks without a visit.',
    advice:
      'Export a ZIP every so often and put it somewhere you chose. That copy is the one that is yours.',
    installHint:
      'Adding AncesTree to your home screen makes the browser far less likely to discard it.',
    persisted: 'The browser has agreed to hold on to this storage.',
    notPersisted: 'The browser has not promised to hold on to this storage.',
    usage: (used) => `Currently using ${used}.`,
    exportNow: 'Export a ZIP now',
    dismiss: 'Got it',
  },

  tree: {
    empty: 'No one here yet.',
    addFirstPerson: 'Add the first person',
    focusHint: 'Click a person to centre the tree on them. Click again to edit.',
    pinUnion: (couple) => `Keep the children of ${couple} highlighted`,
    saving: 'Saving…',
    saved: 'Saved',
    saveError: 'Could not save. Check that the folder is still available.',
  },

  toolbar: {
    edit: 'Edit',
    addParent: 'Add parent',
    addPartner: 'Add partner',
    addChild: 'Add child',
    addPerson: 'Add person',
    // Labels for the two menus the toolbar folds its families of actions into.
    add: 'Add',
    transfer: 'Import & export',
    undo: 'Undo',
    redo: 'Redo',
    exportZip: 'Export ZIP',
    importZip: 'Import ZIP',
    exportGedcom: 'Export GEDCOM',
    importGedcom: 'Import GEDCOM',
    review: 'Review',
    back: 'Back',
    backTo: 'Back to the previous person',
    ancestors: 'Up',
    descendants: 'Down',
    centredOn: 'Centred on',
    generationsUp: 'Generations shown above the centred person',
    generationsDown: 'Generations shown below the centred person',
    language: 'Language',
  },

  archive: {
    exporting: 'Writing archive…',
    exported: (n) => `Archive written · ${n} files`,
    importTitle: 'Import archive',
    summary: (c) =>
      `${c.persons} people · ${c.unions} unions · ${c.media} media · ${c.files} files`,
    unnamedArchive: 'Untitled archive',
    chooseStrategy: 'How should this archive be brought in?',
    mergeHere: 'Merge into this family',
    mergeHint:
      'Adds anything missing, matching by id. Anything already here keeps the local version.',
    openAsNew: 'Open as a new family',
    openAsNewHint: 'Extracts into a new archive of its own. Nothing existing is touched.',
    merged: (added) =>
      `Imported · ${added.persons} people, ${added.unions} unions, ${added.media} media added`,
    imported: 'Archive imported',
    gedcomWritten: (n) => `GEDCOM written · ${n} people`,
    gedcomRead: (c) => `Imported ${c.persons} people and ${c.unions} unions`,
    gedcomWarnings: (n) => `${n} ${n === 1 ? 'line was' : 'lines were'} not understood`,
    gedcomEncoding: (enc) =>
      `Declared encoding ${enc}: accented characters may have been approximated.`,
    gedcomPhotos: 'A GEDCOM carries no photographs — only the references to them.',
    gedcomLossy: 'GEDCOM cannot hold everything this app records. The ZIP is the faithful copy.',
    // A damaged file is reported rather than aborting the whole import.
    damaged: (n) => `${n} ${n === 1 ? 'file was' : 'files were'} damaged and may be incomplete`,
  },

  editor: {
    title: 'Edit person',
    firstName: 'First name',
    lastName: 'First surname',
    secondLastName: 'Second surname',
    sex: 'Sex',
    nationality: 'Nationality',
    countrySearch: 'Search countries',
    noNationality: 'Not recorded',
    birth: 'Born',
    death: 'Died',
    place: 'Place',
    notes: 'Notes',
    save: 'Save',
    cancel: 'Cancel',
    remove: 'Delete person',
    confirmRemove: 'Delete this person and every link to them?',
    materialise: 'This is a placeholder for an unknown person. Filling in a name makes them real.',
    year: 'Year',
    rangeSeparator: 'and',
    review: 'Review',
    noIssues: 'Nothing to flag.',
    showPerson: (name) => `Centre the tree on ${name}`,
    photos: 'Photos',
    addPhotos: 'Add photos',
    noPhotos: 'No photos yet.',
    portrait: 'Portrait',
    makePortrait: 'Use as portrait',
    removePhoto: 'Remove photo',
    photoOf: (name) => `Photo of ${name}`,
    exifStripped: 'Location and camera data are removed from photos as they are added.',
    photosAdded: (n) => `${n} ${n === 1 ? 'photo' : 'photos'} added`,
    photosReused: (n) => `${n} already in this archive`,
    photosFailed: (n) => `${n} could not be read`,
    documents: 'Documents',
    addDocuments: 'Add documents',
    noDocuments: 'No documents yet.',
    removeDocument: 'Remove document',
    downloadDocument: 'Download or open document',
    documentsAdded: (n) => `${n} ${n === 1 ? 'document added' : 'documents added'}`,
    documentsReused: (n) => `${n} already in this archive`,
    documentsFailed: (n) => `${n} could not be read`,
    documentsHint: 'PDF, Word, Excel, text and other attached documents.',
    // Only shown for the free-text mode: everything else has its own control.
    dateHint: '12 MAY 1912 · ABT 1885 · BET 1900 AND 1905',
    dateUnrecognised: 'Kept as written, but not understood as a date.',
  },

  /**
   * Kinds of date offered by the editor. Real genealogy is mostly imprecise, so
   * the uncertain forms are first-class here, not an afterthought.
   */
  dateMode: {
    UNKNOWN: 'Unknown',
    EXACT: 'Exact date',
    MONTH: 'Month and year',
    YEAR: 'Year only',
    ABOUT: 'About a year (ABT)',
    ESTIMATED: 'Estimated (EST)',
    BEFORE: 'Before a year (BEF)',
    AFTER: 'After a year (AFT)',
    BETWEEN: 'Between two years (BET)',
    RAW: 'GEDCOM text',
  },

  card: {
    issues: (n) => `${n} ${n === 1 ? 'check' : 'checks'} on this person`,
    hasNote: 'Has a written note',
  },

  relations: {
    title: (name) => `Relationships of ${name}`,
    open: 'Relationships',
    done: 'Done',
    cancel: 'Cancel',
    change: 'Change',
    remove: 'Remove',
    unknownPerson: 'Unknown',

    parents: 'Parents',
    noParents: 'No parents recorded.',
    parentType: 'Kind of parent',
    addParent: 'Search for a parent to add…',
    addParentHint:
      'Anyone can be added. This person and everybody descended from them are not offered: that would be a loop.',
    changeParent: (name) => `Replace ${name} with somebody else`,
    removeParent: (name) => `Remove ${name} as a parent`,
    replacing: (name) => `Replace ${name} with…`,

    couple: 'Descends from the couple',
    noCouple: 'Not recorded as a couple',
    coupleOf: (a, b) => `${a} and ${b}`,
    coupleHint:
      'Choosing a couple makes both of them parents. Any other parent already recorded is left alone.',

    partners: 'Partners',
    noPartners: 'No partners recorded.',
    addPartner: 'Search for a partner to add…',
    addPartnerHint: 'Anyone can be added who is not already a descendant or partner.',
    unionType: 'Kind of relationship',
    started: 'From',
    ended: 'Until',
    removeUnion: (name) => `Remove the relationship with ${name}`,
  },

  /** How two people were together. A marriage that ended has an end date. */
  unionType: {
    MARRIED: 'Married',
    PARTNERS: 'Partners',
    CASUAL: 'Occasional',
    UNKNOWN: 'Not recorded',
  },

  parentType: {
    BIOLOGICAL: 'Biological',
    ADOPTED: 'Adoptive',
    FOSTER: 'Foster',
    STEP: 'Step',
    GUARDIAN: 'Guardian',
  },

  review: {
    title: 'Review the archive',
    all: 'Everything',
    errors: 'Errors',
    warnings: 'Warnings',
    notes: 'Notes',
    nothing: 'Nothing to review here.',
    more: (n) => `…and ${n} more.`,
    close: 'Close',
  },

  search: {
    label: 'Search for a person',
    placeholder: 'Search…',
    noResults: 'Nobody by that name.',
  },

  notice: {
    dismiss: 'Dismiss',
    changeRejected: 'That change was not saved',
    changeRejectedDetail: 'It would leave the tree in an impossible state.',
  },

  /** Accessible names for things whose meaning is only visual. */
  a11y: {
    tree: 'Family tree',
    treeHint: 'Use the arrow keys to move between people. Press Enter to centre the tree.',
    toolbar: 'Family actions',
    dateKind: 'Kind of date',
    notifications: 'Notifications',
  },

  sex: {
    M: 'Male',
    F: 'Female',
    U: 'Unknown',
    X: 'Other',
  },

  // Validation messages. Keys match the `messageKey` of each rule
  // (validation-rules.md, engine contract section).
  validation: {
    selfParent: 'A person cannot be their own parent.',
    selfUnion: 'A union requires two different people.',
    cycle: 'This link would create a loop in the tree.',
    duplicateEdge: 'This parent-child link already exists.',
    duplicateUnion: 'These two people are already linked by a union.',
    tooManyBiologicalParents: 'A person cannot have more than two biological parents.',
    danglingRef: 'This record points to something that no longer exists.',
    deathBeforeBirth: 'Death date is before the birth date.',
    implausibleLifespan: 'Lifespan over 120 years — check the dates.',
    parentBornAfterChild: 'This parent was born after their child.',
    parentTooYoung: 'This parent would have been very young.',
    parentTooOld: 'This mother would have been unusually old.',
    childAfterMotherDeath: 'This child was born after their mother died.',
    childLongAfterFatherDeath: 'This child was born long after their father died.',
    unionEndBeforeStart: 'The union ends before it starts.',
    unionAfterDeath: 'This union starts after one partner had died.',
    unionBeforeBirth: 'This union starts before one partner was born.',
    unionTooYoung: 'One partner would have been very young.',
    consanguineousUnion: 'These partners share a common ancestor.',
    commonAncestor: (name, generations) =>
      `Common ancestor: ${name}${generations ? `, ${generations} generations back` : ''}.`,
    siblingAsParent: 'Someone is listed as a parent of their own sibling.',
    missingBirthDate: 'No birth date recorded.',
    missingSurname: 'No surname recorded.',
    missingSex: 'Sex not recorded.',
    orphanPerson: 'Not connected to anyone else.',
    livingPersonNoDeath: 'Born over 120 years ago with no death date.',
  },
};
