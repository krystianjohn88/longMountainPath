'use strict';

const TYPE_ICON = {
  'góra': '⛰️', 'przełęcz': '🪨', 'schronisko': '🏠', 'miasto': '🏘️', 'polana': '🌾', 'inne': '📍',
};
// Słowa na początku nazwy, które można pominąć przy wpisywaniu
// („Kubalonka” zamiast „Przełęcz Kubalonka”, „Stare Wierchy” zamiast „Schronisko PTTK Stare Wierchy”).
const OPTIONAL_PREFIXES = ['przelecz', 'hala', 'schronisko', 'pttk', 'stacja', 'turystyczna', 'na'];
const DEFAULT_THRESHOLD = 80;
const THRESHOLD_KEY = 'gsb.threshold';
const TRAIL_KEY = 'gsb.trail';
const MODE_KEY = 'gsb.mode';

const $ = (id) => document.getElementById(id);

const state = {
  trails: [],        // lista szlaków z data/trails.json
  trail: null,       // wybrany szlak
  reversed: false,   // false: kierunek jak w pliku (wg id), true: odwrotnie
  part: null,        // null = cały szlak
  points: [],        // punkty w bieżącej sesji (w kolejności nauki)
  index: 0,
  hintLevel: 0,
  mistakes: 0,
  revealed: 0,
  close: 0,          // zaliczone z literówką (zgodność < 100%)
  threshold: loadThreshold(),
  mode: loadMode(),  // 'type' – wpisywanie, 'order' – układanie klocków (tylko pasma)
  order: null,       // stan układanki
};

// --- ustawienia (localStorage może być niedostępny – wtedy domyślne) ----------

function loadThreshold() {
  try {
    const v = Number(localStorage.getItem(THRESHOLD_KEY));
    if (v >= 50 && v <= 100) return v;
  } catch {}
  return DEFAULT_THRESHOLD;
}

function saveThreshold(v) {
  try { localStorage.setItem(THRESHOLD_KEY, String(v)); } catch {}
}

function loadTrailId() {
  try { return localStorage.getItem(TRAIL_KEY); } catch { return null; }
}

function saveTrailId(id) {
  try { localStorage.setItem(TRAIL_KEY, id); } catch {}
}

function loadMode() {
  try { return localStorage.getItem(MODE_KEY) === 'order' ? 'order' : 'type'; } catch { return 'type'; }
}

function saveMode(mode) {
  try { localStorage.setItem(MODE_KEY, mode); } catch {}
}

// --- porównywanie odpowiedzi ---------------------------------------------------

function normalize(s) {
  return s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Akceptowane warianty nazwy: pełna, bez dopisku w nawiasie, sam dopisek z nawiasu
// („Chatka Puchatka (Hasiakowa Skała)” → „Chatka Puchatka” / „Hasiakowa Skała”),
// oraz każdy z nich bez przedrostka typu „Przełęcz”.
function variants(label) {
  const paren = label.match(/\(([^)]*)\)/);
  const forms = [label, label.replace(/\s*\([^)]*\)/, '')];
  if (paren) forms.push(paren[1]);
  const out = new Set();
  for (const f of forms.map(normalize)) {
    const words = f.split(' ');
    out.add(f);
    // Zdejmujemy kolejne słowa z początku, dopóki są na liście (zostawiając co najmniej jedno).
    while (words.length > 1 && OPTIONAL_PREFIXES.includes(words[0])) {
      words.shift();
      out.add(words.join(' '));
    }
  }
  return out;
}

// Odległość Levenshteina: ile liter trzeba dodać / usunąć / zamienić.
function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

// Zgodność odpowiedzi z nazwą w procentach (0–100), najlepsza z wariantów.
// Spacje są pomijane, więc „duzejaslo” = „Duże Jasło”.
function similarity(input, label) {
  const a = normalize(input).replace(/ /g, '');
  if (!a) return 0;
  let best = 0;
  for (const v of variants(label)) {
    const b = v.replace(/ /g, '');
    const score = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
    best = Math.max(best, score);
  }
  return Math.round(best * 100);
}

function matches(input, label, threshold = 100) {
  return similarity(input, label) >= threshold;
}

// --- dane ------------------------------------------------------------------------

// Dane czytane bezpośrednio z plików JSON w data/ (strona statyczna, np. GitHub Pages):
// data/trails.json – lista szlaków, data/<szlak>.json – punkty szlaku.
const pointsCache = {};

async function fetchJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

async function loadTrails() {
  state.trails = await fetchJson('data/trails.json');
  const saved = state.trails.find((t) => t.id === loadTrailId());
  state.trail = saved || state.trails[0];
}

