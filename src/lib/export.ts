import type { CropRect, LoadedImage, OutputSize, Preset } from './types';
import { cropFor } from './crop';

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
  format: Preset['format'],
  quality: number
): Promise<Blob> {
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

  // JPEG has no alpha; fill white so transparent source areas don't go black.
  if (format === 'image/jpeg') {
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, size.width, size.height);
  }

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
  for (const preset of presets) {
    const crop = cropFor(image, preset);
    for (const size of preset.sizes) {
      if (!size.enabled) continue;
      const blob = await renderSize(
        image.bitmap,
        crop,
        size,
        preset.format,
        preset.quality
      );
      items.push({
        filename: filenameFor(image, preset, size, includeDimensions),
        blob,
      });
    }
  }
  return items;
}
