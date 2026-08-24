#!/usr/bin/env node
/**
 * Headless batch cropper.
 *
 * Runs the exact same crop/detect/export code as the visual app, driven inside
 * headless Chromium. That is deliberate: ImageBitmap, OffscreenCanvas and the
 * MediaPipe WASM runtime are browser APIs, and reimplementing them in Node
 * would mean two pipelines that could drift apart and produce different crops.
 *
 * Usage:
 *   npm run crop -- <input-dir> <output-dir> [options]
 *
 * Options:
 *   --presets <a,b>    Only run these presets (by name). Default: all.
 *   --presets-file <f> Load presets from a JSON file exported by the app.
 *   --no-auto-frame    Skip face detection; use a centered crop.
 *   --no-dimensions    Omit -WxH from output filenames.
 *   --recursive        Include images in subfolders.
 *   --dry-run          Report what would be written without writing it.
 *   --quiet            Only print the final summary and any failures.
 */

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readdir, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp']);

function parseArgs(argv) {
  const opts = {
    input: null,
    output: null,
    presets: null,
    presetsFile: null,
    autoFrame: true,
    dimensions: true,
    recursive: false,
    dryRun: false,
    quiet: false,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--presets': opts.presets = argv[++i]?.split(',').map((s) => s.trim()); break;
      case '--presets-file': opts.presetsFile = argv[++i]; break;
      case '--no-auto-frame': opts.autoFrame = false; break;
      case '--no-dimensions': opts.dimensions = false; break;
      case '--recursive': opts.recursive = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--quiet': opts.quiet = true; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        positional.push(arg);
    }
  }

  [opts.input, opts.output] = positional;
  return opts;
}

const HELP = `
Staff Photo Cropper — batch mode

  npm run crop -- <input-dir> <output-dir> [options]

Options
  --presets <a,b>      Only these presets, by name (e.g. "Square,Portrait 280")
  --presets-file <f>   Presets JSON exported from the app's Save button
  --no-auto-frame      Skip face detection, use a centered crop
  --no-dimensions      Omit -WIDTHxHEIGHT from filenames
  --recursive          Include subfolders
  --dry-run            Show what would be written, write nothing
  --quiet              Only print the summary and failures

Examples
  npm run crop -- ./photos ./out
  npm run crop -- ./photos ./out --presets "Portrait 280"
  npm run crop -- ./photos ./out --dry-run
`;

