/**
 * Geometry for the kinship lines.
 *
 * Kept apart from the component that paints them so it can be tested without a
 * browser. Three separate bugs have shipped in these few lines, every one of
 * them looking like "the lines are a bit wrong" and none of them pointing at
 * its own cause, so they are now covered by tests over synthetic rectangles.
 *
 * A "box" is `{cx, top, bottom, left, right}` in the coordinate space of the
 * SVG layer.
 */

/** Distance from the children up to the lowest sibling bar. */
export const BAR_GAP = 18;

/** Distance between staggered tracks. */
export const BAR_STEP = 11;

/** Maximum number of staggered track heights available in the inter-row gap. */
export const MAX_TRACKS = 6;

/** Buffer in pixels to treat nearly-adjacent horizontal segments as conflicting. */
export const COLLISION_BUFFER = 16;

/** Horizontal run between a card and its union node, at the same height. */
export function partnerPath(from, to) {
  const y = (from.top + from.bottom) / 2;
  const x = from.cx < to.cx ? from.right : from.left;
  return `M ${x} ${y} L ${to.cx} ${y}`;
}

/**
 * One path per set of siblings: a stem down from the parents, a bar, and a drop
 * onto each child.
 *
 * @param {Array<{kind: string, fromNodeId: string, toNodeId: string}>} edges
 * @param {Map<string, object>} boxes  node id -> measured box
 * @returns {Array<{id: string, d: string, children: string[]}>}
 */
export function descentPaths(edges, boxes) {
  const groups = new Map();

  for (const edge of edges) {
    if (edge.kind !== 'descent') continue;

    const from = boxes.get(edge.fromNodeId);
    const to = boxes.get(edge.toNodeId);
    if (!from || !to) continue;

    const group = groups.get(edge.fromNodeId);
    if (group) {
      if (!group.children.some((child) => child.nodeId === to.nodeId)) {
        group.children.push(to);
      }
    } else {
      groups.set(edge.fromNodeId, { fromNodeId: edge.fromNodeId, from, children: [to] });
    }
  }

  if (groups.size === 0) return [];

  const rows = new Map();
  for (const group of groups.values()) {
    const childTop = Math.min(...group.children.map((c) => c.top));
    const rowKey = Math.round(childTop);
    const row = rows.get(rowKey);
    if (row) row.push(group);
    else rows.set(rowKey, [group]);
  }

  const result = [];

  for (const row of rows.values()) {
    const families = row.map((group) => {
      const xs = [group.from.cx, ...group.children.map((c) => c.cx)];
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      return {
        ...group,
        left,
        right,
        childTop: Math.min(...group.children.map((c) => c.top)),
      };
    });

    families.sort((a, b) => a.left - b.left || a.from.cx - b.from.cx || a.right - b.right);

    const tracks = assignTracks(families);
    const rowMaxTrack = Math.max(...tracks);

    for (let i = 0; i < families.length; i++) {
      const fam = families[i];
      const track = tracks[i];
      result.push({
        id: `descent:${fam.fromNodeId}`,
        d: familyPath(fam, track, rowMaxTrack),
        children: fam.children.map((child) => child.nodeId).filter(Boolean),
      });
    }
  }

  return result;
}

function assignTracks(families) {
  const tracks = [];

  for (let i = 0; i < families.length; i++) {
    const current = families[i];

    const conflictingTracks = [];
    for (let j = 0; j < i; j++) {
      const prev = families[j];
      const overlaps =
        current.left <= prev.right + COLLISION_BUFFER &&
        prev.left <= current.right + COLLISION_BUFFER;
      if (overlaps) {
        conflictingTracks.push(tracks[j]);
      }
    }

    let assigned;
    if (conflictingTracks.length === 0) {
      assigned = 0;
    } else {
      const maxConf = Math.max(...conflictingTracks);
      const candidate = maxConf + 1;
      if (candidate < MAX_TRACKS && !conflictingTracks.includes(candidate)) {
        assigned = candidate;
      } else {
        for (let t = 0; t < MAX_TRACKS; t++) {
          if (!conflictingTracks.includes(t)) {
            assigned = t;
            break;
          }
        }
        if (assigned === undefined) {
          assigned = candidate % MAX_TRACKS;
        }
      }
    }

    tracks.push(assigned);
  }

  return tracks;
}

function familyPath({ from, children, childTop }, track, rowMaxTrack = track) {
  const barY = childTop - (BAR_GAP + (rowMaxTrack - track) * BAR_STEP);

  const xs = [from.cx, ...children.map((child) => child.cx)];
  const left = Math.min(...xs);
  const right = Math.max(...xs);

  const stem = `M ${from.cx} ${from.bottom} V ${barY}`;
  const bar = right > left ? ` M ${left} ${barY} H ${right}` : '';
  const drops = children.map((child) => ` M ${child.cx} ${barY} V ${child.top}`).join('');

  return `${stem}${bar}${drops}`;
}