async function loadPoints(trail = state.trail) {
  if (!pointsCache[trail.id]) {
    const points = await fetchJson(`data/${trail.file}`);
    pointsCache[trail.id] = points.sort((a, b) => a.id - b.id);
  }
  return pointsCache[trail.id];
}

async function getPoints(part) {
  const all = await loadPoints();
  return part ? all.filter((p) => p.name_mountain_part === part) : all.slice();
}

// Pasma w kolejności występowania na szlaku + liczba punktów.
// Gdy pasmo pojawia się na szlaku dwa razy, liczymy je razem (pierwsza pozycja wyznacza kolejność).
async function getParts() {
  const parts = [];
  for (const p of await loadPoints()) {
    const known = parts.find((x) => x.name === p.name_mountain_part);
    if (known) known.count++;
    else parts.push({ name: p.name_mountain_part, count: 1 });
  }
  return parts;
}

// --- układ na telefonie: wysokość widocznego obszaru (z klawiaturą) -----------------

function syncViewport() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--app-h', `${h}px`);
  if ($('screen-quiz').classList.contains('active')) window.scrollTo(0, 0);
}
if (window.visualViewport) window.visualViewport.addEventListener('resize', syncViewport);
window.addEventListener('resize', syncViewport);
syncViewport();

function show(screen) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  $(`screen-${screen}`).classList.add('active');
  window.scrollTo(0, 0);
}

// --- ekran startowy ----------------------------------------------------------

// Wybór szlaku: przyciski, nagłówek z nazwą i kierunek wg pierwszego/ostatniego punktu.
function renderTrails() {
  const box = $('trails');
  box.innerHTML = '';
  for (const t of state.trails) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'trail';
    btn.style.setProperty('--trail', t.color);
    btn.setAttribute('aria-pressed', String(t.id === state.trail.id));
    btn.innerHTML = '<span class="marker" aria-hidden="true"></span>';
    btn.append(t.short);
    btn.addEventListener('click', () => selectTrail(t));
    box.appendChild(btn);
  }
  document.documentElement.style.setProperty('--trail', state.trail.color);
  $('trail-short').textContent = state.trail.short;
  $('trail-name').textContent = `${state.trail.name} – wpisuj kolejne punkty trasy`;
}

// Nazwa punktu bez dopisku w nawiasie – do krótkich nagłówków („Bielsko-Biała (Straconka)” → „Bielsko-Biała”).
const shortLabel = (label) => label.replace(/\s*\([^)]*\)/, '');

async function renderDirection() {
  const all = await loadPoints();
  const ends = [shortLabel(all[0].label), shortLabel(all[all.length - 1].label)];
  if (state.reversed) ends.reverse();
  $('dir-toggle').textContent = `${ends[0]} → ${ends[1]}`;
}

async function selectTrail(trail) {
  state.trail = trail;
  state.reversed = false;
  saveTrailId(trail.id);
  renderTrails();
  await Promise.all([renderDirection(), renderParts()]);
}

async function renderParts() {
  const parts = await getParts();
  if (state.reversed) parts.reverse();
  $('parts').innerHTML = '';
  for (const p of parts) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'part';
    btn.innerHTML = `<span>${p.name}</span><small>${p.count} pkt</small>`;
    btn.addEventListener('click', () => startPart(p.name));
    li.appendChild(btn);
    $('parts').appendChild(li);
  }
}

function renderThreshold() {
  $('threshold').value = state.threshold;
  $('threshold-value').textContent = `${state.threshold}%`;
}

$('threshold').addEventListener('input', (e) => {
  state.threshold = Number(e.target.value);
  saveThreshold(state.threshold);
  renderThreshold();
});

$('dir-toggle').addEventListener('click', () => {
  state.reversed = !state.reversed;
  renderDirection();
  renderParts();
});

$('start-all').addEventListener('click', () => startQuiz(null));

// --- tryb nauki ------------------------------------------------------------------

function renderMode() {
  const order = state.mode === 'order';
  document.querySelectorAll('.mode').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
  });
  // Układanie tylko dla pasm: chowamy „Cały szlak” i próg zgodności (nie dotyczy klocków).
  $('start-all').hidden = order;
  $('threshold-setting').hidden = order;
  $('order-info').hidden = !order;
  $('parts-heading').textContent = order ? 'Wybierz pasmo do ułożenia' : '…albo wybierz pasmo';
}

document.querySelectorAll('.mode').forEach((b) => {
  b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    saveMode(state.mode);
    renderMode();
  });
});