async function collectImages(dir, recursive) {
  const found = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive) await walk(full);
      } else if (IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) {
        found.push(full);
      }
    }
  }
  await walk(dir);
  return found.sort();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || !opts.input || !opts.output) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 1);
  }

  const inputDir = path.resolve(opts.input);
  const outputDir = path.resolve(opts.output);

  if (!existsSync(inputDir) || !(await stat(inputDir)).isDirectory()) {
    console.error(`Input folder not found: ${inputDir}`);
    process.exit(1);
  }

  const log = opts.quiet ? () => {} : (...a) => console.log(...a);

  const files = await collectImages(inputDir, opts.recursive);
  if (files.length === 0) {
    console.error(`No images found in ${inputDir}${opts.recursive ? ' (including subfolders)' : ''}.`);
    process.exit(1);
  }

  let presetOverride = null;
  if (opts.presetsFile) {
    presetOverride = JSON.parse(await readFile(path.resolve(opts.presetsFile), 'utf8'));
  }

  log(`Found ${files.length} image${files.length === 1 ? '' : 's'} in ${inputDir}`);
  log('Starting headless browser…');

  // Serve the app so its modules and the MediaPipe assets load over http.
  const server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 0 },
  });
  await server.listen();
  const port = server.config.server.port ?? server.httpServer.address().port;
  const origin = `http://localhost:${port}`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const failures = [];
  page.on('pageerror', (err) => failures.push({ file: '(page)', error: err.message }));

  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });

    // Load the app's own modules once; every image reuses them.
    await page.evaluate(async ({ presetOverride }) => {
      const [{ detectFace }, crop, exp, presetsMod, types] = await Promise.all([
        import('/src/lib/face.ts'),
        import('/src/lib/crop.ts'),
        import('/src/lib/export.ts'),
        import('/src/lib/presets.ts'),
        import('/src/lib/types.ts'),
      ]);
      window.__crop = {
        detectFace,
        ...crop,
        ...exp,
        ...types,
        presets: presetOverride ?? presetsMod.DEFAULT_PRESETS,
      };
    }, { presetOverride });

    const available = await page.evaluate(() => window.__crop.presets.map((p) => p.name));
    let active = available;
    if (opts.presets) {
      const missing = opts.presets.filter((n) => !available.includes(n));
      if (missing.length) {
        console.error(`Unknown preset(s): ${missing.join(', ')}`);
        console.error(`Available: ${available.join(', ')}`);
        process.exit(1);
      }
      active = opts.presets;
    }

    log(`Presets: ${active.join(', ')}`);
    log(`Face detection: ${opts.autoFrame ? 'on' : 'off (centered crops)'}`);

    /**
     * Filenames must be unique before we write anything. Without the -WxH part,
     * two sizes in one preset collapse to the same name and the later write
     * silently destroys the earlier one — so refuse the run instead.
     */
    const collisions = await page.evaluate(
      ({ activeNames, dimensions }) => {
        const K = window.__crop;
        const seen = new Map();
        const dupes = [];
        for (const preset of K.presets.filter((p) => activeNames.includes(p.name))) {
          for (const size of preset.sizes) {
            if (!size.enabled) continue;
            const name = K.filenameFor({ baseName: '{name}' }, preset, size, dimensions);
            const label = `${preset.name} ${size.width}x${size.height}`;
            if (seen.has(name)) dupes.push({ name, a: seen.get(name), b: label });
            else seen.set(name, label);
          }
        }
        return dupes;
      },
      { activeNames: active, dimensions: opts.dimensions }
    );

    if (collisions.length) {
      console.error('\nFilename collision — these would overwrite each other:\n');
      for (const c of collisions) {
        console.error(`  ${c.name}  ←  ${c.a}  and  ${c.b}`);
      }
      console.error(
        opts.dimensions
          ? '\nGive the presets different suffixes so their filenames differ.'
          : '\nDrop --no-dimensions, or select one size per preset.'
      );
      process.exit(1);
    }

    if (opts.dryRun) log('DRY RUN — nothing will be written\n');
    else log('');

    if (!opts.dryRun) await mkdir(outputDir, { recursive: true });

    let written = 0;
    let detected = 0;
    let noFace = 0;
    let heuristic = 0;
    const started = Date.now();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const name = path.basename(file);
      const baseName = name.replace(/\.[^.]+$/, '');

      try {
        const bytes = await readFile(file);
        const result = await page.evaluate(
          async ({ b64, baseName, activeNames, autoFrame, dimensions }) => {
            const K = window.__crop;

            // Rebuild the file in the page from base64.
            const bin = atob(b64);
            const buf = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
            const bitmap = await createImageBitmap(new Blob([buf]));

            const presets = K.presets.filter((p) => activeNames.includes(p.name));

            let face = null;
            if (autoFrame) face = await K.detectFace(bitmap);

            const outputs = [];
            for (const preset of presets) {
              const ratio = K.presetRatio(preset);
              const box = face
                ? K.cropAroundFace(face, bitmap.width, bitmap.height, ratio)
                : K.defaultCrop(bitmap.width, bitmap.height, ratio);

              for (const size of preset.sizes) {
                if (!size.enabled) continue;
                const blob = await K.renderSize(bitmap, box, size, preset.format, preset.quality);
                const ab = await blob.arrayBuffer();
                let s = '';
                const view = new Uint8Array(ab);
                const CHUNK = 0x8000;
                for (let i = 0; i < view.length; i += CHUNK) {
                  s += String.fromCharCode.apply(null, view.subarray(i, i + CHUNK));
                }
                outputs.push({
                  filename: K.filenameFor({ baseName }, preset, size, dimensions),
                  b64: btoa(s),
                  bytes: blob.size,
                });
              }
            }

            bitmap.close();
            return {
              source: `${bitmap.width}x${bitmap.height}`,
              faceSource: face ? face.source : null,
              outputs,
            };
          },
          {
            b64: bytes.toString('base64'),
            baseName,
            activeNames: active,
            autoFrame: opts.autoFrame,
            dimensions: opts.dimensions,
          }
        );

        if (opts.autoFrame) {
          if (!result.faceSource) noFace++;
          else if (result.faceSource === 'heuristic') heuristic++;
          else detected++;
        }

        if (!opts.dryRun) {
          for (const out of result.outputs) {
            await writeFile(path.join(outputDir, out.filename), Buffer.from(out.b64, 'base64'));
          }
        }
        written += result.outputs.length;

        const tag = !opts.autoFrame
          ? 'centered'
          : result.faceSource === 'model'
            ? 'face'
            : result.faceSource === 'heuristic'
              ? 'GUESS'
              : 'NO FACE';
        log(
          `[${String(i + 1).padStart(String(files.length).length)}/${files.length}] ` +
          `${name} → ${result.outputs.length} file(s)  [${tag}]`
        );
      } catch (err) {
        // Strip Playwright's "page.evaluate: <Type>Error:" wrapper.
        const message = err.message
          .replace(/^page\.evaluate:\s*/, '')
          .replace(/^\w*Error:\s*/, '')
          .split('\n')[0];
        failures.push({ file: name, error: message });
        console.error(`  ! ${name}: ${message}`);
      }
    }

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    log('');
    console.log(
      `${opts.dryRun ? 'Would write' : 'Wrote'} ${written} file(s) from ${files.length} image(s) in ${secs}s` +
      (opts.dryRun ? '' : ` → ${outputDir}`)
    );

    if (opts.autoFrame) {
      const parts = [`${detected} face(s) detected`];
      if (noFace) parts.push(`${noFace} with no face (centered crop used)`);
      if (heuristic) parts.push(`${heuristic} by rough guess — review these`);
      console.log(parts.join(' · '));
    }

    if (failures.length) {
      console.log(`\n${failures.length} failure(s):`);
      for (const f of failures) console.log(`  ${f.file}: ${f.error}`);
    }

    process.exitCode = failures.length ? 1 : 0;
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
