import type { ExportItem } from './export';

interface FileSystemHandleLike {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}
interface DirectoryHandleLike {
  name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemHandleLike>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleLike>;
  }
}

export function hasDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function pickOutputDirectory(): Promise<DirectoryHandleLike | null> {
  if (!hasDirectoryPicker()) return null;
  try {
    return await window.showDirectoryPicker!({ mode: 'readwrite' });
  } catch {
    return null; // User cancelled.
  }
}

/** Write items straight into a chosen folder. */
export async function writeToDirectory(
  dir: DirectoryHandleLike,
  items: ExportItem[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  let done = 0;
  for (const item of items) {
    const handle = await dir.getFileHandle(item.filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(item.blob);
    await writable.close();
    onProgress?.(++done, items.length);
  }
}

/** Fallback for browsers without the directory picker: download one by one. */
export async function downloadItems(
  items: ExportItem[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  let done = 0;
  for (const item of items) {
    const url = URL.createObjectURL(item.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    onProgress?.(++done, items.length);
    // Browsers throttle rapid successive downloads; space them out.
    await new Promise((r) => setTimeout(r, 120));
  }
}

export type { DirectoryHandleLike };
