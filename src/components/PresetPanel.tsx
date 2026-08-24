import type { Preset } from '../lib/types';
import { mismatchedSizes, presetRatio, ratioOf } from '../lib/types';
import { newPreset, newSize } from '../lib/presets';

interface Props {
  presets: Preset[];
  activeId: string | null;
  selectedIds: Set<string>;
  onSetPresets(presets: Preset[]): void;
  onSetActive(id: string): void;
  onToggleSelected(id: string): void;
}

export function PresetPanel({
  presets,
  activeId,
  selectedIds,
  onSetPresets,
  onSetActive,
  onToggleSelected,
}: Props) {
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
          <button onClick={() => onSetPresets([...presets, newPreset()])}>+ Preset</button>
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
        const enabledCount = preset.sizes.filter((s) => s.enabled).length;
        return (
          <div
            key={preset.id}
            className={`preset ${activeId === preset.id ? 'active' : ''}`}
            onClick={() => onSetActive(preset.id)}
          >
            <div className="preset-row">
              <input
                type="checkbox"
                checked={selectedIds.has(preset.id)}
                onChange={() => onToggleSelected(preset.id)}
                onClick={(e) => e.stopPropagation()}
                title="Include in export"
              />
              <input
                className="preset-name"
                value={preset.name}
                onChange={(e) => update(preset.id, { name: e.target.value })}
                onClick={(e) => e.stopPropagation()}
              />
              <span className="ratio-badge">{ratio.toFixed(3)}</span>
              <button
                className="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onSetPresets(presets.filter((p) => p.id !== preset.id));
                }}
                title="Delete preset"
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
                  onClick={(e) => e.stopPropagation()}
                />
              </label>
              <label>
                format
                <select
                  value={preset.format}
                  onChange={(e) => update(preset.id, { format: e.target.value as Preset['format'] })}
                  onClick={(e) => e.stopPropagation()}
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
                    onClick={(e) => e.stopPropagation()}
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
                      type="checkbox"
                      checked={size.enabled}
                      onChange={(e) =>
                        update(preset.id, {
                          sizes: preset.sizes.map((s) =>
                            s.id === size.id ? { ...s, enabled: e.target.checked } : s
                          ),
                        })
                      }
                      onClick={(e) => e.stopPropagation()}
                    />
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
                      onClick={(e) => e.stopPropagation()}
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
                      onClick={(e) => e.stopPropagation()}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        update(preset.id, { sizes: preset.sizes.filter((s) => s.id !== size.id) });
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <button
                className="add-size"
                onClick={(e) => {
                  e.stopPropagation();
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
            <div className="preset-foot">
              {enabledCount} size{enabledCount === 1 ? '' : 's'} enabled
            </div>
          </div>
        );
      })}
    </aside>
  );
}
