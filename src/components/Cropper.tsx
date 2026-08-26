import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CropRect } from '../lib/types';
import { clampCrop } from '../lib/crop';

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'move';

/** Painting mode, or null when the pointer drives the crop box as usual. */
export type BrushMode = 'erase' | 'restore' | null;

interface Props {
  bitmap: ImageBitmap;
  naturalWidth: number;
  naturalHeight: number;
  /** Locked aspect ratio, or null to resize freely (contain presets). */
  ratio: number | null;
  crop: CropRect;
  onChange(crop: CropRect): void;
  /**
   * Fired once when a crop gesture begins, before onChange starts streaming.
   * Undo snapshots here: a drag fires onChange every frame, and one history
   * entry per frame would bury everything else in the stack.
   */
  onChangeStart?(): void;
  /** When set, dragging paints the cutout instead of moving the crop. */
  brushMode?: BrushMode;
  /** When true, dragging pans the zoomed view instead of moving the crop. */
  panMode?: boolean;
  /**
   * When false the crop frame is drawn faint and cannot be dragged. Retouch
   * mode still shows it -- painting detail that falls outside the export area
   * is wasted work -- but it stops competing for the pointer.
   */
  cropInteractive?: boolean;
  /**
   * Brush radius in SCREEN pixels. Kept in screen space so the brush stays the
   * size the user sees: a radius in image pixels would shrink to a few pixels
   * on a 2140px phone photo fitted to the stage, and balloon on a small one.
   */
  brushSize?: number;
  /**
   * Called with each dab's centre in natural image pixels, plus the radius
   * converted to the same space.
   */
  onPaint?(x: number, y: number, radiusNatural: number): void;
  /** Called once when a paint drag begins, before the first dab. */
  onPaintStart?(): void;
  /** Called once when a paint drag finishes, for cleanup the stroke deferred. */
  onPaintEnd?(): void;
  /** Reports the current zoom factor, for a readout in the toolbar. */
  onZoomChange?(factor: number): void;
  /** Set by the parent to drive zoom from toolbar buttons. */
  zoomCommand?: { factor: number; seq: number } | null;
}

const HANDLE_HIT = 14;

