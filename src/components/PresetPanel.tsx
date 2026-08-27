import { DEFAULT_TEMPLATE, TEMPLATE_TOKENS, previewTemplate } from '../lib/filename';
import { useState } from 'react';
import type { OutputSize, Preset, PresetCategory } from '../lib/types';
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  isSizeEnabled,
  mismatchedSizes,
  presetRatio,
  ratioLabel,
  ratioLabelOf,
  ratioOf,
  ratiosMatch,
} from '../lib/types';
import { newPreset, newSize, type RecentSize } from '../lib/presets';

/** Extension shown in the filename preview, per format. */
const EXT_LABEL: Record<Preset['format'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

interface Props {
  presets: Preset[];
  activeId: string | null;
  onSetPresets(presets: Preset[]): void;
  onSetActive(id: string): void;
  /** Dimensions used before, most recent first. Offered in the staff section. */
  recentSizes: RecentSize[];
  /** Record a dimension as used, so it can be reused without retyping. */
  onRecordSize(width: number, height: number): void;
}

/**
 * One batch uses one preset, so the active preset IS the selection — there are
 * no checkboxes. Only the active preset expands to reveal its settings, which
 * keeps the whole list visible at a glance. Presets are grouped by category so
 * a staff photo run never has to scroll past the social library.
 */
export function PresetPanel({
  presets,
  activeId,
  onSetPresets,
  onSetActive,
  recentSizes,
  onRecordSize,
}: Props) {
  // Collapsed categories, by name. Empty by default: every group starts open,
  // and a group holding the active preset is forced open regardless, so the
  // current selection can never be hidden behind a collapsed header.
  const [collapsed, setCollapsed] = useState<Set<PresetCategory>>(new Set());

  const toggleCategory = (category: PresetCategory) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  // The new-size row is uncommitted text until it holds a usable width, so it
  // lives here rather than in the preset.
  const [draftWidth, setDraftWidth] = useState('');
  // Only Custom asks for a height; locked shapes derive it.
  const [draftHeight, setDraftHeight] = useState('');
  // Switching presets abandons a half-typed size rather than carrying it into
  // a preset it was never meant for.
  const [draftOwner, setDraftOwner] = useState(activeId);
  if (draftOwner !== activeId) {
    setDraftOwner(activeId);
    if (draftWidth || draftHeight) {
      setDraftWidth('');
      setDraftHeight('');
    }
  }

  const clearDraft = () => {
    setDraftWidth('');
    setDraftHeight('');
  };

  /**
   * Add a staff size, filing it under the group that shares its ratio.
   *
   * A crop box has one shape, so sizes are grouped by ratio and each group is
   * framed once. A size at a ratio no group holds gets a new one — named for
   * the ratio, selected so it can be framed straight away.
   */
  const addStaffSize = (width: number, height: number) => {
    const w = Math.round(width);
    const h = Math.round(height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return;
    onRecordSize(w, h);

    const ratio = w / h;
    const group = presets.find(
      (p) => p.category === 'photo' && ratiosMatch(presetRatio(p), ratio)
    );

    if (group) {
      if (group.sizes.some((s) => s.width === w && s.height === h)) {
        onSetActive(group.id);
        return;
      }
      onSetPresets(
        presets.map((p) => (p.id === group.id ? { ...p, sizes: [...p.sizes, newSize(w, h)] } : p))
      );
      onSetActive(group.id);
      return;
    }

    // No group at this ratio yet — start one. The suffix keeps exported
    // filenames distinguishable between groups.
    const created = newPreset('photo');
    const label = ratioLabelOf(ratio);
    const next: Preset = {
      ...created,
      name: label,
      suffix: label.replace(':', 'x'),
      sizes: [newSize(w, h)],
    };
    /*
     * Drop any crop left empty by removing its last size. One is kept while it
     * is the only crop in the section -- something has to hold the Add-a-size
     * box -- and swept up here, once this new crop can take its place.
     */
    const kept = presets.filter((p) => p.category !== 'photo' || p.sizes.length > 0);
    onSetPresets([...kept, next]);
    onSetActive(next.id);
  };

  /** Append a dimension to a non-staff preset and remember it for reuse. */
  const addSizeTo = (preset: Preset, width: number, height: number) => {
    const w = Math.round(width);
    const h = Math.round(height);
    const exists = preset.sizes.some((s) => s.width === w && s.height === h);
    if (!exists) {
      onSetPresets(
        presets.map((p) => (p.id === preset.id ? { ...p, sizes: [...p.sizes, newSize(w, h)] } : p))
      );
    }
    onRecordSize(w, h);
  };

  /**
   * Turn the draft into a real size. A width is required. Custom supplies its
   * own height; locked shapes derive one from their ratio. Called on Enter and
   * on blur, so a typed value is never silently lost by clicking away.
   */
  const commitDraft = (preset: Preset, ratio: number) => {
    const width = Number(draftWidth);
    if (!draftWidth || !Number.isFinite(width) || width < 1) {
      clearDraft();
      return;
    }
    // A typed height (Custom only) wins; otherwise the shape's ratio decides.
    const typed = Number(draftHeight);
    const height =
      draftHeight && Number.isFinite(typed) && typed >= 1
        ? Math.round(typed)
        : Math.max(1, Math.round(width / ratio));
    addSizeTo(preset, width, height);
    clearDraft();
  };

  const update = (id: string, patch: Partial<Preset>) =>
    onSetPresets(presets.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  /**
   * Remove one size, and the crop it belonged to when it was the last one.
   *
   * A staff crop exists to hold sizes at a ratio, so an empty one is not a
   * thing to keep -- it was previously impossible to remove either, since the
   * last size was locked and the staff section has no delete button. That
   * stranded any group left holding a single size, including the duplicate
   * ratio groups an earlier merge bug produced.
   *
   * The very last crop in the section is kept: with none at all there is
   * nothing to frame or add a size to.
   */
  /**
   * Fold another crop at the same ratio into this one.
   *
   * Offered rather than done automatically: doing it on load is what destroyed
   * user-named presets before. Two crops at one ratio are legitimate -- the
   * same shape exported under two suffixes -- so this only happens when asked.
   *
   * The target keeps its identity, so its framing is preserved; the other's
   * sizes come across, minus any duplicates.
   */
  const mergeInto = (target: Preset, source: Preset) => {
    const additions = source.sizes.filter(
      (s) => !target.sizes.some((t) => t.width === s.width && t.height === s.height)
    );
    const merged = presets
      .map((p) =>
        p.id === target.id ? { ...p, sizes: [...p.sizes, ...additions] } : p
      )
      .filter((p) => p.id !== source.id);
    onSetPresets(merged);
    if (activeId === source.id) onSetActive(target.id);
  };

  const removeSize = (preset: Preset, sizeId: string) => {
    const remaining = preset.sizes.filter((s) => s.id !== sizeId);
    if (remaining.length > 0) {
      update(preset.id, { sizes: remaining });
      return;
    }
    const siblings = presets.filter(
      (p) => p.category === preset.category && p.id !== preset.id
    );
    if (siblings.length === 0) {
      // The only crop left: emptied rather than removed, so the section still
      // has something to add a size to. addStaffSize sweeps it up once another
      // crop exists.
      update(preset.id, { sizes: remaining });
      return;
    }
    onSetPresets(presets.filter((p) => p.id !== preset.id));
    if (activeId === preset.id) onSetActive(siblings[0].id);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'framewise-presets.json';
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

  /**
   * The settings every preset shares: filename suffix, format, fit, and the
   * quality/padding/background controls those imply. Shared by the staff
   * section and the preset list.
   */
  const renderPresetSettings = (preset: Preset) => {
    const isContain = preset.fit === 'contain';
    return (
      <div className="preset-meta">
        <label>
          suffix
          <input
            value={preset.suffix}
            onChange={(e) => update(preset.id, { suffix: e.target.value })}
          />
        </label>
        <label className="template-field">
          filename
          <input
            value={preset.filenameTemplate ?? DEFAULT_TEMPLATE}
            onChange={(e) => update(preset.id, { filenameTemplate: e.target.value })}
            spellCheck={false}
            placeholder={DEFAULT_TEMPLATE}
          />
          {/*
            * A worked example rather than a list of rules: the tokens are only
            * meaningful once you can see what they produce, and a template is
            * easy to get subtly wrong (a missing brace renders literally).
            */}
          <span className="template-preview" title="Example output">
            {previewTemplate(
              preset.filenameTemplate ?? DEFAULT_TEMPLATE,
              preset,
              EXT_LABEL[preset.format]
            )}
          </span>
          <span className="template-tokens">
            {TEMPLATE_TOKENS.map((t) => (
              <button
                key={t.token}
                type="button"
                className="token-chip"
                title={t.description}
                onClick={() =>
                  update(preset.id, {
                    filenameTemplate: (preset.filenameTemplate ?? DEFAULT_TEMPLATE) + t.token,
                  })
                }
              >
                {t.token}
              </button>
            ))}
          </span>
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
        <label>
          fit
          <select
            value={preset.fit}
            onChange={(e) => update(preset.id, { fit: e.target.value as Preset['fit'] })}
          >
            <option value="cover">Crop to fill</option>
            <option value="contain">Fit whole image</option>
          </select>
        </label>
        {/*
          * Background removal lives on the stage ("Remove background"), not
          * here: it is a per-image call -- some photos in a run are shot on a
          * plain wall and need nothing -- and it wants the live preview and the
          * retouch brushes, which a preset checkbox can't offer.
          */}
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
        {isContain && (
          <>
            <label>
              padding {Math.round((preset.padding ?? 0) * 100)}%
              <input
                type="range"
                min={0}
                max={40}
                value={Math.round((preset.padding ?? 0) * 100)}
                onChange={(e) => update(preset.id, { padding: Number(e.target.value) / 100 })}
              />
            </label>
            <label className="bg-field">
              background
              <span className="bg-controls">
                <input
                  type="color"
                  value={
                    preset.background && preset.background !== 'transparent'
                      ? preset.background
                      : '#ffffff'
                  }
                  onChange={(e) => update(preset.id, { background: e.target.value })}
                  disabled={preset.background === 'transparent'}
                />
                <span className="check">
                  <input
                    type="checkbox"
                    checked={preset.background === 'transparent'}
                    onChange={(e) =>
                      update(preset.id, {
                        background: e.target.checked ? 'transparent' : '#ffffff',
                      })
                    }
                  />
                  none
                </span>
              </span>
            </label>
          </>
        )}
      </div>
    );
  };

  /**
   * One dimension cell. Shared by the staff section and the preset list so a
   * size behaves identically wherever it is shown.
   */
  const renderSizeCell = (preset: Preset, size: OutputSize, _sizeIndex: number, ratio: number) => {
    const isContain = preset.fit === 'contain';
    const bad = isContain ? [] : mismatchedSizes(preset);
    const ok = !bad.includes(size);
    return (
      <div
        key={size.id}
        className={`size ${ok ? '' : 'mismatch'}`}
        title={size.label || undefined}
      >
        {/*
          * A committed size is a value, not a field: click to include it in
          * the export or leave it out. Editing in place invited the shape to
          * be redefined a digit at a time; the row at the top of the list is
          * the one place anything is typed.
          */}
        <button
          className="size-pick"
          aria-pressed={isSizeEnabled(size)}
          title={
            isSizeEnabled(size)
              ? `${size.width}×${size.height} will be exported — click to skip it`
              : `${size.width}×${size.height} is skipped — click to include it`
          }
          onClick={() =>
            update(preset.id, {
              sizes: preset.sizes.map((s) =>
                s.id === size.id ? { ...s, enabled: !isSizeEnabled(s) } : s
              ),
            })
          }
        >
          {size.width}
          <span className="size-x">×</span>
          {size.height}
        </button>
        {size.label && <span className="size-label">{size.label}</span>}
        {!ok && (
          <span
            className="warn"
            title={`Ratio ${ratioOf(size).toFixed(3)} differs from the preset ratio ${ratio.toFixed(3)} — this size will be distorted.`}
          >
            !
          </span>
        )}
        {/*
          * Overlaid on the chip's top-right corner rather than sitting beside
          * it: as a sibling it reserved 17px on every chip, which is most of a
          * third column's worth of width across the list.
          */}
        <button
          className="size-remove"
          onClick={() => removeSize(preset, size.id)}
          title={
            preset.sizes.length === 1
              ? `Remove ${size.width}×${size.height} and this crop`
              : `Remove ${size.width}×${size.height}`
          }
          aria-label={`Remove ${size.width}×${size.height}`}
        >
          ×
        </button>
      </div>
    );
  };

  /**
   * Staff photos are chosen by shape, not from a catalogue: pick Square,
   * Portrait, or Custom, then type the dimensions you want. Each shape is
   * still a preset underneath, so each keeps its own crop and switching shape
   * reframes instead of stretching the last crop into a new ratio.
   */
  /**
   * Staff photos: one list of sizes, typed in directly.
   *
   * There are no shapes to pick. Sizes are grouped by ratio underneath — a
   * crop box has exactly one shape — and each group is framed separately, so
   * the list shows which crop a size belongs to and lets you switch between
   * them. Adding a size at a new ratio creates its group on the spot.
   */
  const renderStaffSection = (group: Preset[]) => {
    const active = group.find((p) => p.id === activeId) ?? group[0];
    if (!active) return null;

    const widthNum = Number(draftWidth);
    const heightNum = Number(draftHeight);
    const canAdd =
      !!draftWidth && !!draftHeight && widthNum >= 1 && heightNum >= 1;
    const draftRatioLabel = canAdd ? ratioLabelOf(widthNum / heightNum) : null;

    const submit = () => {
      if (!canAdd) {
        clearDraft();
        return;
      }
      addStaffSize(widthNum, heightNum);
      clearDraft();
    };

    return (
      <div className="staff">
        {/*
          * Settings first.
          *
          * They belong to the crop being edited and are what a run is usually
          * adjusting -- suffix, filename, format. Below the size groups they
          * sat past a scroll, so changing a filename template meant scrolling
          * past every size in every group to reach it.
          */}
        {renderPresetSettings(active)}

        {/* Both dimensions are typed. A size IS its ratio, so asking for one
            and deriving the other would just be picking a shape again. */}
        <div className="custom-entry">
          <label className="custom-label" htmlFor={`staff-w-${active.id}`}>
            Add a size
          </label>
          <div className="custom-row">
            <input
              id={`staff-w-${active.id}`}
              type="number"
              className="custom-w"
              value={draftWidth}
              placeholder="width"
              aria-label="Width"
              min={1}
              onChange={(e) => setDraftWidth(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') clearDraft();
              }}
            />
            <span className="size-x">×</span>
            <input
              type="number"
              className="custom-w"
              value={draftHeight}
              placeholder="height"
              aria-label="Height"
              min={1}
              onChange={(e) => setDraftHeight(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') clearDraft();
              }}
            />
            <button className="custom-add primary" disabled={!canAdd} onClick={submit}>
              Add
            </button>
          </div>
          {/* Says where the size will land before it is added, so a new crop
              group is never a surprise. */}
          {draftRatioLabel && (
            <p className="custom-hint">
              {group.some((p) => ratiosMatch(presetRatio(p), widthNum / heightNum))
                ? `Joins the ${draftRatioLabel} crop`
                : `Starts a new ${draftRatioLabel} crop`}
            </p>
          )}
        </div>

        {/*
          * Recent sizes sit directly above the crops, as part of adding a
          * size rather than as a footnote after the list.
          *
          * Always rendered, and sizes already in this crop are shown disabled
          * rather than dropped. Filtering them out meant the row silently
          * changed shape as sizes were added, and a size vanishing right after
          * being clicked read as it having been lost.
          */}
        {recentSizes.length > 0 && (
          <div className="recents">
            <span className="recents-label">Recent</span>
            <div className="recent-chips">
              {recentSizes.map((r) => {
                const already = active.sizes.some(
                  (sz) => sz.width === r.width && sz.height === r.height
                );
                return (
                  <button
                    key={`${r.width}x${r.height}`}
                    className={`chip ${already ? 'used' : ''}`}
                    disabled={already}
                    title={
                      already
                        ? `${r.width}×${r.height} is already in this crop`
                        : `Add ${r.width}×${r.height}`
                    }
                    onClick={() => addStaffSize(r.width, r.height)}
                  >
                    {r.width}×{r.height}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/*
          * One list, split by crop. Each heading is a crop you frame once.
          *
          * Ordered active crop, then the ones the user named, then the
          * auto-generated ratio groups. A named crop was deliberate and is
          * worth more than a group that appeared because a size at a new ratio
          * was typed, and the active one has to be reachable without hunting.
          *
          * Only the active crop shows its sizes. Expanded, every group at once
          * pushed the panel past a scroll and buried whatever was being
          * worked on; collapsed, the count on each heading still says what is
          * inside without opening it.
          */}
        {[...group]
          .sort((a, b) => {
            if (a.id === active.id) return -1;
            if (b.id === active.id) return 1;
            const aNamed = a.name !== ratioLabel(a);
            const bNamed = b.name !== ratioLabel(b);
            if (aNamed !== bNamed) return aNamed ? -1 : 1;
            return 0;
          })
          .map((preset) => {
          const ratio = presetRatio(preset);
          const isActive = preset.id === active.id;
          return (
            <div key={preset.id} className={`crop-group ${isActive ? 'on' : 'collapsed'}`}>
              <button
                className="crop-group-head"
                aria-pressed={isActive}
                title={
                  isActive
                    ? `Framing the ${preset.name} crop`
                    : `Switch to the ${preset.name} crop`
                }
                onClick={() => onSetActive(preset.id)}
              >
                {/*
                  * Auto-generated groups are named for their ratio, so showing
                  * the ratio names them correctly. A preset the user named is
                  * shown by that name with the ratio beside it: two custom
                  * groups at the same ratio were otherwise both just "1:1",
                  * with nothing to tell them apart.
                  */}
                {preset.name === ratioLabel(preset) ? (
                  <span className="crop-ratio">{ratioLabel(preset)}</span>
                ) : (
                  <span className="crop-ratio">
                    {preset.name}
                    <span className="crop-ratio-note">{ratioLabel(preset)}</span>
                  </span>
                )}
                <span className="crop-count">
                  {preset.sizes.filter(isSizeEnabled).length}/{preset.sizes.length}
                </span>
              </button>
              {isActive && (
                <>
                  <div className="sizes">
                    {preset.sizes.map((size, sizeIndex) =>
                      renderSizeCell(preset, size, sizeIndex, ratio)
                    )}
                  </div>
                  {/*
                    * Two crops at one ratio are framed twice and exported
                    * twice from the same shape. Usually that is a leftover
                    * rather than an intent, but it can be deliberate -- the
                    * same crop under two suffixes -- so merging is offered
                    * here instead of being done silently on load.
                    */}
                  {(() => {
                    const twins = group.filter(
                      (p) => p.id !== preset.id && ratiosMatch(presetRatio(p), ratio)
                    );
                    if (twins.length === 0) return null;
                    return (
                      <p className="merge-hint">
                        {`Also at ${ratioLabel(preset)}: `}
                        {twins.map((t, i) => (
                          <span key={t.id}>
                            {i > 0 && ', '}
                            <button
                              className="merge-link"
                              onClick={() => mergeInto(preset, t)}
                              title={`Move ${t.name}'s sizes into this crop and remove it`}
                            >
                              {`merge ${t.name}`}
                            </button>
                          </span>
                        ))}
                      </p>
                    );
                  })()}
                </>
              )}
            </div>
          );
        })}


      </div>
    );
  };

  const renderPreset = (preset: Preset) => {
    const ratio = presetRatio(preset);
    const isContain = preset.fit === 'contain';
    // A contain preset letterboxes rather than crops, so a differing ratio is
    // expected and never a distortion warning.
    const bad = isContain ? [] : mismatchedSizes(preset);
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
            {bad.length > 0 && (
              <span className="warn" title="Some sizes do not match this preset's ratio.">
                {' '}
                !
              </span>
            )}
          </span>
          {/* The list states the shape; the expanded preset states the
              exact figure. A row is for recognising a preset, not measuring
              it. */}
          <span
            className={`ratio-badge ${isContain ? 'fit-badge' : ''}`}
            title={isContain ? undefined : `Aspect ratio ${ratio.toFixed(3)}`}
          >
            {isContain ? 'fit' : ratioLabel(preset)}
          </span>
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
          <span className={`ratio-badge ${isContain ? 'fit-badge' : ''}`}>
            {isContain ? 'fit' : ratio.toFixed(3)}
          </span>
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

        {renderPresetSettings(preset)}

        {isContain && preset.background === 'transparent' && preset.format === 'image/jpeg' && (
          <p className="preset-note warn-note">
            JPG has no transparency — these export on white. Switch to PNG or WebP to keep it.
          </p>
        )}

        <div className="sizes">
          {/*
            * Adding a size starts here rather than at a button after the list:
            * typing IS the add action. The old "+ size" button appended a copy
            * of the first width that then had to be selected and overwritten.
            *
            * Both fields are offered and both are optional: fill only the
            * width and the height follows the preset ratio; fill both to add a
            * size at a shape of your own.
            */}
          <div className="size size-new">
            <input
              type="number"
              value={draftWidth}
              placeholder="w"
              aria-label={`Add a size to ${preset.name} — width`}
              title="Type a width, then press Enter. The height follows the preset ratio."
              min={1}
              onChange={(e) => setDraftWidth(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitDraft(preset, ratio);
                if (e.key === 'Escape') clearDraft();
              }}
              onBlur={() => commitDraft(preset, ratio)}
            />
            <span className="size-x">×</span>
            {/* Height is shown, not asked for: the preset's ratio decides it. */}
            <span className="size-derived" title={`Height follows the ${ratio.toFixed(3)} ratio`}>
              {draftWidth && Number(draftWidth) > 0
                ? Math.max(1, Math.round(Number(draftWidth) / ratio))
                : 'h'}
            </span>
          </div>
          {preset.sizes.map((size, sizeIndex) =>
            renderSizeCell(preset, size, sizeIndex, ratio)
          )}
        </div>
      </div>
    );
  };

  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>
          <span className="idx">01</span>
          Presets
        </h2>
        <div className="panel-actions">
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

      <div className="panel-scroll">
        {CATEGORY_ORDER.map((category: PresetCategory, categoryIndex: number) => {
          const group = presets.filter((p) => p.category === category);
          if (group.length === 0) return null;
          // The group holding the active preset cannot be collapsed: hiding
          // the preset the next export will use would leave no indication of
          // what is selected. Its toggle is disabled and says why, rather
          // than silently refusing the click.
          const holdsActive = group.some((p) => p.id === activeId);
          const isOpen = !collapsed.has(category) || holdsActive;
          const bodyId = `preset-group-${category}`;
          return (
            <section key={category} className={`preset-group ${isOpen ? '' : 'collapsed'}`}>
              <div className="group-head">
                <button
                  className="group-toggle"
                  aria-expanded={isOpen}
                  // aria-controls is only set while the body exists: a
                  // collapsed group unmounts its list, and pointing at a
                  // missing id is an invalid reference. aria-expanded alone
                  // carries the state.
                  aria-controls={isOpen ? bodyId : undefined}
                  onClick={() => toggleCategory(category)}
                  disabled={holdsActive}
                  title={
                    holdsActive
                      ? 'This category holds the active preset'
                      : isOpen
                        ? 'Collapse this category'
                        : 'Expand this category'
                  }
                >
                  <span className="idx">{String.fromCharCode(65 + categoryIndex)}</span>
                  <h3>{CATEGORY_LABEL[category]}</h3>
                  <span className="group-count">
                    {group.length} preset{group.length === 1 ? '' : 's'}
                  </span>
                  <Chevron open={isOpen} />
                </button>
                {/*
                  * Staff photos have no "add preset" action: you add a size,
                  * and its ratio decides which crop group it joins. Offering
                  * "+" here created a blank 400x400 preset on every click,
                  * stacking duplicate 1:1 groups the grouping exists to avoid.
                  */}
                {category !== 'photo' && (
                  <button
                    className="ghost group-add"
                    title={`Add a ${CATEGORY_LABEL[category].toLowerCase()} preset`}
                    onClick={() => {
                      const created = newPreset(category);
                      // Adding to a collapsed group must reveal what it added.
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        next.delete(category);
                        return next;
                      });
                      onSetPresets([...presets, created]);
                      onSetActive(created.id);
                    }}
                  >
                    +
                  </button>
                )}
              </div>
              {isOpen && (
                <div id={bodyId}>
                  {category === 'photo' ? renderStaffSection(group) : group.map(renderPreset)}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

/**
 * A hard-edged caret rather than a rotating arrow glyph: straight strokes and
 * right angles match the square-cell language used elsewhere in the panel.
 */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`chevron${open ? ' open' : ''}`}
      width="9"
      height="9"
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <path d="M1.5 3.5 5 7 8.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
