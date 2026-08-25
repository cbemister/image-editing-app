# Framewise Design System — Grid System

**Direction:** A rigorously structured, grid-governed UI — hairline-to-thick rule hierarchy, editorial numbering (01, A, 02...), square corners everywhere, a single signal-red accent on a stark black/white base.
**Personality:** Disciplined, systematic, confident, editorial
**Emotion:** "Nothing here is arbitrary" — every rule, gap, and label communicates structure. Feels like a well-run design system, not a themed skin.
**Audience:** Users who value clarity and legibility over warmth or flourish — teams that would recognize and appreciate a Swiss-grid design language (agencies, publishing-adjacent brand teams, technically literate design leads).

---

## 1. Design Philosophy & Inspiration

### Core Principles
1. **The grid is visible, and weighted.** Rules separate every structural region, but not all rules are equal: a three-tier weight system (`--rule-1` 3px / `--rule-2` 2px / `--rule-3` 1px) maps directly to app-shell / section / row boundaries. Nothing floats; everything sits in a cell, and the cell's rank is readable from its edge alone.
2. **Zero corner radius.** Every element — buttons, badges, cards, inputs — is a hard rectangle. This is the most structurally distinct choice among all five concepts.
3. **Numbering as navigation.** Panel and section headers carry explicit numbers/letters (`01 — Presets`, category `A/B/C`, showcase `02`/`03`) — an editorial-index device that makes the hierarchy legible without relying on color or size alone.
4. **One accent, used as a stamp.** Signal red appears only on primary actions, the active preset's left bar, and the crop frame — everywhere else is pure black/white/grey, so red reads as "this is the thing that matters right now."
5. **Type carries the personality, not color.** Archivo Expanded (a wide, confident grotesque) for headings gives this concept its character — where other concepts lean on palette or blur, this one leans on typography and rule-weight.

### Inspiration Sources
- Swiss International Typographic Style (Müller-Brockmann grid posters)
- Are.na's editorial index pages
- Bloomberg Terminal's information density with a redesigned type system
- Praxis/Dieter Rams-era product graphics (functional, gridded, unornamented)
- The Guardian's editorial digital design system (rule hierarchy, mono for data)

### What Makes This NOT AI-Generated
- Zero border-radius is a *hard* constraint applied everywhere without exception — most "clean/modern" output defaults to soft 6–12px radii; committing to true 0px on every element (including badges, usually the first thing to get a pill shape) is a specific, unusual choice.
- Explicit editorial numbering (chipped `01 —`, `A`, `02`) is a structural device, not a cosmetic label — very few generated UIs bother with a real indexing system.
- Archivo Expanded — a wide-set grotesque used *only* for headings/brand, paired with standard-width Archivo for body — a specific two-width pairing within one type family, not a generic font swap.
- Buttons in the topbar and toolbar butt directly against each other with only a 1–2px rule between them (no gap, no padding-as-separation) — deliberately rejects the "everything gets breathing room" instinct common to generated UI.
- The showcase and swatch sections are boxed in a literal ruled grid (`border` + internal dividers) rather than floating cards with shadows — reinforces the "this is a system, not a set of decorated widgets" premise all the way to the documentation page itself.
- Signal red (`#d92b2b`) is a specific warm red chosen to read as "stamp/alert ink" against true black — not a rounded, softened red like Tailwind's `red-500`.

---

## 2. Complete Color Palette

### Design Rationale
Starting from true black-on-white (light) and near-black-on-near-white (dark, inverted) maximizes the contrast the grid rules need to read clearly at 1–2px weights. Red is reserved tightly — used on primary buttons, the active preset's accent bar, and the crop frame — so it always means "primary/active," never decoration. Ink-blue is the sole secondary, used only for "fit" badges.

### Light Mode (default)
| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#ffffff` | App background |
| `--panel-2` | `#f2f2f0` | Active preset background |
| `--line` | `#17171a` | Structural rules (2px) |
| `--line-soft` | `#d4d4d0` | Secondary dividers (1px) |
| `--text` | `#17171a` | Primary text |
| `--text-dim` | `#4a4a4e` | Secondary text |
| `--muted` | `#86868c` | Tertiary/meta |
| `--accent` | `#d92b2b` | Primary actions, active bar, crop frame |
| `--accent-fg` | `#ffffff` | Text on accent |
| `--ink-blue` | `#1f3ac4` | "Fit" badge only |
| `--danger` | `#d92b2b` | Same as accent — one signal color for both |

