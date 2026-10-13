/* ============================================================
   MAPPA DEGLI UNIVERSI
   ============================================================

   Due letture dello stesso grafo, scelte con le schede in alto:

     universi  21 nodi, uno per universo, e i 17 ponti che li collegano.
               E' la risposta alla domanda "come si toccano fra loro".
     titoli    156 nodi, uno per unita' (la stagione intera, non il blocco di
               episodi: vedi comune.js), raggruppati per universo.

   Gli archi vengono da dettagli.json: prerequisiti, sequel/prequel e collegati.
   Un arco fra gli stessi due titoli puo' nascere da piu' campi contemporanea-
   mente, quindi vengono fusi in uno solo che porta con se' l'elenco dei motivi.

   La disposizione e' calcolata una volta sola al caricamento, con un generatore
   pseudo-casuale a seme fisso: la mappa e' identica a ogni ricaricamento, e i
   filtri nascondono i nodi senza spostare quelli che restano.

   Le due letture condividono le posizioni: gli ammassi della vista "titoli"
   stanno dove stavano i nodi della vista "universi", cosi' passare dall'una
   all'altra non disorienta.
   ============================================================ */
(function () {
  'use strict';

  const UNIVERSI = window.MARVEL_UNIVERSI;
  const unitaKey = window.MARVEL_UNITA_KEY;
  const normalize = window.MARVEL_NORMALIZE;
  const trova = window.MARVEL_TROVA;

  const SCONOSCIUTO = { id: '', nome: 'Universo non classificato', colore: '#6b6a73', terra: '', rank: UNIVERSI.length };
  const INFO = new Map(UNIVERSI.map((u, i) => [u.id, Object.assign({ rank: i }, u)]));
  const info = id => INFO.get(id) || SCONOSCIUTO;

  const NS = 'http://www.w3.org/2000/svg';
  const W = 1200, H = 820;   // spazio logico in cui viene calcolata la disposizione

  // Il riquadro visibile invece segue la forma della scatola: su un telefono e'
  // verticale, e un viewBox orizzontale fisso ci finirebbe dentro schiacciato in
  // una striscia alta un terzo, con due fasce vuote sopra e sotto. La larghezza
  // resta 1200, l'altezza la detta il rapporto vero.
  const VB = { w: W, h: H };

  // I tre campi di dettagli.json diventano tre classi di legame. sequel,
  // prequel e spin-off dicono la stessa cosa con verso diverso, e sul filo
  // disegnato il verso non si vede: la direzione la racconta il pannello.
  const CLASSE = {
    prerequisito: 'prerequisito',
    sequel: 'sequela', prequel: 'sequela', 'spin-off': 'sequela',
    collegato: 'collegato',
  };
  // quando un arco nasce da piu' motivi, vince il piu' stretto
  const PRIORITA = ['sequela', 'prerequisito', 'collegato'];
  const NOME_CLASSE = {
    sequela: 'Sequel e prequel',
    prerequisito: 'Prerequisiti',
    collegato: 'Rimandi',
  };
  // Come si legge un legame dal punto di vista di un titolo: prima la frase se
  // il rimando parte da lui, poi quella se il rimando arriva.
  //
  // sequel e prequel sono la STESSA relazione vista dai due capi: "Endgame ha
  // come sequel Doomsday" e "Doomsday ha come prequel Endgame" dicono una cosa
  // sola, e i dati la dichiarano quasi sempre da entrambe le parti. Mandandole
  // in due frasi diverse la scheda elencava Endgame due volte. Qui i quattro
  // casi collassano su due frasi, e la coppia compare una volta sola.
  const VERSO = {
    sequel: ['ha come sequel', 'e’ il sequel di'],
    prequel: ['e’ il sequel di', 'ha come sequel'],
    'spin-off': ['ha come spin-off', 'e’ uno spin-off di'],
    prerequisito: ['richiede prima', 'e’ un prerequisito di'],
    collegato: ['e’ collegato a', 'e’ collegato a'],
  };
  // Un titolo che e' gia' comparso come sequel non torna fra i prerequisiti e
  // fra i rimandi: la prima frase se lo prende, come fa la scheda nella linea
  // temporale. L'ordine di questo elenco e' quindi l'ordine di precedenza.
  const ORDINE_VERSO = [
    'e’ il sequel di', 'ha come sequel',
    'e’ uno spin-off di', 'ha come spin-off',
    'richiede prima', 'e’ un prerequisito di',
    'e’ collegato a',
  ];

  const els = {};
  const state = {
    modo: 'universi',
    cerca: '',
    universo: '',
    legami: { sequela: true, prerequisito: true, collegato: true },
    soloEssenziali: false,
    sel: null,          // selezione bloccata dal clic
    hover: null,        // anteprima al passaggio
    vista: { x: 0, y: 0, k: 1 },
    grafo: null,
  };

  // ============================================================
  // NUMERI CASUALI RIPETIBILI
  // ============================================================
  // La disposizione parte da un pizzico di rumore per non far collassare i nodi
  // sovrapposti. Con Math.random la mappa cambierebbe a ogni ricaricamento e
  // due schermate della stessa cosa non sarebbero confrontabili.
  function seme(s) {
    return function () {
      s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ============================================================
  // COSTRUZIONE DEL GRAFO
  // ============================================================
  function costruisci(data, dettagli) {
    const unita = new Map();
    const perRiga = new Map();

    data.forEach(item => {
      const k = unitaKey(item);
      perRiga.set(item.id, k);
      if (!unita.has(k)) unita.set(k, { key: k, blocchi: [] });
      unita.get(k).blocchi.push(item);
    });

    const nodi = [];
    unita.forEach(u => {
      u.blocchi.sort((a, b) => a.ordine - b.ordine);
      const primo = u.blocchi[0];
      const det = dettagli[primo.id] || {};
      u.id = primo.id;                    // identita' immutabile: regge i link
      u.ordine = primo.ordine;
      u.titolo = primo.titolo;
      u.stagione = primo.stagione;
      u.etichetta = primo.stagione != null ? `${primo.titolo} · S${primo.stagione}` : primo.titolo;
      u.tipo = primo.tipo;
      u.universo = primo.universo;
      u.categoria = primo.categoria;
      u.fase = primo.fase;
      // un blocco essenziale rende essenziale la stagione: e' l'unita' che si guarda
      u.obbligatorio = u.blocchi.some(b => b.obbligatorio);
      u.anno = Number.isInteger(det.annoAmbientazione) ? det.annoAmbientazione : null;
      u.annoStimato = !!det.annoStimato;
      u.ambientazione = det.ambientazione || null;
      // Stessa indicizzazione della linea temporale: titolo, forma senza punti
      // (chiunque cerchi S.H.I.E.L.D. scrive "shield") e cast, attori e
      // personaggi. Se qui si cercasse meno, "Chris Evans" troverebbe qualcosa
      // in una pagina e niente nell'altra.
      const cast = u.blocchi
        .map(b => (dettagli[b.id] && dettagli[b.id].cast) || [])
        .reduce((tutti, c) => tutti.concat(c), [])
        .map(c => `${c.attore} ${c.personaggio}`).join(' ');
      u.cerca = normalize(`${u.titolo} ${u.titolo.replace(/\./g, '')} ${info(u.universo).nome} ${cast}`);
      u.archi = [];
      nodi.push(u);
    });

    // ordine di lettura: universo, poi anno di ambientazione, come la Cronologia
    nodi.sort((a, b) =>
      info(a.universo).rank - info(b.universo).rank ||
      ((a.anno == null ? Infinity : a.anno) - (b.anno == null ? Infinity : b.anno)) ||
      a.ordine - b.ordine);

    const archi = new Map();
    function collega(daRiga, aRiga, tipo) {
      const ka = perRiga.get(daRiga), kb = perRiga.get(aRiga);
      // un rimando a un id inesistente, o interno alla stessa stagione, non e' un arco
      if (!ka || !kb || ka === kb) return;
      const chiave = ka < kb ? ka + '##' + kb : kb + '##' + ka;
      let e = archi.get(chiave);
      if (!e) {
        e = { chiave, a: unita.get(ka), b: unita.get(kb), classi: new Set(), motivi: [] };
        archi.set(chiave, e);
      }
      e.classi.add(CLASSE[tipo]);
      e.motivi.push({ da: ka, a: kb, tipo });
    }

    data.forEach(item => {
      const det = dettagli[item.id];
      if (!det) return;
      (det.prerequisiti || []).forEach(id => collega(item.id, id, 'prerequisito'));
      (det.collegati || []).forEach(id => collega(item.id, id, 'collegato'));
      (det.sequelPrequel || []).forEach(x => collega(item.id, x.id, x.relazione));
    });

    const listaArchi = [];
    archi.forEach(e => {
      e.classe = PRIORITA.find(c => e.classi.has(c)) || 'collegato';
      e.a.archi.push(e);
      e.b.archi.push(e);
      listaArchi.push(e);
    });

    // ---- livello universi ----
    const conteggio = new Map();
    nodi.forEach(n => conteggio.set(n.universo, (conteggio.get(n.universo) || 0) + 1));
    const uNodi = UNIVERSI
      .filter(u => conteggio.has(u.id))
      .map(u => Object.assign({}, u, {
        key: u.id,
        conta: conteggio.get(u.id),
        titoli: nodi.filter(n => n.universo === u.id),
        ponti: [],
        cerca: normalize(`${u.nome} ${u.terra}`),
      }));
    const uPerId = new Map(uNodi.map(u => [u.id, u]));

    const ponti = new Map();
    listaArchi.forEach(e => {
      if (e.a.universo === e.b.universo) return;
      const x = e.a.universo, y = e.b.universo;
      const chiave = info(x).rank < info(y).rank ? x + '|' + y : y + '|' + x;
      let p = ponti.get(chiave);
      if (!p) {
        const [ia, ib] = chiave.split('|');
        p = { chiave, a: uPerId.get(ia), b: uPerId.get(ib), archi: [] };
        ponti.set(chiave, p);
      }
      p.archi.push(e);
    });
    const listaPonti = [];
    ponti.forEach(p => {
      if (!p.a || !p.b) return;   // universo assente dai dati: il ponte non regge
      p.peso = p.archi.length;
      p.a.ponti.push(p);
      p.b.ponti.push(p);
      listaPonti.push(p);
    });
    listaPonti.sort((a, b) => b.peso - a.peso);

    return { nodi, archi: listaArchi, uNodi, listaPonti };
  }

  // ============================================================
  // DISPOSIZIONE
  // ============================================================
  // Simulazione a forze deliberatamente semplice: 156 nodi sono pochi, girano
  // in una manciata di millisecondi in O(n^2) e non serve nessuna libreria.
  // Il numero di passi e' fisso, quindi il risultato e' sempre lo stesso.
  function simula(nodi, archi, opz) {
    const passi = opz.passi;
    const rand = seme(opz.seme);
    nodi.forEach(n => { n.vx = 0; n.vy = 0; n.x += (rand() - 0.5) * 0.8; n.y += (rand() - 0.5) * 0.8; });

    for (let t = 0; t < passi; t++) {
      const alpha = 1 - t / passi;

      for (let i = 0; i < nodi.length; i++) {
        const a = nodi[i];
        for (let j = i + 1; j < nodi.length; j++) {
          const b = nodi[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = (rand() - 0.5); dy = (rand() - 0.5); d2 = dx * dx + dy * dy + 0.01; }
          const d = Math.sqrt(d2);
          const minima = a.r + b.r + opz.aria;
          // La repulsione e' di corto raggio. Lasciata agire su tutte le coppie
          // fa esplodere la nuvola: 150 nodi che si spingono a vicenda vincono
          // sempre sulle molle, e la mappa finisce dieci volte piu' larga del
          // riquadro, cioe' con i punti grandi due pixel.
          if (d > minima * opz.taglio) continue;
          // repulsione morbida a distanza, muro rigido appena si toccano
          let f = opz.repulsione * (a.r + b.r) / d2;
          if (d < minima) f += (minima - d) * opz.collisione;
          const fx = dx / d * f, fy = dy / d * f;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }

      archi.forEach(e => {
        const a = e.na, b = e.nb;
        if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = (d - e.lunghezza) * opz.molla;
        const fx = dx / d * f, fy = dy / d * f;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      });

      nodi.forEach(n => {
        // Gravita' schiacciata: il riquadro e' 1200x820, una nuvola tonda ci
        // lascerebbe due fasce vuote ai lati e i nodi piu' piccoli del dovuto.
        n.vx += (W / 2 - n.x) * opz.gravita;
        n.vy += (H / 2 - n.y) * opz.gravita * opz.schiaccia;
        if (n.ancoraX != null) {
          n.vx += (n.ancoraX - n.x) * n.ancora * (0.35 + 0.65 * alpha);
          n.vy += (n.ancoraY - n.y) * n.ancora * (0.35 + 0.65 * alpha);
        }
        if (n.fisso) { n.vx = 0; n.vy = 0; return; }
        n.vx *= opz.attrito; n.vy *= opz.attrito;
        const v = Math.hypot(n.vx, n.vy);
        const max = opz.passoMax;
        if (v > max) { n.vx = n.vx / v * max; n.vy = n.vy / v * max; }
        n.x += n.vx; n.y += n.vy;
      });
    }

    // ultima passata puramente geometrica: nessun nodo deve coprirne un altro
    for (let giro = 0; giro < 60; giro++) {
      let mosso = false;
      for (let i = 0; i < nodi.length; i++) {
        for (let j = i + 1; j < nodi.length; j++) {
          const a = nodi[i], b = nodi[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          const minima = a.r + b.r + opz.aria;
          if (d >= minima) continue;
          if (d < 0.01) { dx = 1; dy = 0; d = 1; }
          const spinta = (minima - d) / 2;
          const ux = dx / d * spinta, uy = dy / d * spinta;
          if (!a.fisso) { a.x -= ux; a.y -= uy; }
          if (!b.fisso) { b.x += ux; b.y += uy; }
          mosso = true;
        }
      }
      if (!mosso) break;
    }
  }

  // Le costanti qui sotto non sono scelte a occhio: sono state tarate fuori dal
  // browser misurando, per ogni combinazione, l'ingombro finale, il numero di
  // nodi sovrapposti e quanto grande resta un punto una volta inquadrata la
  // mappa. Il bersaglio e' un ingombro vicino a 1200x820, zero sovrapposizioni e
  // un raggio di circa 8px a schermo.
  function disponi(grafo) {
    // ---- universi ----
    const uNodi = grafo.uNodi;
    const SCHIACCIA = 2.6;
    uNodi.forEach((u, i) => {
      u.r = 13 + Math.sqrt(u.conta) * 5.2;
      if (i === 0) {                       // Terra-616 e' il centro di gravita'
        u.x = W / 2; u.y = H / 2; u.fisso = true;
      } else {
        const ang = (i - 1) / (uNodi.length - 1) * Math.PI * 2 - Math.PI / 2;
        u.x = W / 2 + Math.cos(ang) * 320;
        u.y = H / 2 + Math.sin(ang) * 320 / SCHIACCIA;
        u.ancoraX = u.x; u.ancoraY = u.y; u.ancora = 0.006;
      }
    });
    const uPerId = new Map(uNodi.map(u => [u.id, u]));
    grafo.listaPonti.forEach(p => {
      p.na = uPerId.get(p.a.id);
      p.nb = uPerId.get(p.b.id);
      // piu' titoli fanno da ponte, piu' i due universi si stringono
      p.lunghezza = Math.max(p.na.r + p.nb.r + 34, p.na.r + p.nb.r + 150 - p.peso * 8);
    });
    simula(uNodi, grafo.listaPonti, {
      passi: 900, seme: 20250825, repulsione: 400, taglio: 2.5, collisione: 0.9,
      molla: 0.012, attrito: 0.82, aria: 26, passoMax: 6,
      gravita: 0.0010, schiaccia: SCHIACCIA,
    });

    // ---- titoli ----
    // L'ammasso di Terra-616 e' molto piu' largo del cerchio che lo rappresenta
    // fra gli universi, quindi le ancore non possono stare dov'erano quei
    // cerchi: si tiene la direzione, che e' l'informazione che si legge
    // passando da una vista all'altra, e si allontana il raggio quanto basta a
    // far sgombrare il centro.
    const raggioStimato = u => Math.sqrt(u.conta) * 14;
    const r616 = raggioStimato(uNodi[0]);
    const ancore = new Map();
    uNodi.forEach((u, i) => {
      if (i === 0) { ancore.set(u.id, { x: W / 2, y: H / 2 }); return; }
      const ang = Math.atan2(u.y - H / 2, u.x - W / 2);
      const orig = Math.hypot(u.x - W / 2, u.y - H / 2);
      const d = Math.max(r616 + raggioStimato(u) + 90, orig * 1.6);
      ancore.set(u.id, { x: W / 2 + Math.cos(ang) * d, y: H / 2 + Math.sin(ang) * d });
    });

    const nodi = grafo.nodi;
    nodi.forEach((n, i) => {
      const u = uPerId.get(n.universo);
      n.r = 7.4;
      const a = ancore.get(n.universo) || { x: W / 2, y: H / 2 };
      // seme a spirale dentro l'ammasso, in ordine cronologico: anche prima che
      // le forze intervengano la disposizione ha gia' un senso
      const dentro = u ? u.titoli.indexOf(n) : i;
      const quanti = u ? u.titoli.length : nodi.length;
      const ang = dentro * 2.399963;                        // angolo aureo
      const rag = Math.sqrt(dentro + 0.5) * (quanti > 40 ? 20 : 15);
      n.x = a.x + Math.cos(ang) * rag;
      n.y = a.y + Math.sin(ang) * rag;
      n.ancoraX = a.x; n.ancoraY = a.y;
      // l'ammasso grande deve poter respirare, quello da un titolo no
      n.ancora = quanti > 40 ? 0.0022 : 0.02;
    });
    const perChiave = new Map(nodi.map(n => [n.key, n]));
    grafo.archi.forEach(e => {
      e.na = perChiave.get(e.a.key);
      e.nb = perChiave.get(e.b.key);
      const stesso = e.a.universo === e.b.universo;
      e.lunghezza = stesso ? 46 : 190;   // i ponti sono lunghi: si devono vedere
    });
    simula(nodi, grafo.archi, {
      passi: 700, seme: 7716, repulsione: 25, taglio: 3, collisione: 0.55,
      molla: 0.010, attrito: 0.86, aria: 7, passoMax: 5,
      gravita: 0.0014, schiaccia: 2.2,
    });

    // posizione dell'etichetta di ogni ammasso: sopra il suo baricentro
    uNodi.forEach(u => {
      if (!u.titoli.length) return;
      let cx = 0, cy = 0, alto = Infinity;
      u.titoli.forEach(n => { cx += n.x; cy += n.y; alto = Math.min(alto, n.y - n.r); });
      u.etichettaX = cx / u.titoli.length;
      u.etichettaY = alto - 12;
    });
  }

  // ============================================================
  // FILTRI
  // ============================================================
  function nodoVisibile(n) {
    if (state.universo && n.universo !== state.universo) return false;
    if (state.soloEssenziali && !n.obbligatorio) return false;
    return true;
  }
  const arcoVisibile = e => state.legami[e.classe] && nodoVisibile(e.a) && nodoVisibile(e.b);

  // Isolare un universo nella vista d'insieme non vuol dire lasciarlo solo: senza
  // i suoi vicini i ponti sarebbero fili che finiscono nel vuoto, ed e' proprio
  // dove arrivano la cosa che si vuole vedere.
  function universoVisibile(u) {
    if (!state.universo) return true;
    if (u.id === state.universo) return true;
    return u.ponti.some(p => (p.a.id === state.universo || p.b.id === state.universo) && pesoVisibile(p) > 0);
  }
  const pesoVisibile = p => p.archi.filter(a => state.legami[a.classe]).length;
  function ponteVisibile(p) {
    if (!pesoVisibile(p)) return false;
    if (state.universo && p.a.id !== state.universo && p.b.id !== state.universo) return false;
    return universoVisibile(p.a) && universoVisibile(p.b);
  }
  const cercato = n => !!state.cerca && trova(n.cerca, state.cerca);

  // ============================================================
  // DISEGNO
  // ============================================================
  function el(nome, attr) {
    const e = document.createElementNS(NS, nome);
    for (const k in attr) e.setAttribute(k, attr[k]);
    return e;
  }

  // arco leggermente incurvato: due fili fra gli stessi vicini non si sovrappongono
  function curva(x1, y1, x2, y2, quanto) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${(mx - dy * quanto).toFixed(1)} ${(my + dx * quanto).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }

  const elementi = { nodi: new Map(), archi: new Map() };

  function disegna() {
    const svg = els.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    elementi.nodi.clear();
    elementi.archi.clear();

    const scena = el('g', { id: 'scena' });
    const gArchi = el('g', { class: 'archi' });
    const gNodi = el('g', { class: 'nodi' });
    const gEtichette = el('g', { class: 'etichette' });
    scena.appendChild(gArchi); scena.appendChild(gEtichette); scena.appendChild(gNodi);
    svg.appendChild(scena);
    els.scena = scena;

    if (state.modo === 'universi') disegnaUniversi(gArchi, gNodi, gEtichette);
    else disegnaTitoli(gArchi, gNodi, gEtichette);

    applicaVista();
    applicaFuoco();
    aggiornaConteggio();
  }

  function disegnaUniversi(gArchi, gNodi, gEtichette) {
    const g = state.grafo;

    g.listaPonti.forEach(p => {
      if (!ponteVisibile(p)) return;
      const path = el('path', {
        class: 'arco arco-ponte',
        d: curva(p.na.x, p.na.y, p.nb.x, p.nb.y, 0.09),
        'stroke-width': Math.min(9, 1.4 + pesoVisibile(p) * 0.55),
      });
      path.addEventListener('click', ev => { ev.stopPropagation(); seleziona({ genere: 'ponte', dato: p }); });
      path.addEventListener('pointerenter', () => passa({ genere: 'ponte', dato: p }));
      path.addEventListener('pointerleave', () => passa(null));
      gArchi.appendChild(path);
      elementi.archi.set(p.chiave, path);
    });

    g.uNodi.forEach(u => {
      if (!universoVisibile(u)) return;
      const nodo = el('g', {
        class: 'nodo nodo-universo' + (cercato(u) ? ' is-trovato' : ''),
        tabindex: '0', role: 'button',
        'aria-label': `${u.nome}, ${u.conta} titoli, ${u.ponti.length} ponti`,
      });
      nodo.appendChild(el('circle', { class: 'alone', cx: u.x, cy: u.y, r: u.r + 9 }));
      nodo.appendChild(el('circle', { class: 'corpo', cx: u.x, cy: u.y, r: u.r, fill: u.colore }));
      const testo = el('text', { class: 'etichetta-universo', x: u.x, y: u.y + u.r + 17, 'text-anchor': 'middle' });
      testo.textContent = u.nome;
      const conta = el('text', { class: 'etichetta-conta', x: u.x, y: u.y + u.r + 31, 'text-anchor': 'middle' });
      conta.textContent = u.conta === 1 ? '1 titolo' : `${u.conta} titoli`;
      gEtichette.appendChild(testo); gEtichette.appendChild(conta);
      collegaEventi(nodo, { genere: 'universo', dato: u });
      gNodi.appendChild(nodo);
      elementi.nodi.set(u.key, nodo);
    });
  }

  function disegnaTitoli(gArchi, gNodi, gEtichette) {
    const g = state.grafo;

    g.archi.forEach(e => {
      if (!arcoVisibile(e)) return;
      const path = el('path', {
        class: `arco arco-${e.classe}` + (e.a.universo !== e.b.universo ? ' arco-ponte-titoli' : ''),
        d: curva(e.na.x, e.na.y, e.nb.x, e.nb.y, 0.055),
      });
      gArchi.appendChild(path);
      elementi.archi.set(e.chiave, path);
    });

    if (!state.universo) {
      g.uNodi.forEach(u => {
        if (u.etichettaX == null) return;
        const t = el('text', { class: 'etichetta-ammasso', x: u.etichettaX, y: u.etichettaY, 'text-anchor': 'middle', fill: u.colore });
        t.textContent = u.nome;
        gEtichette.appendChild(t);
      });
    }

    g.nodi.forEach(n => {
      if (!nodoVisibile(n)) return;
      const c = info(n.universo).colore;
      const nodo = el('g', {
        class: 'nodo nodo-titolo' + (n.obbligatorio ? ' is-essenziale' : '') + (cercato(n) ? ' is-trovato' : ''),
        tabindex: '0', role: 'button', 'aria-label': etichettaLunga(n),
      });
      if (n.tipo === 'Film') {
        nodo.appendChild(el('circle', { class: 'corpo', cx: n.x, cy: n.y, r: n.r, fill: c }));
      } else {
        const l = n.r * 1.72;
        nodo.appendChild(el('rect', { class: 'corpo', x: n.x - l / 2, y: n.y - l / 2, width: l, height: l, rx: 2.5, fill: c }));
      }
      nodo.appendChild(el('circle', { class: 'presa', cx: n.x, cy: n.y, r: n.r + 7 }));
      const t = el('text', { class: 'etichetta-titolo', x: n.x, y: n.y - n.r - 7, 'text-anchor': 'middle' });
      t.textContent = n.etichetta;
      nodo.appendChild(t);
      collegaEventi(nodo, { genere: 'titolo', dato: n });
      gNodi.appendChild(nodo);
      elementi.nodi.set(n.key, nodo);
    });
  }

  function collegaEventi(nodo, sel) {
    nodo.addEventListener('click', ev => { ev.stopPropagation(); seleziona(sel); });
    nodo.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); seleziona(sel); }
    });
    nodo.addEventListener('pointerenter', () => passa(sel));
    nodo.addEventListener('pointerleave', () => passa(null));
    nodo.addEventListener('focus', () => passa(sel));
    nodo.addEventListener('blur', () => passa(null));
  }

  function etichettaLunga(n) {
    const parti = [n.etichetta, n.tipo, info(n.universo).nome];
    if (n.anno != null) parti.push(annoLabel(n.anno));
    parti.push(n.archi.length === 1 ? '1 collegamento' : `${n.archi.length} collegamenti`);
    return parti.join(', ');
  }

  const annoLabel = a => (a < 0 ? `${Math.abs(a)} a.C.` : String(a));

  // ============================================================
  // FUOCO: cosa resta acceso e cosa si spegne
  // ============================================================
  function vicinato() {
    const scelta = state.sel || state.hover;
    if (!scelta) return null;
    const nodi = new Set(), archi = new Set();

    if (scelta.genere === 'titolo') {
      nodi.add(scelta.dato.key);
      scelta.dato.archi.forEach(e => {
        if (!arcoVisibile(e)) return;
        archi.add(e.chiave);
        nodi.add(e.a.key); nodi.add(e.b.key);
      });
    } else if (scelta.genere === 'universo') {
      nodi.add(scelta.dato.id);
      scelta.dato.ponti.forEach(p => {
        if (!ponteVisibile(p)) return;
        archi.add(p.chiave);
        nodi.add(p.a.id); nodi.add(p.b.id);
      });
    } else if (scelta.genere === 'ponte') {
      archi.add(scelta.dato.chiave);
      nodi.add(scelta.dato.a.id); nodi.add(scelta.dato.b.id);
    }
    return { nodi, archi };
  }

  function applicaFuoco() {
    const v = vicinato();
    els.svg.classList.toggle('is-fuoco', !!v);
    const scelta = state.sel || state.hover;
    const chiaveScelta = scelta ? (scelta.genere === 'titolo' ? scelta.dato.key : scelta.dato.chiave || scelta.dato.id) : null;

    elementi.nodi.forEach((nodo, k) => {
      nodo.classList.toggle('is-spento', !!v && !v.nodi.has(k));
      nodo.classList.toggle('is-scelto', k === chiaveScelta);
      nodo.classList.toggle('is-vicino', !!v && v.nodi.has(k) && k !== chiaveScelta);
    });
    elementi.archi.forEach((arco, k) => {
      arco.classList.toggle('is-spento', !!v && !v.archi.has(k));
      arco.classList.toggle('is-acceso', !!v && v.archi.has(k));
    });
    pannello();
  }

  function seleziona(sel) {
    const uguale = state.sel && sel && state.sel.genere === sel.genere && state.sel.dato === sel.dato;
    state.sel = uguale ? null : sel;
    applicaFuoco();
  }
  function passa(sel) {
    state.hover = sel;
    if (!state.sel) applicaFuoco();
  }

  // ============================================================
  // PANNELLO
  // ============================================================
  function h(tag, cls, testo) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (testo != null) e.textContent = testo;
    return e;
  }

  function bottoneNodo(n) {
    const b = h('button', 'pannello-voce');
    b.type = 'button';
    const pallino = h('span', 'pannello-pallino');
    pallino.style.background = info(n.universo).colore;
    b.appendChild(pallino);
    b.appendChild(h('span', 'pannello-voce-testo', n.etichetta));
    b.addEventListener('click', () => {
      if (state.modo !== 'titoli') { cambiaModo('titoli'); }
      if (state.universo && n.universo !== state.universo) { state.universo = ''; els.universo.value = ''; disegna(); }
      seleziona({ genere: 'titolo', dato: n });
      centraSu(n);
    });
    return b;
  }

  // Sotto gli 860px il pannello stava sotto la mappa, fuori dallo schermo: si
  // toccava un punto e non succedeva niente di visibile. Ora, con una selezione,
  // diventa un foglio che sale dal basso (CSS: .mappa-panel.is-aperto).
  const STRETTO = window.matchMedia('(max-width:859.98px)');

  // Il foglio copre la meta' bassa dello schermo: se la mappa ci finisce sotto,
  // la pagina scorre quanto basta a lasciarla visibile sopra, senza farla
  // passare sotto la barra dei controlli. La barra e' sticky a top:0, quindi il
  // limite e' la sua altezza, non dove si trova adesso: prima di agganciarsi
  // e' ancora nel flusso, e scorre insieme alla pagina.
  function scopriMappa() {
    const r = els.svg.getBoundingClientRect();
    const barra = document.querySelector('.controls');
    const cima = barra ? barra.offsetHeight : 0;
    const libero = window.innerHeight - els.pannello.getBoundingClientRect().height;
    const coperto = r.bottom - libero;
    if (coperto <= 0) return;
    const delta = Math.min(coperto, r.top - cima);
    if (delta > 0) window.scrollBy({ top: delta, behavior: 'smooth' });
  }

  function pannello() {
    const box = els.pannello;
    box.innerHTML = '';
    const scelta = state.sel || state.hover;
    const foglio = box.closest('.mappa-panel');
    const eraAperto = foglio.classList.contains('is-aperto');
    foglio.classList.toggle('is-aperto', !!state.sel);
    if (state.sel && !eraAperto && STRETTO.matches) {
      requestAnimationFrame(scopriMappa);
      box.scrollTop = 0;
    }

    if (!scelta) {
      box.appendChild(h('p', 'pannello-vuoto', state.modo === 'universi'
        ? 'Tocca un universo per vedere quanti titoli contiene e a cosa si aggancia. Tocca un filo per leggere quali storie fanno da ponte.'
        : 'Tocca un punto per vedere il titolo, il suo universo e tutto quello a cui si collega. Ogni filo e’ un rimando dichiarato nelle schede.'));
      return;
    }
    box.classList.toggle('is-bloccato', !!state.sel);

    if (state.sel) {
      // visibile solo nel foglio: su desktop chiude il "Deseleziona" in fondo
      const x = h('button', 'pannello-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'Chiudi');
      x.addEventListener('click', () => { state.sel = null; applicaFuoco(); });
      box.appendChild(x);
    }

    if (scelta.genere === 'universo') pannelloUniverso(box, scelta.dato);
    else if (scelta.genere === 'ponte') pannelloPonte(box, scelta.dato);
    else pannelloTitolo(box, scelta.dato);

    if (state.sel) {
      const chiudi = h('button', 'pannello-chiudi', 'Deseleziona');
      chiudi.type = 'button';
      chiudi.addEventListener('click', () => { state.sel = null; applicaFuoco(); });
      box.appendChild(chiudi);
    }
  }

  function intestazione(box, occhiello, titolo, colore) {
    const e = h('p', 'pannello-occhiello', occhiello);
    if (colore) e.style.color = colore;
    box.appendChild(e);
    box.appendChild(h('h2', 'pannello-titolo', titolo));
  }

  function pannelloUniverso(box, u) {
    intestazione(box, 'Universo', u.nome, u.colore);
    if (u.terra) box.appendChild(h('p', 'pannello-desc', u.terra));

    const dati = h('dl', 'pannello-dati');
    dati.appendChild(h('dt', null, 'Titoli'));
    dati.appendChild(h('dd', null, String(u.conta)));
    dati.appendChild(h('dt', null, 'Ponti'));
    dati.appendChild(h('dd', null, u.ponti.length ? String(u.ponti.length) : 'nessuno'));
    box.appendChild(dati);

    if (u.ponti.length) {
      box.appendChild(h('h3', 'pannello-sez', 'Si tocca con'));
      const ul = h('ul', 'pannello-lista');
      u.ponti.slice().sort((a, b) => b.peso - a.peso).forEach(p => {
        const altro = p.a === u ? p.b : p.a;
        const li = document.createElement('li');
        const b = h('button', 'pannello-voce');
        b.type = 'button';
        const pallino = h('span', 'pannello-pallino');
        pallino.style.background = altro.colore;
        b.appendChild(pallino);
        b.appendChild(h('span', 'pannello-voce-testo', altro.nome));
        b.appendChild(h('span', 'pannello-peso', String(p.peso)));
        b.addEventListener('click', () => seleziona({ genere: 'ponte', dato: p }));
        li.appendChild(b);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    } else {
      box.appendChild(h('p', 'pannello-nota', 'Nessun ponte: nei dati questo universo non rimanda a nessun altro, e nessun altro rimanda a lui.'));
    }

    const vedi = h('button', 'pannello-azione', `Apri i ${u.conta} titoli sulla mappa`);
    vedi.type = 'button';
    vedi.addEventListener('click', () => {
      state.universo = u.id;
      els.universo.value = u.id;
      cambiaModo('titoli');
    });
    box.appendChild(vedi);
  }

  function pannelloPonte(box, p) {
    intestazione(box, 'Ponte', `${p.a.nome} ↔ ${p.b.nome}`);
    box.appendChild(h('p', 'pannello-desc',
      p.peso === 1 ? 'Un solo titolo tiene insieme i due universi.' : `${p.peso} coppie di titoli tengono insieme i due universi.`));
    const ul = h('ul', 'pannello-lista pannello-coppie');
    p.archi.forEach(e => {
      const li = document.createElement('li');
      li.appendChild(bottoneNodo(e.a));
      li.appendChild(h('span', 'pannello-fra', motivoBreve(e)));
      li.appendChild(bottoneNodo(e.b));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  function motivoBreve(e) {
    return PRIORITA.filter(c => e.classi.has(c)).map(c => NOME_CLASSE[c].toLowerCase()).join(' · ');
  }

  function pannelloTitolo(box, n) {
    const u = info(n.universo);
    intestazione(box, u.nome, n.etichetta, u.colore);

    const dati = h('dl', 'pannello-dati');
    dati.appendChild(h('dt', null, 'Tipo'));
    dati.appendChild(h('dd', null, n.tipo));
    if (n.anno != null) {
      dati.appendChild(h('dt', null, 'Ambientazione'));
      dati.appendChild(h('dd', null, (n.annoStimato ? 'circa ' : '') + annoLabel(n.anno)));
    }
    if (n.categoria) {
      dati.appendChild(h('dt', null, 'Categoria'));
      dati.appendChild(h('dd', null, n.categoria + (n.fase ? ` · Fase ${n.fase}` : '')));
    }
    box.appendChild(dati);

    if (n.ambientazione) box.appendChild(h('p', 'pannello-desc', n.ambientazione));

    // I collegamenti sono raccontati con il verso giusto: il filo disegnato non
    // ha una freccia, ma "e' il sequel di" e "ha come sequel" non sono la stessa cosa.
    const gruppi = new Map();
    n.archi.forEach(e => {
      if (!arcoVisibile(e)) return;
      const altro = e.a === n ? e.b : e.a;
      e.motivi.forEach(m => {
        const uscente = m.da === n.key;
        const [avanti, indietro] = VERSO[m.tipo] || VERSO.collegato;
        const frase = uscente ? avanti : indietro;
        if (!gruppi.has(frase)) gruppi.set(frase, new Set());
        gruppi.get(frase).add(altro);
      });
    });

    const gia = new Set();
    let scritto = false;
    ORDINE_VERSO.forEach(frase => {
      const insieme = gruppi.get(frase);
      if (!insieme) return;
      const nuovi = [...insieme].filter(altro => !gia.has(altro));
      if (!nuovi.length) return;
      nuovi.forEach(altro => gia.add(altro));
      scritto = true;
      box.appendChild(h('h3', 'pannello-sez', frase.charAt(0).toUpperCase() + frase.slice(1)));
      const ul = h('ul', 'pannello-lista');
      nuovi.forEach(altro => {
        const li = document.createElement('li');
        li.appendChild(bottoneNodo(altro));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    });
    if (!scritto) box.appendChild(h('p', 'pannello-nota', 'Nessun collegamento visibile con i filtri attivi.'));

    const link = document.createElement('a');
    link.className = 'pannello-azione';
    link.href = `index.html#t-${n.id}`;
    link.textContent = 'Apri la scheda nella linea temporale';
    box.appendChild(link);
  }

  // ============================================================
  // VISTA: spostamento e ingrandimento
  // ============================================================
  function applicaVista() {
    const v = state.vista;
    if (els.scena) els.scena.setAttribute('transform', `translate(${v.x.toFixed(2)} ${v.y.toFixed(2)}) scale(${v.k.toFixed(4)})`);
  }

  function riquadro() {
    const punti = [];
    if (state.modo === 'universi') state.grafo.uNodi.forEach(u => { if (universoVisibile(u)) punti.push(u); });
    else state.grafo.nodi.forEach(n => { if (nodoVisibile(n)) punti.push(n); });
    if (!punti.length) return { x: 0, y: 0, w: W, h: H };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    punti.forEach(p => {
      x0 = Math.min(x0, p.x - p.r); y0 = Math.min(y0, p.y - p.r - 22);
      x1 = Math.max(x1, p.x + p.r); y1 = Math.max(y1, p.y + p.r + 34);
    });
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  // Torna true se il riquadro e' cambiato davvero: chi chiama sa se rifare
  // l'inquadratura o lasciare dov'e' quella scelta dall'utente.
  function adattaViewBox() {
    const r = els.svg.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const h = Math.round(VB.w * r.height / r.width);
    if (Math.abs(h - VB.h) < 2) return false;
    VB.h = h;
    els.svg.setAttribute('viewBox', `0 0 ${VB.w} ${VB.h}`);
    return true;
  }

  function inquadra() {
    const b = riquadro();
    const k = Math.min(VB.w / b.w, VB.h / b.h) * 0.94;
    state.vista.k = Math.max(0.2, Math.min(4, k));
    state.vista.x = VB.w / 2 - (b.x + b.w / 2) * state.vista.k;
    state.vista.y = VB.h / 2 - (b.y + b.h / 2) * state.vista.k;
    applicaVista();
  }

  function centraSu(n) {
    const k = Math.max(state.vista.k, 1.6);
    state.vista.k = k;
    state.vista.x = VB.w / 2 - n.x * k;
    state.vista.y = VB.h / 2 - n.y * k;
    applicaVista();
  }

  function zoom(fattore, cx, cy) {
    const v = state.vista;
    const k = Math.max(0.25, Math.min(6, v.k * fattore));
    const vero = k / v.k;
    v.x = cx - (cx - v.x) * vero;
    v.y = cy - (cy - v.y) * vero;
    v.k = k;
    applicaVista();
  }

  // dal pixel dell'evento alle coordinate del viewBox
  function inLogico(ev) {
    const r = els.svg.getBoundingClientRect();
    const scala = Math.min(r.width / VB.w, r.height / VB.h);
    const offX = (r.width - VB.w * scala) / 2, offY = (r.height - VB.h * scala) / 2;
    return { x: (ev.clientX - r.left - offX) / scala, y: (ev.clientY - r.top - offY) / scala };
  }

  // Due dita: lo zoom segue la distanza fra le dita e lo spostamento il loro
  // punto medio. Prima si ingrandisce attorno al punto medio di prima, poi si
  // trasla di quanto si e' mosso: cosi' il contenuto resta sotto le dita.
  function pizzico(prima, ora) {
    const mp = { x: (prima[0].x + prima[1].x) / 2, y: (prima[0].y + prima[1].y) / 2 };
    const mo = { x: (ora[0].x + ora[1].x) / 2, y: (ora[0].y + ora[1].y) / 2 };
    const dp = Math.hypot(prima[0].x - prima[1].x, prima[0].y - prima[1].y);
    const dO = Math.hypot(ora[0].x - ora[1].x, ora[0].y - ora[1].y);
    if (dp > 0) zoom(dO / dp, mp.x, mp.y);
    state.vista.x += mo.x - mp.x;
    state.vista.y += mo.y - mp.y;
    applicaVista();
  }

  let timerAvvisoDita = null;
  function mostraAvvisoDita() {
    const el = document.getElementById('avviso-dita');
    if (!el) return;
    el.classList.add('is-visibile');
    clearTimeout(timerAvvisoDita);
    timerAvvisoDita = setTimeout(nascondiAvvisoDita, 1400);
  }
  function nascondiAvvisoDita() {
    const el = document.getElementById('avviso-dita');
    if (el) el.classList.remove('is-visibile');
  }

  function trascinamento() {
    // Il riferimento va aggiornato a ogni movimento. Lasciato fermo al punto di
    // partenza, ogni pointermove risommava l'intero spostamento dall'inizio del
    // gesto: un dito che scorreva di 1 cm mandava la mappa via di 1+2+3... cm.
    // Lo spostamento e' in unita' del viewBox come il translate, quindi non va
    // moltiplicato per lo zoom.
    let prima = null, mosso = false;

    // Mouse e penna. Il touch ha il suo ramo sotto.
    els.svg.addEventListener('pointerdown', ev => {
      if (ev.pointerType === 'touch' || ev.button !== 0) return;
      prima = inLogico(ev);
      mosso = false;
      els.svg.setPointerCapture(ev.pointerId);
      els.svg.classList.add('is-trascinando');
    });
    els.svg.addEventListener('pointermove', ev => {
      if (!prima || ev.pointerType === 'touch') return;
      const ora = inLogico(ev);
      const dx = ora.x - prima.x, dy = ora.y - prima.y;
      if (!mosso && Math.hypot(dx, dy) < 3) return;   // un clic tremolante resta un clic
      mosso = true;
      state.vista.x += dx; state.vista.y += dy;
      prima = ora;
      applicaVista();
    });
    const fine = ev => {
      if (ev.pointerType === 'touch') return;
      prima = null;
      els.svg.classList.remove('is-trascinando');
    };
    els.svg.addEventListener('pointerup', fine);
    els.svg.addEventListener('pointercancel', fine);

    // Touch: un dito scorre la pagina, due dita muovono la mappa. Con
    // touch-action:none la mappa, larga quanto lo schermo, si prendeva ogni
    // tocco e la pagina non si poteva piu' scorrere passandoci sopra.
    // touch-action:pan-x pan-y lascia lo scorrimento al browser e gli toglie
    // lo zoom della pagina, che qui sarebbe sempre quello sbagliato.
    let dita = null, avvisoMostrato = 0, partenza = null;
    const punti = ev => [...ev.touches].slice(0, 2).map(t => inLogico(t));
    els.svg.addEventListener('touchstart', ev => {
      if (ev.touches.length === 1) {
        partenza = { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
        mosso = false;
      }
      if (ev.touches.length >= 2) {
        dita = punti(ev);
        mosso = true;
        nascondiAvvisoDita();
      }
    }, { passive: true });
    els.svg.addEventListener('touchmove', ev => {
      if (ev.touches.length >= 2 && dita) {
        // a scorrimento gia' partito il browser non lo lascia piu' annullare
        if (!ev.cancelable) return;
        ev.preventDefault();
        const ora = punti(ev);
        pizzico(dita, ora);
        dita = ora;
        return;
      }
      if (ev.touches.length === 1 && partenza && !dita) {
        const t = ev.touches[0];
        if (Math.hypot(t.clientX - partenza.x, t.clientY - partenza.y) > 12) {
          mosso = true;
          const adesso = Date.now();
          if (adesso - avvisoMostrato > 4000) { avvisoMostrato = adesso; mostraAvvisoDita(); }
        }
      }
    }, { passive: false });
    const fineTocco = ev => {
      if (ev.touches.length < 2) dita = null;
      if (!ev.touches.length) partenza = null;
    };
    els.svg.addEventListener('touchend', fineTocco);
    els.svg.addEventListener('touchcancel', fineTocco);

    els.svg.addEventListener('click', ev => {
      if (mosso) { mosso = false; return; }    // fine di un trascinamento, non un clic
      if (ev.target === els.svg || ev.target.id === 'scena') { state.sel = null; applicaFuoco(); }
    });

    els.svg.addEventListener('wheel', ev => {
      ev.preventDefault();
      const p = inLogico(ev);
      zoom(ev.deltaY < 0 ? 1.16 : 1 / 1.16, p.x, p.y);
    }, { passive: false });
  }

  // ============================================================
  // CONTROLLI
  // ============================================================
  function cambiaModo(modo) {
    if (state.modo === modo) return;
    state.modo = modo;
    state.sel = null; state.hover = null;
    els.modi.forEach(b => {
      const attivo = b.dataset.modo === modo;
      b.classList.toggle('is-active', attivo);
      b.setAttribute('aria-selected', attivo ? 'true' : 'false');
    });
    els.svg.setAttribute('aria-label', modo === 'universi'
      ? 'Mappa dei ventuno universi Marvel e dei ponti narrativi fra loro'
      : 'Mappa dei 156 titoli Marvel raggruppati per universo e collegati fra loro');
    // "solo essenziale" e' una proprieta' del singolo titolo: applicata ai
    // ventuno nodi-universo non vorrebbe dire niente, quindi sparisce.
    els.essenzialiBox.hidden = modo === 'universi';
    disegna();
    inquadra();
  }

  function aggiornaConteggio() {
    if (state.modo === 'universi') {
      const u = state.grafo.uNodi.filter(universoVisibile).length;
      const p = state.grafo.listaPonti.filter(x => elementi.archi.has(x.chiave)).length;
      els.conta.textContent = `${u} ${u === 1 ? 'universo' : 'universi'} · ${p} ${p === 1 ? 'ponte' : 'ponti'}`;
    } else {
      const n = state.grafo.nodi.filter(nodoVisibile).length;
      const a = elementi.archi.size;
      els.conta.textContent = `${n} ${n === 1 ? 'titolo' : 'titoli'} · ${a} ${a === 1 ? 'collegamento' : 'collegamenti'}`;
    }
  }

  function collegaControlli() {
    els.modi.forEach(b => b.addEventListener('click', () => cambiaModo(b.dataset.modo)));

    els.filtriToggle.addEventListener('click', () => {
      const aperto = els.filtri.classList.toggle('is-open');
      els.filtriToggle.setAttribute('aria-expanded', aperto ? 'true' : 'false');
    });

    let timer;
    els.cerca.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.cerca = normalize(els.cerca.value); disegna(); }, 140);
    });

    els.universo.addEventListener('change', () => {
      state.universo = els.universo.value;
      state.sel = null; state.hover = null;
      disegna(); inquadra();
    });

    els.essenziali.addEventListener('change', () => {
      state.soloEssenziali = els.essenziali.checked;
      disegna();
    });

    els.legamiInput.forEach(inp => inp.addEventListener('change', () => {
      state.legami[inp.dataset.legame] = inp.checked;
      disegna();
    }));

    els.zoomPiu.addEventListener('click', () => zoom(1.3, VB.w / 2, VB.h / 2));
    els.zoomMeno.addEventListener('click', () => zoom(1 / 1.3, VB.w / 2, VB.h / 2));
    els.reinquadra.addEventListener('click', inquadra);

    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && state.sel) { state.sel = null; applicaFuoco(); }
    });
  }

  function riempiTendina() {
    const presenti = new Set(state.grafo.nodi.map(n => n.universo));
    UNIVERSI.filter(u => presenti.has(u.id)).forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.nome;
      els.universo.appendChild(opt);
    });
  }

  // ============================================================
  // ELENCO DEI PONTI (la mappa in parole, e senza SVG)
  // ============================================================
  function elencoPonti() {
    const box = els.ponti;
    box.innerHTML = '';
    state.grafo.listaPonti.forEach(p => {
      const sez = h('article', 'ponte');
      const t = h('h3', 'ponte-titolo');
      const sa = h('span', 'ponte-universo', p.a.nome); sa.style.color = p.a.colore;
      const sb = h('span', 'ponte-universo', p.b.nome); sb.style.color = p.b.colore;
      t.appendChild(sa);
      t.appendChild(h('span', 'ponte-segno', '↔'));
      t.appendChild(sb);
      t.appendChild(h('span', 'ponte-peso', p.peso === 1 ? '1 coppia' : `${p.peso} coppie`));
      sez.appendChild(t);
      const ul = h('ul', 'ponte-coppie');
      p.archi.forEach(e => {
        const li = document.createElement('li');
        const a1 = document.createElement('a');
        a1.href = `index.html#t-${e.a.id}`; a1.textContent = e.a.etichetta;
        const a2 = document.createElement('a');
        a2.href = `index.html#t-${e.b.id}`; a2.textContent = e.b.etichetta;
        li.appendChild(a1);
        li.appendChild(h('span', 'ponte-fra', motivoBreve(e)));
        li.appendChild(a2);
        ul.appendChild(li);
      });
      sez.appendChild(ul);
      box.appendChild(sez);
    });
  }

  function legenda() {
    const box = els.legenda;
    box.innerHTML = '';
    state.grafo.uNodi.forEach(u => {
      const b = h('button', 'legenda-voce');
      b.type = 'button';
      b.title = u.terra;
      const pallino = h('span', 'legenda-pallino');
      pallino.style.background = u.colore;
      b.appendChild(pallino);
      b.appendChild(h('span', 'legenda-nome', u.nome));
      b.appendChild(h('span', 'legenda-conta', String(u.conta)));
      b.addEventListener('click', () => {
        const gia = state.universo === u.id;
        state.universo = gia ? '' : u.id;
        els.universo.value = state.universo;
        state.sel = null; state.hover = null;
        disegna(); inquadra();
        segnaLegenda();
      });
      box.appendChild(b);
    });
    segnaLegenda();
  }

  function segnaLegenda() {
    Array.from(els.legenda.children).forEach((b, i) => {
      const u = state.grafo.uNodi[i];
      b.classList.toggle('is-attivo', !!state.universo && state.universo === u.id);
    });
  }

  // ============================================================
  // AVVIO
  // ============================================================
  async function init() {
    els.svg = document.getElementById('mappa');
    els.pannello = document.getElementById('mappa-pannello');
    els.conta = document.getElementById('mappa-conta');
    els.legenda = document.getElementById('legenda');
    els.ponti = document.getElementById('ponti-lista');
    els.cerca = document.getElementById('mappa-cerca');
    els.universo = document.getElementById('mappa-universo');
    els.essenziali = document.getElementById('mappa-essenziali');
    els.essenzialiBox = document.getElementById('mappa-essenziali-box');
    els.legamiInput = Array.from(document.querySelectorAll('[data-legame]'));
    els.filtri = document.getElementById('mappa-filtri');
    els.filtriToggle = document.getElementById('mappa-filtri-toggle');
    els.modi = Array.from(document.querySelectorAll('.mode-btn[data-modo]'));
    els.zoomPiu = document.getElementById('zoom-piu');
    els.zoomMeno = document.getElementById('zoom-meno');
    els.reinquadra = document.getElementById('reinquadra');
    els.avviso = document.getElementById('mappa-avviso');
    els.contaTitoli = document.getElementById('conta-titoli');
    els.contaUniversi = document.getElementById('conta-universi');
    els.contaPonti = document.getElementById('conta-ponti');

    let data, dettagli = {};
    try {
      const [res, resDet] = await Promise.all([
        fetch('data.json'),
        fetch('dettagli.json').catch(() => null),
      ]);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
      if (!Array.isArray(data)) throw new Error('formato inatteso: atteso un array');
      if (resDet && resDet.ok) {
        try { dettagli = await resDet.json(); } catch (e) { dettagli = {}; }
      }
    } catch (err) {
      const dritta = location.protocol === 'file:'
        ? 'Stai aprendo la pagina dal filesystem: servila con un piccolo server HTTP (per esempio <code>python -m http.server</code>).'
        : 'Dettaglio: ' + err.message;
      els.avviso.hidden = false;
      els.avviso.innerHTML = 'Impossibile caricare i dati (data.json). ' + dritta;
      return;
    }

    state.grafo = costruisci(data, dettagli);
    disponi(state.grafo);

    // Senza dettagli.json restano i nodi e sparisce ogni filo: la mappa perde il
    // suo scopo, e dirlo e' meglio che mostrare una nuvola di punti scollegati.
    if (!state.grafo.archi.length) {
      els.avviso.hidden = false;
      els.avviso.textContent = 'I collegamenti vivono in dettagli.json, che non si e’ caricato: la mappa mostra i titoli ma nessun filo.';
    }

    els.contaTitoli.textContent = state.grafo.nodi.length;
    els.contaUniversi.textContent = state.grafo.uNodi.length;
    els.contaPonti.textContent = state.grafo.listaPonti.length;

    riempiTendina();
    legenda();
    elencoPonti();
    collegaControlli();
    trascinamento();
    adattaViewBox();
    disegna();
    inquadra();

    // Girare il telefono cambia la forma del riquadro: se cambia, si reinquadra.
    // Se non cambia non si tocca nulla, per non buttare via lo zoom scelto.
    let attesa;
    window.addEventListener('resize', () => {
      clearTimeout(attesa);
      attesa = setTimeout(() => { if (adattaViewBox()) inquadra(); }, 180);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
