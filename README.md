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

### Make it feel like a desktop app

In Chrome/Edge, open the ⋮ menu → **Cast, save and share** → **Install page as
app**. You get a real window and a taskbar icon, with no admin rights required.

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
