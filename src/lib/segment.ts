import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

/**
 * Background removal for people.
 *
 * The model is MediaPipe's selfie segmenter: it is trained on human subjects,
 * so it is the right tool for the staff-photo and social presets and the wrong
 * one for logos. Callers should present it as a photo feature, not a general
 * "erase anything" tool — on a wordmark it returns confident nonsense.
 *
 * Runtime and model are served from /public, exactly as the face detector is,
 * so this works offline and no image data leaves the machine.
 */
const BASE = import.meta.env.BASE_URL;
const WASM_PATH = `${BASE}mediapipe/wasm`;
const MODEL_PATH = `${BASE}mediapipe/selfie_segmenter.tflite`;

let segmenterPromise: Promise<ImageSegmenter> | null = null;
let segmenterReady = false;

/** Load the segmenter once and reuse it across every image in a batch. */
function getSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      return ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
        runningMode: 'IMAGE',
        // The confidence mask is a per-pixel probability, which is what makes
        // a soft edge possible. The category mask is binary and would stair-step.
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
    })().catch((err) => {
      // Reset so a later attempt can retry rather than reusing a failed promise.
      segmenterPromise = null;
      throw err;
    });
  }
  return segmenterPromise;
}

/** Warm the model up so the first click is not the one that waits. */
export function preloadSegmenter(): void {
  getSegmenter().catch(() => {
    // Ignore; removeBackground reports the failure when it actually matters.
  });
}

export function segmenterStatus(): 'unloaded' | 'loading' | 'ready' {
  if (!segmenterPromise) return 'unloaded';
  return segmenterReady ? 'ready' : 'loading';
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
}

/**
 * Pixels below this confidence are fully transparent, above it fully opaque,
 * and the band between them is feathered.
 *
 * The window is deliberately wide. The model reports a genuine gradient across
 * the hair boundary -- measured at a 16px median on a 800x1200 portrait, up to
 * 46px through flyaway strands -- and that gradient IS the strand detail. A
 * narrow window (0.35-0.65 was the first attempt) rescales that transition down
 * to about 5px, which quantises the hairline into visible stair-steps and drops
 * the wisps entirely.
 *
 * Widening it to 0.10-0.90 preserves roughly 12-13px of that ramp and restores
 * individual strands. Going wider still (0.02-0.98) keeps marginally more wisp
 * but starts holding onto background haze in the low tail, so this stops short
 * of the extremes.
 */
const ALPHA_LOW = 0.1;
const ALPHA_HIGH = 0.9;

/**
 * Turn the model's confidence mask into an 8-bit alpha ramp.
 *
 * The task upscales the mask to the source dimensions before handing it over,
 * so this is drawn 1:1 rather than being stretched. The ramp is what keeps the
 * edge soft: a bare threshold would cut a hard, jagged line through hair.
 */
