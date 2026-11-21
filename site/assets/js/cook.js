// Экран кухни (specs/018, адрес /cook): принятые заказы точки — «Принят» → «Готовим» → «Готово». Отметку «Готово»
// (orders.ready_at) сразу видят курьер («✅ Готов — можно забирать») и покупатель (шаг «Готов»). Вход — тот же, что у панели:
// сессия менеджера на этом устройстве; владелец выбирает точку. «Одно устройство — одна роль» (specs/011): на устройстве шефа
// (страница продуктов) экран, как и панель, не открывается. Заказы — раз в 10 секунд и при возврате на вкладку; новый принятый
// заказ — короткие тоны, как в панели. Экран не гаснет (Wake Lock), пока страница открыта. Готовый самовывоз кухня отмечает
// «Выдан» — заказ уходит с экрана.
import { api } from './api.js';
import { BRANCHES, branchName, deliveryAt, deliveryStart, wait } from './data.js';
import { orderNo, showBranchInNumbers } from './cashbox.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const POLL_MS = 10_000;
const FRESH_MS = 60_000;          // новый принятый заказ подсвечен минуту
const ACCESS_EVERY_MS = 120_000;  // раз в 2 минуты проверяем, что вход менеджера ещё действует (как панель)
const WAIT_EVERY_MS = 300_000;    // время доставки точек — раз в 5 минут
const ERROR_MS = 30_000;          // строка ошибки у плитки
const DAY = 86_400_000;
// Тот же ключ, что пишет страница шефа и проверяет панель (admin.js → CHEF_KEY; сверяет scripts/check-cook.mjs)
const CHEF_KEY = 'kokoro.kitchen';
const VIEW_KEY = 'kokoro.cookView';
const SOUND_KEY = 'kokoro.cookSound';
const AWAKE_KEY = 'kokoro.cookAwake';
const COLUMNS = { new: 'Принят', cooking: 'Готовим', ready: 'Готово' };

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } };

let me = null;           // { branch, owner, legacy } — кто вошёл
let view = BRANCHES.includes(read(VIEW_KEY)) ? read(VIEW_KEY) : 'all'; // владелец: все точки или одна
let orders = [];
let branchWait = null;   // { kulieva: 90, kokzhar: 60 } — время доставки точек, минуты
let waitAt = 0;
let accessAt = 0;
let known = null;        // id заказов, которые экран уже показывал: новый принятый — сигнал
const freshUntil = new Map();
const busy = new Set();  // заказы, по которым идёт запрос
const errors = new Map(); // id → { text, at, col } — ошибка строкой у плитки
let note = '';
let timer = null;
let clockTimer = null;
let tab = 'new';
let soundOn = read(SOUND_KEY) !== 'off';
let awakeOn = read(AWAKE_KEY) !== 'off';
let open = false;        // экран заказов показан

const isNetwork = (err) => err instanceof TypeError;
const isOwner = () => Boolean(me && !me.legacy && (me.owner || !me.branch));
const time = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek' });
const dayKey = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek' }).format(new Date(ms));
const weekday = (ms) => new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'Asia/Bishkek' }).format(new Date(ms));

/* ---------- Вход: та же сессия, что у панели ---------- */

const chefDevice = () => Boolean(read(CHEF_KEY));

/**
 * Экран не открывается: kind — 'login' (нет входа или доступа), 'chef' (устройство шефа), 'error' (не удалось проверить —
 * сеть). text — пояснение под заголовком
 */
function gate(kind, text = '') {
  stop();
  open = false;
  orders = [];
  known = null;
  $('[data-board]').hidden = true;
  $('[data-tools]').hidden = true;
  $('[data-point]').textContent = '';
  ['new', 'cooking', 'ready'].forEach((c) => paint($(`[data-list="${c}"]`), ''));
  releaseAwake();
  $('[data-gate]').hidden = false;
  $('[data-gate-title]').textContent = kind === 'chef' ? 'Это устройство шефа — экран кухни здесь не открывается'
    : kind === 'error' ? 'Не удалось проверить вход' : 'Войдите в панель на этом устройстве';
  $('[data-gate-text]').textContent = text || (kind === 'chef'
    ? 'На этом телефоне или планшете открыта страница продуктов шефа. Экран кухни открывайте на устройстве менеджера точки.'
    : kind === 'login' ? 'Экран кухни открывается со входом менеджера точки — тем же, что у панели. Войдите в панель и вернитесь сюда.' : '');
  $('[data-gate-link]').hidden = kind === 'chef';
  $('[data-gate-retry]').hidden = kind !== 'error';
  document.title = 'Кухня — KOKORO';
}

