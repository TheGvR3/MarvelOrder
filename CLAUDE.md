# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static single-page site (no build step, no dependencies, no tests) that renders a Marvel watch-order timeline of 140 titles. All UI text and all data fields are in Italian — keep new strings and field names in Italian for consistency.

Five files matter: [index.html](index.html) (static shell + modal markup), [script.js](script.js) (all logic, one IIFE), [style.css](style.css), [data.json](data.json) (the 140 entries), [dettagli.json](dettagli.json) (per-title research powering the modal). `Marvel_Ordine_Cronologico.xlsx` is the original spreadsheet `data.json` was extracted from; it is not read at runtime.

## Running

`script.js` `fetch`es `data.json`, so opening `index.html` via `file://` fails (the app shows an explicit "serve it over HTTP" message). Serve the folder instead:

```
python -m http.server 8000     # or: npx serve .
```

## Architecture

**State → render.** A single `state` object (`mode`, `search`, `tipo`, `categoria`, `requiredOnly`) drives everything. Every event handler mutates `state` and calls `render()`, which re-runs the whole pipeline and rebuilds `#timeline` from scratch: `getFiltered()` → `getSorted()` → `groupItems()` → `buildCard()` per item. There is no diffing or partial update — adding a control means adding a `state` field, a listener that sets it, and a clause in `getFiltered()`.

**Three view modes.** `state.mode` is `'fase' | 'uscita' | 'cronologico'`, set by the `.mode-btn` tabs via `data-mode`. Sorting and grouping are coupled per mode, so a new mode needs a branch in both `getSorted()` and `groupItems()`:

| mode | sort | group heading |
|---|---|---|
| `fase` | `fase` (null → 99), then `SAGA_ORDER` rank *among the fase-less only*, then release date, then `ordine` | `PHASE_LABELS`, then `categoria` |
| `uscita` | release date, then `ordine` | decade (`1990s`) |
| `cronologico` | `ordine` (curated narrative order) | none — one unlabelled group |

Grouping is a *run-length* pass over the already-sorted list, not a bucket-by-key, so a label repeats whenever the sort interleaves it. Each mode's sort is built so that never happens:

- `fase` used to dump the 101 titles without a `fase` into a single "Fuori Fase" block. They are now sub-sorted by `SAGA_ORDER` so each saga forms one contiguous run: 6 phase headings + 7 saga headings = 13 groups. `NO_PHASE_LABEL` survives only as a fallback for an item with neither `fase` nor `categoria`.
- `cronologico` deliberately jumps between sagas, so grouping by `categoria` produced a divider every 1.7 cards ("MCU" 30 times). It now emits one group with `label: null`, and `render()` skips the divider for unlabelled groups. The saga stays readable from the card's `badge-cat`.

**Series linking.** `linkSeries()` runs once at load and mutates each item in place, adding `displayTitle`, `seasonNumber`, and (for multi-part titles) `siblings`. The grouping key is `titolo::tipo`, so a film and a TV series with the same name are never merged. Ordering within a group is season, then `episodeStart()` — a season can be split into episode blocks (`"1-7"`, `"8-16"`). `siblings` is what powers the season chips.

**Cross-references by `ordine`.** `ordine` is the stable identity used everywhere: DOM ids are `tl-item-${ordine}`, `siblings` store `ordine`, and `findItemByOrdine()` resolves them. `id` in the data is unused by the app. `jumpToItem()` clears all filters and re-renders if the target card is currently filtered out.

**Shared season row.** `buildSeasonsRow()` builds the same chip row for both the timeline card and the modal; the caller supplies `labelText`, `className`, and `onSelect` (`jumpToItem` in the card, `openModal` in the modal).

**Modal.** One reusable overlay in `index.html`; `renderModalContent()` empties and refills `#modal-body`. Its five sections are built from `dettagli.json` via `addSection(titolo, build)`, which **emits nothing when `build()` returns null** — a title with no data shows fewer sections, not five identical "coming soon" boxes. Closes on Escape, overlay click, or the close button.

`titleLinks()` renders cross-references as buttons that open the target's modal, and shares one `giaMostrati` Set per render pass: the same `ordine` often appears in `prerequisiti`, `sequelPrequel` *and* `collegati`, and listing it three times reads as a data bug. First section to claim it wins, so section order is the precedence order.

Focus handling has three parts that are easy to break: `trapFocus` cycles Tab inside the dialog, `body.modal-open` stops the page behind from scrolling, and `openModal` records `lastFocusedEl` **only when the overlay was closed** — the season chips inside the modal call `openModal` on a sibling, so recording unconditionally would capture a chip that is about to be destroyed. `closeModal` checks `isConnected` before restoring, because a `render()` in between detaches the original node.

**Search normalization.** `normalize()` lowercases, folds curly apostrophes onto `'`, and strips diacritics; `linkSeries()` precomputes `item.searchKey` from it and the search box runs its input through the same function. Comparing raw strings meant `L'inizio` typed with the other apostrophe found nothing.

