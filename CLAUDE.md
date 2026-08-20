# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static single-page site (no build step, no dependencies, no tests) that renders a Marvel watch-order timeline of 140 titles. All UI text and all data fields are in Italian — keep new strings and field names in Italian for consistency.

Four files matter: [index.html](index.html) (static shell + modal markup), [script.js](script.js) (all logic, one IIFE), [style.css](style.css), [data.json](data.json) (the 140 entries). `Marvel_Ordine_Cronologico.xlsx` is the original spreadsheet `data.json` was extracted from; it is not read at runtime.

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
| `fase` | `fase` (null → 99), then release date, then `ordine` | `PHASE_LABELS` / `Fuori Fase` |
| `uscita` | release date (undated last), then `ordine` | decade (`1990s`) / `Uscita da definire` |
| `cronologico` | `ordine` (curated narrative order) | `categoria` / `Storie indipendenti` |

Grouping is a *run-length* pass over the already-sorted list, not a bucket-by-key: the same label can appear twice if the sort interleaves it. That is intentional.

**Series linking.** `linkSeries()` runs once at load and mutates each item in place, adding `displayTitle`, `seasonNumber`, and (for multi-part titles) `siblings`. The grouping key is `titolo::tipo`, so a film and a TV series with the same name are never merged. Ordering within a group is season, then `episodeStart()` — a season can be split into episode blocks (`"1-7"`, `"8-16"`). `siblings` is what powers the season chips.

**Cross-references by `ordine`.** `ordine` is the stable identity used everywhere: DOM ids are `tl-item-${ordine}`, `siblings` store `ordine`, and `findItemByOrdine()` resolves them. `id` in the data is unused by the app. `jumpToItem()` clears all filters and re-renders if the target card is currently filtered out.

**Shared season row.** `buildSeasonsRow()` builds the same chip row for both the timeline card and the modal; the caller supplies `labelText`, `className`, and `onSelect` (`jumpToItem` in the card, `openModal` in the modal).

**Modal.** One reusable overlay in `index.html`; `renderModalContent()` empties and refills `#modal-body`. Five sections ("Anno di ambientazione", "Cast", "Titoli collegati", "Da vedere prima…", "Sequel / Prequel") are currently hardcoded `is-placeholder` stubs awaiting data. Closes on Escape, overlay click, or the close button, and restores focus to `lastFocusedEl`.

## data.json

Array of 140 objects. Fields: `id` (unused), `ordine` (1-based narrative position and item identity), `titolo`, `tipo` (`Film` | `Serie TV` | `Miniserie` | `One Shot/Other`), `stagione`, `episodi` (`"1-7"` style block, nullable), `uscita` (`YYYY-MM-DD` or null), `uscitaRaw` (unparseable date string kept verbatim, shown as-is when `uscita` is null), `categoria` (`MCU`, `XMEN`, `Sam Raimi/MCU`, … or null), `obbligatorio` (drives the "Solo visione essenziale" filter and the dimmed `is-optional` card style), `fase` (1–6 or null).

Nullable fields are pervasive and the code branches on them everywhere — when adding entries, keep nulls explicit rather than omitting keys. The `tipo` and `categoria` dropdowns are populated from the data at load, so new values appear as filters automatically.

## style.css

Plain CSS, no preprocessor. All colors, fonts, radii, and the `--container` width are `:root` custom properties in the `TOKENS` block — restyle there, not at call sites. Sections are marked with `/* === NAME === */` banners (TOKENS, HEADER, CONTROLS, TIMELINE, MODAL, EMPTY STATE, FOOTER). The layout breakpoint is 860px: below it the timeline spine is left-aligned, above it cards alternate around a centered spine (`--spine-x-desktop`). `prefers-reduced-motion` is honored globally.
