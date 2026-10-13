# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static site (no build step, no dependencies, no tests) that renders a Marvel watch-order timeline of 161 entries — **156 titles**, because five of them are extra blocks of a season that is already listed (see **Units**). All UI text and all data fields are in Italian — keep new strings and field names in Italian for consistency.

**Two pages, one data set.** [index.html](index.html) is the timeline; [mappa.html](mappa.html) is the graph of how the universes connect. Each has its own script and its own stylesheet, and they share [comune.js](comune.js), [style.css](style.css), [data.json](data.json) and [dettagli.json](dettagli.json):

| file | page | what it is |
|---|---|---|
| [index.html](index.html) | timeline | static shell + modal markup |
| [script.js](script.js) | timeline | all timeline logic, one IIFE |
| [mappa.html](mappa.html) | map | static shell, legend and bridge index containers |
| [mappa.js](mappa.js) | map | graph build, force layout, SVG render, one IIFE |
| [mappa.css](mappa.css) | map | map-only styles, layered on `style.css` tokens |
| [comune.js](comune.js) | both | the universes table, `unitaKey`, `normalize` |
| [style.css](style.css) | both | tokens, header, controls, timeline, modal, nav |
| [data.json](data.json) | both | the 161 entries |
| [dettagli.json](dettagli.json) | both | per-title research: modal sections and map edges |

`Marvel_Ordine_Cronologico.xlsx` is the original spreadsheet `data.json` was extracted from; it is not read at runtime.

**[comune.js](comune.js) exists to stop the two pages from drifting apart.** It holds the three definitions where a second copy would be a bug rather than a duplication: `window.MARVEL_UNIVERSI` (the universes, colours included), `window.MARVEL_UNITA_KEY` (what counts as one title — two definitions would mean the two pages report different totals) and `window.MARVEL_NORMALIZE` (search folding — two variants would mean the same query finds different things on the two pages). It is a plain `<script>` from the same folder, loaded before the page's own script; it is not defended against, because a missing one is a deploy error, not a runtime condition. What *is* defended against is `dettagli.json`, which is a `fetch`.

The two pages link to each other through `.nav-link` in the header, and every page has a `.to-top` anchor pointing at `#top` on the header — a plain `<a href>`, no JavaScript, because `html{scroll-behavior:smooth}` already does the work.

**`index.html#t-<id>` opens a title.** `apriDaHash()` runs after the first render and on `hashchange`: it resolves the id, scrolls the card into view and opens its modal. The map links every title this way. The id is the immutable one, so the link survives any renumbering of `ordine`.

## Running

Both pages `fetch` `data.json`, so opening them via `file://` fails (each shows an explicit "serve it over HTTP" message). Serve the folder instead:

```
python -m http.server 8000     # or: npx serve .
```

## Architecture

**State → render.** A single `state` object (`mode`, `search`, `tipo`, `categoria`, `fase`, `requiredOnly`, `listaDoomsday`, `hideWatched`, `visti`) drives everything. Every event handler mutates `state` and calls `render()`, which re-runs the whole pipeline and rebuilds `#timeline` from scratch: `getFiltered()` → `getSorted()` → `groupItems()` → `buildCard()` per item. There is no diffing or partial update — adding a control means adding a `state` field, a listener that sets it, and a clause in `getFiltered()`.

**Three view modes.** `state.mode` is `'fase' | 'uscita' | 'cronologico'`, set by the `.mode-btn` tabs via `data-mode`. Sorting and grouping are coupled per mode, so a new mode needs a branch in both `getSorted()` and `groupItems()`:

| mode | sort | group heading |
|---|---|---|
| `fase` | `fase` (null → 99), then `SAGA_ORDER` rank *among the fase-less only*, then release date, then `ordine` | `PHASE_LABELS`, then `categoria` |
| `uscita` | `dataVisione()` (Italian date, US as fallback), then `ordine` | year (`2008`) |
| `cronologico` | `universo` rank, then `annoAmbientazione`, then `ordine` | `universo` (21 sections) |

Grouping is a *run-length* pass over the already-sorted list, not a bucket-by-key, so a label repeats whenever the sort interleaves it. Each mode's sort is built so that never happens:

