# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static single-page site (no build step, no dependencies, no tests) that renders a Marvel watch-order timeline of 140 entries — **135 titles**, because five of them are extra blocks of a season that is already listed (see **Units**). All UI text and all data fields are in Italian — keep new strings and field names in Italian for consistency.

Five files matter: [index.html](index.html) (static shell + modal markup), [script.js](script.js) (all logic, one IIFE), [style.css](style.css), [data.json](data.json) (the 140 entries), [dettagli.json](dettagli.json) (per-title research powering the modal). `Marvel_Ordine_Cronologico.xlsx` is the original spreadsheet `data.json` was extracted from; it is not read at runtime.

## Running

`script.js` `fetch`es `data.json`, so opening `index.html` via `file://` fails (the app shows an explicit "serve it over HTTP" message). Serve the folder instead:

```
python -m http.server 8000     # or: npx serve .
```

## Architecture

**State → render.** A single `state` object (`mode`, `search`, `tipo`, `categoria`, `fase`, `requiredOnly`, `hideWatched`, `visti`) drives everything. Every event handler mutates `state` and calls `render()`, which re-runs the whole pipeline and rebuilds `#timeline` from scratch: `getFiltered()` → `getSorted()` → `groupItems()` → `buildCard()` per item. There is no diffing or partial update — adding a control means adding a `state` field, a listener that sets it, and a clause in `getFiltered()`.

**Three view modes.** `state.mode` is `'fase' | 'uscita' | 'cronologico'`, set by the `.mode-btn` tabs via `data-mode`. Sorting and grouping are coupled per mode, so a new mode needs a branch in both `getSorted()` and `groupItems()`:

| mode | sort | group heading |
|---|---|---|
| `fase` | `fase` (null → 99), then `SAGA_ORDER` rank *among the fase-less only*, then release date, then `ordine` | `PHASE_LABELS`, then `categoria` |
| `uscita` | `dataVisione()` (Italian date, US as fallback), then `ordine` | year (`2008`) |
| `cronologico` | `universo` rank, then `annoAmbientazione`, then `ordine` | `universo` (13 sections) |

Grouping is a *run-length* pass over the already-sorted list, not a bucket-by-key, so a label repeats whenever the sort interleaves it. Each mode's sort is built so that never happens:

- `fase` used to dump the 101 titles without a `fase` into a single "Fuori Fase" block. They are now sub-sorted by `SAGA_ORDER` so each saga forms one contiguous run: 6 phase headings + 7 saga headings = 13 groups. `NO_PHASE_LABEL` survives only as a fallback for an item with neither `fase` nor `categoria`.
- `cronologico` used to sort by `ordine` and emit a single unlabelled group. `ordine` is a *watch* order, so against setting year it ran backwards 35 times. It now sorts by universe rank, then by `annoAmbientazione`, and groups by `universo`: 13 contiguous sections, 0 backward steps inside a section, 0 seasons out of sequence. `render()` still skips the divider for a group whose `label` is null, which is now only a safety net.

**Universes.** `universo` (in [data.json](data.json), 140/140) is the *fiction* taxonomy; `categoria` is the *production* one, and they disagree on purpose. `categoria` splits MCU / Marvel Television / Marvel Netflix, which are one universe (Terra-616, 100 titles), and merges continuities that never touch: `Sony / Spider-Man` holds three universes, `Pre-MCU` three, `Fantastici 4 (Fox)` two. Three titles filed under `MCU` are not Terra-616 at all — First Steps is Terra-828, `What If...?` spans the multiverse, Marvel Zombies is its own reality.

`UNIVERSI` in [script.js](script.js) is the single source of truth: an ordered array of `{id, nome, terra}`. **Array order is section order** in the `cronologico` view and option order in the filter — Terra-616 opens, the parallel universes follow by size. Adding a universe means adding a row there *and* setting `universo` on the entries; an id with no row sorts last and renders as "Universo non classificato".

The `fase` view deliberately keeps grouping by `categoria`. Grouping it by universe would collapse the Marvel Television and Marvel Netflix blocks into Terra-616 and put them in conflict with the six Phases, which are also Terra-616. The universe is declared in the divider's `sublabel` instead (`Sony / Spider-Man` reads `Terra-96283 · Terra-120703 · Terra-688`), so nothing is hidden and no group is broken.