function startPart(part) {
  return state.mode === 'order' ? startOrder(part) : startQuiz(part);
}

// --- lista punktów -------------------------------------------------------------

async function showList() {
  const points = await getPoints(null);
  if (state.reversed) points.reverse();
  const box = $('point-list');
  box.innerHTML = '';

  // Grupy = kolejne punkty z tego samego regionu (w wybranym kierunku).
  let group = null;
  points.forEach((p, i) => {
    if (!group || group.name !== p.name_mountain_part) {
      group = { name: p.name_mountain_part, el: document.createElement('section') };
      group.el.className = 'group';
      const head = document.createElement('div');
      head.className = 'group-head';
      const h = document.createElement('h3');
      h.textContent = p.name_mountain_part;
      const learn = document.createElement('button');
      learn.type = 'button';
      learn.className = 'pill small';
      learn.textContent = 'Ucz się →';
      const part = p.name_mountain_part;
      learn.addEventListener('click', () => startPart(part));
      head.append(h, learn);
      group.list = document.createElement('ol');
      group.el.append(head, group.list);
      box.appendChild(group.el);
    }
    const li = document.createElement('li');
    li.dataset.search = normalize(p.label);
    const nr = document.createElement('span');
    nr.className = 'nr';
    nr.textContent = i + 1;
    const ico = document.createElement('span');
    ico.textContent = TYPE_ICON[p.typ_punktu] || '•';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = p.label;
    const meta = document.createElement('small');
    meta.textContent = p.height ? `${p.typ_punktu} · ${p.height} m` : p.typ_punktu;
    li.append(nr, ico, label, meta);
    group.list.appendChild(li);
  });

  const ends = [shortLabel(points[0].label), shortLabel(points[points.length - 1].label)];
  $('list-title').textContent = `${state.trail.short} · ${ends[0]} → ${ends[1]}`;
  $('list-search').value = '';
  filterList();
  show('list');
}

function filterList() {
  const q = normalize($('list-search').value);
  let visible = 0;
  for (const g of $('point-list').querySelectorAll('.group')) {
    let inGroup = 0;
    for (const li of g.querySelectorAll('li')) {
      const hit = !q || li.dataset.search.includes(q);
      li.hidden = !hit;
      if (hit) inGroup++;
    }
    g.hidden = inGroup === 0;
    visible += inGroup;
  }
  const total = $('point-list').querySelectorAll('li').length;
  $('list-count').textContent = q ? `${visible} z ${total} punktów` : `${total} punktów`;
}

$('browse').addEventListener('click', showList);
$('list-search').addEventListener('input', filterList);
$('list-back').addEventListener('click', () => show('start'));

// --- nauka -------------------------------------------------------------------

async function startQuiz(part) {
  const points = await getPoints(part);
  if (state.reversed) points.reverse();
  state.lastMode = 'type';
  Object.assign(state, {
    part, points, index: 0, hintLevel: 0, mistakes: 0, revealed: 0, close: 0,
  });

  $('quiz-title').textContent = `${state.trail.short} · ${part || 'cały szlak'}`;
  $('done').innerHTML = '';
  setFeedback('', '');
  show('quiz');
  // Pierwszy punkt podajemy jako punkt startowy – uczymy się „co dalej”.
  addDone(points[0], 'start');
  state.index = 1;
  nextPrompt();
}

function addDone(point, kind, score) {
  const li = document.createElement('li');
  li.className = kind;
  const ico = document.createElement('span');
  ico.className = 'ico';
  ico.textContent = TYPE_ICON[point.typ_punktu] || '•';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = point.label;
  const meta = document.createElement('small');
  meta.textContent = score !== undefined && score < 100
    ? `${point.typ_punktu} · ${score}%`
    : point.typ_punktu;
  li.append(ico, label, meta);
  const list = $('done');
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
}

function setFeedback(text, kind) {
  const el = $('feedback');
  el.textContent = text;
  el.className = `feedback ${kind}`;
}

function current() {
  return state.points[state.index];
}

function nextPrompt() {
  const total = state.points.length;
  $('quiz-progress').textContent = `${state.index} / ${total}`;
  $('progress-fill').style.width = `${(state.index / total) * 100}%`;

  if (state.index >= total) return finish();

  state.hintLevel = 0;
  $('hint').textContent = '';
  $('answer').value = '';
  $('answer').focus({ preventScroll: true });
}

function advance(kind, score) {
  addDone(current(), kind, score);
  state.index++;
  nextPrompt();
}