- `fase` used to dump the titles without a `fase` into a single "Fuori Fase" block. They are now sub-sorted by `SAGA_ORDER` so each saga forms one contiguous run: 6 phase headings + 7 saga headings = 13 groups. `NO_PHASE_LABEL` survives only as a fallback for an item with neither `fase` nor `categoria`.
- `cronologico` used to sort by `ordine` and emit a single unlabelled group. `ordine` is a *watch* order, so against setting year it ran backwards 35 times. It now sorts by universe rank, then by `annoAmbientazione`, and groups by `universo`: 21 contiguous sections, 0 backward steps inside a section, 0 seasons out of sequence. `render()` still skips the divider for a group whose `label` is null, which is now only a safety net.

**Universes.** `universo` (in [data.json](data.json), 161/161) is the *fiction* taxonomy; `categoria` is the *production* one, and they disagree on purpose. `categoria` splits MCU / Marvel Television / Marvel Netflix, which are one universe (Terra-616, 103 titles), and merges continuities that never touch: `Sony / Spider-Man` holds five universes, `Altre licenze` six, `X-Men (Fox)` three, `Fantastici 4 (Fox)` two. Three titles filed under `MCU` are not Terra-616 at all — First Steps is Terra-828, `What If...?` spans the multiverse, Marvel Zombies is its own reality.

**Not every universe has a number.** 17 of the 21 carry a designation Marvel actually uses; Legion, The Gifted, Helstrom and Spider-Noir have none, so their `nome` is a descriptive phrase instead. Do not close that gap by inventing a number — a plausible-looking `Terra-NNNNN` is indistinguishable from a real one once it is in the data.

`MARVEL_UNIVERSI` in [comune.js](comune.js) is the single source of truth: an ordered array of `{id, nome, terra, colore}` (`colore` is what the map tints nodes, legend and edges with). **Array order is section order** in the `cronologico` view and option order in the filter — Terra-616 opens, the parallel universes follow by size, and `multiverso` stays last because it is a residual bucket rather than a place. Adding a universe means adding a row there *and* setting `universo` on the entries; an id with no row sorts last and renders as "Universo non classificato".

The `fase` view deliberately keeps grouping by `categoria`. Grouping it by universe would collapse the Marvel Television and Marvel Netflix blocks into Terra-616 and put them in conflict with the six Phases, which are also Terra-616. The universe is declared in the divider's `sublabel` instead (`Sony / Spider-Man` reads `Terra-96283 · Terra-120703 · Terra-688`), so nothing is hidden and no group is broken.

**Units — the site counts seasons, not rows.** `data.json` has 161 entries but only **156 units**: a unit is `titolo::tipo::stagione` (or the entry itself when `stagione` is null). Agents of S.H.I.E.L.D. occupies 12 rows for 7 seasons, because four of its seasons are cut into blocks — `episodi: "1-7"`, `"8-16"` — so that a film can be watched in the middle. Thor: The Dark World falls inside season 1, Age of Ultron inside season 2, Civil War inside season 3, Doctor Strange inside season 4. It is the only series that is split.

`buildUnita()` runs once at load and builds `state.unita` (a Map keyed by unit), setting `item.unitaKey` and `item.unita` on every entry, plus `primo` (the first block, whose date is the season's start) and `dataFine` (the last block's date, present only when the season really straddles more than one).

`collassaUnita()` then drops every non-first block **except in `cronologico`**, where the split is the whole point. So the timeline renders 156 cards in `fase` and `uscita` and 161 in `cronologico`. It runs *after* `getSorted()`, which is what makes the surviving block the earliest one in that view's order.

Three consequences that are easy to break:

