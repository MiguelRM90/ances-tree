/**
 * Every threshold in the project lives here. No stray numeric constants
 * scattered through the code (see AGENTS.md, conventions).
 */

// --- Maximum file sizes (storage.md, limits section) ---
export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
export const MAX_JSON_BYTES = 200 * 1024 * 1024;
export const MAX_GEDCOM_BYTES = 200 * 1024 * 1024;
export const MAX_UNZIPPED_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 100_000;

// --- Persistence ---
export const AUTOSAVE_DEBOUNCE_MS = 2_000;
export const BACKUP_COPIES = 10;

// --- Dates (data-model.md, genealogical dates) ---
// Margins used to derive the interval for ABT and EST. A project convention,
// not part of the GEDCOM standard.
export const ABOUT_MARGIN_YEARS = 5;
export const ESTIMATED_MARGIN_YEARS = 10;

// --- Validation (validation-rules.md) ---
export const MIN_PARENT_AGE = 12;
export const MAX_MOTHER_AGE = 55;
export const MAX_LIFESPAN_YEARS = 120;
export const POSTHUMOUS_MARGIN_MONTHS = 9;
export const MIN_UNION_AGE = 12;
export const PARTNER_AGE_GAP_INFO = 40;
export const CONSANGUINITY_MAX_DEPTH = 8;

// --- Interface ---
export const DEFAULT_GENERATIONS_UP = 4;
export const DEFAULT_GENERATIONS_DOWN = 4;
export const UNDO_STACK_SIZE = 50;
/** How many people back the "previous person" button can walk. */
export const TRAIL_LENGTH = 50;
export const SEARCH_RESULTS = 20;
export const SEARCH_DEBOUNCE_MS = 120;
export const RESIZE_DEBOUNCE_MS = 100;

/**
 * How long typing a union date settles before it is committed.
 *
 * Longer than the search debounce on purpose: this one writes to the project
 * and pushes an undo step, so it should fire once when the year is finished
 * rather than four times on the way to it.
 */
export const RELATION_EDIT_DEBOUNCE_MS = 600;
