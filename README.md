# Staff Photo Cropper

A local replacement for cropping staff photos in Photoshop. Load headshots, crop
once per aspect ratio, and export every pixel size you need in one click.

Everything runs in the browser on your own machine — no upload, no server, no
account. Photos never leave the computer.

## Running it

```
npm install     # first time only
npm run dev
```

Then open http://localhost:5173 in Chrome or Edge.

### Install it as a desktop app (works with no server running)

```
npm run build
npm run serve
```

Open http://localhost:4173, then in Chrome/Edge: ⋮ → **Cast, save and share** →
**Install page as app**. You get a real window and taskbar icon, no admin rights
needed.

The app caches itself on install — about 12 MB, including the face-detection
model — so **once installed you can stop the server and it keeps working**,
offline included. Launch it from the taskbar like any other app.

`npm run dev` is only for developing. `npm run serve` is only needed to install
the app or to pick up a new build.

### Updating an installed app

```
npm run build
npm run serve
```

Open the installed app while the server is running. It checks for a new version
on startup and shows **"A new version is ready. Reload"** in the status bar —
click Reload and it switches over. Stop the server afterwards.

The update waits for that click rather than applying itself, so a new build
never swaps code out from under you mid-batch.

If the prompt does not appear, the app is already current. To force a check,
close and reopen it while the server is up.

## How it works

**Presets** group output sizes that share one exact aspect ratio, so a single
crop drives every size in the group. Crop the square once and all seven square
sizes export from it.

The seeded presets come from an audit of the existing staff pages:

| Preset       | Ratio | Sizes                                          |
| ------------ | ----- | ---------------------------------------------- |
| Square       | 1.000 | 600, 356, 300, 268, 250, 200, 150 (all square) |
| Portrait 280 | 0.747 | 280×375, 500×670                               |
| Portrait 300 | 0.756 | 300×397                                        |
| Portrait 255 | 0.750 | 255×340                                        |
| Landscape    | 1.172 | 300×256                                        |

The three portrait presets are separate because their ratios genuinely differ by
about 1%. Merging them would distort or shift the crop, so each keeps its own.

