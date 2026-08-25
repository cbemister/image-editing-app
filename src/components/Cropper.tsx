import { useCallback, useEffect, useRef, useState } from 'react';
import type { CropRect } from '../lib/types';
import { clampCrop } from '../lib/crop';

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'move';

interface Props {
  bitmap: ImageBitmap;
  naturalWidth: number;
  naturalHeight: number;
  /** Locked aspect ratio, or null to resize freely (contain presets). */
  ratio: number | null;
  crop: CropRect;
  onChange(crop: CropRect): void;
}

const HANDLE_HIT = 14;

export function Cropper({ bitmap, naturalWidth, naturalHeight, ratio, crop, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const dragRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    startCrop: CropRect;
  } | null>(null);

  // Fit the image to the available area whenever it or the container changes.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fit = () => {
      const { width, height } = wrap.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      const scale = Math.min(width / naturalWidth, height / naturalHeight) * 0.92;
      setView({
        scale,
        offsetX: (width - naturalWidth * scale) / 2,
        offsetY: (height - naturalHeight * scale) / 2,
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [naturalWidth, naturalHeight]);

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

    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      bitmap,
      view.offsetX,
      view.offsetY,
      naturalWidth * view.scale,
      naturalHeight * view.scale
    );

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

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
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

    ctx.fillStyle = accent;
    for (const [hx, hy] of [
      [tl.x, tl.y],
      [tl.x + cw, tl.y],
      [tl.x, tl.y + ch],
      [tl.x + cw, tl.y + ch],
    ]) {
      ctx.fillRect(hx - 5, hy - 5, 10, 10);
    }
  }, [bitmap, crop, view, naturalWidth, naturalHeight, toScreen]);

  const hitTest = (px: number, py: number): Handle | null => {
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

  const onPointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const handle = hitTest(px, py);
    if (!handle) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { handle, startX: px, startY: py, startCrop: { ...crop } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

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
  };

  return (
    <div ref={wrapRef} className="cropper-wrap">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
}