### Dark Mode
Dark mode is *not* a straight inversion. Two corrections matter: the background sits off true black to reduce halation, and `--line` is a **muted grey**, not the text color — an early version set `--line` equal to `--text` (`#f2f2f0`), which made every 2–3px structural rule shout as loudly as a headline and destroyed the very hierarchy the rule tiers exist to create.

| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#18181a` | App background — off true black |
| `--panel` | `#1a1a1c` | Panel surfaces |
| `--line` | `#a8a8ac` | Structural rules — muted grey, deliberately *below* text contrast |
| `--line-soft` | `#38383c` | Secondary dividers |
| `--text` | `#e4e4e6` | Primary text — pulled off pure white |
| `--accent` | `#e35555` | Softened red for dark contrast |
| `--accent-fg` | `#18181a` | Text on accent |
| `--ink-blue` | `#6b7dff` | "Fit" badge only |

### Contrast Verification
| Combination | Ratio | Result |
|---|---|---|
| `--text` on `--bg` (light) | 17.9:1 | AAA |
| `--accent-fg` on `--accent` (light) | 5.3:1 | AA |
| `--line` on `--bg` (light) | 17.9:1 | Structural rules always max-contrast by design |
| `--text` on `--bg` (dark) | 14.1:1 | AAA |
| `--accent-fg` (`#18181a`) on `--accent` (dark) | 6.2:1 | AA |
| `--line` on `--bg` (dark) | 7.4:1 | Structural — intentionally below text contrast |

### Tailwind/CSS Configuration
Vanilla CSS custom properties. Notably, `--r` (radius) is defined as `0px` and never overridden — every component explicitly sets `border-radius: 0` rather than omitting it, so the "no radius" rule is self-documenting in the CSS itself.

---

## 3. Typography System

### Font Choices & Rationale
- **Archivo Expanded** (700 only) — brand wordmark, panel titles, preset names, section headings. Wide-set and confident; carries the "editorial system" personality on its own.
- **Archivo** (400–900) — all other UI text, body, buttons. Same type family as the expanded cut, different width — a genuine "one family, two widths" system rather than an arbitrary pairing.
- **Roboto Mono** — every measured value: ratios, dimensions, size inputs, status bar. Reinforces "this number is exact" against the structural system around it.

### Type Scale
| Style | Font | Size | Weight | Usage |
|---|---|---|---|---|
| Brand | Archivo Expanded | 15px | 700 | "Framewise" (uppercase) |
| Panel title | Archivo Expanded | 12px | 700 | "01 — Presets" (uppercase) |
| Preset name (active) | Archivo Expanded | 15px | 700 | Editable preset title (uppercase) |
| Group label | Archivo | 10.5px | 700 | "A — Staff Photos" (uppercase) |
| Body/buttons | Archivo | 11.5px | 600 | Uppercase, letter-spaced |
| Meta label | Roboto Mono | 9.5px | 500 | suffix/format/fit labels (uppercase) |
| Ratio/dims | Roboto Mono | 10.5–11px | 400–500 | 1.000, 2400×3200 |

### Font Loading Strategy
`<link>` Google Fonts: `Archivo:wght@400;500;600;700;800;900` + `Archivo+Expanded:wght@700;800` + `Roboto+Mono:wght@400;500;600`.

---

## 4. Spacing System

### Scale
Radius is uniformly `0`. Structural separation comes from a **three-tier rule system**, which *is* the spacing system — replacing gap/shadow-based separation entirely:

| Token | Weight | Scope | Applied to |
|---|---|---|---|
| `--rule-1` | 3px | App shell | topbar bottom, brand right edge, panel/stage split, filmstrip top, statusbar top |
| `--rule-2` | 2px | Section | panel head bottom, preset group heads, stage toolbar, dims divider |
| `--rule-3` | 1px | Row | list rows, button separators, meta dividers, badge borders |

The tier a rule belongs to is decided by *what it separates*, never by how it looks in isolation. Getting this wrong — giving a list row the shell weight, say — collapses the hierarchy back into the flat, undifferentiated grid the first draft suffered from.