async function boot() {
  if (chefDevice()) { leaveChefDevice(); return; }
  if (!api.auth.user()) { gate('login'); return; }
  let status;
  try {
    status = await api.auth.adminStatus();
  } catch (err) {
    if (err?.status === 401) { gate('login'); return; }
    gate('error', `${isNetwork(err) ? 'Нет связи с базой' : err.message}. Проверьте интернет и нажмите «Проверить ещё раз».`);
    return;
  }
  if (status !== 'ok') {
    gate('login', status === 'needs_mfa' ? 'Для панели нужен вход с кодом из приложения. Войдите в панель с кодом и вернитесь сюда.'
      : status === 'none' ? 'У этого входа нет доступа к панели KOKORO. Войдите в панель как менеджер точки.' : '');
    return;
  }
  try {
    me = (await api.admin.me()) || { branch: null, owner: true, legacy: true };
  } catch (err) {
    if (err?.status !== 404) {
      gate('error', `${isNetwork(err) ? 'Нет связи с базой' : err.message}. Проверьте интернет и нажмите «Проверить ещё раз».`);
      return;
    }
    me = { branch: null, owner: true, legacy: true }; // в базе ещё нет admin_me — экран без точек, как панель до двух точек
  }
  if (chefDevice()) { leaveChefDevice(); return; } // пока проверяли вход, в соседней вкладке открыли страницу шефа
  openBoard();
}

// Одно устройство — одна роль: как панель, закрываем здесь вход менеджера, чтобы шеф не открыл панель или этот экран без пароля
function leaveChefDevice() {
  gate('chef');
  if (api.auth.user()) api.auth.signOutHere().catch(() => {});
}
window.addEventListener('storage', (e) => { if (e.key === CHEF_KEY && e.newValue) leaveChefDevice(); });

$('[data-gate-retry]').addEventListener('click', () => { $('[data-gate]').hidden = true; boot(); });

/* ---------- Экран заказов ---------- */

function openBoard() {
  open = true;
  accessAt = Date.now();
  $('[data-gate]').hidden = true;
  $('[data-board]').hidden = false;
  $('[data-tools]').hidden = false;
  $('[data-point]').textContent = me.legacy ? '' : isOwner() ? (view === 'all' ? '· все точки' : `· ${branchName(view)}`) : `· ${branchName(me.branch)}`;
  document.title = me.legacy || (isOwner() && view === 'all') ? 'Кухня — KOKORO' : `Кухня · ${branchName(isOwner() ? view : me.branch)} — KOKORO`;
  showBranchInNumbers(isOwner() && view === 'all');
  buildPoints();
  renderSound();
  keepAwake();
  showTab(tab);
  load();
  stop();
  timer = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
}

function stop() { clearInterval(timer); timer = null; }

/** Переключатель точки — только у владельца */
function buildPoints() {
  const box = $('[data-points]');
  box.hidden = !isOwner();
  box.innerHTML = isOwner() ? [['all', 'Все точки'], ...BRANCHES.map((b) => [b, branchName(b)])]
    .map(([k, label]) => `<button class="ck-chip" type="button" data-view="${k}" aria-pressed="${view === k}">${esc(label)}</button>`).join('') : '';
}

$('[data-points]').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-view]');
  if (!chip || !isOwner()) return;
  view = chip.dataset.view;
  write(VIEW_KEY, view);
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  $('[data-point]').textContent = view === 'all' ? '· все точки' : `· ${branchName(view)}`;
  document.title = view === 'all' ? 'Кухня — KOKORO' : `Кухня · ${branchName(view)} — KOKORO`;
  showBranchInNumbers(view === 'all');
  known = null; // заказы другой точки — не «новые»: без сигнала
  render();
});

/** Заказ на экране: у владельца — по выбранной точке; заказы без точки (до разделения) видны везде, как в панели */
const inView = (o) => !isOwner() || view === 'all' || !o.branch || o.branch === view;