**Units — the site counts seasons, not rows.** `data.json` has 140 entries but only **135 units**: a unit is `titolo::tipo::stagione` (or the entry itself when `stagione` is null). Agents of S.H.I.E.L.D. occupies 12 rows for 7 seasons, because four of its seasons are cut into blocks — `episodi: "1-7"`, `"8-16"` — so that a film can be watched in the middle. Thor: The Dark World falls inside season 1, Age of Ultron inside season 2, Civil War inside season 3, Doctor Strange inside season 4. It is the only series that is split.

`buildUnita()` runs once at load and builds `state.unita` (a Map keyed by unit), setting `item.unitaKey` and `item.unita` on every entry, plus `primo` (the first block, whose date is the season's start) and `dataFine` (the last block's date, present only when the season really straddles more than one).

`collassaUnita()` then drops every non-first block **except in `cronologico`**, where the split is the whole point. So the timeline renders 135 cards in `fase` and `uscita` and 140 in `cronologico`. It runs *after* `getSorted()`, which is what makes the surviving block the earliest one in that view's order.

Three consequences that are easy to break:

- **The count is always in units**, even in `cronologico` where the cards are more numerous — `contaUnita(filtered)`, not `filtered.length`. Otherwise the same selection reports two different numbers depending on the open tab. The empty-state check uses `sorted.length`, which is the card count.
- **A season is watched only when all its blocks are.** `unitaVista()` / `unitaParziale()` derive that from `state.visti`, which still stores plain `ordine` values — the storage format did not change. A partially watched season renders `aria-pressed="mixed"` and `.is-visto-parziale`; clicking the collapsed checkbox calls `toggleUnita()`, which marks or clears every block at once. The progress bar counts fully watched units out of 135.
- **The season chips mirror the cards.** `linkSeries()` precomputes two lists: `siblings` (every part, used in `cronologico`) and `siblingsStagioni` (one per unit, used elsewhere). Passing the wrong one puts 12 chips under a card that stands for 7 seasons. `buildSeasonsRow()` takes an explicit `parts`/`self` pair for this. `jumpToItem()` resolves a block to `unita.primo.ordine` while collapsing, because the block's own card is not in the DOM.

**Series linking.** `linkSeries()` runs once at load and mutates each item in place, adding `displayTitle`, `seasonNumber`, and (for multi-part titles) `siblings`. The grouping key is `titolo::tipo`, so a film and a TV series with the same name are never merged. Ordering within a group is season, then `episodeStart()` — a season can be split into episode blocks (`"1-7"`, `"8-16"`). `siblings` is what powers the season chips.

**Cross-references by `ordine`.** `ordine` is the stable identity used everywhere: DOM ids are `tl-item-${ordine}`, `siblings` store `ordine`, and `findItemByOrdine()` resolves them. `id` in the data is unused by the app. `jumpToItem()` clears all filters and re-renders if the target card is currently filtered out.

**Shared season row.** `buildSeasonsRow()` builds the same chip row for both the timeline card and the modal; the caller supplies `labelText`, `className`, and `onSelect` (`jumpToItem` in the card, `openModal` in the modal).

**Modal.** One reusable overlay in `index.html`; `renderModalContent()` empties and refills `#modal-body`. Its five sections are built from `dettagli.json` via `addSection(titolo, build)`, which **emits nothing when `build()` returns null** — a title with no data shows fewer sections, not five identical "coming soon" boxes. Closes on Escape, overlay click, or the close button.

`titleLinks()` renders cross-references as buttons that open the target's modal, and shares one `giaMostrati` Set per render pass: the same `ordine` often appears in `prerequisiti`, `sequelPrequel` *and* `collegati`, and listing it three times reads as a data bug. First section to claim it wins, so section order is the precedence order.

Focus handling has three parts that are easy to break: `trapFocus` cycles Tab inside the dialog, `body.modal-open` stops the page behind from scrolling, and `openModal` records `lastFocusedEl` **only when the overlay was closed** — the season chips inside the modal call `openModal` on a sibling, so recording unconditionally would capture a chip that is about to be destroyed. `closeModal` checks `isConnected` before restoring, because a `render()` in between detaches the original node.

**Watched titles.** `state.visti` is a Set of `ordine`, persisted to `localStorage` under `marvelsite:visti`. Every read and write is wrapped in try/catch — private browsing and blocked third-party storage make `localStorage` *throw*, not return null, and the site has to keep working without persistence. `init()` drops any stored `ordine` that no longer exists in the data.

