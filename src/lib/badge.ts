import badgeUrl from '../assets/chairmans-club.png';

/*
 * The AutoCanada Chairman's Club badge, laid across the bottom of a staff
 * photo for club members.
 *
 * Bundled as an asset rather than served from public/, so Vite hashes it into
 * /assets/ and the service worker precaches it with the rest of the app -- the
 * badge has to work offline like everything else.
 */

let pending: Promise<ImageBitmap> | null = null;

/**
 * The logo, trimmed to its visible pixels.
 *
 * The source PNG carries a wide transparent margin. Left in, it would make the
 * layout below size the empty space rather than the mark, so the margin is
 * cropped off once here and the padding is owned by drawBadge instead.
 */
export function loadBadge(): Promise<ImageBitmap> {
  if (!pending) {
    pending = (async () => {
      const blob = await (await fetch(badgeUrl)).blob();
      const full = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(full.width, full.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(full, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, full.width, full.height);
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return full;
      const trimmed = await createImageBitmap(full, minX, minY, maxX - minX + 1, maxY - minY + 1);
      full.close();
      return trimmed;
    })();
    // A failed load should be retryable rather than cached as broken forever.
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}

/** Logo width as a share of the frame width. */
const WIDTH_SHARE = 0.8;
/** Ceiling on logo height as a share of the frame, so wide frames do not lose their bottom third. */
const MAX_HEIGHT_SHARE = 0.15;
/** Space above and below the logo inside the band, as a share of the logo's height. */
const BAND_PAD = 0.25;

/**
 * Draw the badge into the frame at (x, y, w, h): a white band across the
 * bottom with the logo centred in it.
 *
 * The band is there for legibility. The mark's grey wordmark disappears
 * against a dark suit or a busy dealership backdrop; on white it reads the same
 * on every photo, which is what the club's on-screen version of the logo is
 * designed for.
 *
 * The stage preview and the exporter both call this with their own frame, so
 * the preview is the export at a different scale.
 */
export function drawBadge(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  logo: ImageBitmap,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const aspect = logo.width / logo.height;
  let logoW = w * WIDTH_SHARE;
  let logoH = logoW / aspect;
  if (logoH > h * MAX_HEIGHT_SHARE) {
    logoH = h * MAX_HEIGHT_SHARE;
    logoW = logoH * aspect;
  }
  const pad = logoH * BAND_PAD;
  const bandH = logoH + pad * 2;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y + h - bandH, w, bandH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(logo, x + (w - logoW) / 2, y + h - bandH + pad, logoW, logoH);
  ctx.restore();
}