- **The count is always in units**, even in `cronologico` where the cards are more numerous — `contaUnita(filtered)`, not `filtered.length`. Otherwise the same selection reports two different numbers depending on the open tab. The empty-state check uses `sorted.length`, which is the card count.
- **A season is watched only when all its blocks are.** `unitaVista()` / `unitaParziale()` derive that from `state.visti`, which still stores plain `ordine` values — the storage format did not change. A partially watched season renders `aria-pressed="mixed"` and `.is-visto-parziale`; clicking the collapsed checkbox calls `toggleUnita()`, which marks or clears every block at once. The progress bar counts fully watched units out of 156.
- **The season chips mirror the cards.** `linkSeries()` precomputes two lists: `siblings` (every part, used in `cronologico`) and `siblingsStagioni` (one per unit, used elsewhere). Passing the wrong one puts 12 chips under a card that stands for 7 seasons. `buildSeasonsRow()` takes an explicit `parts`/`self` pair for this. `jumpToItem()` resolves a block to `unita.primo.ordine` while collapsing, because the block's own card is not in the DOM.

**Series linking.** `linkSeries()` runs once at load and mutates each item in place, adding `displayTitle`, `seasonNumber`, and (for multi-part titles) `siblings`. The grouping key is `titolo::tipo`, so a film and a TV series with the same name are never merged. Ordering within a group is season, then `episodeStart()` — a season can be split into episode blocks (`"1-7"`, `"8-16"`). `siblings` is what powers the season chips.

**`id` is identity, `ordine` is position.** They used to be the same field, which meant inserting a title in the middle renumbered everything and silently moved the cross-references, the DOM anchors and the visitor's watched list onto the wrong titles. Now:

- `id` is immutable and never reused. DOM ids are `tl-item-${id}`, `siblings` carry `id`, `findItemById()` resolves them, `dettagli.json` is keyed by `id`, and `state.visti` / `localStorage` store `id`.
- `ordine` is free to change. It survives only as the narrative position: the sort tiebreaker in all three views, the `#062` on the card and in the modal eyebrow, and the "posizione #N" in a season chip's tooltip.

The two are still numerically equal on the first 140 entries — the migration kept them aligned so `dettagli.json` needed no remapping — but nothing may assume that. **Give a new entry the next free `id`, never the `id` of the position it occupies.**

`jumpToItem()` clears all filters and re-renders if the target card is currently filtered out.

**Shared season row.** `buildSeasonsRow()` builds the same chip row for both the timeline card and the modal; the caller supplies `labelText`, `className`, and `onSelect` (`jumpToItem` in the card, `openModal` in the modal).

**Modal.** One reusable overlay in `index.html`; `renderModalContent()` empties and refills `#modal-body`. Its five sections are built from `dettagli.json` via `addSection(titolo, build)`, which **emits nothing when `build()` returns null** — a title with no data shows fewer sections, not five identical "coming soon" boxes. Closes on Escape, overlay click, or the close button.

`titleLinks()` renders cross-references as buttons that open the target's modal, and shares one `giaMostrati` Set per render pass: the same `ordine` often appears in `prerequisiti`, `sequelPrequel` *and* `collegati`, and listing it three times reads as a data bug. First section to claim it wins, so section order is the precedence order.

Focus handling has three parts that are easy to break: `trapFocus` cycles Tab inside the dialog, `body.modal-open` stops the page behind from scrolling, and `openModal` records `lastFocusedEl` **only when the overlay was closed** — the season chips inside the modal call `openModal` on a sibling, so recording unconditionally would capture a chip that is about to be destroyed. `closeModal` checks `isConnected` before restoring, because a `render()` in between detaches the original node.

**Watched titles.** `state.visti` is a Set of `ordine`, persisted to `localStorage` under `marvelsite:visti`. Every read and write is wrapped in try/catch — private browsing and blocked third-party storage make `localStorage` *throw*, not return null, and the site has to keep working without persistence. `init()` drops any stored `ordine` that no longer exists in the data.

**Search normalization.** `normalize()` (`MARVEL_NORMALIZE` in [comune.js](comune.js)) lowercases, folds curly apostrophes onto `'`, and strips diacritics; `linkSeries()` precomputes `item.searchKey` from it and the search box runs its input through the same function. Comparing raw strings meant `L'inizio` typed with the other apostrophe found nothing.

`searchKey` also indexes a dot-stripped copy of the title, so `S.H.I.E.L.D.` is found by typing `shield` — which is how everyone types it. Five titles gain a second form (`What If...?` → `What If?`, `Vol. 2` → `Vol 2`).