**`ordine` is doing two jobs and that is a known liability.** It is both the narrative position *and* the identity used by `dettagli.json` keys, cross-references, DOM ids, `siblings` and the persisted watched list. Inserting a title in the middle therefore renumbers everything and silently reassigns a visitor's watched list to the wrong titles. `id` exists in the data, is always equal to `ordine`, and is otherwise unused — it is the intended escape hatch: make `id` the immutable key, let `ordine` become a free-floating position. Do that migration *before* inserting any title.

**Search normalization.** `normalize()` lowercases, folds curly apostrophes onto `'`, and strips diacritics; `linkSeries()` precomputes `item.searchKey` from it and the search box runs its input through the same function. Comparing raw strings meant `L'inizio` typed with the other apostrophe found nothing.

`searchKey` also indexes a dot-stripped copy of the title, so `S.H.I.E.L.D.` is found by typing `shield` — which is how everyone types it. Five titles gain a second form (`What If...?` → `What If?`, `Vol. 2` → `Vol 2`).

`searchKey` also folds in the entry's cast — actors *and* character names — so "Chris Evans" or "Scarlet Witch" are findable. This is why `init()` must parse `dettagli.json` **before** calling `linkSeries()`. Coverage is limited by the data: each entry lists 4-6 leading roles, so an actor is found where they star, not everywhere they appear.

**Toast.** `announce()` creates `#toast` on demand (a `role="status"` live region) and auto-hides it. `jumpToItem()` uses it because reaching a filtered-out sibling silently wipes every filter.

## data.json

Array of 140 objects. Fields: `id` (unused, always equal to `ordine`), `ordine` (1-based narrative position and item identity), `titolo`, `tipo` (`Film` | `Serie TV` | `Miniserie` | `One Shot/Other`), `stagione`, `episodi` (`"1-7"` style block, nullable), `uscita` (`YYYY-MM-DD`), `uscitaRaw` (currently null everywhere; kept for dates that cannot be parsed, shown verbatim when `uscita` is null), `categoria`, `obbligatorio` (drives the "Solo visione essenziale" filter and the dimmed `is-optional` card style), `fase` (1–6 or null).

**`uscita` and `categoria` are now populated on all 140 entries**, and the code paths for their absence exist only as a safety net — don't add an entry that relies on them. Release dates use the **US/original** date throughout (the Italian date differs by up to 17 months for older films, e.g. Blade: US 1998-08-21, Italy 2000-01-07); mixing the two conventions silently reorders the `uscita` view.

`categoria` is a closed set of 7 values covering 140/140: `MCU`, `Marvel Television`, `Marvel Netflix`, `X-Men (Fox)`, `Fantastici 4 (Fox)`, `Sony / Spider-Man`, `Pre-MCU`. Adding a value means adding it to `SAGA_ORDER` in [script.js](script.js) too, otherwise it sorts last in the `fase` view.

`universo` is a closed set of 13 ids covering 140/140, one per `UNIVERSI` row: `terra-616` (100), `terra-10005` (13), `terra-688` (5), `terra-26320` (4), `multiverso` (4), `terra-96283` (3), then `terra-120703`, `terra-121698`, `terra-701306`, `terra-86445` (2 each), then `terra-15866`, `terra-58732`, `terra-828` (1 each). The designations are the ones Marvel actually uses — 616, 10005 and 828 were stated on screen, the rest come from the Official Handbook — so do not invent one for a new title: research it or file the title under `multiverso`.

`fase` is null for 82 entries and that is correct: only Marvel Studios titles belong to an official Phase. Fox, Sony, Netflix, Marvel Television and pre-MCU titles are grouped by `categoria` instead.

`uscitaItalia` (136/140) is the Italian theatrical or platform release; it is null only where no Italian distribution exists (the two `WHIH Newsfront` entries, `Slingshot`) or the title is unreleased. **It is the date the UI shows and sorts by** — `dataVisione()` falls back to `uscita` — because the `uscita` view promises the order the audience saw them in, and this audience is Italian. Do not assume Italy is later: on 47 of the 103 entries where the two differ the Italian date is *earlier* (Europe releases on Wednesday, the US on Friday). The large gaps are historical — Blade is 504 days.

`episodi` marks a **partial** block only. It used to also carry whole-season ranges (`"1-22"` on season 5), which said nothing and made the card read *Stagione 5 · Episodi 1–22*; those are now null. A non-null `episodi` therefore means "this season is split", and that is what `buildUnita()` and the UI rely on. 9 entries carry one, all of them Agents of S.H.I.E.L.D.