// Один запрос за раз: опрос и нажатие кнопки не наслаиваются
let inflight = null;
let again = false;
// Растёт с каждым нажатием кнопки на плитке (в начале и в конце запроса): ответ опроса, ушедшего раньше, устарел — он вернул
// бы плитку в прежнюю колонку. Такой ответ не применяем и сразу перечитываем
let actSeq = 0;
function load() {
  if (!open) return Promise.resolve();
  if (inflight) { again = true; return inflight; }
  inflight = (async () => {
    try {
      do { again = false; await loadOnce(); } while (again && open);
    } finally {
      inflight = null;
      again = false;
    }
  })();
  return inflight;
}

async function loadOnce() {
  const seq = actSeq;
  // Сторож, как в панели: вход сброшен или код стал обязателен — база молча отдала бы пустой список
  if (Date.now() - accessAt > ACCESS_EVERY_MS) {
    accessAt = Date.now();
    let status = 'ok';
    try { status = await api.auth.adminStatus(); } catch (err) { if (err?.status === 401) status = 'gone'; }
    if (status !== 'ok') { gate('login', 'Вход менеджера на этом устройстве закончился — войдите в панель снова.'); return; }
  }
  // Время доставки точек (для «отдать к») — вместе с заказами, раз в 5 минут; сбой — спросим со следующим опросом
  let waitReply = null;
  if (Date.now() - waitAt > WAIT_EVERY_MS) {
    waitAt = Date.now();
    waitReply = Promise.resolve().then(() => api.admin.branchSettings()).then((rows) => ({ rows }), () => null);
  }
  let rows;
  try {
    rows = await api.admin.cookOrders();
  } catch (err) {
    if (err?.status === 401) { gate('login', 'Вход менеджера на этом устройстве закончился — войдите в панель снова.'); return; }
    if (waitReply) waitAt = 0;
    setNote(isNetwork(err) ? 'Нет связи — пробуем ещё раз…' : `Не удалось обновить заказы: ${err.message}`, true);
    render();
    return;
  }
  if (waitReply) {
    const got = await waitReply;
    if (!got) waitAt = 0;
    else if (got.rows) branchWait = Object.fromEntries(Object.entries(got.rows).map(([b, r]) => [b, Number(r?.wait_minutes) || null]));
  }
  if (!open) return;
  if (seq !== actSeq) { again = true; return; } // пока ждали ответ, нажали кнопку на плитке — ответ устарел
  orders = (rows || []).filter((o) => o.status === 'confirmed' || o.status === 'cooking');
  if (noteKind === 'net') setNote(''); // связь вернулась
  render();
}

// Строка над колонками: 'net' — нет связи (уходит с первым удачным опросом), 'gone' — отказ по заказу, которого на экране
// уже нет (висит ~30 с)
let noteError = false;
let noteKind = '';
let noteAt = 0;
function setNote(text, error = false, kind = error ? 'net' : '') { note = text; noteError = error; noteKind = text ? kind : ''; noteAt = Date.now(); }

/* ---------- Колонки и плитки ---------- */

/** Колонка заказа: отметка «Готово» важнее статуса — готовый заказ ждёт курьера или покупателя */
const columnOf = (o) => (o.ready_at ? 'ready' : o.status === 'cooking' ? 'cooking' : 'new');
const paidOf = (o) => Date.parse(o.paid_at || o.created_at);
/** Время доставки точки (branch_settings), иначе запасное */
const pointWait = (o) => branchWait?.[o.branch] || wait.minutes;
/** Время ожидания заказа: своё (менеджер выбрал 60/90), иначе время доставки точки */
const waitOf = (o) => Number(o.wait_minutes) || pointWait(o);

/**
 * Время на плитке. «Ко времени» (hour — назначенный час клиенту, data.js → deliveryAt понимает «18:30, 12.11»): at — когда
 * отдать курьеру. Считаем как kokoro_order_due в базе и dueAt в панели — по времени ТОЧКИ, не заказа: именно в этот момент
 * заказ уходит курьерам. Час минус время точки, но не раньше 12:00 и не раньше оплаты.
 * «Побыстрее»: at — к какому времени обещали клиенту: начало доставки (оплаченный ночью — с 12:00) плюс ожидание заказа
 */