**Matching is `MARVEL_TROVA(chiave, query)`**, also in [comune.js](comune.js) and used by both pages. Besides the plain substring it compares a *compact* form, letters and digits only, so `vision quest` finds VisionQuest, `spiderman` Spider-Man, `xmen` X-Men. A compact query must be at least two characters, otherwise one letter would match almost everything.

`searchKey` also folds in the entry's cast — actors *and* character names — so "Chris Evans" or "Scarlet Witch" are findable. This is why `init()` must parse `dettagli.json` **before** calling `linkSeries()`. Coverage is limited by the data: each entry lists 4-6 leading roles, so an actor is found where they star, not everywhere they appear.

**Toast.** `announce()` creates `#toast` on demand (a `role="status"` live region) and auto-hides it. `jumpToItem()` uses it because reaching a filtered-out sibling silently wipes every filter.

## mappa.html / mappa.js

The second page. Same data, read as a graph instead of a list: **who connects to whom**, which the timeline cannot show because a list has only one dimension.

**Two levels, one `state.modo`.**

| modo | nodes | edges |
|---|---|---|
| `universi` | 21, one per universe, radius by title count | 17 *bridges*, thickness by how many title pairs cross |
| `titoli` | 156, one per unit, clustered by universe | 416 |

The edges come from `dettagli.json`: `prerequisiti`, `sequelPrequel` and `collegati` — 788 references that collapse to 416 undirected edges, because the same pair is usually declared through more than one field and from both sides. `costruisci()` merges them and keeps every reason on `e.motivi`, so the panel can still say *why* two titles are joined and in which direction. Without `dettagli.json` the page renders the nodes and says plainly that there are no edges — a cloud of unconnected dots with no explanation would be worse than an error.

**Nodes are units, not rows** — `unitaKey` comes from [comune.js](comune.js) for exactly this reason. The map counts 156 like the timeline does, and a reference to any S.H.I.E.L.D. block lands on the season.

**The layout is computed once and is repeatable.** A small O(n²) force simulation with a fixed step count and a seeded PRNG (`seme()`, a mulberry32): the same map on every reload, so two screenshots of it are comparable. Filters hide nodes, they never move the ones that stay.

Three things in `simula()` are load-bearing and were each a visible bug first:

- **Repulsion is short-range** (`opz.taglio`, a multiple of the touching distance). Let every pair repel every other and 156 mutual pushes beat the springs: the cloud settles ten times wider than the frame, and once fitted the dots are two pixels across.
- **Gravity is squashed** (`opz.schiaccia`). The frame is landscape; a round cloud leaves two empty columns and shrinks everything for nothing.
- **A purely geometric pass runs last**, separating anything still overlapping. The forces get close, they do not guarantee it.

The constants were not picked by eye. They were tuned outside the browser against three measurements — final extent, overlapping pairs, and how big a dot ends up on screen — targeting an extent near the frame, zero overlaps and a radius of about 8px. Re-tune the same way if you change them; eyeballing a force layout is how you get a hairball.

**The two levels share their geometry, by direction not by distance.** The clusters in `titoli` sit at the *angle* of the corresponding node in `universi`, but further out: Terra-616's 97 titles are far wider than the circle that stood for them and would swallow their neighbours. Direction is what a reader carries across when switching tabs; the exact distance is not.

**Focus is what makes 416 edges legible.** Hovering previews, clicking locks. Everything outside the selected node's neighbourhood drops to 14% (nodes) and 4.5% (edges) — still context, no longer noise. Title labels exist for all 156 nodes but are transparent until their node is selected, adjacent to the selection, or matched by the search.

**The panel states direction in words**, because the drawn edge has no arrowhead. `VERSO` maps (relation, direction) to a phrase, and `sequel`/`prequel` deliberately collapse onto the same two phrases: they are one relation seen from its two ends, and the data declares both, so keeping them apart listed the same title twice under two headings. `ORDINE_VERSO` is then a precedence order, and a title already listed does not come back further down — the same rule `giaMostrati` applies in the timeline's modal.

