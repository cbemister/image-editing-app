import type { LoadedImage, OutputSize, Preset } from './types';

/**
 * Filename templates.
 *
 * Exports used to be locked to `{name}-{suffix}-{w}x{h}.{ext}`, which meant a
 * CMS expecting anything else had to be satisfied by renaming afterwards. A
 * template makes the whole name the preset's business: order, separators, and
 * which parts appear at all.
 */

/** A token that can appear in a template, with what it stands for. */
export interface TokenInfo {
  token: string;
  description: string;
  /** Shown in the panel so the effect is legible without exporting. */
  example: string;
}

export const TEMPLATE_TOKENS: TokenInfo[] = [
  { token: '{name}', description: 'Source filename without extension', example: 'jane-smith' },
  { token: '{suffix}', description: "The preset's suffix", example: 'square' },
  { token: '{preset}', description: "The preset's name", example: '1:1' },
  { token: '{w}', description: 'Output width in pixels', example: '600' },
  { token: '{h}', description: 'Output height in pixels', example: '600' },
  { token: '{size}', description: 'Width x height together', example: '600x600' },
  { token: '{ext}', description: 'File extension for the format', example: 'jpg' },
];

/** Used when a preset has no template of its own. Matches the old behaviour. */
export const DEFAULT_TEMPLATE = '{name}-{suffix}-{size}';

/**
 * Characters no common filesystem accepts.
 *
 * Templates are typed by hand, so a stray slash would otherwise ask the
 * browser to write into a directory that does not exist -- the download
 * silently fails or lands somewhere unexpected.
 */
const ILLEGAL_CHARS = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/**
 * Make a rendered name safe to write.
 *
 * Deliberately conservative: it strips rather than substitutes, because a
 * name silently gaining underscores where the user typed punctuation is
 * harder to notice than one that is simply shorter.
 */
function sanitize(name: string): string {
  let cleaned = '';
  for (const char of name) {
    // Control codes are legal in a JS string but not in a filename.
    if (char.charCodeAt(0) < 32) continue;
    if (ILLEGAL_CHARS.includes(char)) continue;
    cleaned += char;
  }
  // Trailing dots and spaces are legal to create but not to open on Windows.
  cleaned = cleaned.replace(/[. ]+$/, '').trim();
  return cleaned || 'export';
}

export interface TemplateContext {
  name: string;
  suffix: string;
  preset: string;
  width: number;
  height: number;
  ext: string;
}

/** Substitute tokens. Unknown tokens are left as typed, so a typo is visible. */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  const values: Record<string, string> = {
    name: ctx.name,
    suffix: ctx.suffix,
    /*
     * Auto-generated groups are named for their ratio ("1:1"), and a colon is
     * not a legal filename character -- stripping it left "11", which reads as
     * a number rather than a ratio. Written the way a ratio is spelled in a
     * filename instead.
     */
    preset: ctx.preset.replace(/:/g, 'x'),
    w: String(ctx.width),
    h: String(ctx.height),
    size: `${ctx.width}x${ctx.height}`,
    ext: ctx.ext,
  };
  const body = template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? values[key] : match
  );
  return sanitize(body);
}

/**
 * The filename for one image/preset/size.
 *
 * The extension is appended rather than templated, so a name can never be
 * written without one. `{ext}` still exists as a token for the rare case of
 * wanting it mid-name; a template ending in it does not get it twice.
 */
export function buildFilename(
  image: LoadedImage,
  preset: Preset,
  size: OutputSize,
  ext: string
): string {
  const template = preset.filenameTemplate?.trim() || DEFAULT_TEMPLATE;
  const rendered = renderTemplate(template, {
    name: image.baseName,
    suffix: preset.suffix,
    preset: preset.name,
    width: size.width,
    height: size.height,
    ext,
  });
  return rendered.toLowerCase().endsWith(`.${ext}`) ? rendered : `${rendered}.${ext}`;
}

/** A preview of what a template produces, for the preset panel. */
export function previewTemplate(template: string, preset: Preset, ext: string): string {
  const first = preset.sizes[0];
  const rendered = renderTemplate(template.trim() || DEFAULT_TEMPLATE, {
    name: 'jane-smith',
    suffix: preset.suffix,
    preset: preset.name,
    width: first?.width ?? 600,
    height: first?.height ?? 600,
    ext,
  });
  return rendered.toLowerCase().endsWith(`.${ext}`) ? rendered : `${rendered}.${ext}`;
}
