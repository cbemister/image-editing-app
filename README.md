# Framewise

A local replacement for cropping images in Photoshop. Load your files, crop once
per aspect ratio, and export every pixel size you need in one click.

Presets ship in three groups:

- **Staff photos** — the square and portrait sizes used across the staff pages.
- **Social media** — Instagram, Story/Reel, LinkedIn, Facebook, X, YouTube, and
  Open Graph link previews.
- **Logos & icons** — logo sets, app icons, favicons, and email signatures.

Photo and social presets **crop to fill**, so the frame is covered edge to edge.
Logo presets **fit the whole image** instead: the artwork is scaled to fit inside
the frame and padded, so a wordmark keeps its ends rather than being cut through.
Padding and the background (including transparent) are per-preset settings.

Everything runs in the browser on your own machine — no upload, no server, no
account. Images never leave the computer.

## Running it

```
npm install     # first time only
npm run dev
```

Then open http://localhost:5173 in Chrome or Edge.

The dev port is pinned. If it is already taken, `npm run dev` fails with
"Port 5173 is already in use" rather than quietly starting on 5174 -- Vite's
default of hunting for a free port hides servers that were never shut down, and
they accumulate, each holding a port and its memory. To clear one:

```
npm run dev:kill          # frees the default port
npm run dev:kill -- 5180  # frees a specific one
```

It finds the process by the port it holds, so it works on Windows too, where
`pkill -f vite` matches nothing (the server runs as `node.exe`).

### Install it as a desktop app (works with no server running)

```
npm run build
npm run serve
```

Open http://localhost:4173, then in Chrome/Edge: ⋮ → **Cast, save and share** →
**Install page as app**. You get a real window and taskbar icon, no admin rights
needed.

The app caches itself on install — about 12 MB, including the face-detection
and background-removal models — so **once installed you can stop the server and it keeps working**,
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

## Filenames

Each preset carries a filename template. The default reproduces the old
behaviour:

```
{name}-{suffix}-{size}   ->  jane-smith-square-600x600.jpg
{name}_{w}x{h}           ->  jane-smith_600x600.jpg
{preset}-{name}          ->  1x1-jane-smith.jpg
```

| Token | Is |
| ----- | -- |
| `{name}` | Source filename without its extension |
| `{suffix}` | The preset's suffix |
| `{preset}` | The preset's name (`:` written as `x`) |
| `{w}` / `{h}` | Output width / height |
| `{size}` | `600x600` |
| `{ext}` | The format's extension |

The extension is appended automatically, so a template never has to end in one.
The panel shows a worked example under the field, and the token chips append as
you click them.

Characters no filesystem accepts (`/ \ : * ? " < >`) are stripped rather than
substituted, so a name comes out shorter rather than quietly gaining
punctuation you did not type. An unknown token is left as written, so a typo is
visible instead of silently vanishing.

A preset with its own template owns the whole name, including whether
dimensions appear -- the "size in filename" switch in the top bar applies only
to presets still on the default.

## Undo

Every edit is undoable: crop drags, auto-frame, background on/off, and each
brush stroke as its own step.

| Action | Shortcut |
| ------ | -------- |
| Undo   | `Ctrl+Z` (`Cmd+Z`) |
| Redo   | `Ctrl+Shift+Z`, or `Ctrl+Y` |

History is **per image**, so undo never jumps you to a different photo
mid-batch, and switching images keeps what you did to each.

A crop drag is one step, not one per frame, and so is a brush stroke -- history
records the gesture, not the pointer events inside it.

Depth is capped at 12 steps because cutouts are full-resolution bitmaps: at
2140x2647 each is roughly 22MB, so an unbounded stack would grow into hundreds
of megabytes over a session. Older states are freed as they fall off the end.

## Two modes

The stage toolbar is split by activity, because framing and retouching want
different tools and both want the drag:

- **Crop** — framing: auto-frame, apply-to-all, and a draggable crop box.
- **Retouch** — the refine brushes.

**Remove background** sits on both bars. It is a setup step rather than a
retouching one -- the brushes exist to clean up its result -- so it is not
hidden behind a tab you would have to know to visit. Removing a background does
not switch modes either; framing and cutting out are both things you might want
to do first.

In Retouch the crop frame is still drawn, faint and without handles, so you can
see what will actually be exported while painting -- but it no longer competes
with the brush for the pointer. Zoom, Pan, and Reset stay available in both.

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

## Removing a background

Some photos are shot against a branded backdrop that has to go; most are shot
against a plain wall and need nothing. Click **Remove background** on the stage
toolbar and the subject is cut out of the active photo right there in the
preview -- what you see is what exports. It is a per-image call, so a run can
mix cut-out and untouched photos.

Clicking it drops you into **Retouch** to clean the edges, and the button
disables once it is on: the source image is never modified, so **Undo** is the
way back.

The model is MediaPipe's selfie segmenter, running locally from
`public/mediapipe` like the face detector. It is **trained on people** -- on a
logo it returns a confident but meaningless cutout.

Transparency only survives in a format that has an alpha channel. The toolbar
warns if the active preset is a JPG; set that preset to PNG or WebP.

### Refining the cutout by hand

The model is not perfect, and some of what it gets wrong cannot be fixed by
tuning. On a branded backdrop it often keeps small pieces of a logo that touch
the subject's outline, scoring them above 0.9 -- as confidently as the person
themselves. No threshold removes those without removing the subject too, which
is why the fix is a brush rather than a slider.

In Retouch, with a background removed, two tools appear:

- **Erase** (solid brush icon) paints away background the model kept -- logo
  marks, stray edges.
- **Restore** (hollow brush icon) paints back subject it cut away.

Drag on the image to paint; the ring under the cursor is the true brush size,
and the slider next to the buttons adjusts it. Strokes are soft-edged and go on
at partial strength, so they blend into the feathered boundary and build up
with repeated passes. Overshooting is recoverable -- switch to the other tool
and paint back over it.

While a brush is armed the crop box is not draggable, so painting near the edge
of the frame cannot move the crop by accident. Click the armed tool again to
put the pointer back on the crop box.

**Reset** returns the image to how it loaded: crop re-centred, background
restored, brush work discarded.

### Zooming

Fragments are often only a few pixels across, so the stage zooms:

- **Scroll wheel** over the image zooms about the pointer, so whatever is under
  the cursor stays under it.
- The **− / % / +** controls in the toolbar step the zoom; clicking the
  percentage returns to fit.
- **Pan** arms a drag-to-move tool; **holding Space** does the same without
  arming it, and middle-drag works too. Zoomed in, the crop box fills the
  viewport, so one of these is how you move around -- there is no empty margin
  left to drag.

Zoom affects only the view. The crop rect, the brush size, and everything
exported are unchanged by it -- a 24px brush stays 24 screen pixels, which at
high zoom means finer detail on the image itself.

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

`public/mediapipe/` holds ~23 MB of WASM and the two models — face detection
and selfie segmentation. Those are build
inputs rather than source, so they are gitignored and produced by
`scripts/fetch-assets.mjs`, which runs automatically on `npm install`. The WASM
is copied from the installed `@mediapipe/tasks-vision` package so it always
matches `package.json`; the models are downloaded once and cached.

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
