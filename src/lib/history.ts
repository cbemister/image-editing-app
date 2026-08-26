import type { CropRect } from './types';

/**
 * One undoable state of an image.
 *
 * Crops are plain data and cheap to keep. The cutout is an ImageBitmap and is
 * not: at 2140x2647 each is roughly 22MB of GPU-backed pixels, so the depth
 * has to be capped rather than left to grow with the session.
 */
export interface Snapshot {
  /** Per-preset crop rects, copied so later edits do not mutate history. */
  crops: Record<string, CropRect>;
  /**
   * The cutout at this point, or undefined when the background was on.
   *
   * History OWNS these bitmaps: it closes them when they fall off the end of
   * the stack, and the live image must never close one it handed over. A
   * bitmap may appear in several entries (a crop drag does not change the
   * cutout), so it is only closed once nothing else references it.
   */
  cutout?: ImageBitmap;
  useCutout: boolean;
  /** Short description, for the tooltip on the undo button. */
  label: string;
}

/**
 * How many steps to keep. Bitmaps dominate the cost, so this is set by memory
 * rather than by how far back anyone plausibly wants to go: 12 steps of a
 * 24-megapixel cutout is already ~260MB in the worst case, where every step
 * changed the pixels.
 */
const MAX_DEPTH = 12;

export interface History {
  past: Snapshot[];
  future: Snapshot[];
}

export function emptyHistory(): History {
  return { past: [], future: [] };
}

/** Bitmaps still referenced by any entry in the history. */
function liveBitmaps(history: History): Set<ImageBitmap> {
  const live = new Set<ImageBitmap>();
  for (const s of [...history.past, ...history.future]) {
    if (s.cutout) live.add(s.cutout);
  }
  return live;
}

/**
 * Free a snapshot's bitmap if no other entry still needs it.
 *
 * `alsoLive` covers bitmaps held outside the history -- most importantly the
 * one currently on screen, which must survive being dropped from the stack.
 */
function releaseSnapshot(
  snapshot: Snapshot,
  history: History,
  alsoLive: Set<ImageBitmap>
): void {
  const bitmap = snapshot.cutout;
  if (!bitmap || alsoLive.has(bitmap)) return;
  if (!liveBitmaps(history).has(bitmap)) bitmap.close();
}

/**
 * Push a new state, discarding any redo branch.
 *
 * Returns a new History; the caller keeps it on the image. `currentlyLive`
 * is the set of bitmaps in use right now, so trimming the stack never frees
 * something still being displayed.
 */
export function pushHistory(
  history: History,
  snapshot: Snapshot,
  currentlyLive: Set<ImageBitmap> = new Set()
): History {
  // A new edit invalidates the redo branch; those states are unreachable.
  const next: History = { past: [...history.past, snapshot], future: [] };

  for (const dropped of history.future) {
    releaseSnapshot(dropped, next, currentlyLive);
  }

  while (next.past.length > MAX_DEPTH) {
    const oldest = next.past.shift()!;
    releaseSnapshot(oldest, next, currentlyLive);
  }

  return next;
}

/**
 * Step back one state.
 *
 * `present` is the state being left, which moves onto the redo branch so it
 * can be returned to. Returns null when there is nothing to undo.
 */
export function undo(
  history: History,
  present: Snapshot
): { history: History; snapshot: Snapshot } | null {
  if (history.past.length === 0) return null;
  const past = [...history.past];
  const snapshot = past.pop()!;
  return {
    history: { past, future: [present, ...history.future] },
    snapshot,
  };
}

/** Step forward one state. Returns null when there is nothing to redo. */
export function redo(
  history: History,
  present: Snapshot
): { history: History; snapshot: Snapshot } | null {
  if (history.future.length === 0) return null;
  const future = [...history.future];
  const snapshot = future.shift()!;
  return {
    history: { past: [...history.past, present], future },
    snapshot,
  };
}

/** Free every bitmap the history owns. For clearing or discarding an image. */
export function releaseHistory(history: History, alsoLive: Set<ImageBitmap> = new Set()): void {
  const seen = new Set<ImageBitmap>();
  for (const s of [...history.past, ...history.future]) {
    if (s.cutout && !alsoLive.has(s.cutout)) seen.add(s.cutout);
  }
  for (const b of seen) b.close();
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/** Label of the step undo would return to, for the button tooltip. */
export function undoLabel(history: History): string | null {
  const top = history.past[history.past.length - 1];
  return top ? top.label : null;
}

export function redoLabel(history: History): string | null {
  const top = history.future[0];
  return top ? top.label : null;
}
