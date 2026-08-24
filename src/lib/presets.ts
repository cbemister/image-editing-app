import type { Preset } from './types';

let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const size = (width: number, height: number, label?: string) => ({
  id: uid('size'),
  width,
  height,
  label,
  enabled: true,
});

/**
 * Seeded from an audit of the existing staff pages. Sizes are grouped by
 * EXACT aspect ratio so one crop drives every size in a preset; the portrait
 * variants differ by ~1% and therefore stay separate presets rather than
 * being rounded together.
 *
 * Full-resolution sizes (1920x1920, 1920x2545) are intentionally excluded —
 * those are source images, not crop targets.
 */
export const DEFAULT_PRESETS: Preset[] = [
  {
    id: uid('preset'),
    name: 'Square',
    suffix: 'square',
    format: 'image/jpeg',
    quality: 0.85,
    sizes: [
      size(600, 600),
      size(356, 356),
      size(300, 300),
      size(268, 268),
      size(250, 250),
      size(200, 200),
      size(150, 150),
    ],
  },
  {
    id: uid('preset'),
    name: 'Portrait 280',
    suffix: 'portrait',
    format: 'image/jpeg',
    quality: 0.85,
    sizes: [size(280, 375), size(500, 670)],
  },
  {
    id: uid('preset'),
    name: 'Portrait 300',
    suffix: 'portrait300',
    format: 'image/jpeg',
    quality: 0.85,
    sizes: [size(300, 397)],
  },
  {
    id: uid('preset'),
    name: 'Portrait 255',
    suffix: 'portrait255',
    format: 'image/jpeg',
    quality: 0.85,
    sizes: [size(255, 340)],
  },
  {
    id: uid('preset'),
    name: 'Landscape',
    suffix: 'landscape',
    format: 'image/jpeg',
    quality: 0.85,
    sizes: [size(300, 256)],
  },
];

const STORAGE_KEY = 'staff-cropper.presets.v1';

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_PRESETS);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return structuredClone(DEFAULT_PRESETS);
    }
    return parsed as Preset[];
  } catch {
    return structuredClone(DEFAULT_PRESETS);
  }
}

export function savePresets(presets: Preset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Storage full or blocked — presets stay in memory for this session.
  }
}

export function newPreset(): Preset {
  return {
    id: uid('preset'),
    name: 'New preset',
    suffix: 'custom',
    format: 'image/jpeg',
    quality: 0.85,
    sizes: [size(400, 400)],
  };
}

export function newSize(width = 400, height = 400) {
  return size(width, height);
}
