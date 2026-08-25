import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cropper } from './components/Cropper';
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
import { isSizeEnabled, presetRatio } from './lib/types';
import { cropFor, cropAroundFace, cropRatioFor, defaultCrop, refitCropToRatio } from './lib/crop';
import { detectFace, preloadDetector, type FaceBox } from './lib/face';
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
      setBusy(false);
      setStatus(`${loaded.length} image${loaded.length === 1 ? '' : 's'} loaded.`);
    },
    [activeImageId]
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

  const resetCrop = () => {
    if (!activeImage || !activePreset) return;
    const ratio = cropRatioFor(activePreset);
    setCrop(
      activeImage.id,
      activePreset.id,
      ratio === null
        ? { x: 0, y: 0, width: activeImage.naturalWidth, height: activeImage.naturalHeight }
        : defaultCrop(activeImage.naturalWidth, activeImage.naturalHeight, ratio)
    );
    setStatus(ratio === null ? 'Crop reset to full image.' : 'Crop reset to centered.');
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
          <button
            onClick={() => runExport('active')}
            disabled={busy || !activeImage}
            title={activePreset ? `Export this image at every ${activePreset.name} size` : undefined}
          >
            Export current
          </button>
          <button
            className="primary"
            onClick={() => runExport('all')}
            disabled={busy || !images.length}
            title={activePreset ? `Export all images at every ${activePreset.name} size` : undefined}
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
                <button onClick={autoFrameActive} disabled={busy}>
                  Auto-frame face
                </button>
                <button onClick={autoFrameAll} disabled={busy || images.length === 0}>
                  Auto-frame all
                </button>
                <button onClick={applyCropToAll} disabled={busy || images.length < 2}>
                  Apply crop to all
                </button>
                <button onClick={resetCrop} disabled={busy}>
                  Reset
                </button>
                <span className="spacer" />
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
                bitmap={activeImage.bitmap}
                naturalWidth={activeImage.naturalWidth}
                naturalHeight={activeImage.naturalHeight}
                ratio={cropRatioFor(activePreset)}
                crop={cropFor(activeImage, activePreset)}
                onChange={(crop) => setCrop(activeImage.id, activePreset.id, crop)}
              />
            </>
          ) : (
            <div className="empty">
              <div className={`empty-card ${dragActive ? 'drag-active' : ''}`}>
                <UploadIcon className="icon" />
                <p>{dragActive ? 'Drop to add images' : 'Drop images here, or use “Add images”.'}</p>
                <p className="hint">
                  Staff photos, social graphics, and logos — cropped once, exported at every
                  size. Everything runs locally; no image ever leaves this machine.
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
            onClick={() => setActiveImageId(img.id)}
            title={img.file.name}
          >
            <ThumbCanvas bitmap={img.bitmap} />
            <span>{img.baseName}</span>
          </button>
        ))}
        {images.length > 0 && (
          <button
            className="thumb clear"
            onClick={() => {
              images.forEach((i) => i.bitmap.close());
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