`stagione`/`episodi` stay null on `Film` and on `Miniserie`. The `tipo` and `categoria` dropdowns are populated from the data at load, so new values appear as filters automatically.

## dettagli.json

An object keyed by `ordine` (string keys — it is JSON), one entry per title, ~150 KB. Fetched **in parallel with `data.json` and allowed to fail**: `init()` swallows a missing or malformed `dettagli.json` and the site runs with the modal sections hidden. Keep it that way — this file is researched data, `data.json` is the spreadsheet export, and they have different provenance and update cadence. Merging them would mean losing all of this on the next re-export from the .xlsx.

Fields per entry: `ambientazione` (free Italian prose, 137/140), `annoAmbientazione` (integer, 140/140), `annoStimato` (`true` on the 6 deduced years, absent otherwise), `annoNota` (why that year, on the 7 titles that needed one), `cast` (`{attore, personaggio}`, 140/140), `prerequisiti` / `collegati` (arrays of `ordine`), `sequelPrequel` (`{ordine, relazione}` with `relazione` in `sequel|prequel|spin-off`), `note`.

`annoAmbientazione` is **negative for BC settings** (Eyes of Wakanda is `-1260`) — `annoLabel()` handles the sign. It is now populated on all 140, but 7 of those years were not documented and had to be placed: Loki S2 (the TVA is outside time), `What If...?` S2 and S3 (multiverse anthologies), the second season of the animated Spider-Man, and the three unreleased titles. Six of the seven carry `annoStimato: true` and the UI renders them as *circa 2028*, dimmed, with `annoNota` as the tooltip. **Keep that distinction.** Dropping the flag would turn a deduction into a fact on a site whose whole point is getting the order right. The seventh, `Il tuo amichevole Spider-Man` S1, is documented (autumn 2015) and is not flagged.

Sorting still has to tolerate a null year — `getSorted()` maps it to `Infinity` — because `dettagli.json` is allowed to fail to load entirely.

**Do not group the `cronologico` view by decade, and do not sort it by year alone.** Both were tried and both are wrong, for different reasons. Grouping the curated `ordine` by decade yielded 37 dividers for 140 cards, because `ordine` is a *watch* order and runs backwards 35 times. Sorting by year alone fixes the sequence but interleaves universes — First Steps (1964, Terra-828) lands between two Fox X-Men films, which is chronologically exact and fictionally nonsense. Universe first, year second is what holds: 13 sections, and inside each one the year only ever moves forward.

Within a universe the year is the only sort key, and its resolution is one year — 21 years hold more than one title and 2016 holds 16. The tiebreaker is the curated `ordine`, which is the best micro-sequence available. Do not promise more precision than that. The year is also surfaced per-card (`.card-ambientazione`, only in that mode).

## style.css

Plain CSS, no preprocessor. All colors, fonts, radii, and the `--container` width are `:root` custom properties in the `TOKENS` block — restyle there, not at call sites. Sections are marked with `/* === NAME === */` banners (TOKENS, HEADER, CONTROLS, TIMELINE, MODAL, EMPTY STATE, FOOTER, plus PUNTATORE E TOUCH / TIMELINE SU SCHERMI STRETTI / TIPOGRAFIA FLUIDA / TOAST appended at the end). `prefers-reduced-motion` is honored globally.

The breakpoint is **859.98px / 860px** — the old `859`/`860` pair left the 859.01–859.99 range (fractional DPI, browser zoom) with no rules at all, which made the filter panel unreachable. Below it the timeline spine is left-aligned, above it cards alternate around a centered spine via `.tl-item:nth-of-type(even)` (`nth-child` counted the era dividers too and broke the alternation).

Two things that look redundant but are not: every `:hover` lives inside `@media (hover:hover) and (pointer:fine)`, because touch browsers latch `:hover` after a tap; and `input`/`select` are 16px on mobile with a desktop override back to 13.5px, because Safari iOS zooms the page on focus below 16px and never zooms back.

**Measuring mobile:** `--window-size` on headless Chrome does *not* set the layout viewport — screenshots taken that way show phantom overflow. Load the page in a fixed-width `<iframe>` from a probe page instead. Also inject `transition:none !important` before measuring: under `--virtual-time-budget` CSS transitions never advance, so a collapsed panel reads as `max-height: 0` forever.
