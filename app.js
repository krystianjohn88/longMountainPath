'use strict';

const TYPE_ICON = {
  'góra': '⛰️', 'przełęcz': '🪨', 'schronisko': '🏠', 'miasto': '🏘️', 'polana': '🌾', 'inne': '📍',
};
// Przedrostki, które można pominąć przy wpisywaniu („Kubalonka” zamiast „Przełęcz Kubalonka”).
const OPTIONAL_PREFIXES = ['przelecz', 'hala', 'schronisko'];

const $ = (id) => document.getElementById(id);

const state = {
  reversed: false,   // false: Ustroń → Wołosate
  part: null,        // null = cały szlak
  points: [],        // punkty w bieżącej sesji (w kolejności nauki)
  index: 0,
  hintLevel: 0,
  mistakes: 0,
  revealed: 0,
};

// --- narzędzia ---------------------------------------------------------------

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
    out.add(f);
    const [first, ...rest] = f.split(' ');
    if (OPTIONAL_PREFIXES.includes(first) && rest.length) out.add(rest.join(' '));
  }
  return out;
}

function matches(input, label) {
  const a = normalize(input);
  return a !== '' && variants(label).has(a);
}

// Dane czytane bezpośrednio z pliku points.json obok (strona statyczna, np. GitHub Pages).
let pointsCache = null;

async function loadPoints() {
  if (!pointsCache) {
    const res = await fetch('points.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} points.json`);
    pointsCache = (await res.json()).sort((a, b) => a.id - b.id);
  }
  return pointsCache;
}

async function getPoints(part) {
  const all = await loadPoints();
  return part ? all.filter((p) => p.name_mountain_part === part) : all.slice();
}

// Pasma w kolejności występowania na szlaku + liczba punktów.
async function getParts() {
  const parts = [];
  for (const p of await loadPoints()) {
    const last = parts[parts.length - 1];
    if (last && last.name === p.name_mountain_part) last.count++;
    else parts.push({ name: p.name_mountain_part, count: 1 });
  }
  return parts;
}

function show(screen) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  $(`screen-${screen}`).classList.add('active');
}

// --- ekran startowy ----------------------------------------------------------

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

$('dir-toggle').addEventListener('click', () => {
  state.reversed = !state.reversed;
  $('dir-toggle').textContent = state.reversed ? 'Wołosate → Ustroń' : 'Ustroń → Wołosate';
  renderParts();
});

$('start-all').addEventListener('click', () => startQuiz(null));

// --- nauka -------------------------------------------------------------------

async function startQuiz(part) {
  const points = await getPoints(part);
  if (state.reversed) points.reverse();
  Object.assign(state, { part, points, index: 0, hintLevel: 0, mistakes: 0, revealed: 0 });

  $('quiz-title').textContent = part || 'Cały szlak';
  $('done').innerHTML = '';
  // Pierwszy punkt podajemy jako punkt startowy – uczymy się „co dalej”.
  addDone(points[0], 'start');
  state.index = 1;
  show('quiz');
  nextPrompt();
}

function addDone(point, kind) {
  const li = document.createElement('li');
  li.className = kind;
  li.innerHTML = `<span class="ico">${TYPE_ICON[point.typ_punktu] || '•'}</span>
    <span class="label">${point.label}</span>
    <small>${point.typ_punktu}</small>`;
  $('done').appendChild(li);
  li.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
  $('answer').focus();
}

function advance(kind) {
  addDone(current(), kind);
  state.index++;
  nextPrompt();
}

$('answer-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('answer').value;
  if (!input.trim()) return;
  if (matches(input, current().label)) {
    advance('ok');
  } else {
    state.mistakes++;
    const field = $('answer');
    field.classList.remove('wrong');
    void field.offsetWidth; // restart animacji
    field.classList.add('wrong');
  }
});

$('btn-hint').addEventListener('click', () => {
  const p = current();
  state.hintLevel++;
  const hints = [
    `Typ: ${TYPE_ICON[p.typ_punktu] || ''} ${p.typ_punktu}`,
    `Typ: ${p.typ_punktu} · zaczyna się na „${p.label[0]}”`,
    `Typ: ${p.typ_punktu} · „${p.label.slice(0, Math.ceil(p.label.length / 2))}…”`,
  ];
  $('hint').textContent = hints[Math.min(state.hintLevel, hints.length) - 1];
  $('answer').focus();
});

$('btn-reveal').addEventListener('click', () => {
  state.revealed++;
  advance('revealed');
});

$('back').addEventListener('click', () => show('start'));

// --- podsumowanie ------------------------------------------------------------

function finish() {
  const asked = state.points.length - 1;
  const ok = asked - state.revealed;
  $('summary').textContent =
    `Trafione: ${ok} / ${asked} · pokazane: ${state.revealed} · błędne próby: ${state.mistakes}`;
  show('end');
}

$('again').addEventListener('click', () => startQuiz(state.part));
$('home').addEventListener('click', () => show('start'));

renderParts().catch((err) => {
  $('parts').innerHTML = `<li class="error">Nie udało się wczytać danych: ${err.message}</li>`;
});
