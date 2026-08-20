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
    mode: 'fase', // 'fase' | 'uscita' | 'cronologico'
    search: '',
    tipo: '',
    categoria: '',
    requiredOnly: false,
  };

  const MONTHS = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  const PHASE_LABELS = { 1: 'Fase Uno', 2: 'Fase Due', 3: 'Fase Tre', 4: 'Fase Quattro', 5: 'Fase Cinque', 6: 'Fase Sei' };
  const NO_PHASE_LABEL = 'Fuori Fase';

  // Accetta solo ISO YYYY-MM-DD con mese/giorno plausibili: qualsiasi altra cosa
  // torna null e il chiamante ricade su uscitaRaw / "Uscita da definire".
  function formatDate(iso) {
    const m = typeof iso === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${day} ${MONTHS[month - 1]} ${year}`;
  }

  function decadeLabel(iso) {
    const year = Number(String(iso).slice(0, 4));
    if (!Number.isFinite(year)) return 'Uscita da definire';
    return `${Math.floor(year / 10) * 10}s`;
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
      item.searchKey = normalize(item.titolo);
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
      const res = await fetch('data.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const raw = await res.json();
      if (!Array.isArray(raw)) throw new Error('formato inatteso: atteso un array');
      state.data = linkSeries(raw);
    } catch (err) {
      const hint = location.protocol === 'file:'
        ? 'Stai aprendo la pagina dal filesystem: servila con un piccolo server HTTP (per esempio <code>python -m http.server</code>).'
        : 'Dettaglio: ' + err.message;
      els.timeline.innerHTML = '<p class="empty-state">Impossibile caricare i dati (data.json). ' + hint + '</p>';
      return;
    }
    if (els.totalCount) els.totalCount.textContent = state.data.length;
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
    state.requiredOnly = false;
    els.search.value = '';
    els.tipoFilter.value = '';
    els.catFilter.value = '';
    els.requiredOnly.checked = false;
  }

  function getFiltered() {
    return state.data.filter(item => {
      if (state.search && !item.searchKey.includes(state.search)) return false;
      if (state.tipo && item.tipo !== state.tipo) return false;
      if (state.categoria && item.categoria !== state.categoria) return false;
      if (state.requiredOnly && !item.obbligatorio) return false;
      return true;
    });
  }

  // I titoli senza data vanno in fondo; a parita' di data decide l'ordine narrativo.
  function byDateThenOrder(a, b) {
    if (a.uscita && b.uscita) return a.uscita.localeCompare(b.uscita) || a.ordine - b.ordine;
    if (a.uscita) return -1;
    if (b.uscita) return 1;
    return a.ordine - b.ordine;
  }

  function getSorted(list) {
    const copy = list.slice();
    if (state.mode === 'cronologico') return copy.sort((a, b) => a.ordine - b.ordine);
    if (state.mode === 'fase') return copy.sort((a, b) => ((a.fase ?? 99) - (b.fase ?? 99)) || byDateThenOrder(a, b));
    return copy.sort(byDateThenOrder);
  }

  function groupItems(list) {
    // returns array of { label, sublabel, items: [] }
    const groups = [];
    if (state.mode === 'cronologico') {
      let current = null;
      list.forEach(item => {
        const key = item.categoria || 'Storie indipendenti';
        if (!current || current.label !== key) {
          current = { label: key, items: [] };
          groups.push(current);
        }
        current.items.push(item);
      });
    } else if (state.mode === 'fase') {
      let current = null;
      list.forEach(item => {
        const key = PHASE_LABELS[item.fase] || NO_PHASE_LABEL;
        if (!current || current.label !== key) {
          current = { label: key, items: [] };
          groups.push(current);
        }
        current.items.push(item);
      });
    } else {
      let current = null;
      list.forEach(item => {
        const key = item.uscita ? decadeLabel(item.uscita) : 'Uscita da definire';
        if (!current || current.label !== key) {
          current = { label: key, items: [] };
          groups.push(current);
        }
        current.items.push(item);
      });
    }
    return groups;
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

  function buildMetaBadges(item) {
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

    const dateBadge = document.createElement('span');
    const pretty = formatDate(item.uscita);
    if (pretty) {
      dateBadge.className = 'badge-date';
      dateBadge.textContent = pretty;
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

    els.modalBody.appendChild(buildMetaBadges(item));

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
    sections.innerHTML = `
      <div class="modal-section">
        <h3>Anno di ambientazione</h3>
        <p class="is-placeholder">Informazioni in arrivo.</p>
      </div>
      <div class="modal-section">
        <h3>Cast</h3>
        <p class="is-placeholder">Informazioni in arrivo.</p>
      </div>
      <div class="modal-section">
        <h3>Titoli collegati</h3>
        <p class="is-placeholder">Informazioni in arrivo.</p>
      </div>
      <div class="modal-section">
        <h3>Da vedere prima per capirlo bene</h3>
        <p class="is-placeholder">Informazioni in arrivo.</p>
      </div>
      <div class="modal-section">
        <h3>Sequel / Prequel</h3>
        <p class="is-placeholder">Informazioni in arrivo.</p>
      </div>
    `;
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
    li.className = 'tl-item' + (item.obbligatorio ? '' : ' is-optional');
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
    li.appendChild(card);
    return li;
  }

  function render(opts) {
    const animate = !!(opts && opts.animate);
    const keepScroll = window.scrollY;
    const filtered = getFiltered();
    const sorted = getSorted(filtered);
    const groups = groupItems(sorted);

    els.resultCount.textContent = filtered.length;
    if (els.resultCountLabel) els.resultCountLabel.textContent = filtered.length === 1 ? 'titolo' : 'titoli';
    els.timeline.classList.toggle('no-anim', !animate);
    els.timeline.innerHTML = '';

    if (filtered.length === 0) {
      els.empty.hidden = false;
      return;
    }
    els.empty.hidden = true;

    let idx = 0;
    groups.forEach(group => {
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
