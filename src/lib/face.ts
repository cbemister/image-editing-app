import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * 'model'     — MediaPipe BlazeFace, trustworthy.
   * 'heuristic' — skin-tone guess, used only if the model fails to load.
   */
  source: 'model' | 'heuristic';
  /** Detector confidence 0..1, when the model produced it. */
  score?: number;
}

/**
 * The WASM runtime and model are served from /public, not a CDN, so detection
 * works offline and no image data ever leaves the machine.
 */
const BASE = import.meta.env.BASE_URL;
const WASM_PATH = `${BASE}mediapipe/wasm`;
const MODEL_PATH = `${BASE}mediapipe/blaze_face_short_range.tflite`;

let detectorPromise: Promise<FaceDetector> | null = null;

/** Load the detector once and reuse it across every image in a batch. */
function getDetector(): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      return FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5,
      });
    })().catch((err) => {
      // Reset so a later attempt can retry rather than reusing a failed promise.
      detectorPromise = null;
      throw err;
    });
  }
  return detectorPromise;
}

/** Warm the model up so the first Auto-frame click is not the one that waits. */
export function preloadDetector(): void {
  getDetector().catch(() => {
    // Ignore; detectFace reports the failure when it actually matters.
  });
}

export function detectorStatus(): 'unloaded' | 'loading' | 'ready' {
  if (!detectorPromise) return 'unloaded';
  return detectorReady ? 'ready' : 'loading';
}

let detectorReady = false;

/**
 * Skin-tone centroid fallback, used only when the model cannot load.
 *
 * This is a weak signal: warm-toned backgrounds (beige walls, photo backdrops)
 * register as skin and inflate the box toward the whole frame. Boxes covering
 * an implausible share of the image are rejected rather than returned, since a
 * centered default crop beats a confidently wrong one.
 */
function detectBySkinTone(bitmap: ImageBitmap): FaceBox | null {
  const SAMPLE = 128;
  const scale = Math.min(SAMPLE / bitmap.width, SAMPLE / bitmap.height, 1);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0, w, h);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < h * 0.7; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const isSkin =
        r > 95 &&
        g > 40 &&
        b > 20 &&
        r > g &&
        r > b &&
        Math.abs(r - g) > 15 &&
        Math.max(r, g, b) - Math.min(r, g, b) > 15;
      if (isSkin) {
        sumX += x;
        sumY += y;
        count++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (count < w * h * 0.01) return null;

  const spreadW = (maxX - minX) / w;
  const spreadH = (maxY - minY) / h;
  // A "face" wider than 60% of the frame means the background matched too.
  if (spreadW > 0.6 || spreadH > 0.75) return null;

  const centerX = sumX / count / scale;
  const centerY = sumY / count / scale;
  const boxW = Math.max(((maxX - minX) / scale) * 0.8, bitmap.width * 0.15);
  const boxH = Math.max(((maxY - minY) / scale) * 0.8, bitmap.height * 0.15);

  return {
    x: centerX - boxW / 2,
    y: centerY - boxH / 2,
    width: boxW,
    height: boxH,
    source: 'heuristic',
  };
}

/**
 * Detect the most prominent face. Returns null when nothing is found, in which
 * case callers should leave the existing crop alone.
 */
export async function detectFace(bitmap: ImageBitmap): Promise<FaceBox | null> {
  try {
    const detector = await getDetector();
    detectorReady = true;
    const result = detector.detect(bitmap);

    if (result.detections.length > 0) {
      // Multiple faces (a colleague in frame): keep the largest.
      const best = result.detections.reduce((a, b) => {
        const areaA = a.boundingBox ? a.boundingBox.width * a.boundingBox.height : 0;
        const areaB = b.boundingBox ? b.boundingBox.width * b.boundingBox.height : 0;
        return areaB > areaA ? b : a;
      });
      const box = best.boundingBox;
      if (box) {
        return {
          x: box.originX,
          y: box.originY,
          width: box.width,
          height: box.height,
          source: 'model',
          score: best.categories?.[0]?.score,
        };
      }
    }
    // Model loaded and ran but saw no face — trust that over a skin-tone guess.
    return null;
  } catch {
    return detectBySkinTone(bitmap);
  }
}