**Toast.** `announce()` creates `#toast` on demand (a `role="status"` live region) and auto-hides it. `jumpToItem()` uses it because reaching a filtered-out sibling silently wipes every filter.

## data.json

Array of 140 objects. Fields: `id` (unused, always equal to `ordine`), `ordine` (1-based narrative position and item identity), `titolo`, `tipo` (`Film` | `Serie TV` | `Miniserie` | `One Shot/Other`), `stagione`, `episodi` (`"1-7"` style block, nullable), `uscita` (`YYYY-MM-DD`), `uscitaRaw` (currently null everywhere; kept for dates that cannot be parsed, shown verbatim when `uscita` is null), `categoria`, `obbligatorio` (drives the "Solo visione essenziale" filter and the dimmed `is-optional` card style), `fase` (1–6 or null).

**`uscita` and `categoria` are now populated on all 140 entries**, and the code paths for their absence exist only as a safety net — don't add an entry that relies on them. Release dates use the **US/original** date throughout (the Italian date differs by up to 17 months for older films, e.g. Blade: US 1998-08-21, Italy 2000-01-07); mixing the two conventions silently reorders the `uscita` view.

`categoria` is a closed set of 7 values covering 140/140: `MCU`, `Marvel Television`, `Marvel Netflix`, `X-Men (Fox)`, `Fantastici 4 (Fox)`, `Sony / Spider-Man`, `Pre-MCU`. Adding a value means adding it to `SAGA_ORDER` in [script.js](script.js) too, otherwise it sorts last in the `fase` view.

`fase` is null for 82 entries and that is correct: only Marvel Studios titles belong to an official Phase. Fox, Sony, Netflix, Marvel Television and pre-MCU titles are grouped by `categoria` instead.

`stagione`/`episodi` stay null on `Film` and on `Miniserie`. The `tipo` and `categoria` dropdowns are populated from the data at load, so new values appear as filters automatically.

## dettagli.json

An object keyed by `ordine` (string keys — it is JSON), one entry per title, ~150 KB. Fetched **in parallel with `data.json` and allowed to fail**: `init()` swallows a missing or malformed `dettagli.json` and the site runs with the modal sections hidden. Keep it that way — this file is researched data, `data.json` is the spreadsheet export, and they have different provenance and update cadence. Merging them would mean losing all of this on the next re-export from the .xlsx.

Fields per entry: `ambientazione` (free Italian prose, 137/140), `annoAmbientazione` (integer, 133/140), `cast` (`{attore, personaggio}`, 140/140), `prerequisiti` / `collegati` (arrays of `ordine`), `sequelPrequel` (`{ordine, relazione}` with `relazione` in `sequel|prequel|spin-off`), `note`.

`annoAmbientazione` is null where an anchor year would be a lie (Loki S2 is outside time, the two `What If...?` anthologies span universes, three 2026-2027 titles are unreleased) and **negative for BC settings** (Eyes of Wakanda is `-1260`) — `annoLabel()` handles the sign. Any consumer must tolerate null and negative values.

**Do not group the `cronologico` view by `annoAmbientazione`.** It is tempting and it is wrong: the curated `ordine` is a *watch* order, not a chronology of events. Measured against setting year it has 35 inversions, and a run-length pass by decade yields 37 dividers for 140 cards. The year is surfaced per-card instead (`.card-ambientazione`, only in that mode).

## style.css

Plain CSS, no preprocessor. All colors, fonts, radii, and the `--container` width are `:root` custom properties in the `TOKENS` block — restyle there, not at call sites. Sections are marked with `/* === NAME === */` banners (TOKENS, HEADER, CONTROLS, TIMELINE, MODAL, EMPTY STATE, FOOTER, plus PUNTATORE E TOUCH / TIMELINE SU SCHERMI STRETTI / TIPOGRAFIA FLUIDA / TOAST appended at the end). `prefers-reduced-motion` is honored globally.

The breakpoint is **859.98px / 860px** — the old `859`/`860` pair left the 859.01–859.99 range (fractional DPI, browser zoom) with no rules at all, which made the filter panel unreachable. Below it the timeline spine is left-aligned, above it cards alternate around a centered spine via `.tl-item:nth-of-type(even)` (`nth-child` counted the era dividers too and broke the alternation).

Two things that look redundant but are not: every `:hover` lives inside `@media (hover:hover) and (pointer:fine)`, because touch browsers latch `:hover` after a tap; and `input`/`select` are 16px on mobile with a desktop override back to 13.5px, because Safari iOS zooms the page on focus below 16px and never zooms back.

**Measuring mobile:** `--window-size` on headless Chrome does *not* set the layout viewport — screenshots taken that way show phantom overflow. Load the page in a fixed-width `<iframe>` from a probe page instead. Also inject `transition:none !important` before measuring: under `--virtual-time-budget` CSS transitions never advance, so a collapsed panel reads as `max-height: 0` forever.