function dueOf(o) {
  const paid = paidOf(o);
  const hour = deliveryAt(paid, o.delivery_time);
  if (hour === null) return { at: deliveryStart(paid) + waitOf(o) * 60_000, timed: false, hour: null };
  return { at: Math.max(deliveryStart(paid), deliveryStart(hour - pointWait(o) * 60_000)), timed: true, hour };
}

/** День «ко времени», если не сегодня: «завтра, пт 12.11» или «сб 13.11». 00:00 — конец предыдущего дня */
function dayLabel(at) {
  const ms = at - 1;
  const d = dayKey(ms);
  const now = Date.now();
  if (d === dayKey(now)) return '';
  const date = `${weekday(ms)} ${d.slice(8, 10)}.${d.slice(5, 7)}`;
  return d === dayKey(now + DAY) ? `завтра, ${date}` : date;
}

// Главная кнопка плитки по колонке (у готового самовывоза перед «Вернуть» ещё «Выдан» — см. tileHtml)
const ACTIONS = {
  new: ['cook', 'Начать готовить'],
  cooking: ['ready', 'Готово'],
  ready: ['back', 'Вернуть'],
};

function tileHtml(o) {
  const col = columnOf(o);
  const due = dueOf(o);
  const late = col !== 'ready' && Date.now() > due.at;
  const fresh = (freshUntil.get(o.id) || 0) > Date.now();
  const day = due.timed ? dayLabel(due.hour) : '';
  const marks = [
    o.fulfillment === 'pickup' ? '<span class="ck-mark ck-mark--pickup">🥡 Самовывоз</span>' : '',
    o.door ? '<span class="ck-mark ck-mark--door">🚪 До двери</span>' : '',
  ].join('');
  // Готовый самовывоз: «Выдан» — заказ уходит с экрана (иначе «Готово» копило бы выданные), «Вернуть» — на случай ошибки
  const acts = col === 'ready' && o.fulfillment === 'pickup' ? [['done', 'Выдан'], ACTIONS.ready] : [ACTIONS[col]];
  const pending = busy.has(o.id);
  const buttons = acts.map(([act, label]) => `<button class="ck-tile__btn ck-tile__btn--${act}" type="button" data-act="${act}"${pending ? ' disabled' : ''}
      aria-label="${esc(`${label}: заказ ${orderNo(o)}`)}">${pending && act === acts[0][0] ? 'Секунду…' : label}</button>`).join('');
  const error = errors.get(o.id)?.text || '';
  return `<article class="ck-tile${due.timed ? ' ck-tile--timed' : ''}${fresh ? ' ck-tile--new' : ''}" data-id="${esc(o.id)}">
    <div class="ck-tile__head">
      <span class="ck-tile__num">${esc(orderNo(o))}</span>
      <span class="ck-tile__qty">Комбо × ${esc(o.qty)}</span>
    </div>
    ${due.timed ? `<p class="ck-tile__timed">⏰ к ${time(due.hour)}${day ? ` <span class="ck-tile__day">${esc(day)}</span>` : ''}</p>` : ''}
    ${marks ? `<p class="ck-tile__marks">${marks}</p>` : ''}
    <p class="ck-tile__due${late ? ' ck-tile__due--late' : ''}">${due.timed ? 'отдать к' : 'клиенту к'} <b>${time(due.at)}</b>${late ? ' · опаздываем' : ''}</p>
    ${o.comment ? `<p class="ck-tile__comment">💬 ${esc(o.comment)}</p>` : ''}
    ${buttons}
    <p class="ck-tile__error" role="alert">${esc(error)}</p>
  </article>`;
}

// Одинаковое содержимое не перерисовываем: кнопка под пальцем не пересоздаётся каждые 10 секунд
const painted = new WeakMap();
function paint(el, html) {
  if (painted.get(el) === html) return;
  painted.set(el, html);
  el.innerHTML = html;
}
function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

