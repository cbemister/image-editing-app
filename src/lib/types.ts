/** An exact output size in pixels. */
export interface OutputSize {
  id: string;
  width: number;
  height: number;
  /** Optional label shown in the UI; falls back to "WxH". */
  label?: string;
  enabled: boolean;
}

/**
 * A preset groups output sizes that share one exact aspect ratio, so a single
 * crop can drive every size in the group. Sizes with differing ratios must
 * live in separate presets — see ratioOf().
 */
export interface Preset {
  id: string;
  name: string;
  /** Suffix appended to exported filenames, e.g. "square" -> jane-square.jpg */
  suffix: string;
  sizes: OutputSize[];
  format: 'image/jpeg' | 'image/png' | 'image/webp';
  /** 0..1, ignored for PNG. */
  quality: number;
  /** Grouping shown in the preset panel. */
  category: PresetCategory;
  /**
   * How the crop maps onto the output canvas.
   * 'cover'   - the crop fills the frame edge to edge (photos).
   * 'contain' - the whole crop is fitted inside the frame and padded, so a
   *             logo or wordmark is never cut through. See `background`.
   */
  fit: FitMode;
  /** CSS color painted behind a 'contain' fit. 'transparent' needs PNG/WebP. */
  background?: string;
  /** Inset as a fraction (0..0.45) of the frame's shorter edge, 'contain' only. */
  padding?: number;
}

export type FitMode = 'cover' | 'contain';

export type PresetCategory = 'photo' | 'social' | 'logo';

export const CATEGORY_LABEL: Record<PresetCategory, string> = {
  photo: 'Staff photos',
  social: 'Social media',
  logo: 'Logos & icons',
};

/** Order categories appear in the panel. */
export const CATEGORY_ORDER: PresetCategory[] = ['photo', 'social', 'logo'];

/**
 * Fill in fields added after a preset was stored, so a v2 copy in localStorage
 * or an old JSON export still loads without undefined `fit`/`category`.
 */
export function withPresetDefaults(preset: Preset): Preset {
  return {
    ...preset,
    category: preset.category ?? 'photo',
    fit: preset.fit ?? 'cover',
    background: preset.background ?? '#ffffff',
    padding: preset.padding ?? 0,
  };
}

/**
 * Whether a size will be exported. Sizes start off and are opted in, so an
 * absent flag means off. The UI and the export pipeline must both read the
 * flag through here -- when they disagreed, the button's count promised files
 * the exporter never wrote.
 */
export function isSizeEnabled(size: Pick<OutputSize, 'enabled'>): boolean {
  return size.enabled === true;
}

/** Aspect ratio (width / height) of a size. */
export function ratioOf(size: Pick<OutputSize, 'width' | 'height'>): number {
  return size.width / size.height;
}

/** The ratio a preset's crop box is locked to, taken from its first size. */
export function presetRatio(preset: Preset): number {
  const first = preset.sizes[0];
  return first ? ratioOf(first) : 1;
}

/**
 * The named shapes worth recognising. Rounding to whole pixels means a size
 * is rarely an exact integer ratio — 560x747 is 3:4 in intent but does not
 * reduce to it — so a preset is matched to the nearest of these within a
 * tolerance rather than by reducing its pixels.
 */
const NAMED_RATIOS: Array<[string, number]> = [
  ['1:1', 1],
  ['3:4', 3 / 4],
  ['4:5', 4 / 5],
  ['2:3', 2 / 3],
  ['9:16', 9 / 16],
  ['4:3', 4 / 3],
  ['3:2', 3 / 2],
  ['5:4', 5 / 4],
  ['16:9', 16 / 9],
  ['2:1', 2],
  ['3:1', 3],
  ['4:1', 4],
];

/** Within this much of a named ratio, the name is a fair description. */
const RATIO_LABEL_TOLERANCE = 0.01;

/**
 * A preset's ratio as a human label — "3:4" where it lands on a familiar
 * shape, the decimal where it genuinely does not. Never claims a shape the
 * preset is not: "Landscape" at 1.172 stays 1.172 rather than being rounded
 * to a 7:6 it was never cut to.
 */
export function ratioLabel(preset: Preset): string {
  return ratioLabelOf(presetRatio(preset));
}

/** The same label for a bare ratio, for naming a group before it exists. */
export function ratioLabelOf(ratio: number): string {
  let best: [string, number] | null = null;
  for (const candidate of NAMED_RATIOS) {
    const delta = Math.abs(ratio - candidate[1]);
    if (delta <= RATIO_LABEL_TOLERANCE && (!best || delta < Math.abs(ratio - best[1]))) {
      best = candidate;
    }
  }
  return best ? best[0] : ratio.toFixed(3);
}

/** Ratios within this tolerance share a crop box without visible error. */
const RATIO_EPSILON = 0.0005;

export function ratiosMatch(a: number, b: number): boolean {
  return Math.abs(a - b) < RATIO_EPSILON;
}

/** Sizes in a preset that do NOT match the preset's locked ratio. */
export function mismatchedSizes(preset: Preset): OutputSize[] {
  const target = presetRatio(preset);
  return preset.sizes.filter((s) => !ratiosMatch(ratioOf(s), target));
}

/** Crop rectangle in natural (source) image pixel coordinates. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LoadedImage {
  id: string;
  file: File;
  /** Filename without extension, used as the export basename. */
  baseName: string;
  bitmap: ImageBitmap;
  naturalWidth: number;
  naturalHeight: number;
  /** Per-preset crop rects, keyed by preset id. */
  crops: Record<string, CropRect>;
}
