#!/usr/bin/env node
/**
 * Populates public/mediapipe/ with the vision runtime and its models.
 *
 * These are build inputs, not source, so they are gitignored and regenerated
 * here — committing ~23MB of binaries would bloat every clone permanently.
 *
 *   - WASM runtime: copied out of the installed @mediapipe/tasks-vision package,
 *     so it always matches the version in package.json.
 *   - Models: downloaded once from Google's model store and cached on disk.
 *     BlazeFace drives Auto-frame; the selfie segmenter drives background
 *     removal. Both share the one WASM runtime copied above.
 *
 * Runs automatically after `npm install` (see the "prepare" script).
 */

import { mkdir, copyFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WASM_SRC = path.join(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm');
const OUT = path.join(ROOT, 'public/mediapipe');
const WASM_OUT = path.join(OUT, 'wasm');

const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

const MODELS = [
  {
    name: 'blaze_face_short_range.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
    /** Reject a truncated or error-page download. */
    minBytes: 100_000,
  },
  {
    name: 'selfie_segmenter.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
    minBytes: 200_000,
  },
];

async function main() {
  if (!existsSync(WASM_SRC)) {
    console.error(
      'fetch-assets: @mediapipe/tasks-vision not installed.\n' +
      '  Run `npm install` first.'
    );
    process.exit(1);
  }

  await mkdir(WASM_OUT, { recursive: true });

  let copied = 0;
  for (const name of WASM_FILES) {
    const src = path.join(WASM_SRC, name);
    const dest = path.join(WASM_OUT, name);
    if (!existsSync(src)) {
      console.error(`fetch-assets: missing ${name} in tasks-vision package.`);
      process.exit(1);
    }
    // Skip if already present at the same size — keeps repeat installs fast.
    if (existsSync(dest) && (await stat(dest)).size === (await stat(src)).size) continue;
    await copyFile(src, dest);
    copied++;
  }

  let downloaded = 0;
  for (const model of MODELS) {
    const modelPath = path.join(OUT, model.name);
    if (existsSync(modelPath) && (await stat(modelPath)).size >= model.minBytes) continue;

    process.stdout.write(`fetch-assets: downloading ${model.name}… `);
    const res = await fetch(model.url);
    if (!res.ok) {
      console.error(`\nfetch-assets: download failed (HTTP ${res.status}).`);
      console.error(`  Fetch it manually into public/mediapipe/:\n  ${model.url}`);
      process.exit(1);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < model.minBytes) {
      console.error(`\nfetch-assets: ${model.name} looks truncated (${buf.length} bytes).`);
      process.exit(1);
    }
    await writeFile(modelPath, buf);
    downloaded++;
    console.log(`ok (${(buf.length / 1024).toFixed(0)} KB)`);
  }

  if (copied || downloaded) {
    console.log(`fetch-assets: ready (${copied} runtime file(s) copied${downloaded ? `, ${downloaded} model(s) downloaded` : ''})`);
  } else {
    console.log('fetch-assets: assets already present');
  }
}

main().catch((err) => {
  console.error(`fetch-assets: ${err.message}`);
  process.exit(1);
});
