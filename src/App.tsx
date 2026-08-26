import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cropper, type BrushMode } from './components/Cropper';
import { PresetPanel } from './components/PresetPanel';
import {
  addRecentSize,
  loadPresets,
  loadRecentSizes,
  savePresets,
  saveRecentSizes,
  type RecentSize,
} from './lib/presets';
import type { CropRect, LoadedImage, Preset } from './lib/types';
import { activeBitmap, isSizeEnabled, presetRatio } from './lib/types';
import { cropFor, cropAroundFace, cropRatioFor, defaultCrop, refitCropToRatio } from './lib/crop';
import { detectFace, preloadDetector, type FaceBox } from './lib/face';
import { applyBrush, preloadSegmenter, removeBackground, type BrushStroke } from './lib/segment';
import {
  canRedo,
  canUndo,
  emptyHistory,
  pushHistory,
  redo as redoHistory,
  redoLabel,
  releaseHistory,
  undo as undoHistory,
  undoLabel,
  type Snapshot,
} from './lib/history';
import { applyUpdate, registerServiceWorker } from './lib/sw-register';
import { exportImage } from './lib/export';
import {
  downloadItems,
  hasDirectoryPicker,
  pickOutputDirectory,
  writeToDirectory,
  type DirectoryHandleLike,
} from './lib/fs';
import './App.css';

let imageSeq = 0;

