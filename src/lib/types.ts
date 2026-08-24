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
