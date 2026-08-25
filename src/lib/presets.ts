import type { Preset, PresetCategory } from './types';
import { presetRatio, ratiosMatch, withPresetDefaults } from './types';

let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/*
 * Sizes start OFF. A run usually wants one crop and a couple of sizes, so
 * opting in to a few beats opting out of everything else. `enabled` is
 * therefore explicit everywhere and undefined counts as off -- see
 * isSizeEnabled().
 */
const size = (width: number, height: number, label?: string) => ({
  id: uid('size'),
  width,
  height,
  label,
  enabled: false,
});

/** Photo/social preset: the crop fills the frame edge to edge. */
const cover = (
  name: string,
  suffix: string,
  category: PresetCategory,
  sizes: ReturnType<typeof size>[]
): Preset => ({
  id: uid('preset'),
  name,
  suffix,
  category,
  fit: 'cover',
  format: 'image/jpeg',
  quality: 0.85,
  sizes,
});

/**
 * Logo preset: the whole image is fitted inside the frame and padded rather
 * than cropped through, so a wordmark keeps its ends. Defaults to transparent
 * PNG, which is what an icon or an overlay logo almost always needs.
 */
const contain = (
  name: string,
  suffix: string,
  sizes: ReturnType<typeof size>[],
  padding = 0.08,
  background = 'transparent'
): Preset => ({
  id: uid('preset'),
  name,
  suffix,
  category: 'logo',
  fit: 'contain',
  background,
  padding,
  format: 'image/png',
  quality: 0.92,
  sizes,
});

/**
 * Staff sizes are seeded from an audit of the existing staff pages and grouped
 * by aspect ratio, so one crop drives every size in a group.
 *
 * The portrait sizes were once three presets (0.7467, 0.7557, 0.7500) kept
 * apart because they differ by ~1%. They are now one exactly-3:4 group: the
 * spread was 1.26%, and snapping every size to 0.75 moves each dimension by at
 * most 3px — invisible in the 120px box the staff page renders these in.
 *
 * Full-resolution sizes (1920x1920, 1920x2545) are intentionally excluded --
 * those are source images, not crop targets.
 *
 * Social sizes follow each platform's published spec as of 2026; every size in
 * a preset shares one ratio, which is why "Instagram post" and "Instagram
 * portrait" are separate entries rather than one grouped preset.
 */
export const DEFAULT_PRESETS: Preset[] = [
  // ---- Staff photos ----
  // One list of sizes, typed in directly. There are no named shapes: "Square"
  // and "Portrait" were only ever a locked ratio plus a starting size list,
  // and both are things a typed size already expresses. A group is named for
  // the ratio it holds, and a new one appears whenever a size at a new ratio
  // is added.
  //
  // Sizes are grouped by ratio because a crop box has exactly one shape: each
  // group is framed once and every size in it rides that crop.
  //
  // Seeded from an audit of the existing staff pages.
  //
  // Every 3:4 size is EXACTLY 0.750000, which requires widths divisible by 3 --
  // hence 558/501/279 rather than the audited 560/500/280. Rounding a width
  // like 280 to the nearest 3:4 height lands 0.001 off, which trips the
  // mismatch warning and means the crop is very slightly stretched. A 1-2px
  // width shift buys an exact ratio across the whole ladder.
  //
  // 558x744 stays the exact 2x of 279x372 for high-DPI phones: the staff page
  // renders these in a 120px box, so a 3x display needs 360px and a 4.5x one
  // needs 540px. At 279 the browser upscales and the photo looks soft next to
  // natively-rendered text.
  cover('1:1', 'square', 'photo', [
    size(600, 600),
    size(356, 356),
    size(300, 300),
    size(268, 268),
    size(250, 250),
    size(200, 200),
    size(150, 150),
  ]),
  cover('3:4', 'portrait', 'photo', [
    size(558, 744),
    size(501, 668),
    size(300, 400),
    size(279, 372),
    size(255, 340),
  ]),

  // ---- Social media ----
  cover('Instagram post', 'ig-post', 'social', [size(1080, 1080, 'Feed 1:1')]),
  cover('Instagram portrait', 'ig-portrait', 'social', [size(1080, 1350, 'Feed 4:5')]),
  cover('Story / Reel', 'story', 'social', [
    size(1080, 1920, 'Story 9:16'),
    size(720, 1280, 'Lightweight'),
  ]),
  cover('LinkedIn post', 'li-post', 'social', [size(1200, 627, 'Shared link')]),
  cover('LinkedIn banner', 'li-banner', 'social', [size(1584, 396, 'Profile cover')]),
  cover('Facebook cover', 'fb-cover', 'social', [size(1640, 856)]),
  cover('X / Twitter post', 'x-post', 'social', [size(1600, 900, '16:9')]),
  cover('YouTube thumbnail', 'yt-thumb', 'social', [size(1280, 720)]),
  cover('Open Graph', 'og', 'social', [size(1200, 630, 'Link preview')]),

  // ---- Logos & icons ----
  contain('Logo square', 'logo', [
    size(1024, 1024),
    size(512, 512),
    size(256, 256),
    size(128, 128),
  ]),
  contain('App icon', 'icon', [
    size(512, 512, 'Store'),
    size(192, 192, 'PWA'),
    size(180, 180, 'Apple touch'),
  ], 0.06),
  contain('Favicon', 'favicon', [size(64, 64), size(32, 32), size(16, 16)], 0.04),
  contain('Logo wide', 'logo-wide', [size(800, 200), size(400, 100)], 0.1),
  // Email signatures are shown on white in most clients, so a white matte
  // avoids the grey halo transparent PNGs pick up in Outlook.
  contain('Email signature', 'sig', [size(300, 100)], 0.08, '#ffffff'),
];

