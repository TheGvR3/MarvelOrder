/* ============================================================
   UNIVERSI — tabella condivisa fra la linea temporale e la mappa
   ============================================================

   `categoria` (in data.json) e' una tassonomia di produzione, non di finzione:
   tiene separati MCU, Marvel Television e Marvel Netflix che sono lo stesso
   universo, e tiene insieme dentro "Sony / Spider-Man" e "Altre licenze"
   continuita' che non si toccano. `universo` e' la lettura di finzione, ed e'
   quella che ordina la Cronologia e disegna la mappa.

   L'ordine di questo array e' l'ordine delle sezioni nella vista Cronologia e
   l'ordine delle voci nel menu a tendina: la linea principale apre, gli
   universi paralleli seguono per dimensione, il Multiverso resta in fondo
   perche' e' un residuo e non un posto.

   Diciassette righe su ventuno portano una sigla che Marvel usa davvero: 616,
   10005, 828 e 1610 sono dette a schermo, le altre vengono dall'Official
   Handbook. Legion, The Gifted, Helstrom e Spider-Noir una sigla non ce l'hanno,
   quindi portano un nome descrittivo. Non colmare quel buco inventandone una: un
   Terra-NNNNN plausibile, una volta finito nei dati, e' indistinguibile da uno
   vero.

   `colore` serve alla mappa (mappa.js) per tingere nodi, legenda e archi.
   ============================================================ */
window.MARVEL_UNIVERSI = [
  { id: 'terra-616',    nome: 'Terra-616',              colore: '#d0102a', terra: 'Marvel Studios, Marvel Television e Marvel Netflix' },
  { id: 'terra-10005',  nome: 'Terra-10005',            colore: '#4d7fd6', terra: 'X-Men e Deadpool, Fox' },
  { id: 'terra-688',    nome: 'Terra-688',              colore: '#7d4fd0', terra: 'Universo Sony: Venom, Morbius, Madame Web, Kraven' },
  { id: 'terra-26320',  nome: 'Terra-26320',            colore: '#b03a5b', terra: 'Blade, trilogia e serie' },
  { id: 'terra-96283',  nome: 'Terra-96283',            colore: '#d1642a', terra: 'Spider-Man, trilogia di Sam Raimi' },
  { id: 'terra-1610',   nome: 'Terra-1610',             colore: '#e0479a', terra: 'Spider-Verse, la trilogia animata di Miles Morales' },
  { id: 'legion',       nome: 'Universo di Legion',     colore: '#4fbfa8', terra: 'FX, parallelo ai film X-Men. Marvel non gli ha assegnato una Terra' },
  { id: 'terra-120703', nome: 'Terra-120703',           colore: '#d19a2a', terra: 'The Amazing Spider-Man, duologia di Marc Webb' },
  { id: 'terra-121698', nome: 'Terra-121698',           colore: '#3fa3d1', terra: 'I Fantastici 4, dittico di Tim Story' },
  { id: 'terra-701306', nome: 'Terra-701306',           colore: '#a34d2a', terra: 'Daredevil ed Elektra, 2003-2005' },
  { id: 'terra-86445',  nome: 'Terra-86445',            colore: '#5ec04d', terra: 'Il tuo amichevole Spider-Man di quartiere' },
  { id: 'terra-121347', nome: 'Terra-121347',           colore: '#e07b1f', terra: 'Ghost Rider, i due film con Nicolas Cage' },
  { id: 'the-gifted',   nome: 'Universo di The Gifted', colore: '#9a7fd0', terra: 'Fox, linea temporale in cui gli X-Men sono spariti. Nessuna Terra assegnata' },
  { id: 'terra-15866',  nome: 'Terra-15866',            colore: '#2f8fb3', terra: 'Fantastic Four, reboot di Josh Trank' },
  { id: 'terra-58732',  nome: 'Terra-58732',            colore: '#8a8f99', terra: 'The Punisher, 2004' },
  { id: 'terra-828',    nome: 'Terra-828',              colore: '#6aa9e0', terra: 'The Fantastic Four: First Steps' },
  { id: 'terra-400083', nome: 'Terra-400083',           colore: '#6fae3a', terra: 'Hulk, il film di Ang Lee del 2003' },
  { id: 'terra-47281',  nome: 'Terra-47281',            colore: '#5c6470', terra: 'Punisher - Zona di guerra, 2008' },
  { id: 'helstrom',     nome: 'Universo di Helstrom',   colore: '#b0518f', terra: "Hulu, dichiarato fuori dall'MCU dal suo showrunner. Nessuna Terra assegnata" },
  { id: 'spider-noir',  nome: 'Universo di Spider-Noir', colore: '#b8a27a', terra: "MGM+ e Prime Video, la New York degli anni Trenta. Non e' lo Spider-Noir dello Spider-Verse. Nessuna Terra assegnata" },
  { id: 'multiverso',   nome: 'Multiverso',             colore: '#c9c6d1', terra: 'What If...? e Marvel Zombies: nessuna Terra unica' },
];

/* ============================================================
   UNITA' — cosa il sito conta come "un titolo"
   ============================================================

   data.json ha 161 voci ma i titoli sono 156: un'unita' e' la stagione intera,
   non il blocco di episodi in cui e' spezzata. Agents of S.H.I.E.L.D. occupa 12
   voci per 7 stagioni, perche' quattro sono divise in due o tre blocchi
   affinche' un film si incastri a meta'.

   La regola sta qui, e non in script.js, perche' anche la mappa conta i nodi
   allo stesso modo: due definizioni separate darebbero due conteggi diversi
   della stessa cosa nelle due pagine.
   ============================================================ */
window.MARVEL_UNITA_KEY = function unitaKey(item) {
  return item.stagione != null
    ? `${item.titolo}::${item.tipo}::${item.stagione}`
    : `id::${item.id}`;
};

/* ============================================================
   NORMALIZZAZIONE DELLA RICERCA
   ============================================================

   Apostrofi curvi e dritti convivono nei dati e gli accenti si digitano a
   fatica: la ricerca confronta forme normalizzate, non le stringhe grezze.
   Anche qui la definizione e' una sola per tutto il sito: se le due pagine
   normalizzassero in modo diverso, "shield" troverebbe la serie in una e non
   nell'altra.
   ============================================================ */
window.MARVEL_NORMALIZE = function normalize(str) {
  return String(str == null ? '' : str)
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc\u00b4`]/g, "'")
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};