Edit any preset in the left panel — rename it, change the filename suffix, add
or remove sizes, switch format (JPG/PNG/WebP) and quality. Changes save to the
browser automatically. **Save**/**Load** export and import presets as JSON, for
backup or for sharing with a colleague.

If you add a size whose ratio doesn't match its preset, the field turns amber
with a `!` — that size would be distorted. Move it to its own preset.

## Cropping

- **Drag inside** the box to move it; **drag a corner** to resize. The ratio
  stays locked to the preset.
- **Auto-frame face** finds the face and frames the crop on it, biased slightly
  high so the composition reads correctly for a headshot. Uses MediaPipe
  BlazeFace, which runs locally — the model and its runtime are served from
  `public/mediapipe`, never a CDN, so detection stays offline.
- **Auto-frame all** does that for every loaded image across every selected preset.
- **Apply crop to all** copies the current crop to every other image
  proportionally, useful when photos are framed consistently.
- Each image keeps a separate crop per preset, so switching presets never loses
  your work.

## Exporting

Tick the presets you want in the left panel, then **Export current** or
**Export all**. The button shows the total file count.

**Choose output folder** (Chrome/Edge) writes files straight into a folder you
pick — no download prompts. Without it, files go to your Downloads folder.

Filenames are `basename-suffix-WIDTHxHEIGHT.jpg`, e.g.
`jane-smith-square-300x300.jpg`. Untick **size in filename** to drop the
dimensions.

## Sharing with co-workers

Two ways, depending on whether they need to change the code.

**They just want to use it** — host it once and send a link:

```
npm run build
```

Drop `dist/` on any static host (Netlify, Vercel, an internal web server). They
open the URL and install it from the browser menu, same as you did. **They need
nothing installed** — no Node, no repo, no admin rights. Photos stay on their
machine either way; only the app itself is hosted.

To update everyone, rebuild and redeploy. Each person gets the update prompt the
next time they open the app.

**They want the source** — point them at the repo:

```
git clone https://github.com/cbemister/image-editing-app
cd image-editing-app
npm install     # fetches the MediaPipe runtime and model automatically
npm run build
npm run serve   # then install from http://localhost:4173
```

To send changes back, use a branch and a pull request rather than pushing to
`main` — history here has been rewritten once already, and force-pushes over
someone else's work are hard to recover.

## Deploying

The build is a folder of static files. **Anyone using the app needs only a
browser** — Node is required just to build it, and to run the batch CLI.

```
npm install     # also fetches the MediaPipe runtime and model
npm run build   # -> dist/
```

Serve `dist/` from anything: Netlify, Vercel, GitHub Pages, S3, nginx, an
internal share. Photos are processed entirely in the visitor's browser, so
hosting the app never means hosting anyone's images.

Deploying under a subfolder — a GitHub Pages project site, say — needs the base
path set, which rebases the asset URLs, the service worker scope, and the
manifest:

```
BASE_PATH=/staff-photo-cropper/ npm run build
```

Two things to get right on the host:

- **HTTPS is required** for the service worker (and so for offline use).
  `localhost` is exempt, which is why local installs work over plain http.
- **Serve `sw.js` with `Cache-Control: no-cache`**, or browsers can pin an old
  worker and never pick up new versions. `npm run serve` already does this.

### Assets are generated, not committed

`public/mediapipe/` holds ~23 MB of WASM and the face model. Those are build
inputs rather than source, so they are gitignored and produced by
`scripts/fetch-assets.mjs`, which runs automatically on `npm install`. The WASM
is copied from the installed `@mediapipe/tasks-vision` package so it always
matches `package.json`; the model is downloaded once and cached.

To regenerate them by hand: `node scripts/fetch-assets.mjs`

## Batch mode (no browser)

For bulk runs, skip the UI entirely:

```
npm run crop -- ./photos ./output
```

Every image in `./photos` gets auto-framed on its face and exported at every
enabled size of every preset. Add `--dry-run` first to see what it would write.

| Option | Effect |
| ------ | ------ |
| `--presets "Square,Portrait 280"` | Only these presets, by name |
| `--presets-file crop-presets.json` | Use presets exported from the app's **Save** button |
| `--no-auto-frame` | Skip face detection, use centered crops (much faster) |
| `--no-dimensions` | Omit `-WIDTHxHEIGHT` from filenames |
| `--recursive` | Include subfolders |
| `--dry-run` | Report what would be written, write nothing |
| `--quiet` | Only print the summary and any failures |

Each line reports how the crop was chosen:

```
[1/3] jane-smith.jpg → 12 file(s)  [face]      ← detected, good
[2/3] office-photo.jpg → 12 file(s)  [NO FACE] ← centered fallback, review it
[3/3] tom-lee.jpg → 12 file(s)  [GUESS]        ← model unavailable, review it
```

`NO FACE` and `GUESS` are the ones worth checking by eye — open those in the
visual app and adjust.

Notes on batch mode:

- It drives the same code as the app inside headless Chromium, so a batch crop
  and a hand crop of the same photo produce identical bytes.
- A corrupt or unreadable image is reported and skipped; the rest still run. The
  command exits non-zero if anything failed, so it is safe to chain.
- If two outputs would land on the same filename, the run refuses before writing
  anything rather than silently overwriting.
- Roughly one second per image with face detection on, well under that without.

## Notes

- Face detection takes about a second on the first image (loading the model),
  then ~110 ms each after that. The model preloads when the page opens, so in
  practice the first click is usually ready too.
- If detection ever fails to load, the app falls back to a crude skin-tone guess
  and says so in the status bar. Treat those crops as unreviewed.
- Downscaling steps down by halves before the final resize, which keeps small
  outputs (150×150) sharp instead of aliased.
- JPEG exports get a white background, so transparent PNG sources don't go black.
- Full-resolution sizes (1920×1920, 1920×2545) were left out of the seeded
  presets — those are source images rather than crop targets. Add them back in
  the panel if you need them.
