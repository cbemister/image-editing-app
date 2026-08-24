#!/usr/bin/env node
/**
 * Static server for the production build.
 *
 * You need this only to INSTALL or UPDATE the app: a service worker cannot be
 * registered from file://, so the app has to be loaded over http once. After
 * the install completes the app runs from its own cache and this server can
 * stay off for good.
 */

import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 4173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
};

try {
  await stat(path.join(DIST, 'index.html'));
} catch {
  console.error('No build found. Run:  npm run build');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';

    // Contain path traversal: resolve, then require the result to stay in DIST.
    const abs = path.resolve(DIST, '.' + rel);
    if (!abs.startsWith(DIST)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let target = abs;
    try {
      const s = await stat(target);
      if (s.isDirectory()) target = path.join(target, 'index.html');
    } catch {
      // SPA fallback — unknown paths render the app shell.
      target = path.join(DIST, 'index.html');
    }

    const ext = path.extname(target).toLowerCase();
    const headers = { 'Content-Type': TYPES[ext] ?? 'application/octet-stream' };

    // The worker itself must never be served stale, or updates can never land.
    if (path.basename(target) === 'sw.js') {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    }

    const s = await stat(target);
    headers['Content-Length'] = s.size;
    res.writeHead(200, headers);
    createReadStream(target).pipe(res);
  } catch (err) {
    res.writeHead(500).end(String(err?.message ?? err));
  }
});

server.listen(PORT, () => {
  console.log(`\n  Staff Photo Cropper — production build`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log('  Open that URL, then install the app:');
  console.log('    Chrome/Edge  ⋮  →  Cast, save and share  →  Install page as app\n');
  console.log('  Once installed it runs from its own cache — you can stop this');
  console.log('  server (Ctrl+C) and the app will keep working offline.\n');
});