function render() {
  if (!open) return;
  const list = orders.filter(inView);
  // Новый принятый заказ — сигнал и подсветка. Первый ответ после входа или смены точки — без сигнала
  const fresh = known ? list.filter((o) => !known.has(o.id) && columnOf(o) === 'new') : [];
  fresh.forEach((o) => freshUntil.set(o.id, Date.now() + FRESH_MS));
  if (fresh.length) signal(fresh.length);
  known = new Set([...(known || []), ...list.map((o) => o.id)]);
  // Ошибка у плитки уходит, когда заказ сменил колонку или прошло ~30 с; заказа на экране уже нет — строкой сверху
  for (const [id, e] of errors) {
    const o = list.find((x) => x.id === id);
    if (!o) { if (!busy.has(id)) { setNote(`${e.no}: ${e.text}`, true, 'gone'); errors.delete(id); } continue; }
    if (columnOf(o) !== e.col || Date.now() - e.at > ERROR_MS) errors.delete(id);
  }
  if (noteKind === 'gone' && Date.now() - noteAt > ERROR_MS) setNote('');
  const by = { new: [], cooking: [], ready: [] };
  for (const o of list) by[columnOf(o)].push({ o, due: dueOf(o).at });
  for (const col of Object.keys(by)) {
    const items = by[col].sort((a, b) => a.due - b.due || a.o.id - b.o.id);
    paint($(`[data-list="${col}"]`), items.length ? items.map(({ o }) => tileHtml(o)).join('')
      : `<p class="ck-empty">${col === 'new' ? 'Новых заказов нет' : col === 'cooking' ? 'Сейчас ничего не готовим' : 'Готовых заказов нет'}</p>`);
    setText($(`[data-col-count="${col}"]`), items.length ? String(items.length) : '');
    setText($(`[data-tab-count="${col}"]`), items.length ? String(items.length) : '');
  }
  const el = $('[data-note]');
  el.className = `ck-note${noteError ? ' ck-note--error' : ''}`;
  setText(el, note);
}

/* ---------- Кнопки: «Начать готовить», «Готово», «Вернуть» ---------- */

function errorText(err, act) {
  if (isNetwork(err)) return 'Нет связи — нажмите ещё раз';
  // База без supabase/mini-app.sql: отметки «Готово» ещё нет
  if (err?.status === 404 && (act === 'ready' || act === 'back')) return 'Отметка «Готово» заработает после обновления базы — скажите владельцу';
  return err?.message || 'Не получилось — нажмите ещё раз';
}

$('[data-cols]').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-act]');
  if (!button || button.disabled) return;
  const id = Number(button.closest('[data-id]')?.dataset.id);
  const order = orders.find((o) => o.id === id);
  if (!order || busy.has(id)) return;
  const act = button.dataset.act;
  // «Выдан» убирает заказ с экрана и показывает покупателю «Выдан» — промах пальцем лучше переспросить
  if (act === 'done' && !confirm(`Заказ ${orderNo(order)} выдан покупателю?`)) return;
  busy.add(id);
  actSeq++; // ответы опроса, ушедшего до нажатия, не применяем
  errors.delete(id);
  render();
  try {
    if (act === 'cook') {
      // Условие «ещё Подтверждён»: если заказ уже взяли или изменили с другого устройства, правка не ляжет (api.js)
      const row = await api.admin.updateOrder(id, { status: 'cooking' }, { status: 'confirmed' });
      Object.assign(order, row && typeof row === 'object' ? row : {}, { status: 'cooking' });
    } else if (act === 'done') {
      // Самовывоз забрали: «Выдан» (статус «Доставлен»), только если заказ всё ещё «Готовится»
      await api.admin.updateOrder(id, { status: 'done' }, { status: 'cooking' });
      orders = orders.filter((o) => o.id !== id);
    } else {
      const row = await api.admin.setReady(id, act === 'ready');
      order.ready_at = row?.ready_at !== undefined ? row.ready_at : act === 'ready' ? new Date().toISOString() : null;
      if (row?.status) order.status = row.status;
      else if (act === 'ready' && order.status === 'confirmed') order.status = 'cooking';
    }
  } catch (err) {
    errors.set(id, { text: errorText(err, act), at: Date.now(), col: columnOf(order), no: orderNo(order) });
  } finally {
    busy.delete(id);
    actSeq++; // и ответы, ушедшие во время запроса: они могли не увидеть правку
  }
  render();
  // Плитка уехала в другую колонку — фокус на её новую кнопку (с клавиатуры место не теряется)
  document.querySelector(`.ck-tile[data-id="${id}"] [data-act]`)?.focus({ preventScroll: true });
  await load();
});

/* ---------- Вкладки на телефоне ---------- */

function showTab(name) {
  tab = name;
  $('[data-cols]').dataset.show = name;
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === name)));
}
$('[data-tabs]').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b && COLUMNS[b.dataset.tab]) showTab(b.dataset.tab);
});