**Gestures: one finger scrolls the page, two fingers move the map.** The canvas is full-bleed on a phone, so `touch-action:none` trapped every touch: the page could not be scrolled past the map. `#mappa` is now `touch-action:pan-x pan-y` (the browser scrolls, but cannot pinch-zoom the page), and `trascinamento()` splits by input: mouse and pen pan through pointer events, touch goes through `touchstart/touchmove` and only acts on two fingers (`pizzico()`: zoom on the distance, pan on the midpoint). A one-finger drag flashes `#avviso-dita` ("Usa due dita…"), otherwise the map would look dead. Two rules that were a bug first: the drag reference must be **updated on every move** (left at the start point, each `pointermove` re-added the whole distance and the map ran away), and deltas are in viewBox units like the `translate`, so they are **not** multiplied by `k`.

**On a phone the panel is a bottom sheet.** Below 860px it used to sit under the map, off screen, so tapping a node seemed to do nothing. Now `pannello()` toggles `.mappa-panel.is-aperto` whenever there is a selection: the sheet slides up, is capped at 52dvh and scrolls inside, has a `.pannello-x` close button (hidden on desktop), and disappears with no selection. On opening, `scopriMappa()` scrolls the page just enough to keep the map above the sheet, but never past the height of the sticky `.controls` bar (use `offsetHeight`: before it sticks, the bar is still in the flow). The mobile rule must reset `top:auto`, otherwise the desktop `top:84px` stretches the fixed sheet to almost full screen, with a transparent box over the map that swallows taps.

**The frame follows the box.** `W`/`H` (1200×820) is the space the layout is computed in; `VB` is the visible viewBox, whose height `adattaViewBox()` derives from the element's real aspect ratio so the fit is exact in a short window. A portrait viewBox on a phone was tried and reverted: the point cloud is landscape, so a tall frame adds empty space instead of size. The mobile canvas keeps the natural ratio and goes full-bleed instead.

**Below the map, the same thing in words.** `#indice-ponti` lists all 17 bridges and the 58 title pairs that form them, as ordinary links into the timeline. It is what the skip link at the top of the map jumps to: a 156-node SVG is 156 tab stops, and someone who cannot use the diagram still gets everything it says.

## data.json

Array of 161 objects. Fields: `id` (immutable identity, never reused), `ordine` (1-based narrative position, free to change), `titolo`, `tipo` (`Film` | `Serie TV` | `Miniserie` | `One Shot/Other`), `stagione`, `episodi` (`"1-7"` style block, nullable), `uscita` (`YYYY-MM-DD`), `uscitaRaw` (used on the 5 entries that only have a release window — Beyond the Spider-Verse reads `"giugno 2027"`, Daredevil: Rinascita S3 `"marzo 2027"`, the three Marvel Zombies specials `"Halloween 2027"` to `"Halloween 2029"`; shown verbatim when `uscita` is null, which also drops the title into the "Uscita da definire" group), `categoria`, `obbligatorio` (drives the "Solo visione essenziale" filter and the dimmed `is-optional` card style), `liste` (optional, present only where it applies: the official watch-lists the title belongs to — today only `"doomsday"`, the 15 titles of the Disney+ collection "Countdown to Avengers: Doomsday", August 2026; Loki counts both seasons, so 16 entries), `fase` (1–6 or null).

`liste` is not `obbligatorio` and must not be merged into it: it prepares for one film, and it includes X-Men (2000) and X-Men 2, which the rest of the story does not need. It drives the green `.badge-doomsday` (`--green`) and the "Solo la lista Doomsday" filter through `inLista()`. With that filter on, `aggiornaProgresso()` counts the list instead of the site ("Lista Doomsday: 3 di 16 visti", in units, so Loki counts twice), turns green, stays visible at zero and hides "Azzera", which would look list-only next to that count but clears every watched title. `.progress[hidden]{display:none}` is required: `.progress{display:flex}` beats the browser's `[hidden]`, and without that rule the bar never hid. It lives in `data.json`, not `dettagli.json`, because a filter cannot depend on a file that is allowed to fail. When Marvel publishes a list for Secret Wars, add a value rather than a second boolean.