export function Cropper({
  bitmap,
  naturalWidth,
  naturalHeight,
  ratio,
  crop,
  onChange,
  onChangeStart,
  brushMode = null,
  panMode = false,
  cropInteractive = true,
  brushSize = 40,
  onPaint,
  onPaintStart,
  onPaintEnd,
  onZoomChange,
  zoomCommand,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /**
   * Zoom multiplier over the fitted scale, with the pan it was anchored at.
   * Kept separate from `view` so a container resize can refit the baseline
   * without discarding the user's zoom.
   */
  const [zoom, setZoom] = useState({ factor: 1, panX: 0, panY: 0 });
  const panRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null
  );
  const dragRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    startCrop: CropRect;
  } | null>(null);
  /** Screen-space cursor position, for drawing the brush outline. */
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const paintingRef = useRef(false);

  // Fit the image to the available area whenever it or the container changes.
  // This is the baseline; `view` below folds the current zoom into it.
  const [fitView, setFitView] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fit = () => {
      const { width, height } = wrap.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      const scale = Math.min(width / naturalWidth, height / naturalHeight) * 0.92;
      setFitView({
        scale,
        offsetX: (width - naturalWidth * scale) / 2,
        offsetY: (height - naturalHeight * scale) / 2,
      });
    };
    fit();
    // A new image starts fitted, never inheriting the previous one's zoom.
    setZoom({ factor: 1, panX: 0, panY: 0 });
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [naturalWidth, naturalHeight]);

  /*
   * The drawn view is the fitted baseline with zoom folded in. Derived during
   * render rather than mirrored into state: as state it lagged a frame behind
   * the zoom that produced it, so the crop box and the image disagreed for one
   * paint after every wheel tick.
   */
  const view = useMemo(
    () => ({
      scale: fitView.scale * zoom.factor,
      offsetX: fitView.offsetX * zoom.factor + zoom.panX,
      offsetY: fitView.offsetY * zoom.factor + zoom.panY,
    }),
    [fitView, zoom]
  );

  const toScreen = useCallback(
    (x: number, y: number) => ({
      x: x * view.scale + view.offsetX,
      y: y * view.scale + view.offsetY,
    }),
    [view]
  );

  // Draw image, dim the area outside the crop, then the crop frame and handles.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const { width, height } = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const drawW = naturalWidth * view.scale;
    const drawH = naturalHeight * view.scale;

    /*
     * Checkerboard behind the image, so a background-removed cutout reads as
     * transparent rather than as whatever colour the stage happens to be. It
     * is clipped to the image rect: outside that, transparent means "no image
     * here", which the plain stage already says.
     */
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.offsetX, view.offsetY, drawW, drawH);
    ctx.clip();
    const SQ = 8;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(view.offsetX, view.offsetY, drawW, drawH);
    ctx.fillStyle = '#d4d7dd';
    const cols = Math.ceil(drawW / SQ);
    const rows = Math.ceil(drawH / SQ);
    for (let row = 0; row < rows; row++) {
      for (let col = row % 2; col < cols; col += 2) {
        ctx.fillRect(view.offsetX + col * SQ, view.offsetY + row * SQ, SQ, SQ);
      }
    }
    ctx.restore();

    ctx.imageSmoothingQuality = 'high';
    /*
     * A bitmap can be closed between this effect being scheduled and running
     * -- a brush stroke swaps the cutout underneath it -- and drawing a
     * detached one throws. The next render draws the replacement, so skipping
     * this frame is the correct recovery; crashing the stage is not.
     */
    try {
      ctx.drawImage(bitmap, view.offsetX, view.offsetY, drawW, drawH);
    } catch {
      return;
    }

    const tl = toScreen(crop.x, crop.y);
    const cw = crop.width * view.scale;
    const ch = crop.height * view.scale;

    ctx.fillStyle = 'rgba(10, 12, 16, 0.62)';
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.rect(tl.x, tl.y, cw, ch);
    ctx.fill('evenodd');

    // Rule-of-thirds guides.
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(tl.x + (cw / 3) * i, tl.y);
      ctx.lineTo(tl.x + (cw / 3) * i, tl.y + ch);
      ctx.moveTo(tl.x, tl.y + (ch / 3) * i);
      ctx.lineTo(tl.x + cw, tl.y + (ch / 3) * i);
    }
    ctx.stroke();

    // The frame reads the accent from the stylesheet so it tracks the theme
    // rather than pinning a colour the tokens can no longer reach.
    const accent =
      getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#d92b2b';

    ctx.save();
    if (!cropInteractive) ctx.globalAlpha = 0.4;
    ctx.strokeStyle = accent;
    ctx.lineWidth = cropInteractive ? 2 : 1;
    ctx.strokeRect(tl.x, tl.y, cw, ch);

    // Centre crosshair: short ticks in from each edge, leaving the middle
    // clear so the subject stays visible while the crop is aligned.
    const tick = Math.min(9, cw / 6, ch / 6);
    const midX = tl.x + cw / 2;
    const midY = tl.y + ch / 2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(midX, tl.y);
    ctx.lineTo(midX, tl.y + tick);
    ctx.moveTo(midX, tl.y + ch);
    ctx.lineTo(midX, tl.y + ch - tick);
    ctx.moveTo(tl.x, midY);
    ctx.lineTo(tl.x + tick, midY);
    ctx.moveTo(tl.x + cw, midY);
    ctx.lineTo(tl.x + cw - tick, midY);
    ctx.stroke();

    // Handles are an affordance for dragging; without dragging they would be
    // a control that does nothing.
    if (cropInteractive) {
      ctx.fillStyle = accent;
      for (const [hx, hy] of [
        [tl.x, tl.y],
        [tl.x + cw, tl.y],
        [tl.x, tl.y + ch],
        [tl.x + cw, tl.y + ch],
      ]) {
        ctx.fillRect(hx - 5, hy - 5, 10, 10);
      }
    }
    ctx.restore();

    /*
     * Brush cursor: a ring at the true painting radius, so the size is read
     * off the image rather than guessed at. The native cursor is hidden while
     * painting (see onPointerMove), making this the only pointer feedback --
     * it is drawn in both black and white so it stays visible over dark hair
     * and blown-out backgrounds alike.
     */
    if (brushMode && cursor) {
      const r = Math.max(2, brushSize);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      // Erase and restore are opposite actions; colour says which is armed.
      ctx.strokeStyle = brushMode === 'erase' ? '#ff5c5c' : '#4ade80';
      ctx.stroke();
      // Centre dot, so a large brush still shows exactly where it is anchored.
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [
    bitmap,
    crop,
    view,
    naturalWidth,
    naturalHeight,
    toScreen,
    brushMode,
    brushSize,
    cursor,
    cropInteractive,
  ]);

  const hitTest = (px: number, py: number): Handle | null => {
    // One gate for every crop gesture: drag, resize, and the cursor hint.
    if (!cropInteractive) return null;
    const tl = toScreen(crop.x, crop.y);
    const cw = crop.width * view.scale;
    const ch = crop.height * view.scale;
    const corners: Array<[Handle, number, number]> = [
      ['nw', tl.x, tl.y],
      ['ne', tl.x + cw, tl.y],
      ['sw', tl.x, tl.y + ch],
      ['se', tl.x + cw, tl.y + ch],
    ];
    for (const [handle, hx, hy] of corners) {
      if (Math.abs(px - hx) <= HANDLE_HIT && Math.abs(py - hy) <= HANDLE_HIT) return handle;
    }
    if (px >= tl.x && px <= tl.x + cw && py >= tl.y && py <= tl.y + ch) return 'move';
    return null;
  };

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 12;

  /**
   * Holding space pans, the convention from every image editor. Offered
   * alongside the toolbar's Pan tool so the gesture is there for people who
   * expect it, without being the only way in.
   */
  const [spaceHeld, setSpaceHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      // Never steal space from a text field or a focused control.
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    // Releasing space in another window would otherwise leave pan stuck on.
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Current zoom for the native wheel listener, which is not re-registered
  // on every zoom change. Written in an effect rather than during render;
  // a ref mutated mid-render is not a safe read for anything else.
  const zoomRef = useRef(zoom.factor);
  useEffect(() => {
    zoomRef.current = zoom.factor;
  }, [zoom.factor]);

  /** Panning is possible only when there is something to pan to. */
  const canPan = zoom.factor > MIN_ZOOM;
  const panning = canPan && (panMode || spaceHeld);

  useEffect(() => {
    onZoomChange?.(zoom.factor);
  }, [zoom.factor, onZoomChange]);

  /**
   * Zoom about a fixed screen point, so the pixel under the cursor stays put.
   * Without the anchor, zooming in on a logo fragment walks it off screen and
   * the user has to chase it.
   */
  const zoomAt = useCallback(
    (screenX: number, screenY: number, nextFactor: number) => {
      setZoom((z) => {
        const factor = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextFactor));
        if (factor === z.factor) return z;
        // Image point currently under the anchor, in fitted (unzoomed) space.
        const curScale = fitView.scale * z.factor;
        const curX = fitView.offsetX * z.factor + z.panX;
        const curY = fitView.offsetY * z.factor + z.panY;
        const imgX = (screenX - curX) / curScale;
        const imgY = (screenY - curY) / curScale;
        // Solve the pan that keeps that point under the anchor at the new zoom.
        const panX = screenX - imgX * fitView.scale * factor - fitView.offsetX * factor;
        const panY = screenY - imgY * fitView.scale * factor - fitView.offsetY * factor;
        return factor === MIN_ZOOM ? { factor, panX: 0, panY: 0 } : { factor, panX, panY };
      });
    },
    [fitView]
  );

  /*
   * Toolbar-driven zoom, anchored at the centre of the view rather than the
   * pointer -- the pointer is over the button, not the image, when it fires.
   * Keyed by `seq` so repeat clicks of the same factor still register.
   */
  const lastCommand = useRef(-1);
  useEffect(() => {
    if (!zoomCommand || zoomCommand.seq === lastCommand.current) return;
    lastCommand.current = zoomCommand.seq;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const { width, height } = wrap.getBoundingClientRect();
    zoomAt(width / 2, height / 2, zoomCommand.factor);
  }, [zoomCommand, zoomAt]);

  /*
   * Wheel-to-zoom is bound natively rather than through React's onWheel.
   * React registers wheel listeners as passive, where preventDefault is
   * ignored -- so the page scrolled underneath the zoom and, in a scrollable
   * toolbar layout, the gesture fought the container instead of zooming.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      // Trackpads report small deltas and mice large ones; scale by a ratio so
      // both feel proportional rather than one being unusably fast.
      const step = Math.exp(-e.deltaY * 0.0015);
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, zoomRef.current * step);
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, [zoomAt]);

  /** Screen point -> natural image pixel. */
  const toNatural = (px: number, py: number) => ({
    x: (px - view.offsetX) / view.scale,
    y: (py - view.offsetY) / view.scale,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const startPan = () => {
      (e.target as Element).setPointerCapture(e.pointerId);
      panRef.current = { startX: px, startY: py, panX: zoom.panX, panY: zoom.panY };
    };

    // Middle button pans at any zoom, and is never a crop or paint gesture.
    if (e.button === 1 && canPan) {
      startPan();
      return;
    }

    // The Pan tool, or space held down.
    if (panning) {
      startPan();
      return;
    }

    /*
     * Retouch mode with no brush armed leaves the pointer unassigned. Panning
     * is the only thing left it could usefully do, so a zoomed view takes it
     * rather than the drag falling through to nothing.
     */
    if (!cropInteractive && !brushMode && canPan) {
      startPan();
      return;
    }

    // Brush mode owns the pointer; the crop box is not draggable while it is on.
    if (brushMode && onPaint) {
      (e.target as Element).setPointerCapture(e.pointerId);
      paintingRef.current = true;
      onPaintStart?.();
      const n = toNatural(px, py);
      onPaint(n.x, n.y, brushSize / view.scale);
      return;
    }

    const handle = hitTest(px, py);
    if (!handle) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    onChangeStart?.();
    dragRef.current = { handle, startX: px, startY: py, startCrop: { ...crop } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const pan = panRef.current;
    if (pan) {
      setZoom((z) => ({
        ...z,
        panX: pan.panX + (px - pan.startX),
        panY: pan.panY + (py - pan.startY),
      }));
      return;
    }

    if (panning) {
      canvas.style.cursor = panRef.current ? 'grabbing' : 'grab';
      return;
    }

    if (brushMode) {
      setCursor({ x: px, y: py });
      canvas.style.cursor = 'none';
      if (paintingRef.current && onPaint) {
        const n = toNatural(px, py);
        onPaint(n.x, n.y, brushSize / view.scale);
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag) {
      const h = hitTest(px, py);
      canvas.style.cursor = h === 'move' ? 'move' : h ? 'nwse-resize' : 'default';
      return;
    }

    const dx = (px - drag.startX) / view.scale;
    const dy = (py - drag.startY) / view.scale;

    if (drag.handle === 'move') {
      onChange(
        clampCrop(
          { ...drag.startCrop, x: drag.startCrop.x + dx, y: drag.startCrop.y + dy },
          naturalWidth,
          naturalHeight
        )
      );
      return;
    }

    // Resize from the anchored opposite corner.
    const s = drag.startCrop;
    const anchorX = drag.handle === 'nw' || drag.handle === 'sw' ? s.x + s.width : s.x;
    const anchorY = drag.handle === 'nw' || drag.handle === 'ne' ? s.y + s.height : s.y;
    const signX = drag.handle === 'ne' || drag.handle === 'se' ? 1 : -1;
    const signY = drag.handle === 'sw' || drag.handle === 'se' ? 1 : -1;

    let width = Math.max(24, s.width + signX * dx);
    let height: number;
    if (ratio === null) {
      // Free resize: each axis follows its own pointer delta.
      height = Math.max(24, s.height + signY * dy);
    } else {
      height = width / ratio;
      // Respect whichever axis the pointer pushed further.
      const byHeight = Math.max(24, s.height + signY * dy);
      if (byHeight * ratio > width) {
        height = byHeight;
        width = height * ratio;
      }
    }

    const x = signX === 1 ? anchorX : anchorX - width;
    const y = signY === 1 ? anchorY : anchorY - height;
    onChange(clampCrop({ x, y, width, height }, naturalWidth, naturalHeight));
  };

  const onPointerUp = () => {
    dragRef.current = null;
    panRef.current = null;
    if (paintingRef.current) {
      paintingRef.current = false;
      onPaintEnd?.();
    }
  };

  return (
    <div ref={wrapRef} className="cropper-wrap">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setCursor(null)}
      />
    </div>
  );
}