/**
 * Bump this when DEFAULT_PRESETS changes in a way existing users should pick
 * up -- a stored older copy would otherwise shadow the new defaults forever.
 * v2: added 560x750 to Portrait 280 for high-DPI phones.
 * v3: added categories, fit modes, and the social + logo preset libraries.
 * v4: merged Portrait 280/300/255 into one exactly-3:4 Portrait preset. Sizes
 *     snapped to 0.750000 (each dimension moved by <=3px; widths 560/500/280
 *     became 558/501/279 so the ratio is exact) and the portrait300 and
 *     portrait255 filename suffixes are retired -- those exports are now
 *     named "portrait".
 * v5: staff photos are one typed size list plus a recent-sizes history. The
 *     named shapes (Square/Portrait/Landscape/Custom) are gone -- a shape was
 *     only ever a locked ratio, which a typed size already expresses. Sizes
 *     are grouped by ratio behind the scenes, one crop per group, and a group
 *     is created on demand when a size at a new ratio is added. The 300x256
 *     landscape size is dropped along with its "landscape" suffix.
 * v6: sizes now start OFF and are opted in -- a run usually wants one crop and
 *     a couple of sizes. A v5 copy has every seeded size enabled, which would
 *     hand existing users the old everything-on behaviour and none of the
 *     benefit, so the key is bumped rather than migrated in place.
 */
const STORAGE_KEY = 'framewise.presets.v6';

/**
 * Fold staff groups that share a ratio into one.
 *
 * Staff sizes are grouped by ratio so each group is one crop; two groups at
 * the same ratio means the same crop framed twice and the same size exported
 * twice. Repairs stored data written before that was enforced, and keeps a
 * hand-edited JSON import honest.
 */
function mergeStaffGroupsByRatio(presets: Preset[]): Preset[] {
  const out: Preset[] = [];
  for (const preset of presets) {
    if (preset.category !== 'photo' || preset.sizes.length === 0) {
      out.push(preset);
      continue;
    }
    const twin = out.find(
      (p) =>
        p.category === 'photo' &&
        p.sizes.length > 0 &&
        ratiosMatch(presetRatio(p), presetRatio(preset))
    );
    if (!twin) {
      out.push(preset);
      continue;
    }
    // Keep the first group's identity (crops are keyed by preset id, so the
    // survivor keeps its framing) and absorb any sizes it does not already have.
    const additions = preset.sizes.filter(
      (s) => !twin.sizes.some((t) => t.width === s.width && t.height === s.height)
    );
    if (additions.length) twin.sizes = [...twin.sizes, ...additions];
  }
  return out;
}

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_PRESETS);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return structuredClone(DEFAULT_PRESETS);
    }
    return mergeStaffGroupsByRatio((parsed as Preset[]).map(withPresetDefaults));
  } catch {
    return structuredClone(DEFAULT_PRESETS);
  }
}

export function savePresets(presets: Preset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Storage full or blocked -- presets stay in memory for this session.
  }
}

/* ==========================================================================
   Recent staff-photo dimensions

   The staff section is driven by typed dimensions rather than a fixed preset
   list, so the sizes a user actually works at have to survive a reload. Kept
   separate from the presets themselves: this is usage history, not
   configuration, and it must never resurrect a size into an export on its own.
   ========================================================================== */

export interface RecentSize {
  width: number;
  height: number;
}

const RECENTS_KEY = 'framewise.recentSizes.v1';

/** Most recent first. Kept short enough to stay scannable at a glance. */
const RECENTS_LIMIT = 12;

export function loadRecentSizes(): RecentSize[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s): s is RecentSize =>
          !!s &&
          Number.isFinite(s.width) &&
          Number.isFinite(s.height) &&
          s.width >= 1 &&
          s.height >= 1
      )
      .slice(0, RECENTS_LIMIT)
      .map((s) => ({ width: Math.round(s.width), height: Math.round(s.height) }));
  } catch {
    return [];
  }
}

export function saveRecentSizes(sizes: RecentSize[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(sizes.slice(0, RECENTS_LIMIT)));
  } catch {
    // Storage full or blocked -- recents stay in memory for this session.
  }
}

/** Add a dimension to the front, de-duplicated, oldest dropped past the cap. */
export function addRecentSize(list: RecentSize[], width: number, height: number): RecentSize[] {
  const w = Math.round(width);
  const h = Math.round(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return list;
  return [{ width: w, height: h }, ...list.filter((s) => s.width !== w || s.height !== h)].slice(
    0,
    RECENTS_LIMIT
  );
}

export function newPreset(category: PresetCategory = 'photo'): Preset {
  return category === 'logo'
    ? contain('New logo preset', 'custom', [size(512, 512)])
    : cover('New preset', 'custom', category, [size(400, 400)]);
}

/**
 * A size the user just typed starts ON. Seeded sizes start off — they are a
 * menu — but deliberately adding one and then having to click it again to
 * turn it on would be a pointless second step.
 */
export function newSize(width = 400, height = 400) {
  return { ...size(width, height), enabled: true };
}
