/**
 * Geometry of the tree, in pixels.
 *
 * These live in JavaScript rather than in tokens.css because the layout engine
 * now computes positions, and it needs the real numbers. The canvas publishes
 * them back as custom properties so the components size themselves from the
 * same source — one definition, not two that drift apart.
 */
export const LAYOUT = {
  /** A person card. */
  cardWidth: 192,
  cardHeight: 76,

  /** The dot standing for a union. */
  unionSize: 24,

  /** Between a card and the union node beside it. */
  itemGap: 16,

  /** Between two couples of the same family. */
  siblingGap: 24,

  /** Between one family and the next. Wide enough to be read as a break. */
  familyGap: 80,

  /** Between generations. */
  rowGap: 80,

  /** Around the whole tree. */
  padding: 32,
};

/** The custom properties the components read, derived from the above. */
export const layoutProperties = (metrics = LAYOUT) => ({
  '--card-width': `${metrics.cardWidth}px`,
  '--card-height': `${metrics.cardHeight}px`,
  '--union-size': `${metrics.unionSize}px`,
});
