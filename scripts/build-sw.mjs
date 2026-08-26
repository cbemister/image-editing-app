#!/usr/bin/env node
/**
 * Post-build step: rewrite dist/sw.js with the real precache list.
 *
 * Vite content-hashes asset filenames, so the service worker cannot know them
 * ahead of time. This walks dist/, picks what must be available offline, and
 * substitutes it into the placeholder.
 *
 * Deliberately excluded from the precache:
 *   - vision_wasm_nosimd_internal.*  (~11MB) — only fetched by browsers without
 *     SIMD support, which in practice is none of the ones this runs on. The
 *     service worker still caches it at runtime if it is ever requested.
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

/** Files that must be in the cache before the app can run offline. */
const PRECACHE_MATCHERS = [
  (p) => p === '/index.html',
  (p) => p === '/manifest.webmanifest',
  (p) => p.startsWith('/assets/'),
  (p) => p.endsWith('.svg'),
  (p) => p === '/mediapipe/blaze_face_short_range.tflite',
  (p) => p === '/mediapipe/selfie_segmenter.tflite',
  (p) => p === '/mediapipe/wasm/vision_wasm_internal.js',
  (p) => p === '/mediapipe/wasm/vision_wasm_internal.wasm',
];

async function walk(dir, base = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = `${base}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(abs, rel)));
    else out.push(rel);
  }
  return out;
}

// Must match vite.config.ts. Normalised to always start and end with "/".
const BASE = (process.env.BASE_PATH || '/').replace(/^\/?/, '/').replace(/\/?$/, '/');

const all = await walk(DIST);
const precache = all
  .filter((p) => PRECACHE_MATCHERS.some((m) => m(p)))
  .sort()
  // Cache keys are request URLs, so they must carry the deploy base path.
  .map((p) => (BASE === '/' ? p : BASE.slice(0, -1) + p));

/** Map a cache URL back to its path inside dist/. */
const onDisk = (url) => path.join(DIST, BASE === '/' ? url : url.slice(BASE.length - 1));

if (!precache.includes(`${BASE}index.html`)) {
  console.error('build-sw: dist/index.html missing — did the build run?');
  process.exit(1);
}

// Version the caches by the content of what we precache, so a rebuild that
// changes nothing does not force clients to re-download.
const hash = createHash('sha256');
for (const url of precache) {
  hash.update(url);
  hash.update(await readFile(onDisk(url)));
}
const version = hash.digest('hex').slice(0, 12);

const swPath = path.join(DIST, 'sw.js');
let sw = await readFile(swPath, 'utf8');

// Each token must appear exactly once. More than one means a stray mention
// (a comment, say) would swallow the substitution and ship a worker that
// throws on install — which silently disables offline mode.
for (const [token, value] of [
  ['__PRECACHE__', JSON.stringify(precache, null, 2)],
  ['__VERSION__', version],
  ['__BASE__', BASE],
]) {
  const hits = sw.split(token).length - 1;
  if (hits !== 1) {
    console.error(`build-sw: expected exactly 1 "${token}" in sw.js, found ${hits}.`);
    process.exit(1);
  }
  sw = sw.replace(token, value);
}

await writeFile(swPath, sw);

// The manifest ships with root-relative paths; rewrite them for a subfolder
// deploy so the installed app resolves its icons and start_url correctly.
if (BASE !== '/') {
  const manifestPath = path.join(DIST, 'manifest.webmanifest');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.start_url = BASE;
  manifest.scope = BASE;
  for (const icon of manifest.icons ?? []) {
    if (icon.src.startsWith('/')) icon.src = BASE.slice(0, -1) + icon.src;
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`build-sw: manifest rebased to ${BASE}`);
}

let bytes = 0;
for (const url of precache) bytes += (await stat(onDisk(url))).size;

console.log(`build-sw: ${precache.length} files precached (${(bytes / 1024 / 1024).toFixed(1)} MB), version ${version}`);

const skipped = all.filter((p) => !precache.includes(BASE === '/' ? p : BASE.slice(0, -1) + p));
if (skipped.length) {
  console.log(`build-sw: ${skipped.length} runtime-cached on demand:`);
  for (const s of skipped) console.log(`  ${s}`);
}
