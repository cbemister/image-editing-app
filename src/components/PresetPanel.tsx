import type { Preset } from '../lib/types';
import { mismatchedSizes, presetRatio, ratioOf } from '../lib/types';
import { newPreset, newSize } from '../lib/presets';

interface Props {
  presets: Preset[];
  activeId: string | null;
  onSetPresets(presets: Preset[]): void;
  onSetActive(id: string): void;
}

/**
 * One batch uses one preset, so the active preset IS the selection — there are
 * no checkboxes. Only the active preset expands to reveal its settings, which
 * keeps the whole list visible at a glance.
 */
export function PresetPanel({ presets, activeId, onSetPresets, onSetActive }: Props) {
  const update = (id: string, patch: Partial<Preset>) =>
    onSetPresets(presets.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'crop-presets.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (Array.isArray(parsed) && parsed.length) onSetPresets(parsed);
    } catch {
      alert('That file is not a valid preset export.');
    }
  };

  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>Presets</h2>
        <div className="panel-actions">
          <button onClick={() => onSetPresets([...presets, newPreset()])} title="Add a preset">
            +
          </button>
          <button onClick={exportJson} title="Export presets as JSON">
            Save
          </button>
          <label className="file-btn" title="Import presets from JSON">
            Load
            <input
              type="file"
              accept="application/json"
              onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
            />
          </label>
        </div>
      </div>

      {presets.map((preset) => {
        const ratio = presetRatio(preset);
        const bad = mismatchedSizes(preset);
        const isActive = activeId === preset.id;

        // Collapsed: a one-line summary of what this preset would export.
        if (!isActive) {
          return (
            <button
              key={preset.id}
              className="preset-row-collapsed"
              onClick={() => onSetActive(preset.id)}
            >
              <span className="preset-row-name">{preset.name}</span>
              <span className="preset-row-meta">
                {preset.sizes.length} size{preset.sizes.length === 1 ? '' : 's'}
                {bad.length > 0 && <span className="warn" title="Some sizes do not match this preset's ratio."> !</span>}
              </span>
              <span className="ratio-badge">{ratio.toFixed(3)}</span>
            </button>
          );
        }

        return (
          <div key={preset.id} className="preset active">
            <div className="preset-row">
              <input
                className="preset-name"
                value={preset.name}
                onChange={(e) => update(preset.id, { name: e.target.value })}
              />
              <span className="ratio-badge">{ratio.toFixed(3)}</span>
              <button
                className="danger"
                onClick={() => {
                  const next = presets.filter((p) => p.id !== preset.id);
                  onSetPresets(next);
                  if (next.length) onSetActive(next[0].id);
                }}
                title="Delete preset"
                disabled={presets.length === 1}
              >
                ×
              </button>
            </div>

            <div className="preset-meta">
              <label>
                suffix
                <input
                  value={preset.suffix}
                  onChange={(e) => update(preset.id, { suffix: e.target.value })}
                />
              </label>
              <label>
                format
                <select
                  value={preset.format}
                  onChange={(e) => update(preset.id, { format: e.target.value as Preset['format'] })}
                >
                  <option value="image/jpeg">JPG</option>
                  <option value="image/png">PNG</option>
                  <option value="image/webp">WebP</option>
                </select>
              </label>
              {preset.format !== 'image/png' && (
                <label>
                  quality {Math.round(preset.quality * 100)}
                  <input
                    type="range"
                    min={40}
                    max={100}
                    value={Math.round(preset.quality * 100)}
                    onChange={(e) => update(preset.id, { quality: Number(e.target.value) / 100 })}
                  />
                </label>
              )}
            </div>

            <div className="sizes">
              {preset.sizes.map((size) => {
                const ok = !bad.includes(size);
                return (
                  <div key={size.id} className={`size ${ok ? '' : 'mismatch'}`}>
                    <input
                      type="number"
                      value={size.width}
                      onChange={(e) =>
                        update(preset.id, {
                          sizes: preset.sizes.map((s) =>
                            s.id === size.id ? { ...s, width: Number(e.target.value) } : s
                          ),
                        })
                      }
                    />
                    <span>×</span>
                    <input
                      type="number"
                      value={size.height}
                      onChange={(e) =>
                        update(preset.id, {
                          sizes: preset.sizes.map((s) =>
                            s.id === size.id ? { ...s, height: Number(e.target.value) } : s
                          ),
                        })
                      }
                    />
                    {!ok && (
                      <span
                        className="warn"
                        title={`Ratio ${ratioOf(size).toFixed(3)} differs from the preset ratio ${ratio.toFixed(3)} — this size will be distorted.`}
                      >
                        !
                      </span>
                    )}
                    <button
                      className="danger"
                      onClick={() =>
                        update(preset.id, { sizes: preset.sizes.filter((s) => s.id !== size.id) })
                      }
                      title="Remove size"
                      disabled={preset.sizes.length === 1}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <button
                className="add-size"
                onClick={() => {
                  const first = preset.sizes[0];
                  const w = first ? first.width : 400;
                  update(preset.id, {
                    sizes: [...preset.sizes, newSize(w, Math.round(w / ratio))],
                  });
                }}
              >
                + size
              </button>
            </div>
          </div>
        );
      })}
    </aside>
  );
}
