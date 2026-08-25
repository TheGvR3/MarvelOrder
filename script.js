(function () {
  'use strict';

  const els = {
    timeline: document.getElementById('timeline'),
    empty: document.getElementById('empty-state'),
    resetBtn: document.getElementById('reset-filters'),
    resultCount: document.getElementById('result-count'),
    resultCountLabel: document.getElementById('result-count-label'),
    totalCount: document.getElementById('total-count'),
    search: document.getElementById('search'),
    tipoFilter: document.getElementById('tipo-filter'),
    catFilter: document.getElementById('cat-filter'),
    universoFilter: document.getElementById('universo-filter'),
    requiredOnly: document.getElementById('required-only'),
    faseFilter: document.getElementById('fase-filter'),
    hideWatched: document.getElementById('hide-watched'),
    progress: document.getElementById('progress'),
    progressBar: document.querySelector('#progress .progress-bar'),
    progressFill: document.getElementById('progress-fill'),
    progressText: document.getElementById('progress-text'),
    resetVisti: document.getElementById('reset-visti'),
    modeBtns: Array.from(document.querySelectorAll('.mode-btn')),
    filtersToggle: document.getElementById('filters-toggle'),
    filtersPanel: document.getElementById('filters-panel'),
    modalOverlay: document.getElementById('modal-overlay'),
    modalClose: document.getElementById('modal-close'),
    modalSearch: document.getElementById('modal-search'),
    modalBody: document.getElementById('modal-body'),
    modal: document.querySelector('.modal'),
  };

  const state = {
    data: [],
    dettagli: {},   // indicizzati per ordine; vuoto se dettagli.json non c'e'
    unita: new Map(),   // stagione -> blocchi che la compongono; 135 per 140 voci
    mode: 'fase', // 'fase' | 'uscita' | 'cronologico'
    search: '',
    tipo: '',
    categoria: '',
    universo: '',
    fase: '',
    requiredOnly: false,
    hideWatched: false,
    visti: new Set(),   // ordine dei titoli gia' visti, persistiti in localStorage
  };

  // ============================================================
  // TITOLI VISTI
  // ============================================================
  const STORAGE_KEY = 'marvelsite:visti';

  // localStorage puo' lanciare (navigazione privata, cookie di terze parti bloccati):
  // il sito deve funzionare comunque, semplicemente senza ricordare nulla.
  function caricaVisti() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr.filter(Number.isInteger) : []);
    } catch (err) {
      return new Set();
    }
  }

  function salvaVisti() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.visti].sort((a, b) => a - b)));
    } catch (err) {
      /* spazio esaurito o storage non disponibile: si perde solo la persistenza */
    }
  }

  function toggleVisto(id) {
    if (state.visti.has(id)) state.visti.delete(id);
    else state.visti.add(id);
    salvaVisti();
  }

  const MONTHS = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  const PHASE_LABELS = { 1: 'Fase Uno', 2: 'Fase Due', 3: 'Fase Tre', 4: 'Fase Quattro', 5: 'Fase Cinque', 6: 'Fase Sei' };
  // I titoli senza fase (Fox, Sony, TV, pre-MCU) finivano tutti in un unico blocco da 82 card.
  // Qui definisce l'ordine con cui le saghe si susseguono dopo le sei Fasi.
  const SAGA_ORDER = [
    'Altre licenze',
    'X-Men (Fox)',
    'Fantastici 4 (Fox)',
    'Sony / Spider-Man',
    'Marvel Television',
    'Marvel Netflix',
    'MCU',
  ];
  const sagaRank = saga => {
    const i = SAGA_ORDER.indexOf(saga);
    return i === -1 ? SAGA_ORDER.length : i;
  };

  // La tabella vive in comune.js perche' anche la mappa (mappa.js) ne ha
  // bisogno, e due copie divergerebbero in silenzio.
  const UNIVERSI = window.MARVEL_UNIVERSI;
  const UNIVERSI_BY_ID = new Map(UNIVERSI.map((u, i) => [u.id, Object.assign({ rank: i }, u)]));
  const universoInfo = id => UNIVERSI_BY_ID.get(id) || null;
  const universoRank = id => {
    const u = UNIVERSI_BY_ID.get(id);
    return u ? u.rank : UNIVERSI.length;
  };

  // annoAmbientazione vive in dettagli.json, che puo' mancare: senza anno il
  // titolo scivola in fondo al proprio universo invece di rompere l'ordinamento.
  function annoAmb(item) {
    const det = state.dettagli[item.id];
    return det && Number.isInteger(det.annoAmbientazione) ? det.annoAmbientazione : null;
  }

  // Accetta solo ISO YYYY-MM-DD con mese/giorno plausibili: qualsiasi altra cosa
  // torna null e il chiamante ricade su uscitaRaw / "Uscita da definire".
  function formatDate(iso) {
    const m = typeof iso === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${day} ${MONTHS[month - 1]} ${year}`;
  }

  // Il sito e' italiano e la vista "Uscita" promette l'ordine in cui il pubblico
  // li ha visti: vale la data italiana, con quella USA come ripiego dove manca
  // (4 titoli mai distribuiti in Italia).
  function dataVisione(item) {
    return item.uscitaItalia || item.uscita;
  }

  function annoUscita(iso) {
    const anno = String(iso).slice(0, 4);
    return /^\d{4}$/.test(anno) ? anno : 'Uscita da definire';
  }

  // La normalizzazione vive in comune.js: la usa anche la mappa, e due varianti
  // vorrebbero dire che la stessa ricerca trova cose diverse nelle due pagine.
  const normalize = window.MARVEL_NORMALIZE;

  // Groups multi-season / multi-part entries so a part isn't shown as an
  // unrelated standalone show. Grouping key is titolo+tipo (a film and a
  // TV series can share the same name, e.g. "Daredevil", without being merged).
  // Sort/label also accounts for shows split into episode blocks within the
  // same season (e.g. "Agents of S.H.I.E.L.D." S01 split into 1-7 / 8-16 / 17-22).
  function episodeStart(item) {
    if (!item.episodi) return 0;
    const n = parseInt(item.episodi.split('-')[0], 10);
    return Number.isNaN(n) ? 0 : n;
  }

  // Un'unita' e' cio' che il sito conta come un titolo: la stagione intera, non
  // il blocco di episodi in cui e' spezzata (vedi comune.js). Quella divisione
  // serve solo nella Cronologia, dove l'incastro e' il punto; nelle Fasi e
  // nell'Uscita e' rumore.
  const unitaKey = window.MARVEL_UNITA_KEY;

  const staCollassando = () => state.mode !== 'cronologico';

  function buildUnita(data) {
    const map = new Map();
    data.forEach(item => {
      const k = unitaKey(item);
      item.unitaKey = k;
      if (!map.has(k)) map.set(k, { key: k, items: [] });
      map.get(k).items.push(item);
    });
    map.forEach(u => {
      u.items.sort((a, b) => episodeStart(a) - episodeStart(b) || a.ordine - b.ordine);
      u.primo = u.items[0];
      const date = u.items.map(dataVisione).filter(Boolean).sort();
      u.dataInizio = date[0] || null;
      // la data di fine esiste solo se la stagione e' andata in onda a cavallo
      // di piu' blocchi: e' quella che la card scrive come intervallo
      u.dataFine = date.length > 1 && date[date.length - 1] !== date[0] ? date[date.length - 1] : null;
      u.items.forEach(i => { i.unita = u; });
    });
    return map;
  }

  // Una stagione e' vista quando lo sono tutti i suoi blocchi. Spuntarne due su
  // tre non e' "vista": e' un terzo stato, e la card lo dichiara.
  const unitaVista = u => u.items.every(i => state.visti.has(i.id));
  const unitaParziale = u => !unitaVista(u) && u.items.some(i => state.visti.has(i.id));

  function toggleUnita(u) {
    const tutti = unitaVista(u);
    u.items.forEach(i => { if (tutti) state.visti.delete(i.id); else state.visti.add(i.id); });
    salvaVisti();
  }

  // Il sito conta stagioni, non voci: 135 unita' per 140 righe di data.json.
  const contaUnita = list => new Set(list.map(i => i.unitaKey)).size;

  // Nelle viste che accorpano sopravvive il primo blocco della stagione, che
  // essendo il piu' vecchio porta con se' anche la data giusta per ordinare.
  function collassaUnita(list) {
    if (!staCollassando()) return list;
    const visti = new Set();
    return list.filter(item => {
      if (visti.has(item.unitaKey)) return false;
      visti.add(item.unitaKey);
      return true;
    });
  }

  function linkSeries(data) {
    const byKey = new Map();

    data.forEach(item => {
      item.displayTitle = item.titolo;
      item.seasonNumber = item.stagione || null;
      // 426 attori e 473 personaggi erano nei dati ma invisibili alla ricerca:
      // cercare "Tom Holland" o "Scarlet Witch" non trovava nulla.
      const det = state.dettagli[item.id];
      const cast = det && det.cast ? det.cast.map(c => `${c.attore} ${c.personaggio}`).join(' ') : '';
      // Gli acronimi puntati vanno indicizzati anche senza punti: "S.H.I.E.L.D."
      // non veniva trovato scrivendo "shield", che e' come lo cerca chiunque.
      const senzaPunti = item.titolo.indexOf('.') === -1 ? '' : item.titolo.replace(/\./g, '');
      item.searchKey = normalize(`${item.titolo} ${senzaPunti} ${cast}`);
      const key = `${item.titolo}::${item.tipo}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(item);
    });

    byKey.forEach(group => {
      if (group.length < 2) return; // single-part shows don't need cross-links
      group.sort((a, b) => (a.seasonNumber || 0) - (b.seasonNumber || 0) || episodeStart(a) - episodeStart(b));
      // Le pastiglie devono rispecchiare le card: una per blocco nella Cronologia,
      // una per stagione altrove. Senza il secondo elenco S.H.I.E.L.D. mostrerebbe
      // 12 pastiglie sotto una card che di stagioni ne rappresenta 7.
      const perStagione = [];
      const gia = new Set();
      group.forEach(other => {
        const k = unitaKey(other);
        if (gia.has(k)) return;
        gia.add(k);
        perStagione.push({ id: other.id, ordine: other.ordine, season: other.seasonNumber, episodi: null, key: k });
      });
      group.forEach(item => {
        item.siblings = group
          .filter(other => other !== item)
          .map(other => ({ id: other.id, ordine: other.ordine, season: other.seasonNumber, episodi: other.episodi }));
        item.siblingsStagioni = perStagione.filter(other => other.key !== unitaKey(item));
      });
    });

    return data;
  }

  async function init() {
    try {
      const [res, resDet] = await Promise.all([
        fetch('data.json'),
        // i dettagli sono un di piu': un errore qui non deve impedire il caricamento
        fetch('dettagli.json').catch(() => null),
      ]);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const raw = await res.json();
      if (!Array.isArray(raw)) throw new Error('formato inatteso: atteso un array');
      // i dettagli vanno letti prima di linkSeries: searchKey indicizza anche il cast
      if (resDet && resDet.ok) {
        try { state.dettagli = await resDet.json(); } catch (e) { state.dettagli = {}; }
      }
      state.data = linkSeries(raw);
      state.unita = buildUnita(state.data);
    } catch (err) {
      const hint = location.protocol === 'file:'
        ? 'Stai aprendo la pagina dal filesystem: servila con un piccolo server HTTP (per esempio <code>python -m http.server</code>).'
        : 'Dettaglio: ' + err.message;
      els.timeline.innerHTML = '<p class="empty-state">Impossibile caricare i dati (data.json). ' + hint + '</p>';
      return;
    }
    if (els.totalCount) els.totalCount.textContent = state.unita.size;
    state.visti = caricaVisti();
    // un ordine rimasto in localStorage e non piu' presente nei dati va scartato
    const esistenti = new Set(state.data.map(d => d.id));
    [...state.visti].forEach(x => { if (!esistenti.has(x)) state.visti.delete(x); });
    populateFilters();
    bindEvents();
    render({ animate: true });
    apriDaHash();
    window.addEventListener('hashchange', apriDaHash);
  }

  // index.html#t-<id> arriva dalla mappa: porta la card in vista e ne apre la
  // scheda. L'id e' l'identita' immutabile, non la posizione, quindi il link
  // regge anche se l'ordine narrativo cambia.
  function apriDaHash() {
    const m = /^#t-(\d+)$/.exec(location.hash || '');
    if (!m) return;
    const item = findItemById(Number(m[1]));
    if (!item) return;
    jumpToItem(item.id);
    openModal(item.unita && staCollassando() ? item.unita.primo : item);
  }

  function populateFilters() {
    const tipi = Array.from(new Set(state.data.map(d => d.tipo))).sort((a, b) => a.localeCompare(b, 'it'));
    const cats = Array.from(new Set(state.data.map(d => d.categoria).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'it'));

    tipi.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      els.tipoFilter.appendChild(opt);
    });
    cats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      els.catFilter.appendChild(opt);
    });

    // In ordine di UNIVERSI, non alfabetico: la tendina rispecchia le sezioni.
    if (els.universoFilter) {
      const presenti = new Set(state.data.map(d => d.universo).filter(Boolean));
      UNIVERSI.filter(u => presenti.has(u.id)).forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.nome + ' — ' + u.terra;
        els.universoFilter.appendChild(opt);
      });
    }

    const fasi = Array.from(new Set(state.data.map(d => d.fase).filter(f => f != null))).sort((a, b) => a - b);
    fasi.forEach(f => {
      const opt = document.createElement('option');
      opt.value = String(f);
      opt.textContent = PHASE_LABELS[f] || `Fase ${f}`;
      els.faseFilter.appendChild(opt);
    });
    const senza = document.createElement('option');
    senza.value = 'nessuna';
    senza.textContent = 'Senza fase ufficiale';
    els.faseFilter.appendChild(senza);
  }

  function bindEvents() {
    els.modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        state.mode = btn.dataset.mode;
        els.modeBtns.forEach(b => {
          b.classList.toggle('is-active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        render({ animate: true });
      });
    });

    els.filtersToggle.addEventListener('click', () => {
      const isOpen = els.filtersPanel.classList.toggle('is-open');
      els.filtersToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    let searchTimer;
    els.search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = normalize(els.search.value);
        render();
      }, 120);
    });

    els.tipoFilter.addEventListener('change', () => {
      state.tipo = els.tipoFilter.value;
      render();
    });
    els.catFilter.addEventListener('change', () => {
      state.categoria = els.catFilter.value;
      render();
    });
    if (els.universoFilter) {
      els.universoFilter.addEventListener('change', () => {
        state.universo = els.universoFilter.value;
        render();
      });
    }
    els.requiredOnly.addEventListener('change', () => {
      state.requiredOnly = els.requiredOnly.checked;
      render();
    });
    els.faseFilter.addEventListener('change', () => {
      state.fase = els.faseFilter.value;
      render();
    });
    els.hideWatched.addEventListener('change', () => {
      state.hideWatched = els.hideWatched.checked;
      render();
    });
    els.resetVisti.addEventListener('click', () => {
      if (!state.visti.size) return;
      const quanti = state.visti.size;
      state.visti.clear();
      salvaVisti();
      render();
      announce(quanti === 1 ? 'Segnato come non visto 1 titolo.' : `Segnati come non visti ${quanti} titoli.`);
    });

    els.resetBtn.addEventListener('click', () => {
      resetFilters();
      render();
    });

    els.modalClose.addEventListener('click', closeModal);
    els.modalOverlay.addEventListener('click', e => {
      if (e.target === els.modalOverlay) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !els.modalOverlay.hidden) closeModal();
    });
  }

  function resetFilters() {
    state.search = '';
    state.tipo = '';
    state.categoria = '';
    state.universo = '';
    state.fase = '';
    state.requiredOnly = false;
    state.hideWatched = false;
    els.search.value = '';
    els.tipoFilter.value = '';
    els.catFilter.value = '';
    if (els.universoFilter) els.universoFilter.value = '';
    els.faseFilter.value = '';
    els.requiredOnly.checked = false;
    els.hideWatched.checked = false;
  }

  function getFiltered() {
    return state.data.filter(item => {
      if (state.search && !item.searchKey.includes(state.search)) return false;
      if (state.tipo && item.tipo !== state.tipo) return false;
      if (state.categoria && item.categoria !== state.categoria) return false;
      if (state.universo && item.universo !== state.universo) return false;
      if (state.fase === 'nessuna' ? item.fase != null : state.fase && String(item.fase) !== state.fase) return false;
      if (state.requiredOnly && !item.obbligatorio) return false;
      if (state.hideWatched && state.visti.has(item.id)) return false;
      return true;
    });
  }

  // I titoli senza data vanno in fondo; a parita' di data decide l'ordine narrativo.
  function byDateThenOrder(a, b) {
    const da = dataVisione(a), db = dataVisione(b);
    if (da && db) return da.localeCompare(db) || a.ordine - b.ordine;
    if (da) return -1;
    if (db) return 1;
    return a.ordine - b.ordine;
  }

  function getSorted(list) {
    const copy = list.slice();
    if (state.mode === 'cronologico') {
      // Universo prima, poi l'anno in cui e' ambientato, poi l'ordine curato come
      // spareggio: annoAmbientazione ha la precisione dell'anno e 21 anni ne
      // contengono piu' d'uno, quindi dentro l'anno decide la sequenza del foglio.
      return copy.sort((a, b) =>
        universoRank(a.universo) - universoRank(b.universo) ||
        ((annoAmb(a) ?? Infinity) - (annoAmb(b) ?? Infinity)) ||
        a.ordine - b.ordine);
    }
    if (state.mode === 'fase') {
      return copy.sort((a, b) =>
        ((a.fase ?? 99) - (b.fase ?? 99)) ||
        // solo fra i senza-fase: raggruppa per saga invece di interlacciarle per data
        (a.fase == null && b.fase == null ? sagaRank(a.categoria) - sagaRank(b.categoria) : 0) ||
        byDateThenOrder(a, b));
    }
    return copy.sort(byDateThenOrder);
  }

  function groupItems(list) {
    // returns array of { label, sublabel, items: [] }
    const groups = [];
    if (state.mode === 'cronologico') {
      // Una sezione per universo, e dentro la sezione il tempo scorre in avanti.
      // Mescolarli per anno puro metterebbe First Steps (1964, Terra-828) in mezzo
      // a due X-Men della Fox: cronologicamente esatto, ma sono universi diversi.
      let current = null;
      list.forEach(item => {
        const u = universoInfo(item.universo);
        const key = u ? u.nome : 'Universo non classificato';
        if (!current || current.label !== key) {
          current = { label: key, sublabel: u ? u.terra : null, items: [] };
          groups.push(current);
        }
        current.items.push(item);
      });
    } else if (state.mode === 'fase') {
      let current = null;
      list.forEach(item => {
        const key = PHASE_LABELS[item.fase] || item.categoria || NO_PHASE_LABEL;
        if (!current || current.label !== key) {
          current = { label: key, items: [] };
          groups.push(current);
        }
        current.items.push(item);
      });
      // Le Fasi restano raggruppate per produzione, che li' e' il criterio giusto:
      // per universo i blocchi Marvel Television e Netflix collasserebbero dentro
      // Terra-616 e finirebbero a litigare con le sei Fasi, anch'esse Terra-616.
      // L'universo lo si dichiara sotto l'intestazione, senza toccare i gruppi.
      groups.forEach(g => {
        const nomi = [];
        g.items.forEach(item => {
          const u = universoInfo(item.universo);
          const nome = u ? u.nome : null;
          if (nome && nomi.indexOf(nome) === -1) nomi.push(nome);
        });
        if (nomi.length) g.sublabel = nomi.join(' · ');
      });
    } else {
      let current = null;
      list.forEach(item => {
        const key = dataVisione(item) ? annoUscita(dataVisione(item)) : 'Uscita da definire';
        if (!current || current.label !== key) {
          current = { label: key, items: [] };
          groups.push(current);
        }
        current.items.push(item);
      });
    }
    return groups;
  }

  function annoLabel(anno) {
    if (!Number.isInteger(anno)) return null;
    return anno < 0 ? `${Math.abs(anno)} a.C.` : String(anno);
  }

  function chipLabel(part) {
    return part.episodi ? `S${part.season} · ${part.episodi.replace('-', '–')}` : `S${part.season}`;
  }

  function findItemById(id) {
    return state.data.find(i => i.id === id);
  }

  // labelText/onSelect let the same row work both in the timeline card
  // (scrolls + flashes the sibling) and inside the modal (swaps content).
  function buildSeasonsRow(item, { labelText, onSelect, className, parts, self }) {
    const row = document.createElement('div');
    row.className = className;

    const label = document.createElement('span');
    label.className = 'seasons-label';
    label.textContent = labelText;
    row.appendChild(label);

    const all = (parts || item.siblings)
      .concat([self || { id: item.id, ordine: item.ordine, season: item.seasonNumber, episodi: item.episodi }])
      .sort((a, b) => (a.season || 0) - (b.season || 0) || episodeStart({ episodi: a.episodi }) - episodeStart({ episodi: b.episodi }));

    all.forEach(s => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'season-chip' + (s.id === item.id ? ' is-current' : '');
      chip.textContent = chipLabel(s);
      if (s.id !== item.id) {
        chip.title = `Vai a ${chipLabel(s)} (posizione #${s.ordine})`;
        chip.addEventListener('click', e => {
          e.stopPropagation();
          onSelect(s.id);
        });
      } else {
        chip.disabled = true;
      }
      row.appendChild(chip);
    });

    return row;
  }

  function jumpToItem(id) {
    // il blocco di destinazione puo' essere accorpato dentro la card della sua
    // stagione: in quel caso la card visibile e' quella del primo blocco
    if (staCollassando()) {
      const dest = findItemById(id);
      if (dest && dest.unita) id = dest.unita.primo.id;
    }
    let target = document.getElementById(`tl-item-${id}`);
    if (!target) {
      // the sibling season is hidden by an active filter: clear filters so it's reachable,
      // and say so — otherwise the result count silently jumps back to the full list.
      resetFilters();
      render();
      announce('Filtri azzerati per mostrare la parte selezionata.');
      target = document.getElementById(`tl-item-${id}`);
      if (!target) return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('flash');
    setTimeout(() => target.classList.remove('flash'), 1400);
  }

  let announceTimer;
  function announce(message) {
    let box = document.getElementById('toast');
    if (!box) {
      box = document.createElement('p');
      box.id = 'toast';
      box.className = 'toast';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    box.textContent = message;
    box.classList.add('is-visible');
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => box.classList.remove('is-visible'), 3200);
  }

  // ============================================================
  // MODAL
  // ============================================================
  let lastFocusedEl = null;

  // conData:false nella scheda, dove il riquadro .modal-uscite dice gia' tutto
  function buildMetaBadges(item, conData) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-meta';

    const tipoBadge = document.createElement('span');
    tipoBadge.className = 'badge badge-tipo';
    tipoBadge.textContent = item.tipo;
    wrap.appendChild(tipoBadge);

    if (item.fase) {
      const faseBadge = document.createElement('span');
      faseBadge.className = 'badge badge-fase';
      faseBadge.textContent = PHASE_LABELS[item.fase];
      wrap.appendChild(faseBadge);
    }

    if (item.categoria) {
      const catBadge = document.createElement('span');
      catBadge.className = 'badge badge-cat';
      catBadge.textContent = item.categoria;
      wrap.appendChild(catBadge);
    }

    const uni = universoInfo(item.universo);
    if (uni) {
      const uniBadge = document.createElement('span');
      uniBadge.className = 'badge badge-universo';
      uniBadge.textContent = uni.nome;
      uniBadge.title = uni.terra;
      wrap.appendChild(uniBadge);
    }

    if (item.obbligatorio) {
      const reqBadge = document.createElement('span');
      reqBadge.className = 'badge badge-required';
      reqBadge.textContent = 'Essenziale';
      wrap.appendChild(reqBadge);
    }

    if (conData === false) return wrap;

    const dateBadge = document.createElement('span');
    const u = item.unita;
    // accorpata, la card copre piu' date: dirne una sola nasconderebbe che la
    // stagione 3 e' finita otto mesi dopo essere cominciata
    const intervallo = staCollassando() && u && u.items.length > 1 && u.dataFine;
    const pretty = intervallo ? formatDate(u.dataInizio) : formatDate(dataVisione(item));
    if (pretty) {
      dateBadge.className = 'badge-date';
      dateBadge.textContent = intervallo ? `${pretty} – ${formatDate(u.dataFine)}` : pretty;
      // dove le due date divergono la card mostra l'italiana: dichiaralo,
      // altrimenti sembra sbagliata a chi ha in mente quella americana
      if (intervallo) {
        // il suggerimento deve coprire tutta la stagione, non solo il primo
        // blocco: altrimenti dichiara una fine che non e' quella mostrata
        const usa = u.items.map(b => b.uscita).filter(Boolean).sort();
        const dal = formatDate(usa[0]), al = formatDate(usa[usa.length - 1]);
        dateBadge.title = dal
          ? `Date italiane, dal primo all'ultimo episodio. Negli Stati Uniti: ${dal}${al && al !== dal ? ' – ' + al : ''}`
          : "Date italiane, dal primo all'ultimo episodio della stagione";
      } else if (item.uscitaItalia && item.uscitaItalia !== item.uscita) {
        dateBadge.title = `Uscita italiana. Negli Stati Uniti: ${formatDate(item.uscita) || 'data non disponibile'}`;
      } else if (!item.uscitaItalia) {
        dateBadge.title = 'Data di uscita originale: il titolo non ha avuto una distribuzione italiana identificabile';
      }
    } else {
      dateBadge.className = 'badge-date is-tbd';
      dateBadge.textContent = item.uscitaRaw ? `Uscita: ${item.uscitaRaw}` : 'Uscita da definire';
    }
    wrap.appendChild(dateBadge);

    return wrap;
  }

  function googleSearchUrl(item) {
    let q = item.displayTitle;
    if (item.seasonNumber && (item.tipo === 'Serie TV' || item.tipo === 'Miniserie')) {
      q += ` stagione ${item.seasonNumber}`;
    }
    return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  }

  function renderModalContent(item) {
    els.modalBody.innerHTML = '';

    const eyebrow = document.createElement('p');
    eyebrow.className = 'modal-eyebrow';
    eyebrow.innerHTML = `Posizione <strong>#${String(item.ordine).padStart(3, '0')}</strong> nell'ordine narrativo`;
    els.modalBody.appendChild(eyebrow);

    const title = document.createElement('h2');
    title.id = 'modal-title';
    title.textContent = item.displayTitle;
    els.modalBody.appendChild(title);

    if (item.seasonNumber && (item.tipo === 'Serie TV' || item.tipo === 'Miniserie')) {
      const sub = document.createElement('p');
      sub.className = 'card-sub';
      sub.style.marginBottom = '14px';
      sub.textContent = item.episodi
        ? `Stagione ${item.seasonNumber} · Episodi ${item.episodi.replace('-', '–')}`
        : `Stagione ${item.seasonNumber}`;
      els.modalBody.appendChild(sub);
    }

    els.modalBody.appendChild(buildMetaBadges(item, false));

    const uscite = document.createElement('dl');
    uscite.className = 'modal-uscite';
    function rigaData(etichetta, iso, nota) {
      const pretty = formatDate(iso);
      const dt = document.createElement('dt');
      dt.textContent = etichetta;
      const dd = document.createElement('dd');
      dd.textContent = pretty || nota || 'non disponibile';
      if (!pretty) dd.className = 'is-tbd';
      uscite.appendChild(dt);
      uscite.appendChild(dd);
    }
    rigaData('Italia', item.uscitaItalia, 'nessuna distribuzione italiana identificata');
    rigaData('Stati Uniti', item.uscita, null);
    if (item.uscitaItalia && item.uscita) {
      const giorni = Math.round((new Date(item.uscitaItalia) - new Date(item.uscita)) / 86400000);
      if (giorni !== 0) {
        const scarto = document.createElement('p');
        scarto.className = 'modal-scarto';
        const g = Math.abs(giorni);
        scarto.textContent = giorni < 0
          ? `In Italia ${g} giorn${g === 1 ? 'o' : 'i'} prima`
          : `In Italia ${g} giorn${g === 1 ? 'o' : 'i'} dopo`;
        uscite.appendChild(scarto);
      }
    }
    els.modalBody.appendChild(uscite);

    const apriScheda = id => {
      const sibling = findItemById(id);
      if (sibling) openModal(sibling);
    };

    if (item.siblings && item.siblings.length) {
      const parti = staCollassando() ? item.siblingsStagioni : item.siblings;
      if (parti && parti.length) {
        els.modalBody.appendChild(buildSeasonsRow(item, {
          labelText: 'Altre parti di questa serie:',
          className: 'modal-seasons',
          onSelect: apriScheda,
          parts: parti,
          self: staCollassando() ? { id: item.id, ordine: item.ordine, season: item.seasonNumber, episodi: null } : null,
        }));
      }
    }

    // La stagione e' divisa perche' un altro titolo si colloca a meta': i blocchi
    // restano raggiungibili anche dalle viste che li accorpano.
    const unitaMod = item.unita;
    if (unitaMod && unitaMod.items.length > 1) {
      els.modalBody.appendChild(buildSeasonsRow(item, {
        labelText: `La stagione ${item.seasonNumber} si divide in:`,
        className: 'modal-seasons modal-blocchi',
        onSelect: apriScheda,
        parts: unitaMod.items
          .filter(b => b !== item)
          .map(b => ({ id: b.id, ordine: b.ordine, season: b.seasonNumber, episodi: b.episodi })),
      }));
    }

    const sections = document.createElement('div');
    sections.className = 'modal-sections';
    const det = state.dettagli[item.id] || null;

    // una sezione senza dati non viene emessa: cinque scatole con la stessa frase
    // di attesa erano peggio che non mostrarle affatto
    function addSection(titolo, build) {
      const body = build();
      if (!body) return;
      const box = document.createElement('div');
      box.className = 'modal-section';
      const h3 = document.createElement('h3');
      h3.textContent = titolo;
      box.appendChild(h3);
      box.appendChild(body);
      sections.appendChild(box);
    }

    const giaMostrati = new Set();

    // riga di collegamenti ad altri titoli: aprono la loro scheda, come i chip stagione
    function titleLinks(ids, etichetta) {
      const validi = (ids || [])
        .filter(x => !giaMostrati.has(x))
        .map(findItemById)
        .filter(Boolean);
      if (!validi.length) return null;
      validi.forEach(v => giaMostrati.add(v.id));
      const wrap = document.createElement('div');
      wrap.className = 'link-row';
      validi.forEach(other => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'title-link';
        const num = document.createElement('span');
        num.className = 'title-link-num';
        num.textContent = String(other.ordine).padStart(3, '0');
        b.appendChild(num);
        b.appendChild(document.createTextNode(
          other.displayTitle + (other.seasonNumber && other.tipo !== 'Film' ? ` (st. ${other.seasonNumber})` : '')
        ));
        if (etichetta) b.title = `${etichetta}: ${other.displayTitle}`;
        b.addEventListener('click', () => openModal(other));
        wrap.appendChild(b);
      });
      return wrap;
    }

    if (det) {
      addSection('Anno di ambientazione', () => {
        const anno = annoLabel(det.annoAmbientazione);
        if (!anno && !det.ambientazione) return null;
        const wrap = document.createDocumentFragment();
        if (anno) {
          const t = document.createElement('p');
          t.className = 'modal-anno' + (det.annoStimato ? ' is-stimato' : '');
          t.textContent = det.annoStimato ? `circa ${anno}` : anno;
          wrap.appendChild(t);
        }
        if (det.annoNota) {
          const nota = document.createElement('p');
          nota.className = 'modal-anno-nota';
          nota.textContent = det.annoNota;
          wrap.appendChild(nota);
        }
        if (det.ambientazione) {
          const p = document.createElement('p');
          p.textContent = det.ambientazione;
          wrap.appendChild(p);
        }
        return wrap;
      });

      addSection('Cast', () => {
        if (!det.cast || !det.cast.length) return null;
        const ul = document.createElement('ul');
        ul.className = 'cast-list';
        det.cast.forEach(c => {
          const li = document.createElement('li');
          const a = document.createElement('span');
          a.className = 'cast-attore';
          a.textContent = c.attore;
          const r = document.createElement('span');
          r.className = 'cast-ruolo';
          r.textContent = c.personaggio;
          li.appendChild(a);
          li.appendChild(r);
          ul.appendChild(li);
        });
        return ul;
      });

      addSection('Da vedere prima per capirlo bene', () => titleLinks(det.prerequisiti, 'Prerequisito'));

      addSection('Sequel / Prequel', () => {
        if (!det.sequelPrequel || !det.sequelPrequel.length) return null;
        const wrap = document.createElement('div');
        ['prequel', 'sequel', 'spin-off'].forEach(rel => {
          const ids = det.sequelPrequel.filter(x => x.relazione === rel).map(x => x.id);
          const row = titleLinks(ids, rel);
          if (!row) return;
          const lab = document.createElement('p');
          lab.className = 'rel-label';
          lab.textContent = rel === 'spin-off' ? 'Spin-off' : rel.charAt(0).toUpperCase() + rel.slice(1);
          wrap.appendChild(lab);
          wrap.appendChild(row);
        });
        return wrap.children.length ? wrap : null;
      });

      addSection('Titoli collegati', () => titleLinks(det.collegati, 'Collegato'));

      if (det.note) {
        const nota = document.createElement('p');
        nota.className = 'modal-nota';
        nota.textContent = det.note;
        sections.appendChild(nota);
      }
    }

    if (!sections.children.length) {
      const vuoto = document.createElement('p');
      vuoto.className = 'is-placeholder';
      vuoto.textContent = 'Per questo titolo non ci sono ancora schede di approfondimento.';
      sections.appendChild(vuoto);
    }
    els.modalBody.appendChild(sections);
  }

  const FOCUSABLE = 'a[href], button:not(:disabled), input, select, textarea, [tabindex]:not([tabindex="-1"])';

  // Tab non deve uscire dal dialog: aria-modal da solo non lo impedisce.
  function trapFocus(e) {
    if (e.key !== 'Tab') return;
    const items = Array.from(els.modal.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === els.modal)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function openModal(item) {
    // I chip dentro la scheda richiamano openModal: senza questa guardia
    // lastFocusedEl finirebbe su un chip che sta per essere distrutto.
    if (els.modalOverlay.hidden) lastFocusedEl = document.activeElement;
    renderModalContent(item);
    els.modalSearch.href = googleSearchUrl(item);
    els.modalOverlay.hidden = false;
    document.body.classList.add('modal-open');
    els.modal.addEventListener('keydown', trapFocus);
    els.modal.focus();
  }

  function closeModal() {
    els.modalOverlay.hidden = true;
    document.body.classList.remove('modal-open');
    els.modal.removeEventListener('keydown', trapFocus);
    if (lastFocusedEl && lastFocusedEl.isConnected) lastFocusedEl.focus();
    else els.search.focus({ preventScroll: true });
  }

  function buildCard(item, displayIndex) {
    // in Fasi e Uscita la card rappresenta l'intera stagione, nella Cronologia
    // il singolo blocco: lo stato "visto" segue la stessa unita'
    const unita = item.unita;
    const collassa = staCollassando() && unita.items.length > 1;
    const eVisto = collassa ? unitaVista(unita) : state.visti.has(item.id);
    const eParziale = collassa && unitaParziale(unita);

    const li = document.createElement('article');
    li.className = 'tl-item'
      + (item.obbligatorio ? '' : ' is-optional')
      + (eVisto ? ' is-visto' : '')
      + (eParziale ? ' is-visto-parziale' : '');
    li.style.animationDelay = (Math.min(displayIndex, 12) * 0.02) + 's';
    li.id = `tl-item-${item.id}`;

    const dot = document.createElement('span');
    dot.className = 'tl-dot';
    li.appendChild(dot);

    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-haspopup', 'dialog');
    card.setAttribute('aria-label', `Apri scheda di ${item.displayTitle}`);
    card.addEventListener('click', () => openModal(item));
    card.addEventListener('keydown', e => {
      if (e.target !== card) return; // il tasto appartiene a un chip figlio: lascialo passare
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openModal(item);
      }
    });

    const top = document.createElement('div');
    top.className = 'card-top';

    const order = document.createElement('span');
    order.className = 'card-order';
    order.textContent = String(item.ordine).padStart(3, '0');
    top.appendChild(order);

    const titleWrap = document.createElement('div');
    titleWrap.className = 'card-title-wrap';
    const title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = item.displayTitle;
    titleWrap.appendChild(title);

    if (item.seasonNumber && (item.tipo === 'Serie TV' || item.tipo === 'Miniserie')) {
      const sub = document.createElement('p');
      sub.className = 'card-sub';
      sub.textContent = item.episodi && !collassa
        ? `Stagione ${item.seasonNumber} · Episodi ${item.episodi.replace('-', '–')}`
        : `Stagione ${item.seasonNumber}`;
      if (collassa) {
        const quanti = document.createElement('span');
        quanti.className = 'card-blocchi';
        quanti.textContent = ` · in ${unita.items.length} parti`;
        quanti.title = 'Nella vista Cronologia questa stagione si divide, perché un altro titolo si colloca a metà';
        sub.appendChild(quanti);
      }
      titleWrap.appendChild(sub);
    }
    top.appendChild(titleWrap);

    const visto = document.createElement('button');
    visto.type = 'button';
    visto.className = 'visto-btn';
    visto.setAttribute('aria-pressed', eParziale ? 'mixed' : (eVisto ? 'true' : 'false'));
    const cosaSegna = collassa ? `la stagione ${item.seasonNumber} di "${item.displayTitle}"` : `"${item.displayTitle}"`;
    visto.setAttribute('aria-label', `Segna ${cosaSegna} come ${eVisto ? 'non vista' : 'vista'}`);
    visto.title = eParziale
      ? (() => {
          const fatti = unita.items.filter(i => state.visti.has(i.id)).length;
          return `Stagione vista in parte (${fatti} blocc${fatti === 1 ? 'o' : 'hi'} su ${unita.items.length}). Segna tutta la stagione`;
        })()
      : (eVisto ? 'Segna come non visto' : 'Segna come visto');
    if (eParziale) visto.classList.add('is-parziale');
    visto.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14"><path d="M2 8.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    visto.addEventListener('click', e => {
      e.stopPropagation();          // non deve aprire la scheda
      if (collassa) toggleUnita(unita); else toggleVisto(item.id);
      render();
    });
    visto.addEventListener('keydown', e => e.stopPropagation());
    top.appendChild(visto);

    card.appendChild(top);

    const parti = staCollassando() ? item.siblingsStagioni : item.siblings;
    if (parti && parti.length) {
      card.appendChild(buildSeasonsRow(item, {
        labelText: 'Serie in più parti:',
        className: 'card-seasons',
        onSelect: jumpToItem,
        parts: parti,
        self: staCollassando() ? { id: item.id, ordine: item.ordine, season: item.seasonNumber, episodi: null } : null,
      }));
    }

    const meta = buildMetaBadges(item);
    meta.className = 'card-meta';
    card.appendChild(meta);

    if (state.mode === 'cronologico') {
      const det = state.dettagli[item.id];
      const anno = det && annoLabel(det.annoAmbientazione);
      if (anno) {
        const amb = document.createElement('p');
        amb.className = 'card-ambientazione';
        // Sette anni sono dedotti dai titoli adiacenti, non documentati: il "circa"
        // e' quello che distingue un dato da una deduzione, e va mostrato.
        amb.textContent = det.annoStimato ? `Ambientato circa nel ${anno}` : `Ambientato nel ${anno}`;
        if (det.annoStimato) amb.classList.add('is-stimato');
        if (det.annoNota) amb.title = det.annoNota;
        card.appendChild(amb);
      }
    }
    li.appendChild(card);
    return li;
  }

  function aggiornaProgresso() {
    if (!els.progress) return;
    let visti = 0;
    state.unita.forEach(u => { if (unitaVista(u)) visti++; });
    const totale = state.unita.size;
    els.progress.hidden = visti === 0;
    if (!totale) return;
    const perc = Math.round((visti / totale) * 100);
    els.progressFill.style.width = perc + '%';
    els.progressText.textContent = `${visti} di ${totale} visti`;
    els.progressBar.setAttribute('aria-valuenow', String(visti));
    els.progressBar.setAttribute('aria-valuemax', String(totale));
    els.progressBar.setAttribute('aria-valuetext', `${visti} di ${totale} titoli visti, ${perc} per cento`);
  }

  function render(opts) {
    const animate = !!(opts && opts.animate);
    const keepScroll = window.scrollY;
    const filtered = getFiltered();
    const sorted = collassaUnita(getSorted(filtered));
    const groups = groupItems(sorted);

    // Il conto e' sempre in stagioni, anche nella Cronologia dove le card sono
    // di piu': altrimenti la stessa selezione darebbe due numeri diversi a
    // seconda della linguetta aperta.
    const nUnita = contaUnita(filtered);
    els.resultCount.textContent = nUnita;
    if (els.resultCountLabel) els.resultCountLabel.textContent = nUnita === 1 ? 'titolo' : 'titoli';
    aggiornaProgresso();
    els.timeline.classList.toggle('no-anim', !animate);
    els.timeline.innerHTML = '';

    if (sorted.length === 0) {
      els.empty.hidden = false;
      return;
    }
    els.empty.hidden = true;

    let idx = 0;
    groups.forEach(group => {
      if (group.label) {
        const divider = document.createElement('div');
        divider.className = 'era-divider';
        const h2 = document.createElement('h2');
        h2.textContent = group.label;
        divider.appendChild(h2);
        if (group.sublabel) {
          const sub = document.createElement('p');
          sub.className = 'era-sublabel';
          sub.textContent = group.sublabel;
          divider.appendChild(sub);
        }
        const count = document.createElement('span');
        count.className = 'era-count';
        count.textContent = group.items.length === 1 ? '1 titolo' : `${group.items.length} titoli`;
        divider.appendChild(count);
        els.timeline.appendChild(divider);
      }

      group.items.forEach(item => {
        els.timeline.appendChild(buildCard(item, idx));
        idx++;
      });
    });

    // innerHTML='' fa collassare l'altezza: senza questo lo scroll salta in alto a ogni tasto.
    if (!animate && window.scrollY !== keepScroll) window.scrollTo({ top: keepScroll });
  }

  init();
})();