**`categoria` is populated on all 161 entries, `uscita` on all but the 5 that only have a window** (see `uscitaRaw`). The code paths for a missing `categoria` exist only as a safety net — don't add an entry that relies on them. When an exact date is announced, move it into `uscita` and null `uscitaRaw`. Release dates use the **US/original** date throughout (the Italian date differs by up to 17 months for older films, e.g. Blade: US 1998-08-21, Italy 2000-01-07); mixing the two conventions silently reorders the `uscita` view.

`categoria` is a closed set of 7 values covering 161/161: `MCU`, `Marvel Television`, `Marvel Netflix`, `X-Men (Fox)`, `Fantastici 4 (Fox)`, `Sony / Spider-Man`, `Altre licenze`. The last one was called `Pre-MCU` until Ghost Rider (2007 and 2012) and Punisher - Zona di guerra (2008) joined it and the name became false — it groups films shot under licence outside Fox X-Men and Sony Spider-Man, not films predating the MCU. Adding a value means adding it to `SAGA_ORDER` in [script.js](script.js) too, otherwise it sorts last in the `fase` view.

`universo` is a closed set of 21 ids covering 161/161, one per `UNIVERSI` row. `terra-616` holds 103, `terra-10005` 13, `terra-688` 6, then a long tail down to seven universes of one title each. 616, 10005, 828 and 1610 were stated on screen; the rest come from the Official Handbook, except Legion, The Gifted, Helstrom and Spider-Noir which have no designation at all (the 2026 series is *not* the Spider-Noir of the Spider-Verse, even though Nicolas Cage plays both). Do not invent one for a new title: research it, give the universe a descriptive name, or file the title under `multiverso`.

`fase` is null for 101 entries and that is correct: only Marvel Studios titles belong to an official Phase. Fox, Sony, Netflix, Marvel Television and pre-MCU titles are grouped by `categoria` instead.

`uscitaItalia` (152/161) is the Italian theatrical or platform release; it is null only where no Italian distribution exists (the two `WHIH Newsfront` entries, `Slingshot`) or the title is unreleased. **It is the date the UI shows and sorts by** — `dataVisione()` falls back to `uscita` — because the `uscita` view promises the order the audience saw them in, and this audience is Italian. Do not assume Italy is later: on 50 of the 118 entries where the two differ the Italian date is *earlier* (Europe releases on Wednesday, the US on Friday). The large gaps are historical — Blade is 504 days.

`episodi` marks a **partial** block only. It used to also carry whole-season ranges (`"1-22"` on season 5), which said nothing and made the card read *Stagione 5 · Episodi 1–22*; those are now null. A non-null `episodi` therefore means "this season is split", and that is what `buildUnita()` and the UI rely on. 9 entries carry one, all of them Agents of S.H.I.E.L.D.

`stagione`/`episodi` stay null on `Film` and on `Miniserie`. The `tipo` and `categoria` dropdowns are populated from the data at load, so new values appear as filters automatically.

## dettagli.json

An object keyed by `id` (string keys — it is JSON), one entry per title, ~170 KB. Fetched **in parallel with `data.json` and allowed to fail**: `init()` swallows a missing or malformed `dettagli.json` and the site runs with the modal sections hidden. Keep it that way — this file is researched data, `data.json` is the spreadsheet export, and they have different provenance and update cadence. Merging them would mean losing all of this on the next re-export from the .xlsx.

Fields per entry: `ambientazione` (free Italian prose, 152/161), `annoAmbientazione` (integer, 161/161), `annoStimato` (`true` on the 15 deduced years, absent otherwise), `annoNota` (why that year), `cast` (`{attore, personaggio}`, 157/161 — Avengers: Secret Wars and the three Marvel Zombies specials have none announced, and an empty array is honest where a guess would not be), `prerequisiti` / `collegati` (arrays of `id`), `sequelPrequel` (`{id, relazione}` with `relazione` in `sequel|prequel|spin-off`), `note`.