/* ---------- Сигнал о новом заказе: короткие тоны, как в панели ---------- */

let audio = null;
// Звук браузер даёт включить только после касания страницы: готовим его на первое нажатие
function onTap() {
  try {
    if (!audio || audio.state === 'closed') audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state !== 'running') audio.resume?.().catch(() => {});
  } catch { /* без звука */ }
  renderSound();
  if (awakeOn && !wakeLock && open) keepAwake(); // Safari держит экран только по нажатию
}
for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) document.addEventListener(type, onTap, { capture: true, passive: true });

function beep() {
  if (!audio || audio.state === 'closed') return;
  try {
    audio.resume?.();
    [0, 0.25, 0.5].forEach((at) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, audio.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + at + 0.2);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + at);
      osc.stop(audio.currentTime + at + 0.2);
    });
  } catch { /* без звука */ }
}

let titleTimer = null;
function signal(n) {
  if (soundOn) {
    beep();
    if (navigator.userActivation?.hasBeenActive ?? true) { try { navigator.vibrate?.([300, 150, 300]); } catch { /* не везде есть */ } }
  }
  const base = document.title.replace(/^\(\d+\) Новый заказ — /, '');
  const text = `(${n}) Новый заказ — ${base}`;
  let flips = 0;
  clearInterval(titleTimer);
  document.title = text;
  titleTimer = setInterval(() => {
    document.title = flips++ % 2 ? base : text;
    if (flips > 20) { clearInterval(titleTimer); document.title = base; }
  }, 800);
}

function renderSound() {
  const b = $('[data-sound]');
  b.setAttribute('aria-pressed', String(soundOn));
  b.textContent = soundOn ? '🔔 Звук' : '🔕 Без звука';
  $('[data-unlock]').hidden = !open || !soundOn || Boolean(audio && audio.state === 'running');
}
$('[data-sound]').addEventListener('click', () => {
  soundOn = !soundOn;
  write(SOUND_KEY, soundOn ? 'on' : 'off');
  renderSound();
  if (soundOn) beep(); // заодно слышно, что звук работает
});

/* ---------- Экран не гаснет (Wake Lock) ---------- */

// С погасшим экраном браузер не выполняет код страницы — о заказе никто не узнает. Свернули вкладку — система отпускает
// сама, вернулись — просим снова
let wakeLock = null;
let wakePending = false;
let wakeProblem = ''; // '' | 'unsupported' | 'denied'

async function keepAwake() {
  if (!awakeOn || !open || document.hidden || wakeLock || wakePending) { renderAwake(); return; }
  if (!navigator.wakeLock) { wakeProblem = 'unsupported'; renderAwake(); return; }
  wakePending = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    wakeProblem = '';
    if (!awakeOn || !open || document.hidden) lock.release().catch(() => {});
    else {
      wakeLock = lock;
      lock.addEventListener?.('release', () => { if (wakeLock === lock) wakeLock = null; renderAwake(); });
    }
  } catch {
    if (!document.hidden) wakeProblem = 'denied';
  }
  wakePending = false;
  renderAwake();
}

function releaseAwake() {
  const lock = wakeLock;
  wakeLock = null;
  lock?.release().catch(() => {});
  renderAwake();
}

function renderAwake() {
  const b = $('[data-awake]');
  b.setAttribute('aria-pressed', String(awakeOn));
  b.textContent = awakeOn ? '☀ Экран не гаснет' : '🌙 Экран гаснет';
  setText($('[data-awake-note]'), !awakeOn || !open ? ''
    : wakeProblem === 'unsupported' ? 'Этот браузер не умеет держать экран включённым — отключите автоблокировку в настройках устройства'
      : wakeProblem === 'denied' ? 'Коснитесь экрана — тогда он перестанет гаснуть. Не помогает — подключите зарядку или выключите энергосбережение'
        : '');
}
$('[data-awake]').addEventListener('click', () => {
  awakeOn = !awakeOn;
  write(AWAKE_KEY, awakeOn ? 'on' : 'off');
  if (awakeOn) keepAwake(); else releaseAwake();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !open) return;
  load();
  keepAwake();
  renderSound();
});

/* ---------- Часы в шапке ---------- */

function tick() { setText($('[data-clock]'), time(Date.now())); }
tick();
clockTimer = setInterval(tick, 15_000);

boot();
