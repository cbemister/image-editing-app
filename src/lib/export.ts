import type { CropRect, LoadedImage, OutputSize, Preset } from './types';
import { activeBitmap, isSizeEnabled } from './types';
import { cropFor } from './crop';
import { buildFilename } from './filename';

export interface ExportItem {
  filename: string;
  blob: Blob;
}

const EXTENSION: Record<Preset['format'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Render one crop at one output size. Downscaling in a single drawImage step
 * aliases badly at large reduction factors, so we step down by halves first —
 * this is what keeps 600px-wide crops legible at 150x150.
 */
export async function renderSize(
  bitmap: ImageBitmap,
  crop: CropRect,
  size: OutputSize,
  preset: Preset
): Promise<Blob> {
  const { format, quality, fit } = preset;
  let sourceCanvas: HTMLCanvasElement | OffscreenCanvas;
  let sw = Math.round(crop.width);
  let sh = Math.round(crop.height);

  const make = (w: number, h: number) =>
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });

  sourceCanvas = make(sw, sh);
  const sctx = sourceCanvas.getContext('2d') as CanvasRenderingContext2D;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(
    bitmap,
    Math.round(crop.x),
    Math.round(crop.y),
    sw,
    sh,
    0,
    0,
    sw,
    sh
  );

  // Halve repeatedly until within 2x of the target, then do the final draw.
  while (sw > size.width * 2 && sh > size.height * 2) {
    const nw = Math.max(size.width, Math.floor(sw / 2));
    const nh = Math.max(size.height, Math.floor(sh / 2));
    const next = make(nw, nh);
    const nctx = next.getContext('2d') as CanvasRenderingContext2D;
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(sourceCanvas as CanvasImageSource, 0, 0, sw, sh, 0, 0, nw, nh);
    sourceCanvas = next;
    sw = nw;
    sh = nh;
  }

  const out = make(size.width, size.height);
  const octx = out.getContext('2d') as CanvasRenderingContext2D;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';

  /*
   * Paint the backdrop.
   *
   * A 'contain' fit uses the preset's configured background. A 'cover' fit
   * normally has none visible, since the crop covers the frame -- but a
   * background-removed source is transparent inside the crop too, so filling
   * white unconditionally would paint the removed background straight back
   * in. Leave it clear when the format can carry alpha.
   *
   * JPEG has no alpha channel and encodes transparency as black, so it always
   * gets an opaque backdrop regardless of intent.
   */
  const requested =
    fit === 'contain' ? (preset.background ?? '#ffffff') : 'transparent';
  const backdrop =
    requested === 'transparent' && format === 'image/jpeg' ? '#ffffff' : requested;
  if (backdrop !== 'transparent') {
    octx.fillStyle = backdrop;
    octx.fillRect(0, 0, size.width, size.height);
  }

  if (fit === 'contain') {
    // Fit the whole crop inside the padded box, preserving its aspect ratio,
    // so a wordmark keeps its ends instead of being cut through.
    const inset = Math.min(Math.max(preset.padding ?? 0, 0), 0.45);
    const pad = Math.min(size.width, size.height) * inset;
    const boxW = Math.max(1, size.width - pad * 2);
    const boxH = Math.max(1, size.height - pad * 2);
    const scale = Math.min(boxW / sw, boxH / sh);
    const dw = Math.round(sw * scale);
    const dh = Math.round(sh * scale);
    octx.drawImage(
      sourceCanvas as CanvasImageSource,
      0,
      0,
      sw,
      sh,
      Math.round((size.width - dw) / 2),
      Math.round((size.height - dh) / 2),
      dw,
      dh
    );
  } else {
    octx.drawImage(
      sourceCanvas as CanvasImageSource,
      0,
      0,
      sw,
      sh,
      0,
      0,
      size.width,
      size.height
    );
  }

  if (out instanceof OffscreenCanvas) {
    return out.convertToBlob({ type: format, quality });
  }
  return new Promise<Blob>((resolve, reject) => {
    (out as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))),
      format,
      quality
    );
  });
}

/** Filename for one image/preset/size, e.g. jane-smith-square-300x300.jpg */
export function filenameFor(
  image: LoadedImage,
  preset: Preset,
  size: OutputSize,
  includeDimensions: boolean
): string {
  const ext = EXTENSION[preset.format];
  /*
   * A preset with its own template owns the whole name, including whether
   * dimensions appear -- the global "size in filename" switch would otherwise
   * silently override a template that deliberately places {w} and {h}.
   */
  if (preset.filenameTemplate && preset.filenameTemplate.trim()) {
    return buildFilename(image, preset, size, ext);
  }
  const dims = includeDimensions ? `-${size.width}x${size.height}` : '';
  return `${image.baseName}-${preset.suffix}${dims}.${ext}`;
}

/** Render every enabled size of every given preset for one image. */
export async function exportImage(
  image: LoadedImage,
  presets: Preset[],
  includeDimensions: boolean
): Promise<ExportItem[]> {
  const items: ExportItem[] = [];

  /*
   * Background removal is a per-image decision now, made with the "Remove
   * background" toggle on the stage. `activeBitmap` returns the cutout when it
   * is on -- retouched edges and all -- and the original otherwise, so export
   * ships exactly what the stage showed.
   */
  const source = activeBitmap(image);

  for (const preset of presets) {
    const crop = cropFor(image, preset);
    for (const size of preset.sizes) {
      if (!isSizeEnabled(size)) continue;
      const blob = await renderSize(source, crop, size, preset);
      items.push({
        filename: filenameFor(image, preset, size, includeDimensions),
        blob,
      });
    }
  }

  return items;
}
