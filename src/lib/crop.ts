import type { CropRect, LoadedImage, Preset } from './types';
import { presetRatio } from './types';

/**
 * The largest centered crop of `ratio` that fits inside the image.
 * Used as the starting crop before any face detection or manual adjustment.
 */
export function defaultCrop(
  naturalWidth: number,
  naturalHeight: number,
  ratio: number
): CropRect {
  const imageRatio = naturalWidth / naturalHeight;
  let width: number;
  let height: number;

  if (imageRatio > ratio) {
    // Image is wider than target: height is the limiting dimension.
    height = naturalHeight;
    width = height * ratio;
  } else {
    width = naturalWidth;
    height = width / ratio;
  }

  return {
    x: (naturalWidth - width) / 2,
    y: (naturalHeight - height) / 2,
    width,
    height,
  };
}

/** Clamp a crop so it stays fully inside the image, preserving its size. */
export function clampCrop(
  crop: CropRect,
  naturalWidth: number,
  naturalHeight: number
): CropRect {
  const width = Math.min(crop.width, naturalWidth);
  const height = Math.min(crop.height, naturalHeight);
  return {
    width,
    height,
    x: Math.max(0, Math.min(crop.x, naturalWidth - width)),
    y: Math.max(0, Math.min(crop.y, naturalHeight - height)),
  };
}

/**
 * Build a crop of the given ratio around a focal point (e.g. a detected face),
 * scaled so the focal box occupies `headroom` of the crop height. The crop is
 * biased upward so the subject sits slightly above center, which reads better
 * for headshots than dead-centering.
 *
 * The 0.32 default is tuned for BlazeFace, whose box covers only the facial
 * features — brow to chin — not the whole head. A larger value crops into the
 * forehead; smaller pulls in too much torso.
 */
export function cropAroundFace(
  face: { x: number; y: number; width: number; height: number },
  naturalWidth: number,
  naturalHeight: number,
  ratio: number,
  headroom = 0.32
): CropRect {
  const faceCenterX = face.x + face.width / 2;
  const faceCenterY = face.y + face.height / 2;

  let height = face.height / headroom;
  let width = height * ratio;

  // Don't exceed the image; shrink proportionally if we do.
  const scale = Math.min(1, naturalWidth / width, naturalHeight / height);
  width *= scale;
  height *= scale;

  // Bias upward: place the face center at 42% down the crop, not 50%.
  const x = faceCenterX - width / 2;
  const y = faceCenterY - height * 0.42;

  return clampCrop({ x, y, width, height }, naturalWidth, naturalHeight);
}

/** Resize a crop about its center to a new ratio, keeping it in bounds. */
export function refitCropToRatio(
  crop: CropRect,
  naturalWidth: number,
  naturalHeight: number,
  ratio: number
): CropRect {
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;

  // Preserve area where possible so the subject stays framed similarly.
  const area = crop.width * crop.height;
  let height = Math.sqrt(area / ratio);
  let width = height * ratio;

  const scale = Math.min(1, naturalWidth / width, naturalHeight / height);
  width *= scale;
  height *= scale;

  return clampCrop(
    { x: centerX - width / 2, y: centerY - height / 2, width, height },
    naturalWidth,
    naturalHeight
  );
}

/** The crop for an image under a preset, computed on demand if not yet set. */
export function cropFor(image: LoadedImage, preset: Preset): CropRect {
  return (
    image.crops[preset.id] ??
    defaultCrop(image.naturalWidth, image.naturalHeight, presetRatio(preset))
  );
}