type Theme = 'dark' | 'light';

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export default function App() {
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets());
  const [recentSizes, setRecentSizes] = useState<RecentSize[]>(() => loadRecentSizes());
  const [images, setImages] = useState<LoadedImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [includeDimensions, setIncludeDimensions] = useState(true);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const outDirRef = useRef<DirectoryHandleLike | null>(null);
  const [outDirName, setOutDirName] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  /*
   * Armed brush, if any. Derived against the active image at use time rather
   * than cleared by an effect: there is no cutout to paint without one, so
   * gating the reads keeps the two from drifting out of sync.
   */
  const [brushMode, setBrushMode] = useState<BrushMode>(null);
  const [brushSize, setBrushSize] = useState(24);
  /*
   * Dabs collected since the last flush. Painting fires a pointer event per
   * frame, and rebuilding the bitmap on each one would stall the drag, so
   * they are batched and applied together on an animation frame.
   */
  const pendingStrokes = useRef<BrushStroke[]>([]);
  const flushHandle = useRef<number | null>(null);
  /** Cutouts replaced mid-stroke, freed once the stroke is over. */
  const superseded = useRef<ImageBitmap[]>([]);
  /**
   * Set at pointer-down, cleared by the first flush of the stroke.
   *
   * The history entry has to be pushed from inside that flush rather than
   * from the pointer-down handler: both run through setImages, React batches
   * them, and a separate commit could snapshot an image whose cutout the
   * stroke had already replaced -- recording the edit as its own "before".
   */
  const strokePending = useRef(false);
  const [zoomFactor, setZoomFactor] = useState(1);
  const [panMode, setPanMode] = useState(false);
  /**
   * Which activity the stage is set up for. Framing a crop and retouching a
   * cutout want different tools and compete for the same drag, so they are
   * separated rather than stacked into one row.
   */
  const [stageMode, setStageMode] = useState<'crop' | 'retouch'>('crop');
  /** Bumped per click so the Cropper re-applies even the same factor. */
  const [zoomCommand, setZoomCommand] = useState<{ factor: number; seq: number } | null>(null);
  const zoomSeq = useRef(0);
  const commandZoom = useCallback((factor: number) => {
    zoomSeq.current += 1;
    setZoomCommand({ factor, seq: zoomSeq.current });
    // Nothing to pan once the image is fitted again.
    if (factor <= 1) setPanMode(false);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => savePresets(presets), [presets]);

  useEffect(() => saveRecentSizes(recentSizes), [recentSizes]);

  const recordSize = useCallback(
    (width: number, height: number) =>
      setRecentSizes((prev) => addRecentSize(prev, width, height)),
    []
  );

  // Load the face model in the background so the first Auto-frame is instant.
  useEffect(() => preloadDetector(), []);

  // Same for the segmenter, so the first Remove background click does not wait.
  useEffect(() => preloadSegmenter(), []);

  // Offline support; surfaces a prompt when a newer build is cached and waiting.
  useEffect(() => registerServiceWorker(() => setUpdateReady(true)), []);

  /**
   * Keep the active preset id valid as presets are added or deleted. The setter
   * must return the previous value untouched when nothing changed, or the
   * re-render refires this effect and stomps the user's selection.
   */
  useEffect(() => {
    if (presets.length === 0) return;
    setActivePresetId((prev) =>
      prev && presets.some((p) => p.id === prev) ? prev : presets[0].id
    );
  }, [presets]);

  const activeImage = useMemo(
    () => images.find((i) => i.id === activeImageId) ?? null,
    [images, activeImageId]
  );
  const activePreset = useMemo(
    () => presets.find((p) => p.id === activePresetId) ?? null,
    [presets, activePresetId]
  );

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (list.length === 0) return;
      setBusy(true);
      setStatus(`Loading ${list.length} image${list.length === 1 ? '' : 's'}…`);

      const loaded: LoadedImage[] = [];
      for (const file of list) {
        try {
          const bitmap = await createImageBitmap(file);
          loaded.push({
            id: `img-${imageSeq++}`,
            file,
            baseName: file.name.replace(/\.[^.]+$/, ''),
            bitmap,
            naturalWidth: bitmap.width,
            naturalHeight: bitmap.height,
            crops: {},
          });
        } catch {
          setStatus(`Could not read ${file.name} — skipped.`);
        }
      }

      setImages((prev) => {
        const next = [...prev, ...loaded];
        if (!activeImageId && next.length) setActiveImageId(next[0].id);
        return next;
      });
      // New images start fitted, so a Pan armed for the previous one is stale.
      setPanMode(false);
      setBusy(false);
      setStatus(`${loaded.length} image${loaded.length === 1 ? '' : 's'} loaded.`);
    },
    [activeImageId]
  );

  /**
   * Snapshot an image's current state, for pushing onto its history.
   *
   * Crops are copied so a later in-place edit cannot rewrite the past. The
   * cutout is shared by reference, not cloned -- cloning a 24-megapixel bitmap
   * per step would be far more expensive than the history is worth, and the
   * history module owns the lifetime instead.
   */
  const snapshotOf = useCallback(
    (image: LoadedImage, label: string): Snapshot => ({
      crops: { ...image.crops },
      cutout: image.cutout,
      useCutout: image.useCutout === true,
      label,
    }),
    []
  );

  /**
   * Record the state an image is in before a change, so it can be undone.
   *
   * Called with the image as it is now; the caller then applies its edit. Any
   * bitmap still on screen is passed as live, so trimming the stack cannot
   * free something being displayed.
   */
  const commit = useCallback(
    (imageId: string, label: string) => {
      setImages((prev) =>
        prev.map((img) => {
          if (img.id !== imageId) return img;
          const live = new Set<ImageBitmap>();
          if (img.cutout) live.add(img.cutout);
          return {
            ...img,
            history: pushHistory(img.history ?? emptyHistory(), snapshotOf(img, img.lastEdit ?? label), live),
            lastEdit: label,
          };
        })
      );
    },
    [snapshotOf]
  );

  const setCrop = useCallback(
    (imageId: string, presetId: string, crop: CropRect) => {
      setImages((prev) =>
        prev.map((img) =>
          img.id === imageId ? { ...img, crops: { ...img.crops, [presetId]: crop } } : img
        )
      );
    },
    []
  );

  /**
   * Seed crops for one image across the given presets. Detection runs once per
   * image and the box is reused for every preset ratio.
   */
  const autoFrameOne = useCallback(
    async (image: LoadedImage, targets: Preset[]) => {
      const face = await detectFace(image.bitmap);
      if (!face) return { framed: 0, source: null as FaceBox['source'] | null };
      for (const preset of targets) {
        setCrop(
          image.id,
          preset.id,
          cropAroundFace(
            face,
            image.naturalWidth,
            image.naturalHeight,
            cropRatioFor(preset) ?? image.naturalWidth / image.naturalHeight
          )
        );
      }
      return { framed: targets.length, source: face.source };
    },
    [setCrop]
  );

  const autoFrameActive = async () => {
    if (!activeImage || !activePreset) return;
    commit(activeImage.id, 'auto-frame');
    setBusy(true);
    setStatus('Detecting face…');
    const { framed, source } = await autoFrameOne(activeImage, [activePreset]);
    if (framed && source === 'model') {
      setStatus('Crop framed on detected face.');
    } else if (framed) {
      setStatus('Face model unavailable — used a rough skin-tone guess. Check the crop.');
    } else {
      setStatus('No face detected — crop left unchanged.');
    }
    setBusy(false);
  };

  const autoFrameAll = async () => {
    if (images.length === 0 || !activePreset) return;
    const targets = [activePreset];
    setBusy(true);
    let hits = 0;
    let misses = 0;
    let heuristic = 0;
    for (let i = 0; i < images.length; i++) {
      setStatus(`Auto-framing ${i + 1}/${images.length}…`);
      const { framed, source } = await autoFrameOne(images[i], targets);
      if (!framed) misses++;
      else {
        hits++;
        if (source === 'heuristic') heuristic++;
      }
    }
    setBusy(false);
    const parts = [`Framed ${hits}/${images.length} image${images.length === 1 ? '' : 's'}`];
    if (misses) parts.push(`${misses} without a detected face (left unchanged)`);
    if (heuristic) parts.push(`${heuristic} by rough guess — check these`);
    setStatus(`${parts.join(' · ')}.`);
  };

  /** Copy the active image's crop to every other image, refit per preset ratio. */
  const applyCropToAll = () => {
    if (!activeImage || !activePreset) return;
    const source = cropFor(activeImage, activePreset);
    // Store as fractions so it transfers across differing source dimensions.
    const fx = source.x / activeImage.naturalWidth;
    const fy = source.y / activeImage.naturalHeight;
    const fw = source.width / activeImage.naturalWidth;
    const fh = source.height / activeImage.naturalHeight;

    setImages((prev) =>
      prev.map((img) => {
        if (img.id === activeImage.id) return img;
        return {
          ...img,
          crops: {
            ...img.crops,
            [activePreset.id]: {
              x: fx * img.naturalWidth,
              y: fy * img.naturalHeight,
              width: fw * img.naturalWidth,
              height: fh * img.naturalHeight,
            },
          },
        };
      })
    );
    setStatus(`Crop applied to ${images.length - 1} other image(s).`);
  };

  /**
   * Cut the subject out of the active photo, or put the background back.
   *
   * The result is cached on the image, so toggling it off and on again is
   * instant and never re-runs the model. The original bitmap is kept either
   * way -- this is a view of the image, not a destructive edit.
   */
  const toggleBackground = async () => {
    if (!activeImage) return;

    // Already computed: just flip which bitmap is in use.
    if (activeImage.cutout) {
      const nowOn = !activeImage.useCutout;
      commit(activeImage.id, nowOn ? 'remove background' : 'restore background');
      setImages((prev) =>
        prev.map((img) => (img.id === activeImage.id ? { ...img, useCutout: nowOn } : img))
      );
      setStatus(nowOn ? 'Cutout shown.' : 'Cutout hidden.');
      return;
    }

    setBusy(true);
    setStatus('Removing background…');
    commit(activeImage.id, 'remove background');
    try {
      const cutout = await removeBackground(activeImage.bitmap);
      if (!cutout) {
        setStatus('Background model unavailable — image left unchanged.');
        return;
      }
      setImages((prev) =>
        prev.map((img) =>
          img.id === activeImage.id ? { ...img, cutout, useCutout: true } : img
        )
      );
      setStatus(
        'Cutout previewed. Erase and Restore fix the edges; tick "remove background" on a preset to export it.'
      );
    } catch (err) {
      setStatus(
        `Background removal failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * Apply the queued dabs to the active image's cutout.
   *
   * Runs off an animation frame so a fast drag coalesces into one bitmap
   * rebuild per frame instead of one per pointer event. Reads the image from
   * the state setter rather than from `activeImage`, so a stroke started
   * before a re-render still lands on the current bitmap.
   */
  const flushStrokes = useCallback(() => {
    flushHandle.current = null;
    const strokes = pendingStrokes.current;
    if (strokes.length === 0) return;
    pendingStrokes.current = [];

    /*
     * Read and clear the flag OUT here, not inside the updater. React can call
     * an updater more than once for a single update, and clearing it in there
     * consumed the next stroke's flag too -- so a second stroke pushed no
     * history entry and both collapsed into one undo step.
     */
    const started = strokePending.current;
    strokePending.current = false;

    setImages((prev) => {
      const img = prev.find((i) => i.id === activeImageId);
      if (!img?.cutout) return prev;
      const base = img.cutout;

      applyBrush(base, img.bitmap, strokes)
        .then((next) => {
          setImages((cur) =>
            cur.map((i) => {
              if (i.id !== img.id) return i;
              // A later stroke may have replaced it already; drop this result.
              if (i.cutout !== base) {
                next.close();
                return i;
              }
              /*
               * The superseded bitmap is deliberately NOT closed here.
               *
               * Closing detaches it immediately, and any render still holding
               * the old reference -- a resize, a crop drag, an in-flight
               * effect -- then throws "image source is detached" from
               * drawImage. Deferring the close by a frame only narrows that
               * window; it cannot close it, because the draw effect can re-run
               * at any time. Superseded strokes are instead retired together
               * when the stroke ends (see retireSupersededCutouts), by which
               * point nothing is rendering them.
               */
              superseded.current.push(base);
              return { ...i, cutout: next };
            })
          );
        })
        .catch(() => {
          setStatus('Brush stroke failed.');
        });

      if (!started) return prev;
      // Snapshot taken from `img`, whose cutout is still the pre-stroke one:
      // applyBrush is async and has not swapped anything yet.
      const live = new Set<ImageBitmap>([base]);
      return prev.map((i) =>
        i.id === img.id
          ? {
              ...i,
              history: pushHistory(
                i.history ?? emptyHistory(),
                snapshotOf(i, i.lastEdit ?? 'brush stroke'),
                live
              ),
              lastEdit: 'brush stroke',
            }
          : i
      );
    });
  }, [activeImageId, snapshotOf]);


  /**
   * Free the intermediate bitmaps a stroke left behind.
   *
   * Called once the pointer is up and the last flush has landed, so none of
   * them is still on screen. Skips anything currently in use, which is the
   * one guarantee that matters here.
   */
  const retireSupersededCutouts = useCallback(() => {
    if (superseded.current.length === 0) return;
    const stale = superseded.current;
    superseded.current = [];
    setImages((cur) => {
      const live = new Set<ImageBitmap>();
      for (const i of cur) {
        if (i.cutout) live.add(i.cutout);
        live.add(i.bitmap);
        /*
         * History holds bitmaps too, and undo needs them intact. Before undo
         * existed a superseded cutout had exactly one owner; now a stroke's
         * starting bitmap is also the state undo returns to, and freeing it
         * here detached the very pixels the stack was keeping.
         */
        if (i.history) {
          for (const snap of [...i.history.past, ...i.history.future]) {
            if (snap.cutout) live.add(snap.cutout);
          }
        }
      }
      for (const b of stale) if (!live.has(b)) b.close();
      return cur;
    });
  }, []);

const beginStroke = useCallback(() => {
    strokePending.current = true;
  }, []);

  const endStroke = useCallback(() => {
    strokePending.current = false;
    retireSupersededCutouts();
  }, [retireSupersededCutouts]);

  const paintAt = useCallback(
    (x: number, y: number, radiusNatural: number) => {
      // No armed brush, or nothing to paint on: ignore the drag.
      if (!brushMode || !activeImage?.useCutout || !activeImage.cutout) return;
      pendingStrokes.current.push({
        x,
        y,
        radius: radiusNatural,
        mode: brushMode,
        // Below full strength, so repeated passes build up gradually and a
        // single overshoot is easy to walk back with the opposite mode.
        strength: 0.75,
      });
      if (flushHandle.current === null) {
        flushHandle.current = requestAnimationFrame(flushStrokes);
      }
    },
    [brushMode, flushStrokes, activeImage]
  );

  /**
   * Put the active image back to how it loaded: crop re-centred and the
   * background restored. Reset covers everything the stage tools changed --
   * leaving the cutout on made the button a lie, since the image plainly had
   * not been reset.
   *
   * The computed cutout is kept, so turning it back on does not re-run the
   * model; only the brush edits are dropped, as those are what Reset undoes.
   */
  /**
   * Step the active image back or forward through its history.
   *
   * Both directions are the same operation with the stacks swapped, so they
   * share one implementation. The bitmap being left is handed to the opposite
   * stack rather than closed -- it is exactly what the reverse step needs.
   */
  const step = useCallback(
    (direction: 'undo' | 'redo') => {
      setImages((prev) =>
        prev.map((img) => {
          if (img.id !== activeImageId) return img;
          const history = img.history ?? emptyHistory();
          // Named for the edit that produced this state, so stepping either
          // way can report what changed.
          const present = snapshotOf(img, img.lastEdit ?? 'change');
          const result =
            direction === 'undo' ? undoHistory(history, present) : redoHistory(history, present);
          if (!result) return img;

          const { snapshot } = result;

          /*
           * The label describes the EDIT, which is stored on the entry that
           * was pushed when that edit happened. Undoing steps back to the
           * state before it, so the name of what was undone comes from the
           * entry being left; redoing steps into it, so the name comes from
           * the entry being entered.
           */
          const label = direction === 'undo' ? present.label : snapshot.label;
          setStatus(`${direction === 'undo' ? 'Undid' : 'Redid'} ${label}.`);
          return {
            ...img,
            crops: { ...snapshot.crops },
            cutout: snapshot.cutout,
            useCutout: snapshot.useCutout,
            history: result.history,
            lastEdit: snapshot.label,
          };
        })
      );
      // A restored state may have no cutout to paint on.
      setBrushMode(null);
    },
    [activeImageId, snapshotOf]
  );

  const activeHistory = activeImage?.history ?? emptyHistory();
  const undoAvailable = canUndo(activeHistory);
  const redoAvailable = canRedo(activeHistory);

  /*
   * Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y). Bound on the window rather
   * than a focused element: the stage is a canvas the user drags on, not
   * something they tab into, so there is nothing that reliably holds focus.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      // Never hijack undo inside a text field -- preset names are edited here.
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        step(e.shiftKey ? 'redo' : 'undo');
      } else if (key === 'y') {
        e.preventDefault();
        step('redo');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  const resetCrop = () => {
    if (!activeImage || !activePreset) return;
    commit(activeImage.id, 'reset');
    const ratio = cropRatioFor(activePreset);
    setCrop(
      activeImage.id,
      activePreset.id,
      ratio === null
        ? { x: 0, y: 0, width: activeImage.naturalWidth, height: activeImage.naturalHeight }
        : defaultCrop(activeImage.naturalWidth, activeImage.naturalHeight, ratio)
    );

    const hadCutout = activeImage.useCutout;
    if (hadCutout) {
      /*
       * The cutout is dropped from state but not closed. Something may still
       * be rendering it this frame, and a detached bitmap throws from
       * drawImage. Letting it be garbage collected costs one bitmap and
       * cannot crash; see flushStrokes for the same reasoning.
       */
      setImages((prev) =>
        prev.map((img) =>
          img.id === activeImage.id
            ? { ...img, useCutout: false, cutout: undefined }
            : img
        )
      );
      superseded.current = [];
    }

    const cropNote = ratio === null ? 'Crop reset to full image' : 'Crop reset to centered';
    setStatus(hadCutout ? `${cropNote}; background restored.` : `${cropNote}.`);
  };

  const chooseOutputFolder = async () => {
    const dir = await pickOutputDirectory();
    if (dir) {
      outDirRef.current = dir;
      setOutDirName(dir.name);
      setStatus(`Output folder set to "${dir.name}".`);
    }
  };

  const runExport = async (scope: 'active' | 'all') => {
    if (!activePreset) {
      setStatus('No preset selected.');
      return;
    }
    if (!activePreset.sizes.some(isSizeEnabled)) {
      setStatus(
        `No sizes ticked for "${activePreset.name}" — pick at least one in the preset panel.`
      );
      return;
    }
    const targets = [activePreset];
    const subjects = scope === 'active' ? (activeImage ? [activeImage] : []) : images;
    if (subjects.length === 0) {
      setStatus('No images to export.');
      return;
    }

    setBusy(true);
    try {
      const all = [];
      for (let i = 0; i < subjects.length; i++) {
        setStatus(`Rendering ${i + 1}/${subjects.length}…`);
        all.push(...(await exportImage(subjects[i], targets, includeDimensions)));
      }

      if (outDirRef.current) {
        await writeToDirectory(outDirRef.current, all, (done, total) =>
          setStatus(`Writing ${done}/${total}…`)
        );
        setStatus(`Exported ${all.length} file(s) to "${outDirName}".`);
      } else {
        await downloadItems(all, (done, total) => setStatus(`Downloading ${done}/${total}…`));
        setStatus(`Exported ${all.length} file(s) to your Downloads folder.`);
      }
    } catch (err) {
      setStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // Only enabled sizes are rendered (see renderAll), so the count on the
  // export button has to agree with what will actually be written.
  const totalOutputs = useMemo(
    () =>
      (activePreset?.sizes.filter(isSizeEnabled).length ?? 0) * images.length,
    [activePreset, images.length]
  );

  /**
   * Whether the active preset has any size ticked.
   *
   * Separate from `totalOutputs`, which is zero both when no size is picked
   * and when no image is loaded -- two different problems needing two
   * different prompts.
   */
  const sizesEnabled = useMemo(
    () => (activePreset?.sizes.some(isSizeEnabled) ?? false),
    [activePreset]
  );

  return (
    <div
      className="app"
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current++;
        if (e.dataTransfer.types.includes('Files')) setDragActive(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragActive(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <header className="topbar">
        <h1>
          <LogoMark />
          <span>Framewise</span>
        </h1>
        <div className="topbar-actions">
          <label className="file-btn primary">
            Add images
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </label>
          <button onClick={chooseOutputFolder} disabled={!hasDirectoryPicker()}>
            {outDirName ? `Folder: ${outDirName}` : 'Choose output folder'}
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={includeDimensions}
              onChange={(e) => setIncludeDimensions(e.target.checked)}
            />
            size in filename
          </label>
          <span className="topbar-sep" />
          {/*
            * Both are disabled when no size is ticked. "Export all (0)" used
            * to stay clickable and then do nothing at all, which reads as the
            * export being broken rather than as nothing being selected.
            */}
          <button
            onClick={() => runExport('active')}
            disabled={busy || !activeImage || !sizesEnabled}
            title={
              !sizesEnabled
                ? 'Tick at least one size in the preset panel first'
                : activePreset
                  ? `Export this image at every ${activePreset.name} size`
                  : undefined
            }
          >
            Export current
          </button>
          <button
            className="primary"
            onClick={() => runExport('all')}
            disabled={busy || !images.length || !sizesEnabled}
            title={
              !sizesEnabled
                ? 'Tick at least one size in the preset panel first'
                : activePreset
                  ? `Export all images at every ${activePreset.name} size`
                  : undefined
            }
          >
            Export all ({totalOutputs})
          </button>
          <span className="topbar-sep" />
          <button
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <ThemeIcon theme={theme} />
          </button>
        </div>
      </header>

      <div className="body">
        <PresetPanel
          presets={presets}
          activeId={activePresetId}
          recentSizes={recentSizes}
          onRecordSize={recordSize}
          onSetPresets={setPresets}
          onSetActive={(id) => {
            setActivePresetId(id);
            // Refit the existing crop to the newly selected ratio.
            const preset = presets.find((p) => p.id === id);
            if (activeImage && preset && activeImage.crops[id] === undefined) {
              const prior = activePresetId ? activeImage.crops[activePresetId] : undefined;
              // A free-ratio (contain) preset keeps the incoming crop as-is;
              // there is no output shape to refit it to.
              const nextRatio = cropRatioFor(preset);
              if (prior && nextRatio !== null) {
                setCrop(
                  activeImage.id,
                  id,
                  refitCropToRatio(
                    prior,
                    activeImage.naturalWidth,
                    activeImage.naturalHeight,
                    nextRatio
                  )
                );
              } else if (prior) {
                setCrop(activeImage.id, id, prior);
              }
            }
          }}
        />

        <main className="stage">
          {activeImage && activePreset ? (
            <>
              <div className="stage-tools">
                {/*
                  * Mode tabs first, then only that mode's tools. Framing and
                  * retouching want different controls and both want the drag,
                  * so they are separated rather than crowded into one row that
                  * scrolls and arbitrates gestures behind the scenes.
                  */}
                <span className="mode-tabs" role="tablist" aria-label="Stage mode">
                  <button
                    role="tab"
                    aria-selected={stageMode === 'crop'}
                    className={stageMode === 'crop' ? 'on' : undefined}
                    onClick={() => {
                      setStageMode('crop');
                      setBrushMode(null);
                    }}
                  >
                    Crop
                  </button>
                  <button
                    role="tab"
                    aria-selected={stageMode === 'retouch'}
                    className={stageMode === 'retouch' ? 'on' : undefined}
                    onClick={() => setStageMode('retouch')}
                  >
                    Retouch
                  </button>
                </span>

                {stageMode === 'crop' ? (
                  <>
                    <button onClick={autoFrameActive} disabled={busy}>
                      Auto-frame face
                    </button>
                    <button onClick={autoFrameAll} disabled={busy || images.length === 0}>
                      Auto-frame all
                    </button>
                    <button onClick={applyCropToAll} disabled={busy || images.length < 2}>
                      Apply crop to all
                    </button>
                  </>
                ) : (
                  <>
                    {/*
                      * Retouch previews a cutout so it can be corrected by
                      * hand. Whether an export actually cuts out is a preset
                      * setting ("remove background" in the preset panel) --
                      * this is the working view, not the configuration.
                      */}
                    <button
                      onClick={toggleBackground}
                      disabled={busy}
                      className={activeImage.useCutout ? 'on' : undefined}
                      title="Preview the cutout so it can be corrected. Which exports cut out is set per preset."
                    >
                      {activeImage.useCutout ? 'Hide cutout' : 'Preview cutout'}
                    </button>
                    {/*
                      * Brushes need a cutout to paint on, so they appear only
                      * once there is one.
                      */}
                    {activeImage.useCutout && (
                      <>
                        <button
                          onClick={() => {
                            setPanMode(false);
                            setBrushMode((m) => (m === 'erase' ? null : 'erase'));
                          }}
                          className={`tool ${brushMode === 'erase' ? 'on' : ''}`}
                          title="Erase brush — drag on the image to paint away background the model kept (logo marks, stray edges)."
                        >
                          <BrushIcon />
                          Erase
                        </button>
                        <button
                          onClick={() => {
                            setPanMode(false);
                            setBrushMode((m) => (m === 'restore' ? null : 'restore'));
                          }}
                          className={`tool ${brushMode === 'restore' ? 'on' : ''}`}
                          title="Restore brush — drag on the image to paint back subject the model cut away."
                        >
                          <BrushIcon hollow />
                          Restore
                        </button>
                        {brushMode && (
                          <label className="brush-size" title="Brush size">
                            <span className="brush-size-label">Size</span>
                            <input
                              type="range"
                              min={4}
                              max={80}
                              value={brushSize}
                              onChange={(e) => setBrushSize(Number(e.target.value))}
                            />
                            <span>{brushSize}px</span>
                          </label>
                        )}
                      </>
                    )}
                  </>
                )}

                <span className="spacer" />

                {/* View controls belong to neither mode; both need them. */}
                <span className="zoom-controls">
                  <button
                    className={`tool ${panMode ? 'on' : ''}`}
                    onClick={() => {
                      setBrushMode(null);
                      setPanMode((p) => !p);
                    }}
                    disabled={zoomFactor <= 1}
                    title="Pan tool — drag to move around the zoomed image. Holding Space does the same without arming the tool."
                  >
                    <PanIcon />
                    Pan
                  </button>
                  <button
                    onClick={() => commandZoom(zoomFactor / 1.5)}
                    disabled={zoomFactor <= 1}
                    title="Zoom out"
                  >
                    −
                  </button>
                  <button
                    className="zoom-readout"
                    onClick={() => commandZoom(1)}
                    disabled={zoomFactor === 1}
                    title="Reset zoom to fit"
                  >
                    {Math.round(zoomFactor * 100)}%
                  </button>
                  <button
                    onClick={() => commandZoom(zoomFactor * 1.5)}
                    disabled={zoomFactor >= 12}
                    title="Zoom in"
                  >
                    +
                  </button>
                  {zoomFactor > 1 && !panMode && (
                    <span className="zoom-hint">Hold Space to pan</span>
                  )}
                </span>

                <span className="history-controls">
                  <button
                    className="tool"
                    onClick={() => step('undo')}
                    disabled={busy || !undoAvailable}
                    title={
                      undoAvailable
                        ? `Undo ${undoLabel(activeHistory)} (Ctrl+Z)`
                        : 'Nothing to undo'
                    }
                  >
                    <UndoIcon />
                  </button>
                  <button
                    className="tool"
                    onClick={() => step('redo')}
                    disabled={busy || !redoAvailable}
                    title={
                      redoAvailable
                        ? `Redo ${redoLabel(activeHistory)} (Ctrl+Shift+Z)`
                        : 'Nothing to redo'
                    }
                  >
                    <UndoIcon forward />
                  </button>
                </span>

                <button onClick={resetCrop} disabled={busy}>
                  Reset
                </button>

                {/*
                 * Three separate cells rather than one nowrap string: at narrow
                 * widths the facts wrap onto their own rows instead of being
                 * clipped mid-word, and each keeps a readable rule between it
                 * and the next.
                 */}
                <span className="dims">
                  <span className="dim">
                    {activeImage.naturalWidth}×{activeImage.naturalHeight} source
                  </span>
                  <span className="dim">{activePreset.name}</span>
                  <span className="dim">
                    {activePreset.fit === 'contain'
                      ? 'fit whole image'
                      : `ratio ${presetRatio(activePreset).toFixed(3)}`}
                  </span>
                </span>
              </div>
              <Cropper
                bitmap={activeBitmap(activeImage)}
                naturalWidth={activeImage.naturalWidth}
                naturalHeight={activeImage.naturalHeight}
                ratio={cropRatioFor(activePreset)}
                crop={cropFor(activeImage, activePreset)}
                onChange={(crop) => setCrop(activeImage.id, activePreset.id, crop)}
                onChangeStart={() => commit(activeImage.id, 'crop change')}
                brushMode={activeImage.useCutout ? brushMode : null}
                panMode={panMode}
                cropInteractive={stageMode === 'crop'}
                brushSize={brushSize}
                onPaint={paintAt}
                onPaintStart={beginStroke}
                onPaintEnd={endStroke}
                onZoomChange={setZoomFactor}
                zoomCommand={zoomCommand}
              />
            </>
          ) : (
            <div className="empty">
              <div className={`empty-card ${dragActive ? 'drag-active' : ''}`}>
                <UploadIcon className="icon" />
                <p>{dragActive ? 'Drop to add images' : 'Drop images here, or use “Add images”.'}</p>
                <p className="hint">
                  Staff photos, social graphics, and logos — crop and resize, fast. Everything
                  runs locally; no image ever leaves this machine.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      <footer className="filmstrip">
        {images.map((img) => (
          <button
            key={img.id}
            className={`thumb ${img.id === activeImageId ? 'active' : ''}`}
            onClick={() => {
              setActiveImageId(img.id);
              // The Cropper refits per image, so a carried-over Pan is stale.
              setPanMode(false);
            }}
            title={img.file.name}
          >
            <ThumbCanvas bitmap={activeBitmap(img)} />
            <span>{img.baseName}</span>
          </button>
        ))}
        {images.length > 0 && (
          <button
            className="thumb clear"
            onClick={() => {
              images.forEach((i) => {
                // History owns its own bitmaps; release those before the
                // live ones, so a shared reference is not closed twice.
                if (i.history) releaseHistory(i.history, new Set(i.cutout ? [i.cutout] : []));
                i.bitmap.close();
                i.cutout?.close();
              });
              setImages([]);
              setActiveImageId(null);
              setStatus('Cleared all images.');
            }}
          >
            Clear all
          </button>
        )}
      </footer>

      <div className="statusbar">
        {busy ? `⏳ ${status}` : status}
        {updateReady && (
          <span className="update-note">
            A new version is ready.
            <button onClick={applyUpdate}>Reload</button>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Two offset frames -- the crop box and the output frame -- which is the whole
 * idea of the app in one mark.
 */
function LogoMark() {
  return (
    <svg className="logomark" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="14" height="14" rx="3" className="logomark-back" />
      <rect
        x="7.75"
        y="7.75"
        width="12.5"
        height="12.5"
        rx="3"
        className="logomark-front"
      />
    </svg>
  );
}

/*
 * A two-cell split square: one cell filled, one outlined. A sun/moon glyph
 * would belong to a different visual language than the geometric cells used
 * everywhere else in this interface. The filled cell swaps sides with the
 * theme, so the icon states which way the toggle goes.
 */
function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <rect className={`cell${theme === 'dark' ? ' on' : ''}`} x="1" y="1" width="7" height="14" />
      <rect className={`cell${theme === 'dark' ? '' : ' on'}`} x="8" y="1" width="7" height="14" />
    </svg>
  );
}

/**
 * A brush, angled, with its tip filled or hollow.
 *
 * The two brushes are told apart the way the theme toggle tells its states
 * apart -- filled versus outlined -- rather than by hue. Everything here draws
 * in currentColor: the palette keeps one accent as a stamp, so a second
 * signal colour in a toolbar icon reads as a different design language.
 */
function BrushIcon({ hollow = false }: { hollow?: boolean }) {
  return (
    <svg
      className="brush-icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Handle, longer so the tool reads as a brush and not a blob. */}
      <path d="M14 2 L8.6 7.4" />
      {/* Ferrule: the band that makes the shape legible at 14px. */}
      <path d="M7.2 6 L10 8.8" />
      {/* Tip: solid for erase, outlined for restore. */}
      <path
        d="M6.1 6.7 L9.3 9.9 L7.4 11.8 A2.7 2.7 0 0 1 4.2 8.6 Z"
        fill={hollow ? 'none' : 'currentColor'}
      />
    </svg>
  );
}

/** A curved arrow; `forward` mirrors it for redo. */
function UndoIcon({ forward = false }: { forward?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={forward ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M6.5 4.5 L3 7.5 L6.5 10.5" />
      <path d="M3 7.5 h6.2a3.8 3.8 0 0 1 0 7.6H7" />
    </svg>
  );
}

/** A hand, for the pan tool. Outlined, in currentColor, like every other. */
function PanIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5.6 7.4V3.7a1 1 0 0 1 2 0v3.2" />
      <path d="M7.6 6.9V3a1 1 0 0 1 2 0v3.9" />
      <path d="M9.6 7.1V4.2a1 1 0 0 1 2 0V8" />
      <path d="M5.6 7.4V6.1a1 1 0 0 0-2 0v3.5c0 2.3 1.7 4.3 3.9 4.3h1.2c2.1 0 3.7-1.7 3.7-3.9V8" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 15V3M12 3L7.5 7.5M12 3l4.5 4.5" />
      <path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" />
    </svg>
  );
}

function ThumbCanvas({ bitmap }: { bitmap: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const size = 56;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  }, [bitmap]);
  return <canvas ref={ref} />;
}