$('answer-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('answer').value;
  if (!input.trim()) return;
  const point = current();
  const score = similarity(input, point.label);

  if (score === 100) {
    setFeedback('✓ 100% – dokładnie tak', 'ok');
    advance('ok', score);
  } else if (score >= state.threshold) {
    state.close++;
    setFeedback(`✓ ${score}% – zaliczone, poprawnie: ${point.label}`, 'close');
    advance('close', score);
  } else {
    state.mistakes++;
    setFeedback(`✗ ${score}% zgodności – potrzeba ${state.threshold}%`, 'bad');
    const field = $('answer');
    field.classList.remove('wrong');
    void field.offsetWidth; // restart animacji
    field.classList.add('wrong');
    field.select();
  }
});

$('btn-hint').addEventListener('click', () => {
  const p = current();
  state.hintLevel++;
  const type = `${p.typ_punktu}${p.height ? ` ${p.height} m` : ''}`;
  const hints = [
    `Typ: ${TYPE_ICON[p.typ_punktu] || ''} ${type}`,
    `Typ: ${type} · zaczyna się na „${p.label[0]}”`,
    `Typ: ${type} · „${p.label.slice(0, Math.ceil(p.label.length / 2))}…”`,
  ];
  $('hint').textContent = hints[Math.min(state.hintLevel, hints.length) - 1];
  $('answer').focus({ preventScroll: true });
});

$('btn-reveal').addEventListener('click', () => {
  state.revealed++;
  setFeedback(`Pokazano: ${current().label}`, 'revealed');
  advance('revealed');
});

$('back').addEventListener('click', () => show('start'));

// --- podsumowanie ------------------------------------------------------------

function finish() {
  const asked = state.points.length - 1;
  const ok = asked - state.revealed;
  $('summary').textContent =
    `Trafione: ${ok} / ${asked} (w tym z literówką: ${state.close}) · ` +
    `pokazane: ${state.revealed} · błędne próby: ${state.mistakes}`;
  show('end');
}

// --- układanie klocków --------------------------------------------------------------
// Pasmo układa się etapami po N punktów (domyślnie 8, zmiana przyciskami −/+).
// Na górze ostatni ułożony punkt (dla ciągłości) i N pustych miejsc, na dole N wymieszanych
// klocków. Dotknięcie klocka od razu sprawdza, czy to następny punkt: dobry ląduje na swoim
// miejscu (zielony), zły miga na czerwono i zostaje na dole. Po ułożeniu etapu pojawiają się
// kolejne klocki.

const BATCH_KEY = 'gsb.batch';
const BATCH_MIN = 3;
const BATCH_MAX = 20;
const BATCH_DEFAULT = 8;

function loadBatchSize() {
  try {
    const v = Number(localStorage.getItem(BATCH_KEY));
    if (v >= BATCH_MIN && v <= BATCH_MAX) return v;
  } catch {}
  return BATCH_DEFAULT;
}

state.batchSize = loadBatchSize();

function renderBatchSize() {
  document.querySelectorAll('.batch-value').forEach((el) => { el.textContent = state.batchSize; });
  document.querySelectorAll('.batch-dec').forEach((b) => { b.disabled = state.batchSize <= BATCH_MIN; });
  document.querySelectorAll('.batch-inc').forEach((b) => { b.disabled = state.batchSize >= BATCH_MAX; });
}

function changeBatchSize(delta) {
  state.batchSize = Math.min(BATCH_MAX, Math.max(BATCH_MIN, state.batchSize + delta));
  try { localStorage.setItem(BATCH_KEY, String(state.batchSize)); } catch {}
  renderBatchSize();
  // W trakcie układania: nowy rozmiar od razu – etap zaczyna się od następnego punktu.
  if (state.order && $('screen-order').classList.contains('active')) {
    startBatch();
    renderOrder();
  }
}

document.querySelectorAll('.batch-dec').forEach((b) => b.addEventListener('click', () => changeBatchSize(-1)));
document.querySelectorAll('.batch-inc').forEach((b) => b.addEventListener('click', () => changeBatchSize(1)));

function shuffle(items) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Nowy etap od punktu o.next: N miejsc i N wymieszanych klocków.
function startBatch() {
  const o = state.order;
  o.batchStart = o.next;
  o.batchEnd = Math.min(o.expected.length, o.next + state.batchSize);
  const batch = o.expected.slice(o.batchStart, o.batchEnd);
  const tiles = batch.map((p, i) => ({ key: o.batchStart + i, label: p.label }));
  let pool = shuffle(tiles);
  // Przy kilku klockach losowanie może dać od razu dobrą kolejność – mieszamy ponownie.
  for (let n = 0; n < 5 && pool.length > 1 && pool.every((t, i) => t.label === batch[i].label); n++) {
    pool = shuffle(tiles);
  }
  o.pool = pool;
}

