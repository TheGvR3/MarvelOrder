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
    mode: 'fase', // 'fase' | 'uscita' | 'cronologico'
    search: '',
    tipo: '',
    categoria: '',
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

  function toggleVisto(ordine) {
    if (state.visti.has(ordine)) state.visti.delete(ordine);
    else state.visti.add(ordine);
    salvaVisti();
  }

  const MONTHS = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  const PHASE_LABELS = { 1: 'Fase Uno', 2: 'Fase Due', 3: 'Fase Tre', 4: 'Fase Quattro', 5: 'Fase Cinque', 6: 'Fase Sei' };
  // I titoli senza fase (Fox, Sony, TV, pre-MCU) finivano tutti in un unico blocco da 82 card.
  // Qui definisce l'ordine con cui le saghe si susseguono dopo le sei Fasi.
  const SAGA_ORDER = [
    'Pre-MCU',
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

  // Apostrofi curvi e dritti convivono nei dati e gli accenti si digitano a fatica:
  // la ricerca confronta forme normalizzate, non le stringhe grezze.
  function normalize(str) {
    return String(str == null ? '' : str)
      .toLowerCase()
      .replace(/[‘’ʼ´`]/g, "'")
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

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

  function linkSeries(data) {
    const byKey = new Map();

    data.forEach(item => {
      item.displayTitle = item.titolo;
      item.seasonNumber = item.stagione || null;
      // 426 attori e 473 personaggi erano nei dati ma invisibili alla ricerca:
      // cercare "Tom Holland" o "Scarlet Witch" non trovava nulla.
      const det = state.dettagli[item.ordine];
      const cast = det && det.cast ? det.cast.map(c => `${c.attore} ${c.personaggio}`).join(' ') : '';
      item.searchKey = normalize(`${item.titolo} ${cast}`);
      const key = `${item.titolo}::${item.tipo}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(item);
    });

    byKey.forEach(group => {
      if (group.length < 2) return; // single-part shows don't need cross-links
      group.sort((a, b) => (a.seasonNumber || 0) - (b.seasonNumber || 0) || episodeStart(a) - episodeStart(b));
      group.forEach(item => {
        item.siblings = group
          .filter(other => other !== item)
          .map(other => ({ ordine: other.ordine, season: other.seasonNumber, episodi: other.episodi }));
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
    } catch (err) {
      const hint = location.protocol === 'file:'
        ? 'Stai aprendo la pagina dal filesystem: servila con un piccolo server HTTP (per esempio <code>python -m http.server</code>).'
        : 'Dettaglio: ' + err.message;
      els.timeline.innerHTML = '<p class="empty-state">Impossibile caricare i dati (data.json). ' + hint + '</p>';
      return;
    }
    if (els.totalCount) els.totalCount.textContent = state.data.length;
    state.visti = caricaVisti();
    // un ordine rimasto in localStorage e non piu' presente nei dati va scartato
    const esistenti = new Set(state.data.map(d => d.ordine));
    [...state.visti].forEach(o => { if (!esistenti.has(o)) state.visti.delete(o); });
    populateFilters();
    bindEvents();
    render({ animate: true });
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
    state.fase = '';
    state.requiredOnly = false;
    state.hideWatched = false;
    els.search.value = '';
    els.tipoFilter.value = '';
    els.catFilter.value = '';
    els.faseFilter.value = '';
    els.requiredOnly.checked = false;
    els.hideWatched.checked = false;
  }

  function getFiltered() {
    return state.data.filter(item => {
      if (state.search && !item.searchKey.includes(state.search)) return false;
      if (state.tipo && item.tipo !== state.tipo) return false;
      if (state.categoria && item.categoria !== state.categoria) return false;
      if (state.fase === 'nessuna' ? item.fase != null : state.fase && String(item.fase) !== state.fase) return false;
      if (state.requiredOnly && !item.obbligatorio) return false;
      if (state.hideWatched && state.visti.has(item.ordine)) return false;
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
    if (state.mode === 'cronologico') return copy.sort((a, b) => a.ordine - b.ordine);
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
      // L'ordine narrativo salta di proposito da una saga all'altra: raggruppare per
      // categoria produceva un divisore ogni 1,7 card. La saga resta leggibile dalla badge.
      if (list.length) groups.push({ label: null, items: list.slice() });
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

  function findItemByOrdine(ordine) {
    return state.data.find(i => i.ordine === ordine);
  }

  // labelText/onSelect let the same row work both in the timeline card
  // (scrolls + flashes the sibling) and inside the modal (swaps content).
  function buildSeasonsRow(item, { labelText, onSelect, className }) {
    const row = document.createElement('div');
    row.className = className;

    const label = document.createElement('span');
    label.className = 'seasons-label';
    label.textContent = labelText;
    row.appendChild(label);

    const all = item.siblings
      .concat([{ ordine: item.ordine, season: item.seasonNumber, episodi: item.episodi }])
      .sort((a, b) => (a.season || 0) - (b.season || 0) || episodeStart({ episodi: a.episodi }) - episodeStart({ episodi: b.episodi }));

    all.forEach(s => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'season-chip' + (s.ordine === item.ordine ? ' is-current' : '');
      chip.textContent = chipLabel(s);
      if (s.ordine !== item.ordine) {
        chip.title = `Vai a ${chipLabel(s)} (posizione #${s.ordine})`;
        chip.addEventListener('click', e => {
          e.stopPropagation();
          onSelect(s.ordine);
        });
      } else {
        chip.disabled = true;
      }
      row.appendChild(chip);
    });

    return row;
  }

  function jumpToItem(ordine) {
    let target = document.getElementById(`tl-item-${ordine}`);
    if (!target) {
      // the sibling season is hidden by an active filter: clear filters so it's reachable,
      // and say so — otherwise the result count silently jumps back to the full list.
      resetFilters();
      render();
      announce('Filtri azzerati per mostrare la parte selezionata.');
      target = document.getElementById(`tl-item-${ordine}`);
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

    if (item.obbligatorio) {
      const reqBadge = document.createElement('span');
      reqBadge.className = 'badge badge-required';
      reqBadge.textContent = 'Essenziale';
      wrap.appendChild(reqBadge);
    }

    if (conData === false) return wrap;

    const dateBadge = document.createElement('span');
    const pretty = formatDate(dataVisione(item));
    if (pretty) {
      dateBadge.className = 'badge-date';
      dateBadge.textContent = pretty;
      // dove le due date divergono la card mostra l'italiana: dichiaralo,
      // altrimenti sembra sbagliata a chi ha in mente quella americana
      if (item.uscitaItalia && item.uscitaItalia !== item.uscita) {
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

    if (item.siblings && item.siblings.length) {
      const seasonsWrap = buildSeasonsRow(item, {
        labelText: 'Altre parti di questa serie:',
        className: 'modal-seasons',
        onSelect: ordine => {
          const sibling = findItemByOrdine(ordine);
          if (sibling) openModal(sibling);
        },
      });
      els.modalBody.appendChild(seasonsWrap);
    }

    const sections = document.createElement('div');
    sections.className = 'modal-sections';
    const det = state.dettagli[item.ordine] || null;

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
    function titleLinks(ordini, etichetta) {
      const validi = (ordini || [])
        .filter(o => !giaMostrati.has(o))
        .map(findItemByOrdine)
        .filter(Boolean);
      if (!validi.length) return null;
      validi.forEach(v => giaMostrati.add(v.ordine));
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
        if (!det.ambientazione) return null;
        const p = document.createElement('p');
        p.textContent = det.ambientazione;
        return p;
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
          const ordini = det.sequelPrequel.filter(x => x.relazione === rel).map(x => x.ordine);
          const row = titleLinks(ordini, rel);
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
    const li = document.createElement('article');
    li.className = 'tl-item'
      + (item.obbligatorio ? '' : ' is-optional')
      + (state.visti.has(item.ordine) ? ' is-visto' : '');
    li.style.animationDelay = (Math.min(displayIndex, 12) * 0.02) + 's';
    li.id = `tl-item-${item.ordine}`;

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
      sub.textContent = item.episodi
        ? `Stagione ${item.seasonNumber} · Episodi ${item.episodi.replace('-', '–')}`
        : `Stagione ${item.seasonNumber}`;
      titleWrap.appendChild(sub);
    }
    top.appendChild(titleWrap);

    const visto = document.createElement('button');
    visto.type = 'button';
    visto.className = 'visto-btn';
    visto.setAttribute('aria-pressed', state.visti.has(item.ordine) ? 'true' : 'false');
    visto.setAttribute('aria-label', `Segna "${item.displayTitle}" come ${state.visti.has(item.ordine) ? 'non visto' : 'visto'}`);
    visto.title = state.visti.has(item.ordine) ? 'Segna come non visto' : 'Segna come visto';
    visto.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14"><path d="M2 8.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    visto.addEventListener('click', e => {
      e.stopPropagation();          // non deve aprire la scheda
      toggleVisto(item.ordine);
      render();
    });
    visto.addEventListener('keydown', e => e.stopPropagation());
    top.appendChild(visto);

    card.appendChild(top);

    if (item.siblings && item.siblings.length) {
      card.appendChild(buildSeasonsRow(item, {
        labelText: 'Serie in più parti:',
        className: 'card-seasons',
        onSelect: jumpToItem,
      }));
    }

    const meta = buildMetaBadges(item);
    meta.className = 'card-meta';
    card.appendChild(meta);

    if (state.mode === 'cronologico') {
      const det = state.dettagli[item.ordine];
      const anno = det && annoLabel(det.annoAmbientazione);
      if (anno) {
        const amb = document.createElement('p');
        amb.className = 'card-ambientazione';
        amb.textContent = `Ambientato nel ${anno}`;
        card.appendChild(amb);
      }
    }
    li.appendChild(card);
    return li;
  }

  function aggiornaProgresso() {
    if (!els.progress) return;
    const visti = state.visti.size, totale = state.data.length;
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
    const sorted = getSorted(filtered);
    const groups = groupItems(sorted);

    els.resultCount.textContent = filtered.length;
    if (els.resultCountLabel) els.resultCountLabel.textContent = filtered.length === 1 ? 'titolo' : 'titoli';
    aggiornaProgresso();
    els.timeline.classList.toggle('no-anim', !animate);
    els.timeline.innerHTML = '';

    if (filtered.length === 0) {
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
