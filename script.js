(function () {
  'use strict';

  const els = {
    timeline: document.getElementById('timeline'),
    empty: document.getElementById('empty-state'),
    resetBtn: document.getElementById('reset-filters'),
    resultCount: document.getElementById('result-count'),
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

  function formatDate(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }

  function decadeLabel(iso) {
    const year = Number(iso.slice(0, 4));
    const decadeStart = Math.floor(year / 10) * 10;
    return `${decadeStart}s`;
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
      const raw = await res.json();
      state.data = linkSeries(raw);
    } catch (err) {
      els.timeline.innerHTML = '<p class="empty-state">Impossibile caricare i dati (data.json). Se stai aprendo il file localmente, prova a servirlo con un piccolo server HTTP.</p>';
      return;
    }
    populateFilters();
    bindEvents();
    render();
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
        render();
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
        state.search = els.search.value.trim().toLowerCase();
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
      state.search = '';
      state.tipo = '';
      state.categoria = '';
      state.requiredOnly = false;
      els.search.value = '';
      els.tipoFilter.value = '';
      els.catFilter.value = '';
      els.requiredOnly.checked = false;
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

  function getFiltered() {
    return state.data.filter(item => {
      if (state.search && !item.titolo.toLowerCase().includes(state.search) && !item.displayTitle.toLowerCase().includes(state.search)) return false;
      if (state.tipo && item.tipo !== state.tipo) return false;
      if (state.categoria && item.categoria !== state.categoria) return false;
      if (state.requiredOnly && !item.obbligatorio) return false;
      return true;
    });
  }

  function getSorted(list) {
    const copy = list.slice();
    if (state.mode === 'cronologico') {
      copy.sort((a, b) => a.ordine - b.ordine);
    } else if (state.mode === 'fase') {
      copy.sort((a, b) => {
        const fa = a.fase || 99, fb = b.fase || 99;
        if (fa !== fb) return fa - fb;
        if (a.uscita && b.uscita) return a.uscita.localeCompare(b.uscita);
        if (a.uscita && !b.uscita) return -1;
        if (!a.uscita && b.uscita) return 1;
        return a.ordine - b.ordine;
      });
    } else {
      copy.sort((a, b) => {
        if (a.uscita && b.uscita) return a.uscita.localeCompare(b.uscita);
        if (a.uscita && !b.uscita) return -1;
        if (!a.uscita && b.uscita) return 1;
        return a.ordine - b.ordine;
      });
    }
    return copy;
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
        const key = item.fase ? PHASE_LABELS[item.fase] : NO_PHASE_LABEL;
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
      // the sibling season is hidden by an active filter: clear filters so it's reachable
      state.search = '';
      state.tipo = '';
      state.categoria = '';
      state.requiredOnly = false;
      els.search.value = '';
      els.tipoFilter.value = '';
      els.catFilter.value = '';
      els.requiredOnly.checked = false;
      render();
      target = document.getElementById(`tl-item-${ordine}`);
      if (!target) return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('flash');
    setTimeout(() => target.classList.remove('flash'), 1400);
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
    if (item.uscita) {
      dateBadge.className = 'badge-date';
      dateBadge.textContent = formatDate(item.uscita);
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

  function openModal(item) {
    lastFocusedEl = document.activeElement;
    renderModalContent(item);
    els.modalSearch.href = googleSearchUrl(item);
    els.modalOverlay.hidden = false;
    els.modal.focus();
  }

  function closeModal() {
    els.modalOverlay.hidden = true;
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
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

  function render() {
    const filtered = getFiltered();
    const sorted = getSorted(filtered);
    const groups = groupItems(sorted);

    els.resultCount.textContent = filtered.length;
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
  }

  init();
})();