function maskToAlphaCanvas(
  mask: Float32Array,
  maskWidth: number,
  maskHeight: number
): HTMLCanvasElement | OffscreenCanvas {
  const canvas = makeCanvas(maskWidth, maskHeight);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const image = ctx.createImageData(maskWidth, maskHeight);
  const data = image.data;

  const span = ALPHA_HIGH - ALPHA_LOW;
  for (let i = 0; i < mask.length; i++) {
    // Confidence is "belongs to the subject"; clamp and ramp it into alpha.
    const t = Math.min(1, Math.max(0, (mask[i] - ALPHA_LOW) / span));
    // Smoothstep, so the feathered band eases in rather than ramping linearly.
    const alpha = t * t * (3 - 2 * t);
    const p = i * 4;
    data[p] = 255;
    data[p + 1] = 255;
    data[p + 2] = 255;
    data[p + 3] = Math.round(alpha * 255);
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Remove the background from a photo of a person.
 *
 * Returns a new ImageBitmap with an alpha channel, or null when the model
 * cannot load — callers should keep using the original in that case rather
 * than showing a broken cutout. The input bitmap is not modified or closed.
 */
export async function removeBackground(bitmap: ImageBitmap): Promise<ImageBitmap | null> {
  let segmenter: ImageSegmenter;
  try {
    segmenter = await getSegmenter();
    segmenterReady = true;
  } catch {
    return null;
  }

  const { width, height } = bitmap;

  // The mask is owned by the task and freed once the callback returns, so the
  // pixels have to be copied out here rather than held onto.
  let alphaSource: HTMLCanvasElement | OffscreenCanvas | null = null;
  try {
    segmenter.segment(bitmap, (result) => {
      const mask = result.confidenceMasks?.[0];
      if (!mask) return;
      // Index 0 is the subject for this model. getAsFloat32Array() pulls the
      // data back from the GPU when the WebGL delegate is in use.
      const values = mask.getAsFloat32Array();
      alphaSource = maskToAlphaCanvas(values, mask.width, mask.height);
    });
  } catch {
    return null;
  }

  if (!alphaSource) return null;

  // Composite: draw the photo, then keep only what the mask says is subject.
  const out = makeCanvas(width, height);
  const ctx = out.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(alphaSource as CanvasImageSource, 0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';

  return createImageBitmap(out as never);
}

/**
 * Paint over a cutout's alpha channel.
 *
 * The segmenter gets some pixels wrong in ways no threshold can fix: a logo on
 * a branded backdrop can score above 0.9, and gets kept as confidently as the
 * subject. Erasing those by hand is the only reliable correction, so the brush
 * writes alpha directly rather than re-running the model.
 *
 * `mode` 'erase' clears alpha (removing background the model kept); 'restore'
 * brings back alpha from the original image (recovering subject it cut away).
 * Strokes are round with a soft falloff, so an edit blends into the feathered
 * boundary instead of stamping a hard-edged disc into it.
 */
export interface BrushStroke {
  /** Centre in natural image pixels. */
  x: number;
  y: number;
  /** Radius in natural image pixels. */
  radius: number;
  mode: 'erase' | 'restore';
  /** 0..1; how much of the stroke's effect to apply per dab. */
  strength: number;
}

/**
 * Apply one stroke to `cutout`, returning a new bitmap.
 *
 * `original` supplies the colour when restoring: a fully transparent pixel has
 * no colour left to bring back, so it has to be re-read from the source.
 */
export async function applyBrush(
  cutout: ImageBitmap,
  original: ImageBitmap,
  strokes: BrushStroke[]
): Promise<ImageBitmap> {
  const { width, height } = cutout;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.drawImage(cutout, 0, 0);

  const erase = strokes.filter((s) => s.mode === 'erase');
  const restore = strokes.filter((s) => s.mode === 'restore');

  // Erasing is a straight alpha subtraction against the existing pixels.
  if (erase.length) {
    ctx.globalCompositeOperation = 'destination-out';
    for (const s of erase) {
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.radius);
      // Solid to about 60% of the radius, then fall off, so the centre of a
      // stroke fully clears while its rim feathers.
      g.addColorStop(0, `rgba(0,0,0,${s.strength})`);
      g.addColorStop(0.6, `rgba(0,0,0,${s.strength})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /*
   * Restoring paints the original back through a soft circular mask. It is
   * done on a scratch canvas and composited in one step: drawing the source
   * directly, clipped to a circle, would give a hard edge and undo the point
   * of a feathered brush.
   */
  if (restore.length) {
    const patch = makeCanvas(width, height);
    const pctx = patch.getContext('2d') as CanvasRenderingContext2D;
    for (const s of restore) {
      const g = pctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.radius);
      g.addColorStop(0, `rgba(0,0,0,${s.strength})`);
      g.addColorStop(0.6, `rgba(0,0,0,${s.strength})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      pctx.fillStyle = g;
      pctx.beginPath();
      pctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      pctx.fill();
    }
    // Keep only the original's pixels where the mask has coverage...
    pctx.globalCompositeOperation = 'source-in';
    pctx.drawImage(original, 0, 0, width, height);
    pctx.globalCompositeOperation = 'source-over';
    // ...then lay that patch over the cutout.
    ctx.drawImage(patch as CanvasImageSource, 0, 0);
  }

  return createImageBitmap(canvas as never);
}