async function startOrder(part) {
  const points = await getPoints(part);
  if (state.reversed) points.reverse();
  state.part = part;
  state.lastMode = 'order';
  state.order = {
    expected: points,
    next: 0,          // indeks następnego punktu do ułożenia (w całym paśmie)
    batchStart: 0,
    batchEnd: 0,
    pool: [],
    mistakes: 0,
  };
  startBatch();
  $('order-title').textContent = `${state.trail.short} · ${part} · układanie`;
  setOrderFeedback('Dotknij klocka, który jest następny na szlaku', '');
  show('order');
  renderOrder();
}

function setOrderFeedback(text, kind) {
  const el = $('order-feedback');
  el.textContent = text;
  el.className = `feedback ${kind}`;
}

function slotItem(nrText, labelText, cls) {
  const li = document.createElement('li');
  const nr = document.createElement('span');
  nr.className = 'nr';
  nr.textContent = nrText;
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = labelText;
  li.append(nr, label);
  li.className = cls;
  return li;
}

function renderOrder() {
  const o = state.order;
  const total = o.expected.length;
  $('order-progress').textContent = `Ułożone: ${o.next} / ${total} · pomyłki: ${o.mistakes}`;

  const slots = $('slots');
  slots.innerHTML = '';
  // Ostatni punkt poprzedniego etapu – żeby było wiadomo, od czego układamy dalej.
  if (o.batchStart > 0) {
    const prev = o.expected[o.batchStart - 1];
    slots.appendChild(slotItem(o.batchStart, prev.label, 'prev'));
  }
  for (let i = o.batchStart; i < o.batchEnd; i++) {
    const done = i < o.next;
    const cls = done ? 'locked' : (i === o.next ? 'empty next' : 'empty');
    slots.appendChild(slotItem(i + 1, done ? o.expected[i].label : '', cls));
  }

  const pool = $('pool');
  pool.innerHTML = '';
  for (const tile of o.pool) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile';
    b.textContent = tile.label;
    b.addEventListener('click', () => place(tile, b));
    pool.appendChild(b);
  }
  pool.hidden = o.pool.length === 0;

  const next = slots.querySelector('.next');
  if (next) next.scrollIntoView({ block: 'nearest' });
}

function place(tile, button) {
  const o = state.order;
  const expected = o.expected[o.next];
  // Porównujemy nazwy – dwa punkty o tej samej nazwie (np. Beskidek) są zamienne.
  if (tile.label !== expected.label) {
    o.mistakes++;
    setOrderFeedback(`✗ „${tile.label}” to nie ten punkt`, 'bad');
    $('order-progress').textContent = `Ułożone: ${o.next} / ${o.expected.length} · pomyłki: ${o.mistakes}`;
    button.classList.remove('wrong');
    void button.offsetWidth; // restart animacji
    button.classList.add('wrong');
    return;
  }
  o.next++;
  o.pool = o.pool.filter((t) => t !== tile);

  if (o.next === o.expected.length) {
    setOrderFeedback(`✓ ${tile.label}`, 'ok');
    renderOrder();
    return setTimeout(finishOrder, 500);
  }
  if (o.next === o.batchEnd) {
    // Etap ułożony – chwila na zobaczenie całości, potem kolejne klocki.
    setOrderFeedback(`✓ ${tile.label} – etap ułożony, kolejne klocki…`, 'ok');
    renderOrder();
    const batchEnd = o.batchEnd;
    return setTimeout(() => {
      if (state.order !== o || o.batchEnd !== batchEnd) return;
      startBatch();
      setOrderFeedback('Dotknij klocka, który jest następny na szlaku', '');
      renderOrder();
    }, 900);
  }
  setOrderFeedback(`✓ ${tile.label}`, 'ok');
  renderOrder();
}

$('order-back').addEventListener('click', () => show('start'));

renderBatchSize();

function finishOrder() {
  const o = state.order;
  $('summary').textContent =
    `Ułożone punkty: ${o.expected.length} · pomyłki: ${o.mistakes}`;
  show('end');
}

$('again').addEventListener('click', () =>
  (state.lastMode === 'order' ? startOrder(state.part) : startQuiz(state.part)));
$('home').addEventListener('click', () => show('start'));

renderMode();
renderThreshold();
loadTrails()
  .then(() => selectTrail(state.trail))
  .catch((err) => {
    $('parts').innerHTML = `<li class="error">Nie udało się wczytać danych: ${err.message}</li>`;
  });