### Spacing Rules
Buttons within a toolbar or topbar butt against each other with only their shared 1–2px border as separation — no padding-as-gap. This is intentional and matches the "grid, not a stack of padded cards" philosophy; do not add gaps between adjacent same-row buttons when implementing.

---

## 5. Component Designs

**Button** — hard rectangle, uppercase 11.5px/600 text, letter-spacing 0.04em, 1–2px left border shared with neighboring button (no individual card treatment). Primary: solid red fill, white text, 700 weight.

**Index chips** — panel and section numbers render as **filled squares**: mono text knocked out of a solid `--text` (or `--accent`) block, not bare inline text. The panel header reads `01 — Presets` with the `01` chipped; category headers carry `A`/`B`/`C` chips; showcase sections carry `02`/`03`. The chip is what makes the numbering read as a structural index rather than a decorative prefix.

**Panel header** — tinted `--panel-2` background plus a `--rule-2` bottom border, so the header reads as a distinct band rather than text floating above a list.

**Theme toggle** — a two-cell split-square icon (one cell filled, one outlined) sitting **inline as the last button in the topbar actions row**, sharing that row's `--rule-3` separators. A moon/sun glyph was rejected: it belongs to a different visual language than the geometric square-cell system used everywhere else. It must not be fixed-position — an earlier draft floated it and it overlapped "Export All".

**Active preset card** — 5px solid red left border, heavier than any other marker in the system because there is no background glow or shadow to reinforce "active" here; the bar alone must carry it. `--panel-2` fill, bottom rule separating it from the next row.

**Ratio badge** — hard rectangle, 1px border, mono text, no fill in light mode; badges carry zero background by default.

**Crop frame** — 2px solid red border with a faint center crosshair (horizontal + vertical tick lines at 50%) — a literal alignment-grid device inside the crop tool itself, reinforcing the whole concept's premise at the point of actual use.

**Filmstrip** — thumbnails butt against each other with 1px dividers, no gap, no rounded corners — reads as a contact sheet / filmstrip literally, not a row of cards.

**Showcase/documentation page** — component and palette swatches sit inside a literal ruled box (`border: 2px solid`, internal 1px dividers) rather than floating cards — the documentation itself demonstrates the grid system.

### Layout Patterns
Information architecture is unchanged from the current app (topbar / 300px sidebar / stage / filmstrip / statusbar); what changes is that the *rule/border treatment itself* carries all the structural weight — no shadows, no gaps, no radius anywhere in the interface.

---

## 6. Motion & Interaction

- Deliberately minimal: 100ms background/color transitions only, no lift, no glow, no scale. Motion restraint matches the "disciplined system" personality — flourish would undercut the premise.
- Focus states use a solid color border-color change (to `--accent`), not a soft ring — consistent with the hard-edged, no-blur language throughout.

---

## 7. Implementation Notes

### File Mapping
- `src/App.css` — the most extensive change: every `border-radius` becomes `0`, every `box-shadow`-based elevation is replaced with a `border`, and spacing logic shifts from gap/padding to the three-tier rule system. A genuine re-architecture of the stylesheet's visual language, not a token swap. **Note:** the app's stylesheet is dark-default (`:root` is dark, `:root[data-theme='light']` overrides) while the mockup is light-default — keep the app's existing cascade structure and map values into it rather than inverting it.
- `index.html` — add Archivo, Archivo Expanded, Roboto Mono Google Fonts links.
- `src/components/PresetPanel.tsx` — category group headers need an index chip (A/B/C) in the render loop; the panel header needs the `01 — Presets` chip baked into JSX.
- `src/App.tsx` — replace the existing Sun/Moon icon components with the two-cell split-square toggle, and place it inline as the last item in the topbar actions row.
- `src/components/Cropper.tsx` — crop frame needs the center crosshair tick lines added (verify whether the crop overlay is canvas-drawn or DOM before implementing — if canvas, this is a draw-call change, not CSS).

### Migration Path
A content rewrite (JSX changes for the index chips and the toggle) combined with a full CSS visual-language change (radius, shadow→border, rule hierarchy). The main risk is losing information density if the rule weights aren't tuned carefully — test at the actual 300px sidebar width, and verify **both** themes in the running app before calling it done. Dark mode is where this system fails first: it is the mode where an over-contrasted `--line` does the most damage.

### Design Tokens Export
See CSS custom properties block in `mockups/grid-system.html`.