**`relazione` names what the *target* is, not what this entry is.** `Spider-Man --sequel--> Spider-Man 2` reads "Spider-Man 2 is its sequel". 19 pairs had both sides claiming `sequel`, so one side of each was backwards and the modal labelled a prequel as a sequel; they were corrected from the setting year (season number as tiebreaker). A second pass caught 6 more that the first had missed because they are declared from **one side only** (or, for `What If...?` S2/S3, coherently but inverted on both): Avengers: Doomsday called the 1964-set First Steps its sequel. The rule that finds them is worth keeping: **for every `sequel`/`prequel` declaration, the target's `annoAmbientazione` must agree with the direction** — later means `sequel`, earlier means `prequel`, season number breaking a tie within one title. Same year and different titles decides nothing, and is left alone. `spin-off` is exempt. Asymmetry is fine and deliberate — `Item 47` points at `The Avengers` without being pointed back at — but two entries never both point the same way.

`annoAmbientazione` is **negative for BC settings** (Eyes of Wakanda is `-1260`) — `annoLabel()` handles the sign. It is now populated on all 140, but 7 of those years were not documented and had to be placed: Loki S2 (the TVA is outside time), `What If...?` S2 and S3 (multiverse anthologies), the second season of the animated Spider-Man, and the three unreleased titles. Six of the seven carry `annoStimato: true` and the UI renders them as *circa 2028*, dimmed, with `annoNota` as the tooltip. **Keep that distinction.** Dropping the flag would turn a deduction into a fact on a site whose whole point is getting the order right. The seventh, `Il tuo amichevole Spider-Man` S1, is documented (autumn 2015) and is not flagged.

Sorting still has to tolerate a null year — `getSorted()` maps it to `Infinity` — because `dettagli.json` is allowed to fail to load entirely.

**Do not group the `cronologico` view by decade, and do not sort it by year alone.** Both were tried and both are wrong, for different reasons. Grouping the curated `ordine` by decade yielded 37 dividers for 140 cards, because `ordine` is a *watch* order and runs backwards 35 times. Sorting by year alone fixes the sequence but interleaves universes — First Steps (1964, Terra-828) lands between two Fox X-Men films, which is chronologically exact and fictionally nonsense. Universe first, year second is what holds: 13 sections, and inside each one the year only ever moves forward.

Within a universe the year is the only sort key, and its resolution is one year — 21 years hold more than one title and 2016 holds 16. The tiebreaker is the curated `ordine`, which is the best micro-sequence available. Do not promise more precision than that. The year is also surfaced per-card (`.card-ambientazione`, only in that mode).

## style.css

Plain CSS, no preprocessor. All colors, fonts, radii, and the `--container` width are `:root` custom properties in the `TOKENS` block — restyle there, not at call sites. Sections are marked with `/* === NAME === */` banners (TOKENS, HEADER, CONTROLS, TIMELINE, MODAL, EMPTY STATE, FOOTER, plus PUNTATORE E TOUCH / TIMELINE SU SCHERMI STRETTI / TIPOGRAFIA FLUIDA / TOAST appended at the end). `prefers-reduced-motion` is honored globally.

The breakpoint is **859.98px / 860px** — the old `859`/`860` pair left the 859.01–859.99 range (fractional DPI, browser zoom) with no rules at all, which made the filter panel unreachable. Below it the timeline spine is left-aligned, above it cards alternate around a centered spine via `.tl-item:nth-of-type(even)` (`nth-child` counted the era dividers too and broke the alternation).

Two things that look redundant but are not: every `:hover` lives inside `@media (hover:hover) and (pointer:fine)`, because touch browsers latch `:hover` after a tap; and `input`/`select` are 16px on mobile with a desktop override back to 13.5px, because Safari iOS zooms the page on focus below 16px and never zooms back.

[mappa.css](mappa.css) is loaded only by the map, *after* `style.css`, and redefines no token: it uses `--bg`, `--ink`, `--line` and the rest. Node colours are not in it — they live in [comune.js](comune.js), one per universe, because the JavaScript that draws them needs to read them too. The map is also the only block on the site wider than `--container`: 156 nodes inside 1180px are five-pixel dots. The header and the controls stay aligned with the rest of the site.

**Measuring mobile:** `--window-size` on headless Chrome does *not* set the layout viewport — screenshots taken that way show phantom overflow. Load the page in a fixed-width `<iframe>` from a probe page instead. Also inject `transition:none !important` before measuring: under `--virtual-time-budget` CSS transitions never advance, so a collapsed panel reads as `max-height: 0` forever.
