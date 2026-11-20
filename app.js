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

async function renderDirection() {
  const all = await loadPoints();
  const ends = [all[0].label, all[all.length - 1].label];
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
    btn.addEventListener('click', () => startQuiz(p.name));
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

// --- nauka -------------------------------------------------------------------

async function startQuiz(part) {
  const points = await getPoints(part);
  if (state.reversed) points.reverse();
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

$('again').addEventListener('click', () => startQuiz(state.part));
$('home').addEventListener('click', () => show('start'));

renderThreshold();
loadTrails()
  .then(() => selectTrail(state.trail))
  .catch((err) => {
    $('parts').innerHTML = `<li class="error">Nie udało się wczytać danych: ${err.message}</li>`;
  });
