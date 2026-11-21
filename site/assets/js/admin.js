// Панель менеджера: заказы за день (обновляются сами), статусы, WhatsApp, настройки.
import { api } from './api.js';
import { STATUSES, PAYMENTS, delivery, deliveryOpen, deliveryStart, hours, kmLabel, maxKm, money, payment, wait, waitLabel,
  BRANCHES, branchName, branchKitchen, SOVETSKAYA, deliveryAt, door, waitChoices } from './data.js';
import { openChat, hasUnread, chime } from './chat.js';
import { cashDays, cashTotal, orderNo, receiptFileName, receiptsCsv, sniffReceipt, showBranchInNumbers, RECEIPT_PATH } from './cashbox.js';
import { crc32, zipEntry, zipParts } from './zip.js';
import { pointLink, ago, isFresh } from './maps.js';
import { createMap, deliveryQuote, geocode, pin, fit } from './map.js';
import { queueReceipts, receiptVerdict, onReceiptChecked, isQueued, queueLength, pendingReason, keepOnly, rememberLabels, forget as forgetReceipt, clear as clearReceipts } from './receipt-ocr.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nbsp = (s) => s.replace(/ /g, '&nbsp;');
const POLL_MS = 10_000;
const SOUND_KEY = 'kokoro.sound';

let settings = null;
let branchRows = null; // приём и время доставки по точкам (branch_settings); null — таблицы нет, работаем по общим настройкам
// Сколько заказов курьер берёт на руки — по точкам (specs/014): { kulieva: 3, kokzhar: 3 }; null — колонки ещё нет
// (supabase/courier-pickup.sql не запущен), тогда строки «Курьер берёт до …» в полосе приёма нет
let courierLimits = null;
let limitsAt = 0; // когда предел перечитывали: меняется редко — раз в 2 минуты, а не с каждым обновлением заказов
// Кто назначает курьеров — по точкам (specs/026): { kulieva: 'manual' | 'auto' }; null — колонки ещё нет
// (supabase/manual-dispatch.sql не запущен), тогда переключателя «Курьеров назначает» в полосе точки нет
let dispatchModes = null;
let orders = [];
let filter = 'active';
let pollTimer = null;
let autoDay = null;   // день, который панель сама поставила как «сегодня»
let ordersSeq = 0;    // номер последнего запроса заказов: ответы на старые отбрасываем
let ordersDay = null; // день, за который показаны заказы
let dayMoney = [];    // заказы, оформленные или оплаченные в этот день, — для выручки дня; undefined — не загрузились
const FULL_RELOAD_MS = 120_000; // все заказы дня перечитываем не реже раза в 2 минуты
let lastFullLoad = 0;
let lastAccessCheck = Date.now(); // при входе доступ только что проверен
let changeStamp = null; // самое позднее время изменения среди загруженных заказов
let couriers = null;    // курьеры (supabase/couriers.sql); null — функции в базе нет или не загрузились
let contactsById = null; // номера и сводки чатов курьеров (specs/021): Map(id → { phone, chat }); null — ещё нет или база без 021
let contactsAt = 0;     // когда их спрашивали в последний раз
let contactsSeq = 0;    // поздний ответ (до выхода) не применяем
let courierChatOpen = null; // id курьера, чат с которым сейчас открыт: его новые сообщения — без сигнала
let couriersAt = 0;     // когда курьеров перечитывали: место меняется без изменений в заказах — раз в 30 с
const COURIERS_EVERY_MS = 30_000;
let soundOn = true;
try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off'; } catch { /* ничего */ }
// Сигнал, пока оплаченный заказ не приняли (specs/010): раз в минуту, по заказам любого дня за 48 часов
const REMIND_MS = 60_000;
const WAITING_EVERY_MS = 60_000; // как часто спрашиваем базу об ожидающих заказах с других дат
const WAITING_HOURS = 48;
// Запас к минутным порогам: свёрнутую вкладку Chrome будит раз в минуту, и ровно 60 с превращались бы в 120
const SLACK_MS = 5_000;
let serverWaiting = null; // оплаченные и не принятые заказы за 48 часов по ответу базы; null — ещё не знаем
let waitingAt = 0;        // когда базу спрашивали в последний раз
let seenWaiting = null;   // id, о которых уже был первый сигнал: смена даты и повторная загрузка не сигналят заново
let lastSignal = 0;
// Заказ передали на эту точку (specs/013) — сигнал один раз и метка «Передан вам» на 15 минут или до нажатия в карточке.
// seenOrders — какие заказы были в списке дня при прошлой загрузке и какие ушли на другую точку; null — первой загрузки не было
let seenOrders = null;    // { day, ids: Set, left: Set }
const handed = new Map(); // id заказа → когда он появился у точки
const HANDED_MS = 15 * 60_000;
const AWAKE_KEY = 'kokoro.awake';
let awakeOn = true;
try { awakeOn = localStorage.getItem(AWAKE_KEY) !== 'off'; } catch { /* ничего */ }
// Чаты заказов (specs/018): сводка по видимым заказам — id заказа → { order_id, last_id, last_author, count }. Первая сводка
// после открытия панели только ставит метки «есть новое», сигнал — о сообщениях, пришедших после неё
let chats = new Map();
let chatsLoaded = false;
let chatsAt = 0;      // когда сводку спрашивали в последний раз
let chatsSeq = 0;     // ответ на старый запрос не затирает новый
let chatOpenId = null; // чей чат открыт: о его новых сообщениях не сигналим — менеджер их и так видит
const CHATS_HIDDEN_MS = 60_000;
const CHAT_SINCE_HOURS = 48;

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek' });
const todayBishkek = () => DAY_FORMAT.format(new Date());
/** День оформления заказа по Бишкеку: '2026-11-04' */
const dayOf = (iso) => DAY_FORMAT.format(new Date(iso));
const isActive = (o) => o.status !== 'done' && o.status !== 'canceled';
/** Заказ оформлен раньше показанного дня — перенесённый незакрытый (specs/018: в списке «сегодня» за 3 суток) */
const isCarried = (o) => Boolean(ordersDay) && dayOf(o.created_at) < ordersDay;
const CARRY_MS = 3 * 86_400_000;
const carryAsked = new Set(); // ждущие заказы прошлых дней, ради которых день уже перечитывали
const bishkekTime = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek' });
/** '2026-10-31' → «пт, 31 октября» */
const dayTitle = (day) => new Date(`${day}T12:00:00+06:00`)
  .toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'Asia/Bishkek' });
/** '2026-10-31' → «31 октября» */
const dayShort = (day) => new Date(`${day}T12:00:00+06:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Bishkek' });
/** День по Бишкеку со сдвигом: ('2026-11-11', 1) → '2026-11-12' */
const shiftDay = (day, n) => DAY_FORMAT.format(new Date(Date.parse(`${day}T12:00:00+06:00`) + n * 86_400_000));

/* ---------- Две точки (specs/013): кто вошёл и какую точку смотрит ---------- */

// Кто вошёл: { branch: 'kulieva' | 'kokzhar' | null, owner, email }. legacy — в базе ещё нет admin_me (two-points.sql
// не запускали): панель как до двух точек, без меток и деления
let me = null;
const twoPoints = () => Boolean(me && !me.legacy);
const isOwner = () => twoPoints() && (me.owner || !me.branch);
// Владелец смотрит все точки или одну; выбор помним на устройстве
const VIEW_KEY = 'kokoro.branchView';
let branchView = 'all';
try { branchView = BRANCHES.includes(localStorage.getItem(VIEW_KEY)) ? localStorage.getItem(VIEW_KEY) : 'all'; } catch { /* ничего */ }
// Сторона города — в подтверждениях и подписях полос приёма
const SIDE = { kulieva: 'западнее Советской', kokzhar: 'восточнее Советской' };
/**
 * Что видит покупатель, когда его точка остановила приём, — тот же текст из data.js, что показывает сайт: панель обещает
 * ровно это. short — первая фраза, для полосы приёма
 */
function branchClosedText(b, short = false) {
  const text = String(payment.branchClosedMessage || '').replace(/\{name\}/g, branchName(b));
  return short ? text.split('. ')[0] : text;
}

/**
 * Заказ на экране: у владельца — по выбранной точке. Заказы без точки (до запуска двух точек) видны в любой точке —
 * так их видят и менеджеры точек: кто-то должен их довезти или передать
 */
const inView = (o) => !isOwner() || branchView === 'all' || !o.branch || o.branch === branchView;
/**
 * Деньги считаем строго по точке. Заказ до разделения (без точки) — ничей: у владельца он только в «Все точки» отдельной
 * строкой, у менеджера точки в кассу не входит вовсе (иначе каждая точка видела бы выручку всего города до запуска)
 */
const inMoneyView = (o) => (!twoPoints() ? true : isOwner() ? branchView === 'all' || o.branch === branchView : o.branch === me.branch);
/** У менеджера точки: среди заказов есть оплаты до разделения точек — их выручка в кассе владельца */
function hasPreSplitMoney(rows, prefix) {
  if (!twoPoints() || isOwner() || !rows) return false;
  const t = cashTotal(cashDays(rows.filter((o) => !o.branch), prefix));
  return Boolean(t.receipts || t.noReceipt);
}
const PRE_SPLIT_NOTE = 'Заказы до разделения точек — в кассе владельца';

async function whoAmI() {
  try {
    me = (await api.admin.me()) || { branch: null, owner: true, legacy: true };
  } catch (err) {
    if (err.status !== 404) throw err; // сеть или сбой базы — пусть вход скажет «не удалось проверить доступ»
    me = { branch: null, owner: true, legacy: true }; // функции admin_me ещё нет — панель как раньше
  }
  showBranchInNumbers(isOwner());
}

const titleBase = () => (!twoPoints() ? 'Заказы — KOKORO' : isOwner() ? 'Заказы · все точки — KOKORO' : `Заказы · ${branchName(me.branch)} — KOKORO`);

/** Метка в шапке и заголовок вкладки: какая точка вошла */
function renderWho() {
  const el = $('[data-who]');
  el.hidden = !twoPoints() || $('[data-tabs]').hidden;
  el.textContent = isOwner() ? 'Владелец · все точки' : branchName(me?.branch);
  el.title = me?.email ? `Вход: ${me.email}` : '';
  document.title = titleBase();
}

/** Переключатель точки у владельца — на «Заказах» и в «Кассе» */
function buildBranchPick() {
  const chips = [['all', 'Все точки'], ...BRANCHES.map((b) => [b, branchName(b)])];
  document.querySelectorAll('[data-branch-pick]').forEach((box) => {
    box.hidden = !isOwner();
    box.innerHTML = isOwner() ? chips.map(([k, label]) => `<button class="chip" type="button" data-branch="${k}" aria-pressed="${branchView === k}">${label}</button>`).join('') : '';
  });
}

document.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-branch-pick] [data-branch]');
  if (!chip || !isOwner() || zipBusy) return;
  branchView = chip.dataset.branch;
  try { localStorage.setItem(VIEW_KEY, branchView); } catch { /* ничего */ }
  // Кнопки не перерисовываем — фокус остаётся на нажатой
  document.querySelectorAll('[data-branch-pick] [data-branch]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.branch === branchView)));
  renderOrders();
  renderCourierStrip(); // курьеры выбранной точки (specs/014)
  if (opsOpen) renderOpsMap(true);
  if (ledger.month) { ledger.days = cashDays(ledger.rows.filter(inMoneyView), ledger.month); renderLedger(); }
});

/** Выручка по точкам: «Кулиева 2 800 сом · Кок-Жар 4 200 сом»; заказы до запуска — «без точки», если они есть */
function pointSplit(rows, prefix) {
  return [...BRANCHES, null]
    .map((b) => [b, cashTotal(cashDays(rows.filter((o) => (o.branch || null) === b), prefix))])
    .filter(([b, t]) => b || t.revenue || t.receipts)
    .map(([b, t]) => ({ name: b ? branchName(b) : 'без точки', total: t }));
}

/* ---------- Вход ---------- */

async function boot() {
  if (chefDevice()) { await leaveChefDevice(); return; }
  if (!api.auth.user()) { showLoginStep('password'); return; }
  try { await continueLogin(); } catch (err) { loginProblem(err); }
}

// Одно устройство — одна роль (specs/011): на телефоне или планшете, где открыта страница шефа, панель не открываем
// и вход менеджера здесь закрываем. Иначе вход, оставленный менеджером на телефоне шефа, открыл бы шефу панель без пароля:
// сайт у них один, а вход хранится на устройстве бессрочно. Страница шефа со своей стороны делает то же самое
const CHEF_KEY = 'kokoro.kitchen';
const chefDevice = () => { try { return !!localStorage.getItem(CHEF_KEY); } catch { return false; } };

function leaveChefDevice() {
  stopApp();
  clearReceipts(); // распознанные тексты чеков на устройстве шефа не оставляем
  showLoginStep('chef');
  // Только это устройство: остальные менеджеры в панели. Здесь вход стирается сразу, отзыв на сервере — следом, без ожидания
  if (api.auth.user()) api.auth.signOutHere().catch(() => {});
}

// Шеф открыл свою страницу в соседней вкладке этого же устройства — панель закрывается сразу
window.addEventListener('storage', (e) => { if (e.key === CHEF_KEY && e.newValue) leaveChefDevice(); });

$('[data-chef-device-leave]').addEventListener('click', () => {
  if (!confirm('Страница шефа на этом устройстве закроется, и шефу понадобится ссылка заново. Продолжить?')) return;
  try { localStorage.removeItem(CHEF_KEY); } catch { /* ничего */ }
  showLoginStep('password');
});

/** Шаг экрана входа: 'password' | 'code' | 'enroll' | 'chef' (устройство шефа — панель здесь не открывается) */
function showLoginStep(step) {
  $('[data-login]').hidden = false;
  $('[data-login-form]').hidden = step !== 'password';
  $('[data-mfa-form]').hidden = step !== 'code';
  $('[data-mfa-login-enroll]').hidden = step !== 'enroll';
  $('[data-chef-device]').hidden = step !== 'chef';
  // На шагах кода и подключения — чей это вход и как выйти (например, вошли не тем аккаунтом)
  $('[data-login-who]').hidden = step === 'password' || step === 'chef';
  $('[data-login-email]').textContent = api.auth.user()?.email || '';
  (step === 'code' ? $('[data-mfa-form] input') : step === 'password' ? $('[data-login-form] input') : null)?.focus();
}

/** Проверить доступ не удалось: сеть или сбой — не выкидываем, предлагаем повторить */
function loginProblem(err) {
  if (err?.status === 401) { showLoginStep('password'); return; }
  showLoginStep('password');
  $('[data-login-error]').textContent = `Не удалось проверить доступ: ${err?.message || 'нет связи'}. Проверьте интернет и войдите ещё раз`;
}

$('[data-login-other]').addEventListener('click', async () => {
  await api.auth.signOutHere();
  loginFactor = null;
  $('[data-mfa-login-enroll]').innerHTML = '';
  showLoginStep('password');
});

let loginFactor = null; // подключённое приложение-аутентификатор, код которого ждём

/**
 * После пароля: если у аккаунта включён код из приложения — спрашиваем его (даже пока база этого
 * не требует); база требует код, а приложение не подключено — подключаем; иначе — в панель.
 */
async function continueLogin() {
  if (chefDevice()) { await leaveChefDevice(); return; } // пока вводили пароль, в соседней вкладке открыли страницу шефа
  const factors = (await api.auth.mfa.factors()).filter((f) => f.status === 'verified');
  if (factors.length && api.auth.aal() !== 'aal2') {
    loginFactor = factors[0];
    showLoginStep('code');
    return;
  }
  const status = await api.auth.adminStatus();
  if (status === 'ok') {
    await whoAmI(); // какая точка вошла: от этого зависят заказы, полосы приёма и настройки
    $('[data-login]').hidden = true;
    openApp();
    return;
  }
  if (status === 'needs_mfa') {
    showLoginStep('enroll');
    startEnroll($('[data-mfa-login-enroll]'), 'Для входа в панель нужен код из приложения. Подключите его один раз — дальше вход будет по паролю и коду.', continueLogin);
    return;
  }
  await api.auth.signOutHere(); // выходим только здесь: глобальный выход выкинул бы и законные устройства
  showLoginStep('password');
  $('[data-login-error]').textContent = 'У этого пользователя нет доступа к панели KOKORO.';
}

/** Кнопка на время запроса неактивна — двойное нажатие не откроет панель дважды */
async function busy(form, fn) {
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  try { await fn(); } finally { button.disabled = false; }
}

$('[data-login-form]').addEventListener('submit', (e) => {
  e.preventDefault();
  busy(e.target, async () => {
    const f = e.target.elements;
    const error = $('[data-login-error]');
    error.textContent = '';
    try {
      await api.auth.signIn(f.email.value.trim(), f.password.value);
      f.password.value = '';
    } catch (err) {
      error.textContent = /invalid/i.test(err.message) ? 'Неверная почта или пароль'
        : err.status === 429 ? 'Слишком много попыток входа — подождите несколько минут' : err.message;
      return;
    }
    try { await continueLogin(); } catch (err) { loginProblem(err); }
  });
});

$('[data-mfa-form]').addEventListener('submit', (e) => {
  e.preventDefault();
  busy(e.target, async () => {
    const input = e.target.elements.code;
    const error = $('[data-mfa-error]');
    error.textContent = '';
    try {
      await api.auth.mfa.verify(loginFactor.id, input.value.trim());
      input.value = '';
    } catch (err) {
      input.value = '';
      error.textContent = err.status === 429 ? 'Слишком много попыток — подождите несколько минут' : 'Код не подошёл. Введите свежий код из приложения';
      return;
    }
    try { await continueLogin(); } catch (err) { loginProblem(err); }
  });
});

/**
 * Подключение приложения-аутентификатора: QR-код и ключ, затем первый код.
 * После подключения все устройства, где вошли только по паролю, выходят (так устроен Supabase).
 */
async function startEnroll(container, lead, onDone) {
  container.innerHTML = '<p class="admin__hint">Готовим QR-код…</p>';
  let factor;
  try {
    // Незавершённые подключения (закрыли страницу на QR) убираем — иначе их копится до лимита
    for (const f of await api.auth.mfa.factors()) if (f.status !== 'verified') await api.auth.mfa.unenroll(f.id).catch(() => {});
    factor = await api.auth.mfa.enroll(`Телефон ${new Date().toLocaleString('ru-RU')}`);
  } catch (err) {
    const text = /maximum|too many/i.test(err.message) ? 'слишком много незавершённых подключений — подождите несколько минут' : err.message;
    container.innerHTML = `<p class="error">Не удалось начать: ${esc(text)}</p>`;
    return;
  }
  container.innerHTML = `<div class="enroll">
    <p>${esc(lead)}</p>
    <ol class="enroll__steps">
      <li>Установите на телефон Google Authenticator или Microsoft Authenticator.</li>
      <li>В приложении нажмите «+» и отсканируйте QR-код:</li>
    </ol>
    <img class="enroll__qr" src="${esc(factor.totp.qr_code)}" width="200" height="200" alt="QR-код для приложения-аутентификатора">
    <p class="admin__hint">Не сканируется — введите ключ вручную: <code class="enroll__secret">${esc(factor.totp.secret)}</code>.
      Подключаете на этом же телефоне — <a href="${esc(factor.totp.uri)}">откройте приложение по ссылке</a>.</p>
    <form class="enroll__form" data-enroll-form>
      <label class="field"><span>3. Код из приложения</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
      <p class="error" role="alert" data-enroll-error></p>
      <button class="btn" type="submit">Подключить</button>
    </form>
  </div>`;
  container.querySelector('[data-enroll-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.elements.code;
    try {
      await api.auth.mfa.verify(factor.id, input.value.trim());
      container.innerHTML = '<p class="admin__saved">Двухфакторный вход включён ✓ Устройства, где вошли только по паролю, вышли.</p>';
      onDone?.();
    } catch {
      input.value = '';
      container.querySelector('[data-enroll-error]').textContent = 'Код не подошёл. Введите свежий код (он меняется каждые 30 секунд)';
    }
  });
}

// «Выйти» вверху — только с этого устройства: менеджер, заглянувший в панель с чужого телефона, выходит, не выкидывая
// рабочий планшет с сигналом заказов. Выход со всех устройств — в «Настройках» (например, телефон потерян)
$('[data-signout]').addEventListener('click', async () => {
  stopApp();
  clearReceipts(); // распознанные тексты чеков на этом устройстве больше не нужны
  await api.auth.signOutHere();
  location.reload();
});

$('[data-signout-all]').addEventListener('click', async () => {
  if (!confirm('Панель закроется на всех телефонах и планшетах, где вошли под этим входом, в том числе на рабочем. Продолжить?')) return;
  stopApp();
  clearReceipts();
  await api.auth.signOut();
  location.reload();
});

/** Закрыть панель: остановить опросы и спрятать вкладки (дальше — экран входа) */
function stopApp() {
  clearInterval(pollTimer);
  pollTimer = null;
  clearTimeout(ledgerTimer);
  $('[data-tabs]').hidden = true;
  $('[data-signout]').hidden = true;
  $('[data-who]').hidden = true;
  document.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = true; });
  openChat.current?.close();
  chats = new Map();
  chatsLoaded = false;
  contactsById = null; // номера и чаты курьеров (specs/021) прежнего входа
  contactsSeq++;
  // Отчёт прежнего входа (другая точка) не должен остаться на экране; поздний ответ отбросится
  reportSeq++;
  $('[data-report]').innerHTML = '';
  $('[data-report-status]').textContent = '';
  releaseAwake();
  renderUnlock();
}

async function openApp() {
  if (pollTimer) return; // панель уже открыта — второй опрос не запускаем
  $('[data-tabs]').hidden = false;
  $('[data-signout]').hidden = false;
  renderWho();
  buildBranchPick();
  $('[data-day]').value = autoDay = todayBishkek();
  $('[data-month]').max = autoDay.slice(0, 7);
  updateSoundButton();
  prepareAudio();
  keepAwake();
  showTab('orders');
  try { await readIntake(); } catch { /* полосы приёма появятся со следующей загрузкой заказов */ }
  renderIntake();
  await loadCouriers(); // список «Курьер» в карточках нужен до первой отрисовки
  await loadOrders();
  refreshChats(); // первая сводка чатов — только метки «есть новое», без сигнала
  lastSignal = Date.now(); // уже ждущие на момент открытия — без гудка сразу, повтор через минуту
  pollTimer = setInterval(pollOrders, POLL_MS);
}

/**
 * Опрос каждые 10 с: дёшево спрашиваем базу «изменилось ли что-то с прошлого раза», а все заказы дня
 * перечитываем только при изменениях и раз в 2 минуты. Свёрнутая вкладка заказы не перечитывает —
 * при 200 заказах в день это экономит гигабайты трафика Supabase в месяц, — но раз в минуту спрашивает
 * номера оплаченных и не принятых заказов (несколько байт) и сигналит о них.
 */
async function pollOrders() {
  // Автоназначение (specs/015) — первым делом и без ожидания: так вызовы идут ровно по таймеру опроса, а медленный ответ
  // базы не задерживает ни заказы, ни сигнал. Свёрнутая вкладка не зовёт: хватает таймера Cloudflare и страниц курьеров
  if (!document.hidden) kickDispatch();
  if (Date.now() - waitingAt >= WAITING_EVERY_MS - SLACK_MS) {
    await refreshWaiting();
    if (!pollTimer) return; // пока ждали ответ, вышли из панели
  }
  remind();
  // Чаты заказов (specs/018): открытая панель спрашивает с каждым опросом, свёрнутая — раз в минуту (и сигналит о новом)
  if (!document.hidden || Date.now() - chatsAt >= CHATS_HIDDEN_MS - SLACK_MS) refreshChats();
  // Чаты с курьерами и их номера (specs/021) — так же
  if (!document.hidden || Date.now() - contactsAt >= CHATS_HIDDEN_MS - SLACK_MS) refreshCourierContacts();
  if (document.hidden) return;
  // «Передан вам» висит 15 минут; «⏱ Нет курьера», «⏱ Курьер не забрал» и «⏱ В пути» пересчитываются раз в минуту
  // (specs/014, 015)
  if (expireHanded() || lateChanged()) renderOrders();
  if (!wakeLock && wakeProblem !== 'unsupported') keepAwake(); // экран отпустила система (мало заряда) — просим снова
  if (Date.now() - couriersAt > COURIERS_EVERY_MS) loadCouriers();
  const day = $('[data-day]').value;
  const stale = Date.now() - lastFullLoad > FULL_RELOAD_MS || day !== ordersDay || (day === autoDay && autoDay !== todayBishkek());
  if (stale || !changeStamp) { loadOrders(); return; }
  try {
    // Незакрытые заказы прошлых дней в списке сегодня (specs/018): их изменения — тоже повод перечитать
    const days = [day, ...new Set(orders.filter(isCarried).map((o) => dayOf(o.created_at)))];
    const changed = await Promise.all(days.map((d) => api.admin.ordersChangedSince(d, changeStamp)));
    if (changed.some(Boolean)) loadOrders();
  } catch {
    loadOrders();
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('[data-tabs]').hidden) { loadOrders(); keepAwake(); refreshChats(); }
});

/* ---------- Вкладки ---------- */

function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === name)));
  document.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  if (name === 'settings') { fillSettings(); fillSecurity(); renderCourierAdmin(); loadCouriers().then(renderCourierAdmin); }
  if (name === 'money') { loadLedger(); scheduleLedger(); }
  if (name === 'reports') loadReport();
  // Карта, пока вкладка была скрыта, не знала своего размера — подгоняем заново
  if (name === 'orders' && opsOpen) { opsSign = ''; renderOpsMap(true); }
}
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  // Нажали «Заказы» (например, по красному счётчику), а на экране «Смена» — показываем заказы: за ними и нажимали
  if (b.dataset.tab === 'orders' && typeof half !== 'undefined' && half !== 'orders' && !$('[data-pane="orders"]').hidden) showHalf('orders');
  showTab(b.dataset.tab);
}));

/* ---------- Заказы ---------- */

$('[data-day]').addEventListener('change', () => {
  $('[data-moved]').textContent = ''; // «Заказ передан…» — про прежнюю дату
  loadOrders();
});

async function loadOrders() {
  // Панель открыта с вечера: после полуночи сама переходит на новый день, если дату не меняли вручную
  const today = todayBishkek();
  if ($('[data-day]').value === autoDay && autoDay !== today) {
    $('[data-day]').value = autoDay = today;
    $('[data-month]').max = today.slice(0, 7);
  }
  const day = $('[data-day]').value || today;
  const seq = ++ordersSeq;
  // Приём могли остановить с другого устройства — плашка «Сайт принимает заказы» обновляется вместе со списком
  readIntake().then(renderIntake).catch(() => { /* покажем при следующей загрузке */ });
  let rows;
  let cash;
  let waiting;
  let carried;
  // Сегодня — плюс незакрытые заказы, оформленные за 3 суток до него (specs/018): вчерашний заказ «ко времени» на сегодня,
  // вчерашний вечерний, который ещё везут. Список дня строится по дню оформления, без этого их не видно в «сегодня».
  // Сбой — оставляем прежние такие заказы; метода нет (api.js до 018) — только заказы дня
  const carry = day === today && typeof api.admin.listOpenBefore === 'function'
    ? Promise.resolve().then(() => api.admin.listOpenBefore(day)).catch(() => null) : Promise.resolve([]);
  try {
    // Выручка дня — как в «Кассе»: по дню оплаты и только с чеком; её сбой заказы не прячет.
    // Заодно — оплаченные и не принятые заказы с любой даты (сбой тоже не мешает: останется прежний ответ)
    [rows, cash, waiting, carried] = await Promise.all([
      api.admin.listOrders(day),
      api.admin.listOrdersBetween(day, day).catch(() => undefined),
      api.admin.waitingOrders(waitingSince()).catch(() => undefined),
      carry,
    ]);
  } catch (err) {
    if (seq !== ordersSeq) return;
    if (err.status === 401) { stopApp(); showLoginStep('password'); $('[data-login-error]').textContent = 'Вход сброшен — войдите снова'; return; }
    $('[data-orders-status]').textContent = `Не удалось обновить заказы: ${err.message}`;
    return;
  }
  if (seq !== ordersSeq) return; // пока ждали ответ, выбрали другой день
  // Сторож: раз в 2 минуты проверяем, что доступ не пропал (вход сброшен, код стал обязателен) —
  // иначе база молча отдаёт пустой список и панель показала бы «Заказов нет»
  if (Date.now() - lastAccessCheck > FULL_RELOAD_MS) {
    lastAccessCheck = Date.now();
    let status = 'ok';
    try { status = await api.auth.adminStatus(); } catch (err) { if (err.status === 401) status = 'gone'; }
    if (status !== 'ok') { stopApp(); try { await continueLogin(); } catch (err) { loginProblem(err); } return; }
  }
  $('[data-orders-status]').textContent = '';
  if (carried === null) carried = ordersDay === day ? orders.filter((o) => isCarried(o)) : [];
  const own = new Set(rows.map((o) => o.id));
  // Из прошлых дней — только то, что нужно сегодня (владелец, 11.11: «97 заказов, а за сегодня меньше» — в базе много старых
  // заказов, оставшихся «Готовится»): «ко времени» на сегодня, оплаченные и ещё не принятые, оформленные после 18:00 вчера
  const dayStart = new Date(`${day}T00:00:00+06:00`).getTime();
  const neededToday = (o) => {
    if (o.status === 'new') return true;
    const at = deliveryAt(Date.parse(o.paid_at || o.created_at), o.delivery_time);
    if (at !== null && at >= dayStart && at <= dayStart + 86_400_000) return true;
    return Date.parse(o.created_at) >= dayStart - 6 * 3_600_000;
  };
  rows = [...rows, ...(carried || []).filter((o) => !own.has(o.id) && neededToday(o))];
  lastFullLoad = Date.now();
  // Самое позднее изменение среди заказов дня — с ним сравнивает дешёвый опрос
  const latest = Math.max(0, ...rows.flatMap((o) => [o.created_at, o.updated_at, o.paid_at]).filter(Boolean).map(Date.parse));
  changeStamp = latest ? new Date(latest).toISOString() : new Date().toISOString();
  orders = rows;
  ordersDay = day;
  dayMoney = cash;
  if (waiting !== undefined) { serverWaiting = waiting; waitingAt = Date.now(); }
  noticeHanded(rows, day); // до checkWaiting: о переданном заказе — один сигнал «Передан вам», без второго «Новый заказ»
  checkWaiting();
  renderOrders();
}

/* ---------- Ждут принятия: оплачены, статус «Оплачен — новый» (specs/010) ---------- */

const waitingSince = () => new Date(Date.now() - WAITING_HOURS * 3_600_000).toISOString();

/**
 * Оплаченные и не принятые заказы за 48 часов: с выбранной даты — по списку (он свежее, опрос раз в 10 с),
 * с других дат — по ответу базы. Старше 48 часов не считаем: такой заказ уже решили не через панель
 */
function waitingAll() {
  const since = Date.now() - WAITING_HOURS * 3_600_000;
  const shown = new Set(orders.map((o) => o.id));
  return [...orders.filter((o) => o.status === 'new'), ...(serverWaiting || []).filter((o) => !shown.has(o.id))]
    .filter((o) => Date.parse(o.created_at) >= since);
}
/** Ждущие по выбранной точке (у владельца); менеджеру точки база и так отдаёт только его заказы */
const waitingList = () => waitingAll().filter(inView);

/** « · Кулиева» к сигналу в заголовке вкладки: у менеджера — его точка, у владельца — точки этих заказов */
function whereOf(list) {
  if (!twoPoints()) return '';
  const names = isOwner() ? [...new Set(list.map((o) => branchName(o.branch)).filter(Boolean))] : [branchName(me.branch)];
  return names.length ? ` · ${names.join(', ')}` : '';
}

/** Новый ожидающий заказ (оплатили сейчас или после полуночи на вчерашней дате) — сигнал сразу */
function checkWaiting() {
  const list = waitingAll();
  const fresh = seenWaiting ? list.filter((o) => !seenWaiting.has(o.id)) : [];
  seenWaiting ??= new Set();
  // Видели — все, даже другой точки: владелец переключит точку, и старые заказы не загудят как новые
  for (const o of list) seenWaiting.add(o.id);
  const mine = fresh.filter(inView);
  if (mine.length) signal(`🔴 Новый заказ (${mine.length})${whereOf(mine)}`);
}

/**
 * Заказ впервые появился в списке дня, и он уже в работе, — его передали на эту точку (владелец или другая точка,
 * specs/013). «Новый заказ» о нём может не прозвучать: передают и «Подтверждён», и «Готовится». Сигнал один раз и метка
 * «Передан вам». Первая загрузка дня (вход, смена даты, полночь) только запоминает заказы. Только у менеджера точки:
 * владелец видит обе точки, передача не добавляет заказ в его список
 */
function noticeHanded(rows, day) {
  const now = new Set(rows.map((o) => o.id));
  if (seenOrders?.day !== day) { seenOrders = { day, ids: now, left: new Set() }; return; }
  const { ids, left } = seenOrders;
  for (const id of ids) if (!now.has(id)) left.add(id); // ушёл на другую точку — вернут, снова сигнал
  // Был среди ждущих (свёрнутая вкладка спрашивает их раз в минуту) — о нём уже звучал «Новый заказ», это не передача
  const fresh = !twoPoints() || isOwner() ? []
    : rows.filter((o) => ON_THE_WAY.includes(o.status) && dayOf(o.created_at) === day && !ids.has(o.id) && (left.has(o.id) || !seenWaiting?.has(o.id)));
  seenOrders.ids = now;
  for (const id of now) left.delete(id);
  if (!fresh.length) return;
  for (const o of fresh) { handed.set(o.id, Date.now()); seenWaiting?.add(o.id); }
  signal(`🔴 Передан вам: ${fresh.length === 1 ? orderNo(fresh[0]) : `заказов ${fresh.length}`}${whereOf(fresh)}`);
}

/** Метка «Передан вам» — 15 минут или пока менеджер не нажмёт в карточке; у закрытого заказа не нужна */
const isHanded = (o) => handed.has(o.id) && Date.now() - handed.get(o.id) < HANDED_MS && isActive(o);

/** Убрать просроченные метки «Передан вам»; true — какая-то ушла, карточки пора перерисовать */
function expireHanded() {
  let gone = false;
  for (const [id, at] of handed) if (Date.now() - at >= HANDED_MS) { handed.delete(id); gone = true; }
  return gone;
}

/* ---------- Заказ ждёт курьера или давно в пути (specs/014, 015) ---------- */

// Курьеры берут заказы сами, и заказ, который никто не взял, легко проглядеть в пике. Красная рамка и строка «⏱ …»:
// принятый заказ без курьера ждёт дольше max(20, время доставки точки − 30) минут, назначенный базой заказ курьер не
// забрал за 15 минут или заказ больше 90 минут «В пути».
// Только подсветка, без звука и вибрации: сигналы панели остаются про оплату и передачу заказов (specs/010, 013)
// «Оплачен — новый» сюда не входит: курьеры его не видят, пока менеджер не примет, а про него и так сигнал «Ждут принятия»
const LATE_FREE = ['confirmed', 'cooking'];
const LATE_ROAD_MS = 90 * 60_000;
// Заказ назначен базой (specs/015), а курьер за 15 минут не подошёл к кухне за пакетом — «⏱ Курьер не забрал N мин»
const LATE_PICKUP_MS = 15 * 60_000;
const LATE_EVERY_MS = 60_000;
let lateAt = 0;    // когда подсветку пересчитывали в последний раз
let lateSign = ''; // какая подсветка сейчас на карточках

/** Время доставки точки заказа, минуты: из полосы точки; заказ без точки — общие настройки, без них — запасное из data.js */
const waitFor = (o) => branchRows?.[o.branch]?.wait_minutes ?? settings?.wait_minutes ?? wait.minutes;

/**
 * Назначенный час «ко времени» — как kokoro_delivery_at в базе (data.js → deliveryAt). С 018 в тексте есть дата:
 * «Ко времени: 18:30, 12.11» — 18:30 двенадцатого («00:00, 12.11» — полночь в конце 12.11). Без даты (заказы до 018) —
 * этот час в день оплаты (00:00 — конец того же вечера), а если он раньше оплаты больше чем на час — назавтра.
 * «Как можно скорее» — null
 */
const exactTime = (o, paid) => deliveryAt(paid, o.delivery_time);

/**
 * Когда заказ пора везти (как kokoro_order_due в courier-pickup.sql): от оплаты (нет её — от оформления), но оплаченный
 * ночью — с 12:00, «ко времени» — за время доставки до назначенного часа; вечером «к 12:30» на завтра — не раньше начала
 * доставки
 */
function dueAt(o) {
  const paid = Date.parse(o.paid_at || o.created_at);
  const exact = exactTime(o, paid);
  return Math.max(deliveryStart(paid), exact === null ? -Infinity : deliveryStart(exact - waitFor(o) * 60_000));
}

/**
 * Строка подсветки для карточки или ''. Ожидание курьера считаем с момента, когда заказ пора везти (dueAt): иначе в 12:00
 * краснели бы все ночные заказы, а заказ к 18:30 — уже в обед. Заказ, который база назначила сама (specs/015), курьер не
 * забрал за 15 минут — с назначения, но не раньше «пора везти». Курьера назначил менеджер — не подсвечиваем, как и раньше.
 * «В пути» без delivering_at (база до courier-pickup.sql) не подсвечиваем: не знаем, с какого времени. До двух точек
 * подсветки нет вовсе. Самовывоз (specs/018) курьер не везёт — «Нет курьера» у него не бывает
 */
function lateText(o) {
  if (!twoPoints() || isPickup(o)) return '';
  const now = Date.now();
  if (o.status === 'delivering') {
    const since = Date.parse(o.delivering_at);
    return now - since > LATE_ROAD_MS ? `⏱ В пути ${Math.floor((now - since) / 60_000)} мин — проверьте, доставлен ли` : '';
  }
  if (!LATE_FREE.includes(o.status)) return '';
  if (o.courier_id) {
    if (!isAutoAssigned(o)) return '';
    const since = Math.max(Date.parse(o.dispatched_at), dueAt(o));
    return now - since > LATE_PICKUP_MS ? `⏱ Курьер не забрал ${Math.floor((now - since) / 60_000)} мин` : '';
  }
  const minutes = waitFor(o);
  const from = dueAt(o);
  return now - from > Math.max(20, minutes - 30) * 60_000 ? `⏱ Нет курьера ${Math.floor((now - from) / 60_000)} мин` : '';
}

/** Что подсвечено на заказах, которые сейчас на экране */
const lateSignOf = () => orders.filter(inView).map((o) => [o.id, lateText(o)]).filter(([, text]) => text).join('|');

/** Раз в минуту: подсветка изменилась (прошла минута, заказ перешёл порог) — true, карточки пора перерисовать */
function lateChanged() {
  if (!twoPoints() || Date.now() - lateAt < LATE_EVERY_MS - SLACK_MS) return false;
  lateAt = Date.now();
  return lateSignOf() !== lateSign;
}

/* ---------- Автоназначение (specs/015) ---------- */

// Заказы курьерам раздаёт база (supabase/auto-dispatch.sql): по таймеру Cloudflare раз в минуту, со страниц курьеров раз
// в 15 с и отсюда — с опросом заказов, не чаще раза в 10 с (повтор чаще раза в 5 с база всё равно пропускает). Ответа
// не ждём: сколько назначено, панели знать не нужно — назначение меняет updated_at заказа, и курьер в карточке появится
// со следующим опросом. Ошибки молча: база без файла (404 — api.js отвечает 0), нет связи, сбой — опрос заказов не страдает
const DISPATCH_EVERY_MS = 10_000;
// Таймер опроса срабатывает то на миллисекунды позже, то раньше: без запаса часть вызовов пропадала бы и выходило раз в 20 с
const DISPATCH_SLACK_MS = 500;
let dispatchAt = 0; // когда базу просили назначить в последний раз

/** Попросить базу назначить свободные заказы курьерам на смене — не чаще раза в 10 с, без ожидания ответа */
function kickDispatch() {
  const since = Date.now() - dispatchAt;
  // Рано — ждём следующего опроса. Часы телефона перевели назад (since < 0) — не ждём часами, зовём сразу
  if (since >= 0 && since < DISPATCH_EVERY_MS - DISPATCH_SLACK_MS) return;
  dispatchAt = Date.now();
  try {
    Promise.resolve(api.admin.dispatch()).catch(() => { /* следующий опрос попробует снова */ });
  } catch { /* сбой до запроса — тоже молча: заказы и сигнал важнее */ }
}

/** Заказ назначила база сама (specs/015), и курьер его ещё не забрал: «Подтверждён» или «Готовится» */
const isAutoAssigned = (o) => Boolean(o.dispatched_at && o.courier_id && LATE_FREE.includes(o.status));

/**
 * Пока заказ не приняли — сигнал раз в минуту. С 00:00 до 12:00 доставки нет: повтор молчит до утра (о новом
 * заказе сигнал всё равно звучит), иначе телефон с панелью пищал бы всю ночь и звук выключили бы и на день
 */
function remind() {
  if ($('[data-tabs]').hidden || !deliveryOpen(Date.now())) return;
  const list = waitingList();
  if (list.length && Date.now() - lastSignal >= REMIND_MS - SLACK_MS) signal(`🔴 Ждут принятия (${list.length})${whereOf(list)}`);
}

/** Маленький запрос раз в минуту — и в свёрнутой вкладке, где заказы дня не перечитываются */
async function refreshWaiting() {
  waitingAt = Date.now();
  try { serverWaiting = await api.admin.waitingOrders(waitingSince()); } catch { return; }
  if ($('[data-tabs]').hidden) return; // пока ждали ответ, вышли из панели
  // Список дня старее ответа базы (вкладка свёрнута, заказ оплатили или приняли с другого телефона) — перечитываем
  // день: иначе панель промолчит об оплате или будет пищать о принятом заказе
  const ids = new Set(serverWaiting.map((o) => String(o.id)));
  const since = Date.now() - WAITING_HOURS * 3_600_000;
  const shown = new Set(orders.map((o) => String(o.id)));
  const carryFrom = Date.parse(`${ordersDay}T00:00:00+06:00`) - CARRY_MS;
  // Ждущий заказ прошлых трёх суток, которого нет в списке «сегодня», — перечитать день, чтобы он встал в список (по каждому — один раз)
  const toCarry = ordersDay === todayBishkek() ? serverWaiting.filter((o) => !shown.has(String(o.id)) && !carryAsked.has(o.id)
    && dayOf(o.created_at) < ordersDay && Date.parse(o.created_at) >= carryFrom) : [];
  for (const o of toCarry) carryAsked.add(o.id);
  if (toCarry.length || orders.some((o) => Date.parse(o.created_at) >= since && (o.status === 'new') !== ids.has(String(o.id)))) { await loadOrders(); return; }
  checkWaiting();
  renderWaiting();
}

/** Счётчик на вкладке «Заказы» и плашка про заказы с других дат с кнопкой перехода */
function renderWaiting() {
  const list = waitingList();
  $('[data-new-count]').textContent = list.length || '';
  const listed = new Set(orders.map((o) => o.id));
  const other = list.filter((o) => dayOf(o.created_at) !== ordersDay && !listed.has(o.id)); // перенесённые в список — уже на экране
  const days = [...new Set(other.map((o) => dayOf(o.created_at)))].sort();
  const html = days.map((day) => {
    const group = other.filter((o) => dayOf(o.created_at) === day);
    const nums = group.map((o) => orderNo(o)).join(', '); // у владельца — с точкой: «№ 1 · Кулиева»
    const text = group.length === 1
      ? `🔴 Ждёт принятия: заказ ${nums} от ${dayShort(day)}${group[0].paid_at ? `, оплачен в ${bishkekTime(group[0].paid_at)}` : ''}`
      : `🔴 Ждут принятия: заказы ${nums} от ${dayShort(day)}`;
    return `<p class="waiting__row"><span>${esc(text)}</span><button class="btn btn--small" type="button" data-waiting-day="${esc(day)}">Открыть ${esc(dayShort(day))}</button></p>`;
  }).join('');
  const box = $('[data-waiting]');
  if (box.innerHTML !== html) box.innerHTML = html; // без изменений не трогаем — экранный диктор не повторяет
  box.hidden = !html;
}

$('[data-waiting]').addEventListener('click', (e) => {
  const day = e.target.closest('[data-waiting-day]')?.dataset.waitingDay;
  if (!day) return;
  const input = $('[data-day]');
  input.value = day;
  input.dispatchEvent(new Event('change'));
  // Плашка видна и на половинке «Смена» (телефон), а заказы того дня — на «Заказах»: открываем их
  if (half !== 'orders') showHalf('orders');
  input.scrollIntoView({ block: 'nearest' });
});

function renderDayRevenue() {
  const dayCash = dayMoney && (cashDays(dayMoney.filter(inMoneyView), ordersDay)[0] || null);
  // Владелец: выбрана точка — её имя в строке; «Все точки» — сумма и разбивка по точкам
  const point = isOwner() && branchView !== 'all' ? ` · ${branchName(branchView)}` : '';
  const split = isOwner() && branchView === 'all' && dayMoney
    ? ` (${pointSplit(dayMoney, ordersDay).map((p) => `${p.name} ${money(p.total.revenue)}`).join(' · ')})` : '';
  const text = dayMoney === undefined
    ? `Выручку за ${dayTitle(ordersDay)}${point} загрузить не удалось`
    : `Выручка за ${dayTitle(ordersDay)}${point}: <b>${money(dayCash?.revenue || 0)}</b>${split} · оплат с чеком: ${dayCash?.counted || 0}`
      + (dayCash?.noReceipt.length ? ` · без чека: ${dayCash.noReceipt.length} (не в выручке)` : '')
      // Менеджер точки: ночные заказы до разделения в его выручку не входят — говорим, где они
      + (hasPreSplitMoney(dayMoney, ordersDay) ? ` · ${PRE_SPLIT_NOTE[0].toLowerCase()}${PRE_SPLIT_NOTE.slice(1)}` : '');
  // Перерисовываем, только если изменилось, — иначе экранный диктор повторял бы строку каждые 10 с
  if ($('[data-day-revenue]').innerHTML !== text) $('[data-day-revenue]').innerHTML = text;
}

function renderOrders() {
  const shown = orders.filter(inView); // у владельца — выбранная точка
  const counts = { active: shown.filter(isActive).length, all: shown.length, timed: shown.filter(isTimed).length };
  for (const s of Object.keys(STATUSES)) counts[s] = shown.filter((o) => o.status === s).length;
  renderWaiting();
  renderDayRevenue();
  renderOpsMap();

  // «Ко времени» (specs/018) — заказы с назначенным часом, которые ещё не уехали; есть такие — чип красный
  const chips = [['active', 'В работе'], ['timed', '⏰ Ко времени'], ['all', 'Все'], ...Object.entries(STATUSES)];
  $('[data-filters]').innerHTML = chips
    .map(([k, label]) => `<button class="chip${k === 'timed' && counts.timed ? ' chip--hot' : ''}" type="button" data-filter="${k}" aria-pressed="${filter === k}">${label}<b>${counts[k]}</b></button>`)
    .join('');

  queueChecks(orders, true);
  fixQuotes(); // specs/022: заказам без суммы доставки (или с суммой от чужой кухни) — досчитать от кухни их точки
  // Не перерисовываем карточки, пока менеджер печатает заметку или выбирает статус
  if (document.activeElement?.matches?.('.ord textarea, .ord select, .ord input')) return;
  lateSign = lateSignOf(); // подсветка «⏱ …» на карточках — по этим минутам; следующий пересчёт через минуту
  lateAt = Date.now();

  const list = shown.filter((o) => filter === 'all' || (filter === 'active' ? isActive(o) : filter === 'timed' ? isTimed(o) : o.status === filter));
  // В работе — сначала самые старые: очередь разбирается сверху вниз; «Ко времени» — по назначенному часу
  if (filter === 'active') list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (filter === 'timed') list.sort((a, b) => timedAt(a) - timedAt(b));
  keepOpenChecks($('[data-orders]'), () => {
    $('[data-orders]').innerHTML = list.length ? list.map(orderHtml).join('') : '<p>Заказов нет</p>';
  });
}

/* ---------- Сумма доставки от кухни точки, которая везёт (specs/022) ---------- */

// Курьер получает за каждый заказ: сумма — по дорогам от кухни точки заказа, откуда он едет. Сайт считает её при оформлении,
// но бывает, что не посчитал (адрес не нашёлся, сервис маршрутов не ответил) или посчитал от другой кухни (заказ передали
// другой точке). Такие заказы панель досчитывает сама и сохраняет в базе (admin_set_delivery_quote; сумму от своей кухни база
// не трогает). По одному заказу за раз — общие сервисы адресов и маршрутов просят не чаще раза в секунду; заказ, который не
// вышло посчитать (адрес не нашёлся), на этом устройстве больше не трогаем — сумму назовёт менеджер
const quoteTried = new Set();
let quoteFixing = false;
const QUOTE_FIX_MS = 2 * 24 * 3_600_000; // заказы за двое суток: и вчерашние незакрытые, и деньги курьера за сегодня
const kitchenOf = (branch) => delivery.kitchens.find((k) => k.branch === branch) || null;

function needsQuote(o) {
  if (!o.branch || Number(o.delivery_fee) > 0 || isPickup(o) || o.status === 'awaiting_payment' || o.status === 'canceled') return false;
  if (!(Date.now() - Date.parse(o.created_at) < QUOTE_FIX_MS)) return false;
  const q = o.delivery_quote;
  // От своей кухни уже посчитано: с суммой или дальше 15 км (сумму называет менеджер) — не трогаем
  return !(q && q.from === kitchenOf(o.branch)?.label && (Number.isFinite(q.price) || Number(q.km) > 15));
}

async function fixQuotes() {
  if (quoteFixing || typeof api.admin.setDeliveryQuote !== 'function') return;
  quoteFixing = true;
  try {
    for (;;) {
      const o = orders.find((x) => needsQuote(x) && !quoteTried.has(x.id));
      if (!o) break;
      quoteTried.add(o.id);
      const point = Number.isFinite(o.lat) && Number.isFinite(o.lon) ? { lat: o.lat, lon: o.lon } : null;
      const at = point || (o.address ? await geocode(o.address).catch(() => null) : null);
      if (!at) continue;
      const q = await deliveryQuote(at, () => false, o.branch).catch(() => null);
      if (!q || q.from !== kitchenOf(o.branch)?.label) continue;
      const res = await api.admin.setDeliveryQuote(o.id, { km: q.km, price: q.price, from: q.from, approx: Boolean(q.approx || !point) })
        .catch(() => null);
      if (res?.delivery_quote && orders.some((x) => x.id === o.id)) {
        orders = orders.map((x) => (x.id === o.id ? { ...x, delivery_quote: res.delivery_quote } : x));
        renderOrders();
      }
    }
  } finally {
    quoteFixing = false;
  }
}

/** Перерисовка не сворачивает раскрытые подробности сверки */
function keepOpenChecks(container, render) {
  const open = new Set([...container.querySelectorAll('details.chk[open]')].map((d) => d.dataset.path));
  render();
  if (open.size) container.querySelectorAll('details.chk').forEach((d) => { if (open.has(d.dataset.path)) d.open = true; });
}

function fullAddress(o) {
  return [o.address, o.entrance && `подъезд ${o.entrance}`, o.floor && `этаж ${o.floor}`, o.apartment && `кв. ${o.apartment}`]
    .filter(Boolean).join(', ');
}

/** Номер для wa.me: 0700 123 456 → 996700123456 */
function waPhone(phone) {
  let d = phone.replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('0')) d = `996${d.slice(1)}`;
  else if (d.length === 9) d = `996${d}`;
  return d;
}

const WA_ICON = '<svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3a2.9 2.9 0 0 0-.9 2.2c0 1.3.9 2.5 1.1 2.7.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>';

function waLink(o) {
  const vars = {
    number: o.day_number, name: o.name, qty: o.qty, total: o.total.toLocaleString('ru-RU'),
    address: fullAddress(o), time: o.delivery_time, payment: PAYMENTS[o.payment] || o.payment,
    // Личная ссылка на статус: покупатель увидит заказ и курьера в любом браузере, даже не там, где заказывал
    link: o.track_code ? `${location.origin}/?z=${o.track_code}` : '',
    // Сумма доставки, которую посчитал сайт; примерную пишем «около» — менеджер может поправить текст перед отправкой
    delivery: quoteOf(o)?.price ? `${quoteOf(o).approx ? 'около ' : ''}${money(quoteOf(o).price)}` : 'по расстоянию до вас',
  };
  // Шаблон — из data.js, не из базы: с паролем менеджера в него не вписать чужие реквизиты
  const template = payment.whatsappTemplate.split('\n').filter((line) => vars.link || !line.includes('{link}')).join('\n');
  const text = template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return `https://wa.me/${waPhone(o.phone)}?text=${encodeURIComponent(text)}`;
}

/**
 * Сумма доставки, которую посчитал сайт покупателя (supabase/delivery-price.sql): { km, price, from, approx } или null.
 * В сумме по QR («Доставка в сумме по QR» больше 0) доставка уже оплачена — расчёт не показываем
 */
function quoteOf(o) {
  const q = o.delivery_quote;
  return !o.delivery_fee && q && Number.isFinite(q.km) ? q : null;
}

/** Строка доставки в карточке заказа */
function quoteHtml(o) {
  const q = quoteOf(o);
  if (!q) return '';
  const from = `${kmLabel(q.km)} от ${esc(q.from || 'кухни')}`;
  if (!q.price) return `<p class="ord__muted">🛵 Доставка: ${q.approx ? '≈ ' : ''}${from} — дальше ${maxKm} км, сумму назовите сами${q.approx ? ' <i>(примерно — проверьте адрес)</i>' : ''}</p>`;
  // Дождь (supabase/rain-orders.sql): в сумме уже есть надбавка
  const rain = Number(q.rain) > 0 ? ` · в том числе 🌧 ${money(Number(q.rain))} за дождь` : '';
  return `<p class="ord__muted">🛵 Доставка ${q.approx ? '≈ ' : ''}${money(q.price)} курьеру · ${from}${rain}${q.approx ? ' <i>(примерно — проверьте адрес)</i>' : ''}</p>`;
}

// До перехода на номера по дням (day-numbers.sql запущен 02.11.2026 в 15:31 по Бишкеку) номером был внутренний id —
// покупатели тех заказов знают его, показываем рядом
const DAY_NUMBERS_SINCE = Date.parse('2026-11-02T09:31:37Z');

function orderHtml(o) {
  const clock = new Date(o.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek' });
  const time = !isCarried(o) ? clock : `${dayOf(o.created_at) === shiftDay(ordersDay, -1) ? 'вчера' : DDMM.format(new Date(o.created_at))} ${clock}`;
  const cls = o.status === 'new' ? 'ord--new' : o.status === 'awaiting_payment' ? 'ord--awaiting' : isActive(o) ? '' : 'ord--closed';
  const paidAt = o.paid_at && new Date(o.paid_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek' });
  const fresh = isHanded(o);
  const late = lateText(o); // specs/014, 015: ждёт курьера, курьер не забрал или давно в пути
  const timed = isTimed(o); // specs/018: «ко времени» и ещё не уехал — ярко-красная карточка
  const chat = chatButton(o);
  // Кнопки в ряд: «Чек», «О заказе», «Позвонить» (три — в три колонки); с «💬 Чат» (specs/018) — в две колонки, нечётная
  // последняя — во всю ширину
  const actions = chat ? 'ord__actions--chat' : o.receipt_path ? 'ord__actions--3' : '';
  return `<article class="ord ${cls}${fresh ? ' ord--handed' : ''}${late ? ' ord--late' : ''}${timed ? ' ord--timed' : ''}" data-id="${o.id}">
    <div class="ord__head">
      <span class="ord__num${o.day_number ? '' : ' ord__num--none'}">${orderNo(o, undefined, false)}</span>${pointBadge(o)}${fresh ? ' <span class="pt pt--handed">Передан вам</span>' : ''}
      <span class="ord__time">${time}</span>
      <span class="badge badge--${o.status}">${STATUSES[o.status] || esc(o.status)}</span>
    </div>
    ${pointWarning(o)}
    ${timed ? `<p class="ord__timed">${esc(timedText(o))}</p>` : ''}
    ${late ? `<p class="ord__late">${esc(late)}</p>` : ''}
    <p class="ord__what">Комбо × ${o.qty} <span>— ${money(o.total)}${o.delivery_fee ? ` (доставка ${money(o.delivery_fee)})` : ''}</span></p>
    ${modeHtml(o)}
    <div class="ord__info">
      <p class="ord__client"><b>${esc(o.name)}</b>
        <a class="phone-wa" href="https://wa.me/${waPhone(o.phone)}" target="_blank" rel="noopener" title="Открыть чат в WhatsApp">${WA_ICON}${esc(o.phone)}</a></p>
      <p>${esc(fullAddress(o))}</p>
      ${quoteHtml(o)}
      <p class="ord__muted">${esc(o.delivery_time)} · ${esc(PAYMENTS[o.payment] || o.payment)}${Date.parse(o.created_at) < DAY_NUMBERS_SINCE ? ` · раньше № ${o.id}` : ''}</p>
      ${o.comment ? `<p>💬 ${esc(o.comment)}</p>` : ''}
    </div>
    ${o.receipt_path ? `<p class="ord__paid">✓ Чек приложен в ${paidAt}</p>${checkHtml(o)}` : o.payment === 'qr' ? '<p class="ord__unpaid">Чека пока нет — клиент ещё не оплатил</p>' : ''}
    ${readyHtml(o)}
    ${rateHtml(o)}
    <div class="ord__actions ${actions}">
      ${o.receipt_path ? `<button class="btn btn--tray" type="button" data-receipt="${esc(o.receipt_path)}">Чек</button>` : ''}
      ${o.day_number ? `<a class="btn btn--wa" href="${esc(waLink(o))}" target="_blank" rel="noopener" title="Чат откроется с готовым текстом о заказе">${WA_ICON}О заказе</a>` : ''}
      <a class="btn btn--ghost" href="tel:${esc(o.phone)}">Позвонить</a>
      ${chat}
    </div>
    ${isAutoAssigned(o) ? '<p class="ord__auto">Назначен автоматически</p>' : ''}
    ${courierHtml(o)}
    <select data-status data-was="${esc(o.status)}" aria-label="Статус заказа">${Object.entries(STATUSES)
      .map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
    ${prepHtml(o)}
    <textarea data-note rows="1" maxlength="500" placeholder="Заметка менеджера" aria-label="Заметка менеджера">${esc(o.manager_note)}</textarea>
    ${transferHtml(o)}
  </article>`;
}

/* ---------- Мини-приложение (specs/018): «ко времени», самовывоз, «до двери», время ожидания, готовность, оценка ---------- */

// Колонки 018 есть в заказе — база обновлена (supabase/mini-app.sql). Без них карточка как раньше: ни времени ожидания,
// ни «Готово», ни чата (функций в базе тоже нет)
const has018 = (o) => 'fulfillment' in o;
const isPickup = (o) => o.fulfillment === 'pickup';
const NOT_LEFT = ['new', 'confirmed', 'cooking']; // заказ ещё не уехал (и не выдан)
const READY_FROM = ['confirmed', 'cooking'];      // «Готово к выдаче» отмечают у принятых, пока они на кухне

/** Назначенный час заказа «ко времени» (мс) или null — «Как можно скорее» */
const timedAt = (o) => exactTime(o, Date.parse(o.paid_at || o.created_at));
/** «Ко времени» и ещё не уехал: ярко-красная карточка и строка «⏰ …» — в любом фильтре и при любом входе */
const isTimed = (o) => NOT_LEFT.includes(o.status) && timedAt(o) !== null;

const WEEKDAY = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', weekday: 'short' });
const DDMM = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', day: '2-digit', month: '2-digit' });
/** «⏰ Ко времени 18:30 · сегодня» / «… · завтра, пт 12.11» / «… · вс 14.11» */
function timedText(o) {
  const at = timedAt(o);
  const time = bishkekTime(at);
  // «00:00, 12.11» — полночь в конце 12.11: подписываем днём 12.11, а не 13.11
  const dayAt = time === '00:00' ? at - 60_000 : at;
  const day = dayOf(dayAt);
  const today = todayBishkek();
  const date = [WEEKDAY.format(dayAt), DDMM.format(dayAt)].join('\u00a0'); // неразрывный пробел: «пт 12.11» не разрывается переносом
  const when = day === today ? 'сегодня' : day === shiftDay(today, 1) ? `завтра, ${date}` : day === shiftDay(today, -1) ? `вчера, ${date}` : date;
  return `⏰ Ко времени ${time} · ${when}`;
}

/** Способ получения: «🥡 Самовывоз — Кулиева» или «🚪 До двери +50 сом»; обычная доставка — ничего */
function modeHtml(o) {
  if (isPickup(o)) return `<p class="ord__mode ord__mode--pickup">🥡 Самовывоз${o.branch ? ` — ${esc(branchName(o.branch))}` : ''}</p>`;
  if (o.door) return `<p class="ord__mode">🚪 До двери +${money(door.fee)}</p>`;
  return '';
}

/** Кухня отметила «Готово к выдаче» (экран кухни /cook или кнопка в карточке) — пока заказ на кухне */
function readyHtml(o) {
  if (!o.ready_at || !READY_FROM.includes(o.status)) return '';
  return `<p class="ord__ready">✅ Готово к выдаче ${bishkekTime(o.ready_at)}</p>`;
}

/** Оценка покупателя после доставки: «★ 5 · курьер ★ 4 — «Всё горячее»» */
function rateHtml(o) {
  if (!o.rating) return '';
  const courier = o.courier_rating ? ` · курьер ★ ${Number(o.courier_rating)}` : '';
  const comment = o.rating_comment ? ` — «${esc(o.rating_comment)}»` : '';
  return `<p class="ord__rate">★ ${Number(o.rating)}${courier}${comment}</p>`;
}

/**
 * Время ожидания заказа («Ждать: 60 / 90 мин», data.js → waitChoices; текущее, если другое, — тоже в списке) и «Готово» /
 * «Не готово» — пока заказ не уехал. Время ожидания при оплате ставит база (время доставки точки); покупатель видит отсчёт
 * до обещанного часа. null — заказ оплачен до 018: база считает по времени точки
 */
function prepHtml(o) {
  if (!has018(o) || !NOT_LEFT.includes(o.status)) return '';
  const current = Number(o.wait_minutes) || null;
  const choices = [...new Set([...waitChoices, ...(current ? [current] : [])])].sort((a, b) => a - b);
  const options = (current ? '' : '<option value="" selected>Ждать: как у точки</option>')
    + choices.map((m) => `<option value="${m}"${m === current ? ' selected' : ''}>Ждать: ${m} мин</option>`).join('');
  const ready = READY_FROM.includes(o.status) && typeof api.admin.setReady === 'function'
    ? (o.ready_at ? '<button class="btn btn--small btn--ghost" type="button" data-ready="0">Не готово</button>'
      : '<button class="btn btn--small btn--ok" type="button" data-ready="1">Готово</button>') : '';
  return `<div class="ord__prep"><select data-wait data-was="${current ?? ''}" aria-label="Время ожидания заказа">${options}</select>${ready}</div>`;
}

/* ---------- Чат по заказу (specs/018) ---------- */

const CHAT_DOT = '<span class="chat-dot" role="img" aria-label="новое сообщение"></span>';
const chatUnread = (id) => hasUnread(`manager:${id}`, chats.get(Number(id)), 'manager');
/** «💬 Чат» — у оплаченных заказов, когда в базе есть чат (колонки 018); метка — новое сообщение покупателя или курьера */
function chatButton(o) {
  if (!has018(o) || o.status === 'awaiting_payment' || typeof api.admin.chat !== 'function') return '';
  return `<button class="btn btn--ghost ord__chat" type="button" data-chat>💬 Чат${chatUnread(o.id) ? CHAT_DOT : ''}</button>`;
}

/** Метки «есть новое» на кнопках чата — без перерисовки карточек (фокус и открытые списки не сбиваются) */
function renderChatBadges() {
  document.querySelectorAll('.ord[data-id] [data-chat]').forEach((button) => {
    const unread = chatUnread(button.closest('.ord').dataset.id);
    const dot = button.querySelector('.chat-dot');
    if (unread && !dot) button.insertAdjacentHTML('beforeend', CHAT_DOT);
    else if (!unread && dot) dot.remove();
  });
}

/**
 * Сводка чатов за 48 часов — с каждым опросом заказов. Новое сообщение покупателя или курьера (последнее в чате не от
 * менеджера и новее прежнего) — короткий сигнал, если звук включён. База без 018 — пустая сводка, без ошибок
 */
async function refreshChats() {
  if (typeof api.admin.chatSummary !== 'function') return;
  chatsAt = Date.now();
  const seq = ++chatsSeq;
  let list;
  try { list = await api.admin.chatSummary(new Date(Date.now() - CHAT_SINCE_HOURS * 3_600_000).toISOString()); } catch { return; }
  if (seq !== chatsSeq || !Array.isArray(list) || $('[data-tabs]').hidden) return;
  const fresh = chatsLoaded && list.some((s) => s.last_author !== 'manager' && Number(s.order_id) !== chatOpenId
    && Number(s.last_id) > Number(chats.get(Number(s.order_id))?.last_id || 0));
  chats = new Map(list.map((s) => [Number(s.order_id), s]));
  chatsLoaded = true;
  if (fresh && soundOn) chime();
  renderChatBadges();
}

function openOrderChat(button) {
  const order = orders.find((o) => String(o.id) === button.closest('.ord')?.dataset.id);
  if (!order) return;
  chatOpenId = order.id;
  openChat({
    title: `Чат по заказу ${orderNo(order)}`,
    mine: 'manager',
    labels: { client: 'Покупатель', courier: 'Курьер', courierName: true, manager: 'Менеджер' },
    load: (after) => api.admin.chat(order.id, after),
    send: (body) => api.admin.chatSend(order.id, body),
    readKey: `manager:${order.id}`,
    onClose: () => {
      if (chatOpenId === order.id) chatOpenId = null;
      renderChatBadges();
      document.querySelector(`.ord[data-id="${order.id}"] [data-chat]`)?.focus();
    },
  });
}

/** «Готово» / «Не готово»: отметка кухни ready_at (принятый заказ при этом становится «Готовится») */
async function setOrderReady(button) {
  const order = orders.find((o) => String(o.id) === button.closest('.ord')?.dataset.id);
  if (!order || button.disabled) return;
  const ready = button.dataset.ready === '1';
  button.disabled = true;
  try {
    const res = await api.admin.setReady(order.id, ready);
    orders = orders.map((o) => (o.id === order.id ? { ...o, status: res?.status || o.status,
      ready_at: res && 'ready_at' in res ? res.ready_at : ready ? new Date().toISOString() : null } : o));
  } catch (err) {
    alert(`Не сохранилось: ${err.status ? err.message : `${err.message}. Проверьте интернет и попробуйте ещё раз`}`);
    loadOrders();
  }
  renderOrders();
}

/** Время ожидания из карточки — отдельной правкой (колонка wait_minutes, право на неё у менеджера есть) */
async function changeWait(card, select) {
  const order = orders.find((o) => String(o.id) === card.dataset.id);
  const minutes = Number(select.value);
  if (!order || !minutes) return;
  try {
    const row = await api.admin.updateOrder(order.id, { wait_minutes: minutes });
    orders = orders.map((o) => (o.id === order.id ? (row || { ...o, wait_minutes: minutes }) : o));
    select.dataset.was = String(minutes);
  } catch (err) {
    if (err.row) orders = orders.map((o) => (o.id === err.row.id ? err.row : o));
    select.value = select.dataset.was;
    alert(`Не сохранилось: ${err.message}`);
    if (err.gone || err.changed) loadOrders();
  }
  select.blur();
  renderOrders();
}

/* ---------- Точка заказа в карточке и передача на другую точку (specs/013) ---------- */

/** Метка точки рядом с номером — у владельца всегда: номера за день у точек свои, «№ 5» есть у обеих */
function pointBadge(o) {
  if (!isOwner()) return '';
  return o.branch ? ` <span class="pt pt--${o.branch}">${esc(branchName(o.branch))}</span>` : ' <span class="pt pt--none">без точки</span>';
}

/**
 * Под шапкой карточки. Заказ без точки — оформлен до разделения (ночью, до запуска двух точек): его видят обе точки,
 * берёт та, что первой нажмёт «Взять». Точка поставлена по умолчанию (база не нашла адрес на карте) — «проверьте адрес».
 * У закрытых заказов не пишем — им уже не поможет
 */
function pointWarning(o) {
  if (!twoPoints() || !isActive(o)) return '';
  // Без точки и не оплачен — и после запуска так бывает (адрес не нашёлся на карте): точку база поставит при оплате
  if (!o.branch && o.status === 'awaiting_payment') return '<p class="ord__pt-warn">⚠ Точка не определена — проверьте адрес</p>';
  if (!o.branch) {
    return `<p class="ord__pt-none"><b>Без точки (до разделения)</b> · ${isOwner() ? 'отдайте его точке по адресу' : 'его видят обе точки: кто возьмёт первым, у того и заказ'}</p>`;
  }
  return o.branch_guessed ? `<p class="ord__pt-warn">⚠ Точка не определена — проверьте адрес. Пока заказ на «${esc(branchName(o.branch))}»</p>` : '';
}

/**
 * Кнопки точки. Заказ без точки: менеджер — «Взять на «Кулиева»» (свою), владелец — «На Кулиева» / «На Кок-Жар».
 * Точка по умолчанию, а адрес и правда этой стороны — «Адрес наш» снимает пометку (номер и курьер те же).
 * «Передать на Кок-Жар» — адрес у самой Советской или точка определилась не так
 */
function transferHtml(o) {
  if (!twoPoints() || !isActive(o) || isPickup(o)) return ''; // самовывоз (specs/018) забирают на выбранной кухне — не передаём
  const button = (b, text, ghost = true) => `<button class="btn btn--small${ghost ? ' btn--ghost' : ''}" type="button" data-transfer="${b}">${text}</button>`;
  if (!o.branch) {
    return `<div class="ord__move">${isOwner() ? BRANCHES.map((b) => button(b, `На ${esc(branchName(b))}`)).join('')
      : button(me.branch, `Взять на «${esc(branchName(me.branch))}»`, false)}</div>`;
  }
  const keep = o.branch_guessed ? button(o.branch, `Адрес наш — оставить на ${esc(branchName(o.branch))}`) : '';
  // Заказ «В пути» везёт курьер — не передаём (база тоже откажет): сначала снять курьера, заказ вернётся в «Готовится»
  const moves = o.status === 'delivering' ? '' : BRANCHES.filter((b) => b !== o.branch).map((b) => button(b, `Передать на ${esc(branchName(b))}`)).join('');
  return keep || moves ? `<div class="ord__move">${keep}${moves}</div>` : '';
}

/**
 * База не передала заказ. «Заказ уже передан…» — карточка устарела (заказ успела взять другая точка или передал владелец):
 * показываем ответ и перечитываем список, а не пробуем снова. Остальное — ответ базы как есть; без ответа — нет связи
 */
function transferFailed(prefix, err) {
  if (/уже передан|уже в пути/i.test(err.message)) {
    alert(err.message.replace(/\s*Обновите список\.?\s*$/, ' Список обновлён.'));
    loadOrders();
    return;
  }
  alert(`${prefix}: ${err.status === 404 ? 'база ещё не умеет передавать заказы (нужен supabase/two-points.sql)'
    : err.status ? err.message : `${err.message}. Проверьте интернет и попробуйте ещё раз`}`);
}

async function transferOrder(button) {
  const order = orders.find((o) => String(o.id) === button.closest('.ord')?.dataset.id);
  if (!order || button.disabled) return;
  const to = button.dataset.transfer;
  const name = branchName(to);
  const from = order.branch || 'none'; // какую точку видела панель: заказ успели передать — база откажет, а не вернёт его
  const what = order.day_number ? `заказ ${orderNo(order)}` : 'заказ без номера';
  const keep = to === order.branch; // «Адрес наш»: та же точка — база только снимает пометку «проверьте адрес»
  const take = !order.branch;       // заказ до разделения — на точку; номер обычно прежний
  // У менеджера точки переданный заказ уходит: база его больше не покажет
  const leaves = !keep && !isOwner() && to !== me.branch;
  const effects = [leaves && 'Он уйдёт из вашего списка.', order.courier_id && 'Курьер с него снимется.',
    !take && order.day_number && `На точке «${name}» у заказа будет новый номер.`].filter(Boolean).join(' ');
  const question = keep ? `Адрес «${fullAddress(order)}» — на стороне точки «${name}»? Пометка «проверьте адрес» снимется.`
    : `${take && !isOwner() ? 'Взять' : 'Передать'} ${what} (${order.name}, ${fullAddress(order)}) на точку «${name}»?${effects ? `\n${effects}` : ''}`;
  if (!confirm(question)) return;
  button.disabled = true;
  let res;
  try {
    res = await api.admin.transferOrder(order.id, to, from);
  } catch (err) {
    button.disabled = false;
    transferFailed(keep ? 'Не получилось' : 'Заказ не передан', err);
    return;
  }
  if (keep) {
    orders = orders.map((o) => (o.id === order.id ? { ...o, branch_guessed: false } : o));
    $('[data-moved]').textContent = `Точка ${what.replace('заказ ', 'заказа ')} подтверждена: «${name}» ✓`;
    renderOrders();
    return;
  }
  const moved = { ...order, branch: res?.branch || to, branch_guessed: false, courier_id: null, day_number: res?.day_number ?? order.day_number };
  const drop = (list) => list && list.filter((o) => o.id !== order.id);
  const swap = (list) => list && list.map((o) => (o.id === order.id ? { ...o, branch: moved.branch, day_number: moved.day_number } : o));
  orders = leaves ? drop(orders) : orders.map((o) => (o.id === order.id ? moved : o));
  serverWaiting = leaves ? drop(serverWaiting) : swap(serverWaiting);
  dayMoney = leaves ? drop(dayMoney) : swap(dayMoney);
  // Заказ без точки: номер мог смениться (у принявшей точки такой уже был) — покупатель знает прежний, говорим об этом
  $('[data-moved]').textContent = take
    ? `Заказ ${moved.day_number ? `№ ${moved.day_number}` : 'без номера'} теперь у «${name}»`
      + (order.day_number && moved.day_number !== order.day_number ? ` (был № ${order.day_number})` : '') + ' ✓'
    : `${what[0].toUpperCase()}${what.slice(1)} передан на «${name}»` + (!leaves && moved.day_number ? `, теперь он ${orderNo(moved)}` : '') + ' ✓';
  renderOrders();
  if (order.courier_id) loadCouriers(); // у курьера стало на заказ меньше
}

/* ---------- Курьеры ---------- */

const ON_THE_WAY = ['new', 'confirmed', 'cooking', 'delivering'];
const courierOf = (id) => couriers?.find((c) => c.id === id);
/**
 * Курьера заказа нет в списке. У менеджера точки это курьер другой точки: таких база ему не отдаёт (admin_couriers,
 * specs/014), а заказ он мог получить от владельца. Пишем прямо — видно, что заказ уже везут. У владельца и до двух точек
 * в списке все курьеры: незнакомый — только что добавлен, имя придёт со следующим обновлением
 */
const unlistedCourier = () => (twoPoints() && !isOwner() ? 'Курьер другой точки' : 'Курьер назначен');
/** «Курьер: Азамат» — в закрытом заказе и на карте; курьера нет в списке — «Курьер другой точки» */
const courierLabel = (id) => (courierOf(id) ? `Курьер: ${courierOf(id).name}` : unlistedCourier());
/**
 * Точка курьера (specs/014): 'kulieva' | 'kokzhar', null — обе точки. Курьер подходит заказу своей точки, курьер «обе» —
 * любому; заказ без точки (до разделения) везёт кто угодно. До двух точек и до courier-pickup.sql (у курьеров нет branch) — все
 */
const courierFits = (c, o) => !twoPoints() || !c.branch || !o.branch || c.branch === o.branch;
/** Полоса и карта курьеров у владельца — по выбранной точке; курьеры «обе точки» видны в любой */
const courierInView = (c) => !isOwner() || branchView === 'all' || !c.branch || c.branch === branchView;

// Страница курьера спрашивает базу раз в 15 с; дольше часа тишины — база ему заказы не назначает (supabase/auto-dispatch.sql)
const SEEN_MS = 60 * 60_000;
/**
 * Начало рабочего дня — 06:00 по Бишкеку, как kokoro_workday_start() в базе. В Бишкеке UTC+6 круглый год (летнего
 * времени нет), так что 06:00 по Бишкеку — это 00:00 UTC: начало текущих суток по UTC
 */
function workdayStart(now = Date.now()) {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return day.getTime();
}
/**
 * Смена курьера (specs/015) — в полосе и в «Настройках»: «на смене» или «не на смене» по on_shift из базы. База считает
 * курьера на смене, только если он сегодня (с 06:00) открывал свою страницу: кто вчера не нажал «Закончить смену», утром
 * не на смене. Красная строка «не на связи больше часа» — только про того, кто сегодня страницу открывал, но больше часа
 * назад (закрыл, сел телефон, пропал интернет): иначе по утрам красным горели бы все, кто ещё не пришёл. База до этого
 * правила держала смену бессрочно — тогда «на смене» со вчерашним seen_at тоже показываем как «не на смене».
 * Нет поля (база до auto-dispatch.sql) или курьер отключён — ничего
 */
function shiftHtml(c) {
  if (!('on_shift' in c) || !c.active) return '';
  const off = '<span class="crs__off">не на смене</span>';
  if (!c.on_shift) return off;
  if ('seen_at' in c) {
    const seen = Date.parse(c.seen_at); // null и мусор — NaN: сегодня страницу не открывал
    if (!(seen >= workdayStart())) return off;
    if (Date.now() - seen > SEEN_MS) return '<span class="crs__lost">на смене, но не на связи больше часа — заказы не назначаются</span>';
  }
  return '<span class="crs__shift">на смене</span>';
}

// Курьер в карточке: оплаченный заказ в работе — список (курьеры точки заказа и «обе»; назначенный остаётся в любом
// случае), закрытый — кто вёз. Курьер другой точки — выбранным пунктом «Курьер другой точки», другим заказам его не выбрать;
// снять его или отдать заказ своему курьеру можно. data-was — кто был в карточке: правка уйдёт с этим условием (updateOrder)
function courierHtml(o) {
  if (!couriers) return '';
  if (isPickup(o) && !o.courier_id) return ''; // самовывоз (specs/018): покупатель забирает сам, курьер не нужен
  if (!ON_THE_WAY.includes(o.status)) return o.courier_id ? `<p class="ord__muted">${esc(courierLabel(o.courier_id))}</p>` : '';
  if (!couriers.length && !o.courier_id) return '';
  const unlisted = o.courier_id && !courierOf(o.courier_id) ? `<option value="${o.courier_id}" selected disabled>${unlistedCourier()}</option>` : '';
  const options = couriers.filter((c) => c.id === o.courier_id || (c.active && courierFits(c, o)))
    .map((c) => `<option value="${c.id}" ${c.id === o.courier_id ? 'selected' : ''}>${esc(c.name)}${c.active ? '' : ' (отключён)'}</option>`).join('');
  // Номер назначенного курьера (specs/021) — позвонить по заказу одним нажатием
  const phone = o.courier_id ? contactsById?.get(Number(o.courier_id))?.phone : null;
  const call = phone ? `<p class="ord__courier-call"><a href="tel:${esc(phone)}">📞 Позвонить курьеру · ${esc(phoneLabel(phone))}</a></p>` : '';
  // Назначен — под списком, кто везёт и чем занят (specs/026): на линии ли, сколько везёт
  const who = o.courier_id && courierOf(o.courier_id)
    ? `<p class="ord__courier">🛵 <b>${esc(courierOf(o.courier_id).name)}</b>${courierStateText(courierOf(o.courier_id)) ? ` · ${esc(courierStateText(courierOf(o.courier_id)))}` : ''}</p>` : '';
  return `${pickHtml(o)}<select data-courier data-was="${o.courier_id ?? ''}" aria-label="Курьер"><option value="">Курьер не назначен</option>${unlisted}${options}</select>${who}${call}`;
}

/* ---------- Назначить курьера одним нажатием (specs/026) ---------- */

/** На линии ли курьер — как в полосе «Курьеры»: 'on' | 'off' | 'lost' (на смене, но час не открывал страницу) | null */
function courierShift(c) {
  if (!('on_shift' in c) || !c.active) return null;
  if (!c.on_shift) return 'off';
  if ('seen_at' in c) {
    const seen = Date.parse(c.seen_at);
    if (!(seen >= workdayStart())) return 'off';
    if (Date.now() - seen > SEEN_MS) return 'lost';
  }
  return 'on';
}
/** «на линии · свободен · сегодня 4» — коротко, чтобы выбрать, кому отдать заказ */
function courierStateText(c) {
  const shift = { on: 'на линии', off: 'не на линии', lost: 'нет связи' }[courierShift(c)] || '';
  const n = Number(c.orders) || 0;
  const road = Number(c.road) || 0;
  const load = !('orders' in c) ? '' : !n ? 'свободен'
    : road ? `везёт ${road}${n > road ? `, ждёт ${n - road}` : ''}` : `${n} на руках`;
  const today = Number.isInteger(c.today) && c.today > 0 ? `сегодня ${c.today}` : '';
  return [shift, load, today].filter(Boolean).join(' · ');
}
/** Кто первым в кнопках: на линии, у кухни (ничего не везёт), меньше заказов на руках */
const pickRank = (c) => [{ on: 0, lost: 1, off: 2 }[courierShift(c)] ?? 1, Number(c.road) ? 1 : 0, Number(c.orders) || 0];
function byPickRank(a, b) {
  const x = pickRank(a);
  const y = pickRank(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || String(a.name).localeCompare(String(b.name), 'ru');
}

// Кнопки с именами курьеров точки заказа — в заказе без курьера, пока он не уехал. Нажатие сразу назначает: та же правка,
// что выбор в списке «Курьер» (с условием «заказ такой, как в карточке»). Самовывоз — без кнопок
const PICK_FROM = ['new', 'confirmed', 'cooking'];
function pickHtml(o) {
  if (o.courier_id || !PICK_FROM.includes(o.status) || isPickup(o) || !couriers) return '';
  const list = couriers.filter((c) => c.active && courierFits(c, o)).sort(byPickRank);
  if (!list.length) return '<p class="pick__none">Курьеров этой точки нет — добавьте их в «Настройках» → «Курьеры»</p>';
  const no = orderNo(o, undefined, false);
  const button = (c) => {
    const state = courierStateText(c);
    const shift = courierShift(c);
    const noPhone = contactsById && !contactOf(c)?.phone;
    return `<button class="pick__btn${shift === 'on' ? ' is-on' : ''}${Number(c.orders) ? '' : ' is-free'}" type="button" data-assign="${Number(c.id)}"
      aria-label="${esc(`Назначить курьера ${c.name}${state ? `: ${state}` : ''}`)}"><b>${esc(c.name)}</b>${state ? `<span>${esc(state)}</span>` : ''}${noPhone ? '<span class="pick__warn">нет номера</span>' : ''}</button>`;
  };
  // Сверху — кто на линии (и «нет связи»); остальные — под «Не на линии»: на точке до десятка курьеров, карточка не растягивается.
  // На линии никого (или база без смен) — все сразу
  const online = list.filter((c) => ['on', 'lost'].includes(courierShift(c)));
  const offline = list.filter((c) => !online.includes(c));
  const main = online.length ? online : offline;
  const more = online.length && offline.length
    ? `<details class="pick__more"><summary>Не на линии · ${offline.length}</summary><div class="pick__list">${offline.map(button).join('')}</div></details>` : '';
  return `<div class="pick" role="group" aria-label="Назначить курьера на заказ ${esc(no)}">
      <p class="pick__title">Назначить курьера</p>
      <div class="pick__list">${main.map(button).join('')}</div>${more}
    </div>`;
}

$('[data-orders]').addEventListener('click', (e) => {
  const button = e.target.closest('[data-assign]');
  if (!button || button.disabled) return;
  const card = button.closest('.ord');
  const select = card?.querySelector('[data-courier]');
  if (!select || ![...select.options].some((op) => op.value === button.dataset.assign && !op.disabled)) return;
  card.querySelectorAll('[data-assign]').forEach((b) => { b.disabled = true; });
  button.classList.add('is-busy');
  select.value = button.dataset.assign;
  select.dispatchEvent(new Event('change', { bubbles: true })); // дальше — общий путь сохранения курьера (ниже, «change»)
});

let couriersSeq = 0; // ответ на старый запрос (до назначения или «Отключить») не затирает новый
// Карточкам заказов нужны только имена, вкл/выкл и точка курьера (от неё список в карточке, specs/014): место курьера
// меняется каждые полминуты, а лишняя перерисовка карточек сбивала бы нажатия менеджера
// specs/026: и то, что видно на кнопках «Назначить курьера», — на линии ли и сколько заказов (меняется не чаще смены и назначения)
const cardsSign = (list) => JSON.stringify((list || []).map((c) => [c.id, c.name, c.active, c.branch ?? null, courierShift(c), c.orders ?? null, c.road ?? null, c.today ?? null]));

async function loadCouriers() {
  couriersAt = Date.now();
  const seq = ++couriersSeq;
  let list;
  try { list = await api.admin.couriers(); } catch { return; } // функции нет (couriers.sql не запускали) или нет связи — как было
  if (seq !== couriersSeq) return;
  const cardsChanged = cardsSign(list) !== cardsSign(couriers);
  const changed = JSON.stringify(list) !== JSON.stringify(couriers);
  couriers = list;
  renderCourierStrip();
  renderOpsMap();
  if (cardsChanged && orders.length) renderOrders();
  // Владелец выбирает точку курьера в списке — не перерисовываем под рукой, иначе список закрылся бы
  if (changed && !$('[data-couriers-admin]').hidden && !document.activeElement?.matches?.('[data-courier-branch]')) renderCourierAdmin();
  if (!contactsById) refreshCourierContacts(); // номера и чаты — сразу, а не с ближайшим опросом
}

/* ---------- Связь с курьером (specs/021): номер, звонок, WhatsApp и чат ---------- */

// Номер курьер вписывает сам на своей странице. Чат — без заказа: курьер и менеджеры его точки (у «обеих точек» — обеих)
// и владелец. Новое сообщение курьера — тот же тихий сигнал, что у чата по заказу, и метка на «💬 Чат»
const contactOf = (c) => contactsById?.get(Number(c?.id)) || null;
const phoneLabel = (p) => (/^\+996\d{9}$/.test(p || '') ? `+996 ${p.slice(4, 7)} ${p.slice(7, 10)} ${p.slice(10)}` : p || '');
const courierChatKey = (id) => `manager-courier:${Number(id)}`;
const courierChatUnread = (c) => hasUnread(courierChatKey(c.id), contactOf(c)?.chat, 'manager');
const phonesSign = (map) => JSON.stringify([...(map || new Map()).entries()].map(([id, x]) => [id, x.phone || null]));

/** «📞 +996 … · WhatsApp» или «номер не указан»; база без 021 — пусто */
function courierPhoneHtml(c) {
  if (!contactsById) return '';
  const phone = contactOf(c)?.phone;
  if (!phone) return '<span class="crs__off">номер не указан</span>';
  return `<a href="tel:${esc(phone)}">📞 ${esc(phoneLabel(phone))}</a> · <a href="https://wa.me/${esc(phone.slice(1))}" target="_blank" rel="noopener">WhatsApp</a>`;
}
/** «💬 Чат» с меткой нового сообщения; база без 021 — пусто */
function courierChatButton(c, cls = 'crs__chat') {
  if (!contactsById || typeof api.admin.courierChat !== 'function') return '';
  const unread = courierChatUnread(c);
  return `<button class="${cls}" type="button" data-courier-chat="${Number(c.id)}" aria-label="Чат с курьером ${esc(c.name)}${unread
    ? ' — есть новое сообщение' : ''}">💬 Чат${unread ? CHAT_DOT : ''}</button>`;
}

/**
 * Номера и сводки чатов курьеров — с каждым опросом панели (свёрнутая — раз в минуту). Новое сообщение курьера (последнее
 * в его чате — от курьера и новее прежнего) — сигнал, если звук включён. База без 021 — ничего не меняется
 */
async function refreshCourierContacts() {
  if (typeof api.admin.courierContacts !== 'function') return;
  contactsAt = Date.now();
  const seq = ++contactsSeq;
  let list;
  try { list = await api.admin.courierContacts(); } catch { return; }
  if (seq !== contactsSeq || !Array.isArray(list) || $('[data-tabs]').hidden) return;
  const next = new Map(list.map((x) => [Number(x.id), x]));
  const fresh = !!contactsById && list.some((x) => x.chat?.last_author === 'courier' && Number(x.id) !== courierChatOpen
    && Number(x.chat.last_id) > Number(contactsById.get(Number(x.id))?.chat?.last_id || 0));
  const phonesChanged = phonesSign(next) !== phonesSign(contactsById);
  contactsById = next;
  if (fresh && soundOn) chime();
  renderCourierStrip();
  if (phonesChanged && orders.length) renderOrders();
  if (!$('[data-couriers-admin]').hidden && !document.activeElement?.matches?.('[data-courier-branch]')) renderCourierAdmin();
}

function openCourierChat(id) {
  const c = (couriers || []).find((x) => Number(x.id) === Number(id));
  if (!c) return;
  courierChatOpen = Number(c.id);
  const phone = contactOf(c)?.phone;
  openChat({
    title: `Чат с курьером ${c.name}${phone ? ` · ${phoneLabel(phone)}` : ''}`,
    mine: 'manager',
    labels: { courier: c.name, manager: 'Менеджер' },
    load: (after) => api.admin.courierChat(c.id, after),
    send: (body) => api.admin.courierChatSend(c.id, body),
    readKey: courierChatKey(c.id),
    closedNote: 'Чат недоступен — курьер удалён или передан другой точке',
    onClose: () => {
      if (courierChatOpen === Number(c.id)) courierChatOpen = null;
      renderCourierStrip(); // метка «есть новое» уходит: всё прочитано
      if (!$('[data-couriers-admin]').hidden) renderCourierAdmin();
      document.querySelector(`[data-courier-chat="${Number(c.id)}"]`)?.focus();
    },
  });
}

document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-courier-chat]');
  if (button) openCourierChat(button.dataset.courierChat);
});

// Полоса на «Заказах»: кто на смене, где он и сколько у него заказов. У владельца — курьеры выбранной точки и «обе»;
// на «Все точки» рядом с именем — точка курьера
function renderCourierStrip() {
  const box = $('[data-couriers-strip]');
  const active = (couriers || []).filter((c) => c.active && courierInView(c));
  box.hidden = !active.length;
  if (!active.length) return;
  const pointOf = (c) => (isOwner() && branchView === 'all' && 'branch' in c ? ` · ${c.branch ? esc(branchName(c.branch)) : 'обе точки'}` : '');
  const html = `<p class="crs__title">Курьеры</p>${active.map((c) => {
    const where = isFresh(c.location)
      ? `<a href="${esc(pointLink(c.location))}" target="_blank" rel="noopener">📍 на карте</a> · ${ago(c.location.at)}`
      : `<span class="crs__off">${c.location ? `не на карте · последнее место ${ago(c.location.at)}` : 'не на карте'}</span>`;
    const shift = shiftHtml(c); // specs/015: на смене ли
    const phone = courierPhoneHtml(c); // specs/021: номер и чат
    const chat = courierChatButton(c);
    return `<p class="crs__item"><b>${esc(c.name)}</b>${pointOf(c)}${shift ? ` · ${shift}` : ''} · ${where} · заказов: ${c.orders}${phone ? ` · ${phone}` : ''}${chat ? ` ${chat}` : ''}</p>`;
  }).join('')}`;
  if (box.innerHTML !== html) box.innerHTML = html;
}

/* ---------- Карта: курьеры на смене и незакрытые заказы дня ---------- */

let opsOpen = false;
let opsReady = null;          // Promise<{ L, map, layer }> — карта создаётся один раз, при первом открытии
const opsFound = new Map();   // адрес → примерная точка (заказы без точки покупателя)

$('[data-ops-toggle]').addEventListener('click', (e) => {
  opsOpen = !opsOpen;
  e.currentTarget.setAttribute('aria-pressed', String(opsOpen));
  $('[data-ops-map]').hidden = !opsOpen;
  if (opsOpen) renderOpsMap(true);
});

let opsSign = ''; // что сейчас нарисовано: без изменений метки не пересоздаём — открытая подсказка не закрывается сама

// Метки: 🛵 курьер (свежее место), № заказа — оранжевый с курьером, серый — без курьера, пунктир — примерно по адресу.
// Подгонку масштаба делаем только при открытии: менеджер мог приблизить нужный район
// Кухни на карте: менеджеру точки — своя, владельцу — выбранной точки или обе; до двух точек — обе, как раньше
const mapKitchens = () => (!twoPoints() ? delivery.kitchens
  : isOwner() ? (branchView === 'all' ? delivery.kitchens : [branchKitchen(branchView)]) : [branchKitchen(me.branch)]).filter(Boolean);
const kitchenName = (k) => (twoPoints() && k.branch ? `«${branchName(k.branch)}», ${k.label}` : k.label);

async function renderOpsMap(refit = false) {
  // Зоны «Смена» на экране нет (телефон, выбраны «Заказы») — карта без размера: не рисуем и не подгоняем вид, дорисуем,
  // когда «Смену» откроют (showHalf)
  if (!opsOpen || $('[data-pane="orders"]').hidden || !shiftShown()) return;
  // Самовывоз (specs/018) на карте не нужен: его забирают на кухне
  const active = orders.filter((o) => ON_THE_WAY.includes(o.status) && o.day_number && inView(o) && !isPickup(o));
  const kitchens = mapKitchens();
  for (const o of active) {
    if (Number.isFinite(o.lat) || opsFound.has(o.address)) continue;
    opsFound.set(o.address, null);
    // Не нашлось — помним; сбой сети — забываем, найдём со следующим обновлением
    geocode(o.address).then((p) => { if (p) { opsFound.set(o.address, p); renderOpsMap(); } }, () => opsFound.delete(o.address));
  }
  try {
    opsReady ||= createMap($('[data-ops-map-el]'));
    const { L, map, layer } = await opsReady;
    map.invalidateSize();
    const onShift = (couriers || []).filter((c) => c.active && isFresh(c.location) && courierInView(c));
    const sign = JSON.stringify([onShift.map((c) => [c.id, c.name, c.orders, c.location.lat, c.location.lon, ago(c.location.at)]),
      active.map((o) => [o.id, o.status, o.courier_id, o.lat, o.lon, opsFound.get(o.address), o.branch, o.day_number]),
      (couriers || []).map((c) => [c.id, c.name]), kitchens.map((k) => k.label)]);
    if (sign === opsSign && !refit) return;
    opsSign = sign;
    layer.clearLayers();
    // Две точки: граница по Советской — тонкая линия; видно, на чьей стороне заказ
    if (twoPoints()) L.polyline(SOVETSKAYA, { color: '#2B1308', weight: 2, opacity: 0.5, dashArray: '8 6', interactive: false }).addTo(layer);
    // Кухни, откуда возим, — видно, к какой ближе заказ. В подгонку вида не входят: карта — по курьерам и заказам
    for (const k of kitchens) pin(L, k, '🍗', 'kitchen', `Кухня: ${kitchenName(k)}`).bindPopup(`<b>Кухня${twoPoints() && k.branch ? ` «${esc(branchName(k.branch))}»` : ''}</b><br>${esc(k.label)}`).addTo(layer);
    const points = [];
    for (const c of onShift) {
      pin(L, c.location, `🛵 ${c.name}`, 'courier wide', c.name).bindPopup(`<b>${esc(c.name)}</b><br>обновлено ${ago(c.location.at)} · заказов: ${c.orders}`).addTo(layer);
      points.push(c.location);
    }
    let noPoint = 0;
    for (const o of active) {
      const exact = Number.isFinite(o.lat);
      const p = exact ? { lat: o.lat, lon: o.lon } : opsFound.get(o.address);
      if (!p) { noPoint++; continue; }
      const kind = [o.courier_id ? '' : 'muted', exact ? '' : 'approx'].join(' ');
      // У владельца в подписи и точка заказа: номера за день у точек свои
      pin(L, p, `№${o.day_number}${isOwner() && o.branch ? ` · ${branchName(o.branch)}` : ''}`, `wide ${kind}`, `Заказ ${orderNo(o)}`)
        .bindPopup(`<b>${esc(orderNo(o))}</b> · ${esc(STATUSES[o.status] || o.status)}<br>${esc(fullAddress(o))}<br>${o.courier_id ? esc(courierLabel(o.courier_id)) : 'Без курьера'}${exact ? '' : '<br><i>Точка примерно, по адресу</i>'}`)
        .addTo(layer);
      points.push(p);
    }
    // Заказов и курьеров нет — менеджер точки видит свою кухню, остальные — город
    if (refit) fit(map, points.length ? points : [kitchens.length === 1 ? kitchens[0] : { lat: 42.8746, lon: 74.5698 }], 13);
    $('[data-ops-note]').textContent = `Курьеров на карте: ${onShift.length} · заказов в работе: ${active.length}`
      + (noPoint ? ` · без точки: ${noPoint} (адрес не нашёлся на карте)` : '')
      + `. Оранжевые — с курьером, серые — без курьера, пунктир — точка примерно, по адресу, 🍗 — ${kitchens.length === 1 ? 'кухня' : 'кухни'}`
      + (twoPoints() ? '. Линия — граница точек по Советской.' : '.');
  } catch {
    opsReady = null; // со следующим обновлением попробуем снова
    opsSign = '';
    $('[data-ops-note]').textContent = 'Карта не загрузилась — проверьте интернет, попробуем ещё раз.';
  }
}

/* ---------- «Заказы | Смена»: половинки вкладки «Заказы» на телефоне (раскладка 16.11.2026) ---------- */

// На вкладке «Заказы» две зоны: главная (дата, выручка, фильтры, заказы) и «Смена» (приём заказов, курьеры и карта,
// инструменты); срочные плашки и переключатель точки у владельца стоят над обеими. От 1100 px зоны стоят рядом. Уже — на
// экране одна, по переключателю вверху вкладки: какая — говорит data-half у вкладки, вторую прячет CSS (admin-theme.css).
// Выбор помним, пока открыта эта вкладка браузера: перезагрузка панели не сбрасывает «Смену», а в новой вкладке панель снова
// открывается на заказах. На широком экране data-half ни на что не влияет
const HALF_KEY = 'kokoro.half';
let half = 'orders';
try { if (sessionStorage.getItem(HALF_KEY) === 'shift') half = 'shift'; } catch { /* ничего */ }

/** Зона «Смена» сейчас на экране: на широком экране — пока открыта вкладка «Заказы», на телефоне — ещё и выбрана её половинка */
const shiftShown = () => $('[data-zone="shift"]').getClientRects().length > 0;

function showHalf(name) {
  half = name === 'shift' ? 'shift' : 'orders';
  try { sessionStorage.setItem(HALF_KEY, half); } catch { /* ничего */ }
  $('[data-pane="orders"]').dataset.half = half;
  // Кнопки не перерисовываем — фокус остаётся на нажатой
  document.querySelectorAll('[data-half-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.halfPick === half)));
  // Карта, пока «Смена» была скрыта, не знала своего размера и не перерисовывалась — рисуем и подгоняем заново
  if (half === 'shift' && opsOpen) { opsSign = ''; renderOpsMap(true); }
}

// «Включить звук» / «Не гасить экран» на плашке над переключателем — то же, что кнопки в «Смене»
document.querySelectorAll('[data-quiet-on]').forEach((b) => b.addEventListener('click', () => {
  $(`[data-${b.dataset.quietOn}]`)?.click();
}));

$('[data-halves]').addEventListener('click', (e) => {
  const button = e.target.closest('[data-half-pick]');
  if (button && button.dataset.halfPick !== half) showHalf(button.dataset.halfPick);
});
showHalf(half);

/**
 * Точка курьера в строке настроек (specs/014): курьер видит и берёт свободные заказы только своей точки, «обе точки» — любой.
 * Менеджер точки видит, владелец выбирает в списке. До двух точек и до courier-pickup.sql (у курьера нет branch) — ничего
 */
function courierPointHtml(c) {
  if (!twoPoints() || !('branch' in c)) return '';
  if (!isOwner()) return `${c.branch ? `Точка «${esc(branchName(c.branch))}»` : 'Обе точки'} · `;
  const options = [...BRANCHES.map((b) => [b, branchName(b)]), ['', 'Обе точки']]
    .map(([value, text]) => `<option value="${value}"${(c.branch || '') === value ? ' selected' : ''}>${esc(text)}</option>`).join('');
  return `<label class="crs-row__point">Точка <select data-courier-branch aria-label="Точка курьера ${esc(c.name)}">${options}</select></label> · `;
}

// Раздел «Курьеры» в настройках. Опрос зовёт его раз в 30 с, а seen_at в ответе базы меняется у каждой открытой страницы
// курьера: список пересобираем, только если отрисованное другое, — иначе кнопки «Новый код» / «Отключить» пересоздавались
// бы под рукой и фокус с клавиатуры слетал. force — пересобрать всё равно: список точки после неудачной смены показывает
// выбор владельца, а не то, что в базе
let courierAdminHtml = null;
function renderCourierAdmin(force = false) {
  const list = $('[data-courier-list]');
  const html = !couriers ? '<p class="admin__hint">Курьеры появятся после обновления базы (supabase/couriers.sql).</p>'
    : courierAdminRows();
  if (!force && html === courierAdminHtml) return;
  courierAdminHtml = html;
  list.innerHTML = html;
}

// С 018 (admin_couriers из supabase/mini-app.sql отдаёт has_pin) курьер входит по одноразовому коду из 6 цифр (живёт 72 часа,
// после входа сгорает; has_pin — код выдан и ещё не введён), а курьера, который больше
// не работает, можно удалить. «Новая ссылка» (прежний код из 12 знаков) остаётся запасным входом
const pinReady = (c) => 'has_pin' in c && typeof api.admin.courierPin === 'function';

function courierAdminRows() {
  return couriers.length ? couriers.map((c) => `<div class="crs-row${c.active ? '' : ' crs-row--off'}" data-courier-id="${c.id}">
      <p class="crs-row__name"><b>${esc(c.name)}</b>${c.active ? '' : ' · отключён'}${c.has_pin === true && c.active ? ' <span class="crs-row__pinwait">код выдан — ждёт входа</span>' : ''}</p>
      <p class="admin__hint">${courierPointHtml(c)}${shiftHtml(c) ? `${shiftHtml(c)} · ` : ''}${c.tg_linked ? 'Telegram подключён' : 'Telegram не подключён'} · ${isFresh(c.location) ? `на карте, ${ago(c.location.at)}` : 'не на карте'}</p>
      ${contactsById ? `<p class="admin__hint crs-row__phone">${courierPhoneHtml(c)}</p>` : ''}
      <div class="crs-row__actions">
        ${courierChatButton(c, 'btn btn--small btn--ghost')}
        ${c.active && pinReady(c) ? '<button class="btn btn--small" type="button" data-courier-pin>Код для входа</button>' : ''}
        ${c.active ? `<button class="btn btn--small btn--ghost" type="button" data-courier-reset>${pinReady(c) ? 'Новая ссылка' : 'Новый код'}</button>` : ''}
        <button class="btn btn--small btn--ghost" type="button" data-courier-toggle>${c.active ? 'Отключить' : 'Включить'}</button>
        ${pinReady(c) && typeof api.admin.deleteCourier === 'function' ? '<button class="btn btn--small btn--ghost crs-row__delete" type="button" data-courier-delete>Удалить</button>' : ''}
      </div>
    </div>`).join('') : '<p class="admin__hint">Курьеров пока нет — добавьте первого.</p>';
}

// Код из 6 цифр (specs/018) показывается один раз — крупно, с «Отправить в WhatsApp»: курьер открывает свою страницу и вводит
// одноразовый код, телефон запоминает вход. Адрес страницы — всегда kokoro.com.kg (панель могут открыть и на запасном адресе)
const COURIER_PAGE = 'https://kokoro.com.kg/courier';
function showCourierPin({ name, pin }) {
  const code = String(pin);
  const page = COURIER_PAGE;
  const message = `Ваша страница курьера KOKORO: ${page}\nКод для входа: ${code}`;
  const box = $('[data-courier-code]');
  box.hidden = false;
  box.innerHTML = `<p><b>${esc(name)}</b> — код для входа:</p>
    <p class="crs-code__pin">${esc(code)}</p>
    <p class="admin__hint">Курьер открывает ${esc(page)} и вводит эти 6 цифр — телефон запомнит вход.</p>
    <p class="crs-code__once">Код одноразовый: курьер вводит его на своём телефоне в течение 72 часов. Сменил телефон — выдайте новый</p>
    <div class="crs-row__actions">
      <a class="btn btn--small btn--wa" href="https://wa.me/?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">Отправить в WhatsApp</a>
      <button class="btn btn--small" type="button" data-copy-text="${esc(message)}">Скопировать</button>
      <button class="btn btn--small btn--ghost" type="button" data-code-close>Готово</button>
    </div>
    <p class="admin__hint">Код больше нигде не показывается. Курьер его потерял — нажмите «Код для входа» ещё раз: выдадим новый.</p>`;
}

// Код показывается один раз: ссылка для входа, «Скопировать» и «Отправить в WhatsApp»
function showCourierCode({ name, code }) {
  const link = `${location.origin}/courier#${code}`;
  const message = `Ваша страница курьера KOKORO: ${link}\nОткройте её на телефоне и добавьте на главный экран. Код для входа: ${code}`;
  const box = $('[data-courier-code]');
  box.hidden = false;
  box.innerHTML = `<p><b>${esc(name)}</b> — код для входа: <b class="crs-code__code">${esc(code)}</b></p>
    <p class="crs-code__link">${esc(link)}</p>
    <div class="crs-row__actions">
      <button class="btn btn--small" type="button" data-copy-link="${esc(link)}">Скопировать ссылку</button>
      <a class="btn btn--small btn--wa" href="https://wa.me/?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">Отправить в WhatsApp</a>
      <button class="btn btn--small btn--ghost" type="button" data-code-close>Готово</button>
    </div>
    <p class="admin__hint">Код больше нигде не показывается. Потерял ссылку — нажмите «Новый код», старый перестанет работать.</p>`;
}

$('[data-courier-add]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.elements.name;
  const button = e.target.querySelector('button');
  if (button.disabled) return; // двойное нажатие на медленной связи создало бы двух одинаковых курьеров
  button.disabled = true;
  $('[data-courier-error]').textContent = '';
  try {
    const added = await api.admin.addCourier(input.value);
    input.value = '';
    // С 018 новому курьеру сразу выдаём код из 6 цифр; база без 018 (404) — прежняя ссылка с кодом из 12 знаков
    let pin = null;
    if (typeof api.admin.courierPin === 'function') {
      try { pin = await api.admin.courierPin(added.id); } catch (err) {
        if (err.status !== 404) $('[data-courier-error]').textContent = `Курьер добавлен, а код из 6 цифр не выдался: ${err.message}. Нажмите «Код для входа» в его строке`;
      }
    }
    if (pin?.pin) showCourierPin({ name: pin.name || added.name, pin: pin.pin }); else showCourierCode(added);
    await loadCouriers();
    renderCourierAdmin();
  } catch (err) {
    $('[data-courier-error]').textContent = `Не получилось: ${err.message}`;
  } finally {
    button.disabled = false;
  }
});

$('[data-couriers-admin]').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-courier-id]');
  const courier = row && couriers?.find((c) => String(c.id) === row.dataset.courierId);
  $('[data-courier-error]').textContent = '';
  try {
    if (e.target.closest('[data-courier-reset]') && courier) {
      if (!confirm(`Выдать ${courier.name} новый код? Старая ссылка перестанет работать, Telegram придётся подключить заново.`)) return;
      showCourierCode(await api.admin.resetCourier(courier.id));
    } else if (e.target.closest('[data-courier-toggle]') && courier) {
      if (courier.active && !confirm(`Отключить ${courier.name}? Он не сможет войти, его незакрытые заказы останутся без курьера.`)) return;
      await api.admin.setCourierActive(courier.id, !courier.active);
    } else if (e.target.closest('[data-courier-pin]') && courier) {
      // Выданный код ещё не введён — он сгорит, поэтому спрашиваем; кода нет (введён или не выдавался) — выдаём сразу
      if (courier.has_pin === true && !confirm('Прежний код ещё не введён — он перестанет работать. Выдать новый?')) return;
      const res = await api.admin.courierPin(courier.id);
      showCourierPin({ name: res?.name || courier.name, pin: res.pin });
    } else if (e.target.closest('[data-courier-delete]') && courier) {
      if (!confirm(`Удалить курьера ${courier.name}?\nКурьер пропадёт из списка, вход по коду закроется. Заказы за прошлые дни останутся в отчётах.`)) return;
      await api.admin.deleteCourier(courier.id);
      $('[data-courier-code]').hidden = true; // код удалённого курьера больше не нужен
      $('[data-courier-code]').innerHTML = '';
    } else if (e.target.closest('[data-copy-link]')) {
      const button = e.target.closest('[data-copy-link]');
      try { await navigator.clipboard.writeText(button.dataset.copyLink); button.textContent = 'Скопировано ✓'; } catch { button.textContent = 'Выделите ссылку выше и скопируйте'; }
      return;
    } else if (e.target.closest('[data-copy-text]')) {
      const button = e.target.closest('[data-copy-text]');
      try { await navigator.clipboard.writeText(button.dataset.copyText); button.textContent = 'Скопировано ✓'; } catch { button.textContent = 'Не скопировалось — перепишите код'; }
      return;
    } else if (e.target.closest('[data-code-close]')) {
      $('[data-courier-code]').hidden = true;
      $('[data-courier-code]').innerHTML = '';
      return;
    } else {
      return;
    }
    await loadCouriers();
    renderCourierAdmin();
    loadOrders(); // снятые с отключённого курьера заказы
  } catch (err) {
    $('[data-courier-error]').textContent = `Не получилось: ${err.message}`;
  }
});

// Владелец сменил точку курьера (specs/014): база меняет её сразу; список в карточках заказов, полоса и карта — следом
$('[data-couriers-admin]').addEventListener('change', async (e) => {
  const select = e.target.closest('[data-courier-branch]');
  const id = select?.closest('[data-courier-id]')?.dataset.courierId;
  if (!id || !isOwner() || select.disabled) return;
  $('[data-courier-error]').textContent = '';
  select.disabled = true;
  try {
    const res = await api.admin.setCourierBranch(id, select.value || null);
    couriers = couriers.map((c) => (String(c.id) === id ? { ...c, branch: res?.branch !== undefined ? res.branch : select.value || null } : c));
    renderCourierStrip();
    renderOpsMap();
    if (orders.length) renderOrders();
  } catch (err) {
    $('[data-courier-error]').textContent = `Точка не сменилась: ${err.status === 404 ? 'база ещё не умеет (нужен supabase/courier-pickup.sql)' : err.message}`;
  }
  // Перерисовка ставит в списке то, что в базе (при ошибке — прежнюю точку); фокус возвращаем на тот же список
  renderCourierAdmin(true);
  $(`[data-courier-id="${id}"] [data-courier-branch]`)?.focus();
  loadCouriers();
});

/* ---------- Сверка чеков ---------- */

const CHECK_ICON = { ok: '✓', check: '⚠', bad: '✗' };
const CHECK_HINT = 'Это проверка картинки чека, а не денег: подделанный скриншот она не отличит. Спорные и крупные оплаты сверяйте в приложении О!Деньги.';

/** Отметка сверки чека: ✓ сходится / ⚠ сверьте вручную / ✗ не сходится; по нажатию — подробности */
function checkHtml(o) {
  if (!o.receipt_path || !RECEIPT_PATH.test(o.receipt_path)) return '';
  const v = receiptVerdict(o);
  if (!v) {
    const reason = pendingReason(o.receipt_path);
    const text = isQueued(o.receipt_path) ? 'Сверяем чек…' : reason ? `Чек пока не сверен: ${reason}. Попробуем ещё раз позже` : 'Чек ещё не сверен';
    return `<p class="chk chk--wait" data-path="${esc(o.receipt_path)}">${esc(text)}</p>`;
  }
  const f = v.fields;
  const rows = [
    f.amount && ['Сумма', f.amount.state === 'ok' ? `${money(o.total)} ✓` : f.amount.state === 'bad' ? `${money(f.amount.value)} — ждали ${money(o.total)}` : 'не нашли'],
    f.recipient && ['Получатель', f.recipient.state === 'ok' ? `${f.recipient.how} ✓` : f.recipient.state === 'other' ? `${f.recipient.other} — не наш` : 'не нашли'],
    f.date && ['Дата и время', f.date.text ? `${f.date.text}${f.date.state === 'ok' ? ' ✓' : f.date.why ? ` — ${f.date.why}` : ''}` : 'не нашли'],
    f.txn && ['Номер операции', f.txn],
    f.status && f.status.state !== 'missing' && ['Статус', f.status.state === 'ok' ? 'успешно ✓' : f.status.word],
  ].filter(Boolean);
  return `<details class="chk chk--${v.level}" data-path="${esc(o.receipt_path)}">
    <summary><span aria-hidden="true">${CHECK_ICON[v.level]}</span> ${esc(v.summary)}</summary>
    ${rows.length ? `<dl class="chk__rows">${rows.map(([k, val]) => `<dt>${k}</dt><dd>${esc(val)}</dd>`).join('')}</dl>` : ''}
    <p class="chk__hint">${CHECK_HINT}</p>
    <button class="linkbtn" type="button" data-recheck="${esc(o.receipt_path)}">Сверить заново</button>
  </details>`;
}

/** Чеки — в очередь распознавания; urgent — с вкладки «Заказы», вне очереди */
function queueChecks(list, urgent = false) {
  queueReceipts(list.filter((o) => o.receipt_path && RECEIPT_PATH.test(o.receipt_path)), fetchReceipt, { urgent });
}

/** Заказ или чек «Кассы» по пути файла чека */
const orderByPath = (path) => orders.find((o) => o.receipt_path === path) || ledger.days.flatMap((d) => d.receipts).find((r) => r.receipt_path === path);

/** Обновить на экране только отметки этого чека (без перерисовки всего списка) */
function refreshCheck(path) {
  const order = orderByPath(path);
  if (!order) return;
  document.querySelectorAll('.chk[data-path]').forEach((el) => {
    if (el.dataset.path !== path) return;
    const wasOpen = el.open;
    el.outerHTML = checkHtml(order);
    if (wasOpen) document.querySelectorAll('details.chk[data-path]').forEach((d) => { if (d.dataset.path === path) d.open = true; });
  });
}

// Чек распознан — обновляем его отметку; очередь опустела — пересчитываем всё (повторы и итог «Кассы»)
let checkRender = null;
onReceiptChecked((path) => {
  refreshCheck(path);
  if (queueLength()) return;
  clearTimeout(checkRender);
  checkRender = setTimeout(() => {
    if (!$('[data-pane="orders"]').hidden) renderOrders();
    if (!$('[data-pane="money"]').hidden && !zipBusy) renderLedger();
  }, 300);
});

document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-recheck]');
  if (!button) return;
  const path = button.dataset.recheck;
  const order = orderByPath(path);
  forgetReceipt(path);
  if (order) queueChecks([order], true);
  refreshCheck(path);
});

// Быстрый переход в чат по любому номеру
$('[data-wa-quick]').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = e.target.elements.phone;
  const digits = input.value.replace(/\D/g, '');
  if (digits.length < 9) { input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
  input.removeAttribute('aria-invalid');
  window.open(`https://wa.me/${waPhone(input.value)}`, '_blank', 'noopener');
  input.value = '';
});

$('[data-filters]').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filter]');
  if (!chip) return;
  filter = chip.dataset.filter;
  renderOrders();
});

/**
 * Чек из хранилища с проверкой содержимого: { blob, ext } с настоящим типом (фото или PDF)
 * или null, если файл не похож на чек (покупатель мог приложить что угодно)
 */
async function fetchReceipt(path) {
  if (!RECEIPT_PATH.test(path)) return null;
  const raw = await api.admin.receiptBlob(path);
  const kind = sniffReceipt(new Uint8Array(await raw.slice(0, 16).arrayBuffer()));
  return kind && { blob: new Blob([raw], { type: kind.type }), ext: kind.ext };
}

const NOT_A_RECEIPT = 'Файл не похож на фото или PDF — открывать и скачивать его небезопасно. Попросите клиента прислать чек в WhatsApp.';

async function openReceipt(path) {
  // Окно открываем сразу, по клику: иначе браузер посчитает его всплывающей рекламой.
  // opener обнуляем, чтобы открытый файл не мог управлять вкладкой панели
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  try {
    const receipt = await fetchReceipt(path);
    if (!receipt) { tab?.close(); alert(NOT_A_RECEIPT); return; }
    const url = URL.createObjectURL(receipt.blob);
    if (tab) tab.location.href = url; else location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    alert(`Не удалось открыть чек: ${err.message}`);
  }
}

$('[data-orders]').addEventListener('click', (e) => {
  const button = e.target.closest('[data-receipt]');
  if (button) openReceipt(button.dataset.receipt);
  const move = e.target.closest('[data-transfer]');
  if (move) transferOrder(move);
  const chat = e.target.closest('[data-chat]');
  if (chat) openOrderChat(chat);
  const ready = e.target.closest('[data-ready]');
  if (ready) setOrderReady(ready);
});

$('[data-orders]').addEventListener('change', async (e) => {
  const card = e.target.closest('.ord');
  if (!card) return;
  // Время ожидания (specs/018) — своя правка, без условий карточки: курьера и статус она не трогает
  if (e.target.matches('[data-wait]')) { await changeWait(card, e.target); return; }
  const patch = e.target.matches('[data-status]') ? { status: e.target.value }
    : e.target.matches('[data-note]') ? { manager_note: e.target.value.slice(0, 500) }
    : e.target.matches('[data-courier]') ? { courier_id: e.target.value ? Number(e.target.value) : null } : null;
  if (!patch) return;
  // Что показывала карточка. Пока список открыт, карточка не перерисовывается, а курьер мог сам нажать «Забрал — еду»
  // (specs/014): правка уходит с условием «заказ такой, как в карточке» — иначе база её не примет и курьер не затрётся
  const was = e.target.dataset.was;
  const expect = patch.status ? { status: was } : 'courier_id' in patch ? { courier_id: was ? Number(was) : null } : undefined;
  // Неоплаченный заказ в работу — получит номер дня навсегда; случайный выбор в списке не должен занять номер
  const order = orders.find((o) => String(o.id) === card.dataset.id);
  // Сняли курьера с заказа «В пути»: без курьера его никто не везёт и курьеры его не видят — возвращаем в «Готовится»,
  // он снова появится в «Свободных» (specs/014)
  if ('courier_id' in patch && patch.courier_id === null && order?.status === 'delivering') patch.status = 'cooking';
  if (patch.status && order && !order.day_number && !['awaiting_payment', 'canceled'].includes(patch.status)
    && !confirm('Чека нет. Взять заказ в работу без чека? Он получит номер дня — отменить это нельзя.')) {
    e.target.value = was ?? order.status;
    e.target.blur();
    return;
  }
  try {
    const row = await api.admin.updateOrder(card.dataset.id, patch, expect);
    if (row) orders = orders.map((o) => (o.id === row.id ? row : o));
    if (row) {
      const statusSelect = card.querySelector('[data-status]');
      if (statusSelect) { statusSelect.dataset.was = row.status; statusSelect.value = row.status; }
      const courierSelect = card.querySelector('[data-courier]');
      if (courierSelect) courierSelect.dataset.was = row.courier_id ?? '';
    }
    // Приняли заказ — убираем его и из ответа базы о ждущих: иначе на другой дате он пищал бы до следующего запроса
    if (patch.status && patch.status !== 'new' && serverWaiting) serverWaiting = serverWaiting.filter((o) => String(o.id) !== card.dataset.id);
    if ('courier_id' in patch || patch.status) loadCouriers(); // счётчик заказов у курьеров
  } catch (err) {
    // Заказ уже изменился — карточка сразу показывает, каким он стал (кто везёт, статус), список перечитывается
    if (err.row) orders = orders.map((o) => (o.id === err.row.id ? err.row : o));
    // Пока открыт список «Курьер», база сама назначила заказ курьеру (specs/015) — так и говорим, с именем
    const auto = err.changed && 'courier_id' in patch && err.row && isAutoAssigned(err.row);
    alert(auto ? `Не сохранилось: база уже назначила этот заказ ${courierOf(err.row.courier_id) ? `курьеру ${courierOf(err.row.courier_id).name}` : 'курьеру'} автоматически. Нужен другой курьер — выберите ещё раз`
      : `Не сохранилось: ${err.message}`);
    if (err.gone || err.changed) loadOrders(); // заказ ушёл на другую точку или его изменили — убираем устаревшую карточку
    if (err.changed) loadCouriers();
  }
  e.target.blur();
  renderOrders();
});

// Нажали в карточке с меткой «Передан вам» — менеджер заказ увидел, метка уходит. После нажатия, а не на касании:
// иначе карточка «подпрыгнет» под пальцем и нажатие попадёт в соседнюю кнопку
function ackHanded(e) {
  const card = e.target.closest('.ord');
  const id = card && Number(card.dataset.id);
  if (!card || !handed.has(id)) return;
  handed.delete(id);
  card.classList.remove('ord--handed');
  card.querySelector('.pt--handed')?.remove();
}
for (const type of ['click', 'change']) $('[data-orders]').addEventListener(type, ackHanded);

/* ---------- Касса: чеки и выручка ---------- */

const LEDGER_POLL_MS = 60_000;
// Касса выбранного месяца: rows — все заказы из базы, days — по выбранной точке (у владельца), их и показываем
let ledger = { month: null, rows: [], days: [], loadedAt: null };
let ledgerSeq = 0;      // номер последнего запроса: ответы на старые запросы отбрасываем
let zipBusy = false;    // архив собирается — второй не запускаем, кассу не перерисовываем
let ledgerTimer = null; // пока касса на экране, она обновляется сама — раз в минуту

/** '2026-10' → ['2026-10-01', '2026-10-31'] */
function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

function moneyStatus(text) {
  $('[data-money-status]').textContent = text;
}

/** force — перезагрузить и во время сборки архива (её саму) */
async function loadLedger(force = false) {
  if (zipBusy && !force) return;
  const input = $('[data-month]');
  if (!input.value) input.value = todayBishkek().slice(0, 7);
  const month = input.value;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { moneyStatus('Укажите месяц в виде 2026-10'); return; }
  const seq = ++ledgerSeq;
  if (ledger.month !== month) {
    // Пока грузится другой месяц, не показываем старые цифры и не даём скачать чужой архив
    ledger = { month: null, rows: [], days: [], loadedAt: null };
    renderLedger();
  }
  moneyStatus('Загружаем…');
  let rows;
  try {
    rows = await api.admin.listOrdersBetween(...monthRange(month));
  } catch (err) {
    if (seq !== ledgerSeq) return;
    if (err.status === 401) { stopApp(); showLoginStep('password'); $('[data-login-error]').textContent = 'Вход сброшен — войдите снова'; return; }
    ledger = { month: null, rows: [], days: [], loadedAt: null };
    renderLedger();
    moneyStatus(`Не удалось загрузить: ${err.message}`);
    return;
  }
  if (seq !== ledgerSeq || (zipBusy && !force)) return;
  ledger = { month, rows, days: cashDays(rows.filter(inMoneyView), month), loadedAt: new Date() };
  moneyStatus('');
  renderLedger();
}

function renderLedger() {
  const { month, days, loadedAt } = ledger;
  const zipMonth = $('[data-zip-month]');
  if (!month) {
    $('[data-money-sum]').innerHTML = '';
    $('[data-ledger]').innerHTML = '';
    zipMonth.hidden = true;
    return;
  }
  const t = cashTotal(days);
  const monthName = new Date(`${month}-15T12:00:00+06:00`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'Asia/Bishkek' });
  // Владелец: выбрана точка — её имя; «Все точки» — под суммой строка по каждой точке (и заказы до запуска, если есть)
  const point = isOwner() && branchView !== 'all' ? ` · ${branchName(branchView)}` : '';
  const split = isOwner() && branchView === 'all'
    ? `<ul class="moneysum__split">${pointSplit(ledger.rows, month)
      .map((p) => `<li>${p.name[0].toUpperCase()}${p.name.slice(1)}: <b>${money(p.total.revenue)}</b> · оплат с чеком: ${p.total.counted}</li>`).join('')}</ul>` : '';
  $('[data-money-sum]').innerHTML = `<p class="moneysum__label">Выручка за ${monthName}${point}</p>
    <p class="moneysum__value">${money(t.revenue)}</p>
    ${split}
    <p class="moneysum__meta">Оплат с чеком: ${t.counted}${t.delivery ? ` · в т. ч. доставка ${money(t.delivery)}` : ''} · по чекам покупателей, сверяйте с банком</p>
    ${t.noReceipt ? `<p class="moneysum__warn">Оплачено без чека и не в выручке: ${t.noReceipt} — см. дни ниже</p>` : ''}
    ${checkSummary(days)}
    <p class="moneysum__meta">Обновлено в ${bishkekTime(loadedAt.toISOString())}</p>`;
  zipMonth.hidden = t.receipts === 0;
  zipMonth.disabled = zipBusy;
  // Пока собирается архив, точку не меняем: в архив попали бы чеки не той точки, что в имени
  document.querySelectorAll('[data-branch-pick] [data-branch]').forEach((b) => { b.disabled = zipBusy; });
  // Подписи «№ 5 от 31.10» для сообщений о повторах — всем чекам месяца, даже тем, что сейчас не сверяем
  rememberLabels(days.flatMap((d) => d.receipts));
  keepOpenChecks($('[data-ledger]'), () => {
    $('[data-ledger]').innerHTML = (days.length ? days.map(dayHtml).join('') : '<p class="admin__hint">За этот месяц оплат и заказов нет</p>')
      // Менеджер точки: оплаты до разделения точек в его кассу и архив не входят — говорим, где они
      + (hasPreSplitMoney(ledger.rows, month) ? `<p class="admin__hint ledger__presplit">${PRE_SPLIT_NOTE}</p>` : '');
  });
  // Сами сверяем чеки последних трёх дней; весь месяц — по кнопке (на телефоне это долго)
  const wanted = monthCheckRequested === month ? days : days.slice(0, 3);
  const receipts = wanted.flatMap((d) => d.receipts);
  keepOnly(new Set([...orders.map((o) => o.receipt_path), ...receipts.map((r) => r.receipt_path)]));
  queueChecks(receipts);
}

let monthCheckRequested = null; // месяц, для которого нажали «Сверить все чеки месяца»
$('[data-money-sum]').addEventListener('click', (e) => {
  if (!e.target.closest('[data-check-month]')) return;
  monthCheckRequested = ledger.month;
  renderLedger();
});

/** «Сверка чеков: ✓ 10 · ⚠ 2 · ✗ 1 · ждут 3» */
function checkSummary(days) {
  const receipts = days.flatMap((d) => d.receipts).filter((r) => r.safePath);
  if (!receipts.length) return '';
  const count = { ok: 0, check: 0, bad: 0, wait: 0 };
  for (const r of receipts) count[receiptVerdict(r)?.level || 'wait']++;
  return `<p class="moneysum__meta">Сверка чеков: ✓ сходятся ${count.ok} · ⚠ вручную ${count.check} · ✗ не сходятся ${count.bad}${count.wait ? ` · ждут ${count.wait}` : ''}</p>`
    + (count.wait && monthCheckRequested !== ledger.month ? `<button class="chip moneysum__btn" type="button" data-check-month>Сверить все чеки месяца</button>` : '')
    + (count.bad ? `<p class="moneysum__warn">Есть чеки, которые не сходятся с заказом, — они отмечены ✗ ниже</p>` : '');
}

function dayHtml(d) {
  return `<section class="ledger__day" aria-label="${dayTitle(d.day)}">
    <header class="ledger__head">
      <h2 class="ledger__date">${dayTitle(d.day)}</h2>
      <p class="ledger__rev"><b>${money(d.revenue)}</b> · оплат с чеком: ${d.counted}${d.delivery ? ` · доставка ${money(d.delivery)}` : ''}</p>
      ${d.receipts.length ? `<button class="chip" type="button" data-zip-day="${d.day}" ${zipBusy ? 'disabled' : ''}>Чеки за день (zip)</button>` : ''}
      ${isOwner() && branchView === 'all' ? `<p class="ledger__split">${pointSplit(ledger.rows, d.day).map((p) => `${p.name} ${money(p.total.revenue)}`).join(' · ')}</p>` : ''}
    </header>
    ${d.noReceipt.length ? `<p class="ledger__warn">Оплачено без чека, в выручку не входит: ${d.noReceipt.map((o) => `${nbsp(orderNo(o, d.day))}&nbsp;— ${money(o.total)}`).join(', ')}</p>` : ''}
    ${d.receipts.length ? `<ol class="ledger__list">${d.receipts.map(receiptHtml).join('')}</ol>` : '<p class="admin__hint">Чеков нет</p>'}
  </section>`;
}

function receiptHtml(r) {
  const note = r.inRevenue ? '' : ` · ${esc(STATUSES[r.status] || r.status)}, в выручку не входит`;
  const label = `чек ${r.n} за ${dayTitle(r.day)}, заказ ${orderNo(r, r.day)}`;
  const actions = r.safePath
    ? `<button class="btn btn--small btn--ghost" type="button" data-receipt="${esc(r.receipt_path)}" aria-label="Открыть ${label}">Открыть</button>
      <button class="btn btn--small btn--ghost" type="button" data-receipt-save="${esc(r.receipt_path)}" data-day="${r.day}" data-n="${r.n}" aria-label="Скачать ${label}">Скачать</button>`
    : '<span class="rcpt__bad">Подозрительный файл — не открываем</span>';
  return `<li class="rcpt${r.inRevenue ? '' : ' rcpt--out'}">
    <span class="rcpt__n">Чек ${r.n}</span>
    <span class="rcpt__what">${bishkekTime(r.paid_at || r.created_at)} · заказ ${nbsp(orderNo(r, r.day))} · ${esc(r.name)}${note}</span>
    <b class="rcpt__sum">${money(r.total)}</b>
    <span class="rcpt__actions">${actions}</span>
    ${checkHtml(r)}
  </li>`;
}

function saveFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Safari спрашивает подтверждение скачивания — ссылку держим минуту
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Скачивает чеки по одному (с одним повтором) и отдаёт одним ZIP с таблицей итог.csv.
 * Не скачавшиеся и подозрительные файлы в архив не попадают — они перечислены в таблице.
 */
async function saveReceipts(key, zipName, folders) {
  if (zipBusy) return;
  zipBusy = true;
  clearTimeout(ledgerTimer);
  renderLedger();
  try {
    // Перед сборкой — свежие данные: за то время, что касса открыта, могли прийти новые чеки
    await loadLedger(true);
    renderLedger();
    const days = ledger.days.filter((d) => key === 'month' || d.day === key);
    const receipts = days.flatMap((d) => d.receipts);
    if (!receipts.length) { moneyStatus('Чеков для архива нет'); return; }
    const entries = [];
    const rows = [];
    let skipped = 0;
    for (const [i, r] of receipts.entries()) {
      moneyStatus(`Собираем архив: ${i + 1} из ${receipts.length}…`);
      let receipt = null;
      let problem = r.safePath ? '' : 'подозрительный путь — не скачан';
      for (let attempt = 0; attempt < 2 && !receipt && !problem; attempt++) {
        try {
          receipt = await fetchReceipt(r.receipt_path);
          if (!receipt) problem = 'не фото и не PDF — не положен в архив';
        } catch (err) {
          if (attempt === 1) problem = `не скачался: ${err.message}`;
        }
      }
      const file = receipt ? receiptFileName(r, receipt.ext) : '';
      if (receipt) {
        const bytes = new Uint8Array(await receipt.blob.arrayBuffer());
        entries.push({ name: folders ? `${r.day}/${file}` : file, data: receipt.blob, crc: crc32(bytes), size: receipt.blob.size, date: new Date(r.paid_at || r.created_at) });
      } else skipped++;
      // Две точки: номер — без точки, точка — своей колонкой (в Excel по ней удобно отбирать)
      rows.push([r.day, r.n, orderNo(r, r.day, false), ...(twoPoints() ? [branchName(r.branch) || 'без точки'] : []),
        r.name, r.total, STATUSES[r.status] || r.status, r.inRevenue ? 'да' : 'нет', file || problem]);
    }
    const csv = new TextEncoder().encode(receiptsCsv(rows, twoPoints()));
    entries.push(zipEntry('итог.csv', csv, new Date()));
    saveFile(new Blob(zipParts(entries), { type: 'application/zip' }), zipName);
    moneyStatus(skipped
      ? `Архив готов: ${receipts.length - skipped} из ${receipts.length} чеков. Не вошли — смотрите итог.csv в архиве`
      : `Архив готов: ${receipts.length} чеков и итог.csv`);
  } catch (err) {
    moneyStatus(`Не удалось собрать архив: ${err.message}`);
  } finally {
    zipBusy = false;
    renderLedger();
    scheduleLedger();
  }
}

async function saveOne(button) {
  const r = ledger.days.find((d) => d.day === button.dataset.day)?.receipts.find((x) => x.n === Number(button.dataset.n));
  if (!r || button.disabled) return;
  button.disabled = true;
  button.textContent = 'Скачиваем…';
  try {
    const receipt = await fetchReceipt(r.receipt_path);
    if (receipt) saveFile(receipt.blob, receiptFileName(r, receipt.ext));
    else alert(NOT_A_RECEIPT);
  } catch (err) {
    alert(`Не удалось скачать чек: ${err.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Скачать';
  }
}

$('[data-ledger]').addEventListener('click', (e) => {
  const open = e.target.closest('[data-receipt]');
  if (open) return openReceipt(open.dataset.receipt);
  const save = e.target.closest('[data-receipt-save]');
  if (save) return saveOne(save);
  const zip = e.target.closest('[data-zip-day]');
  if (zip) saveReceipts(zip.dataset.zipDay, `KOKORO_чеки_${zip.dataset.zipDay}${zipPoint()}.zip`, false);
});

// Архивы точек в одной папке не путаются: «KOKORO_чеки_2026-11-09_Кулиева.zip»; у владельца «Все точки» — без точки
const zipPoint = () => (!twoPoints() ? '' : isOwner() ? (branchView === 'all' ? '' : `_${branchName(branchView)}`) : `_${branchName(me.branch)}`);

// Месяц одним архивом: внутри папка на каждый день
$('[data-zip-month]').addEventListener('click', () => {
  if (ledger.month) saveReceipts('month', `KOKORO_чеки_${ledger.month}${zipPoint()}.zip`, true);
});

$('[data-month]').addEventListener('change', () => loadLedger());

function scheduleLedger() {
  clearTimeout(ledgerTimer);
  ledgerTimer = setTimeout(async () => {
    if (!$('[data-pane="money"]').hidden) await loadLedger();
    scheduleLedger();
  }, LEDGER_POLL_MS);
}

/* ---------- Отчёты (specs/018) ---------- */

// Считает база (admin_report): дни по Бишкеку, по дню оплаты, не больше 62 дней; менеджер точки получает свою точку,
// владелец — все. Выручка — как в «Кассе» (с чеком, кроме «Ждёт оплаты» и «Отменён»), деньги курьеров — доставка и «до
// двери», среднее время — «побыстрее» с доставкой от начала доставки до «Доставлен», опоздание — доставили позже
// обещанного больше чем на 10 минут
const REPORT_MAX_DAYS = 62;
let reportRange = 'today';
let reportSeq = 0; // ответ на старый запрос (другой период) отбрасываем

function reportDays() {
  const today = todayBishkek();
  if (reportRange === 'yesterday') return [shiftDay(today, -1), shiftDay(today, -1)];
  if (reportRange === 'week') return [shiftDay(today, -6), today];
  if (reportRange === 'custom') {
    const f = $('[data-report-custom]');
    return [f.elements.from.value, f.elements.to.value];
  }
  return [today, today];
}

const num = (n, digits = 0) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: digits });
const minutesText = (m) => (m == null || !Number.isFinite(Number(m)) ? '—' : `${num(Math.round(Number(m)))} мин`);
const ratingText = (avg, count) => (avg == null ? '—' : `★ ${num(avg, 1)}${count ? ` (${num(count)})` : ''}`);
const reportBranch = (b) => (b ? branchName(b) || b : 'Без точки');
/** Время с датой для таблицы опозданий: «12.11 18:42» */
const stamp = (iso) => (iso ? `${DDMM.format(new Date(iso))} ${bishkekTime(iso)}` : '—');

function reportStatus(text) {
  const el = $('[data-report-status]');
  if (el.textContent !== text) el.textContent = text;
}

async function loadReport() {
  const [from, to] = reportDays();
  const box = $('[data-report]');
  if (!from || !to) { box.innerHTML = ''; reportStatus('Выберите даты «с» и «по» и нажмите «Показать»'); return; }
  if (from > to) { box.innerHTML = ''; reportStatus('Дата «с» позже даты «по» — поменяйте их местами'); return; }
  const span = Math.round((Date.parse(`${to}T12:00:00+06:00`) - Date.parse(`${from}T12:00:00+06:00`)) / 86_400_000) + 1;
  if (span > REPORT_MAX_DAYS) { box.innerHTML = ''; reportStatus(`Отчёт — не больше чем за ${REPORT_MAX_DAYS} дня. Выберите период короче`); return; }
  const seq = ++reportSeq;
  box.innerHTML = ''; // цифры прежнего периода не должны висеть, пока считается новый
  reportStatus('Считаем…');
  let data;
  try {
    if (typeof api.admin.report !== 'function') { const err = new Error('нет функции'); err.status = 404; throw err; }
    data = await api.admin.report(from, to);
  } catch (err) {
    if (seq !== reportSeq) return;
    box.innerHTML = '';
    reportStatus(err.status === 404 ? 'Отчёты появятся после обновления базы'
      : `Не удалось загрузить отчёт: ${err.status ? err.message : `${err.message}. Проверьте интернет и попробуйте ещё раз`}`);
    return;
  }
  if (seq !== reportSeq) return;
  reportStatus('');
  box.innerHTML = reportHtml(data || {}, from, to);
}

/** Таблица в обёртке с прокруткой: на телефоне листается вбок сама, страница — нет */
function reportTable(title, head, rows, empty) {
  const id = `report-${title.toLowerCase().replace(/\s+/g, '-')}`;
  const body = rows.length
    ? `<div class="report__scroll" role="region" tabindex="0" aria-labelledby="${id}"><table class="report__table">
        <thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${c}</td>` : `<th scope="row">${c}</th>`)).join('')}</tr>`).join('')}</tbody>
      </table></div>`
    : `<p class="admin__hint">${empty}</p>`;
  return `<section class="report__block" data-report-table="${esc(title)}"><h2 class="report__title" id="${id}">${title}</h2>${body}</section>`;
}

function reportHtml(r, from, to) {
  const branches = Array.isArray(r.branches) ? r.branches : [];
  const people = Array.isArray(r.couriers) ? r.couriers : [];
  const late = Array.isArray(r.late) ? r.late : [];
  const total = (key) => branches.reduce((s, b) => s + (Number(b[key]) || 0), 0);
  // Среднее время по всем точкам — с весом по числу доставленных у точки
  const timed = branches.filter((b) => b.avg_minutes != null && Number(b.delivered) > 0);
  const weight = timed.reduce((s, b) => s + Number(b.delivered), 0);
  const avg = weight ? timed.reduce((s, b) => s + Number(b.avg_minutes) * Number(b.delivered), 0) / weight : null;
  const period = from === to ? dayTitle(from) : `${dayShort(from)} — ${dayShort(to)}`;
  const tile = (key, label, value) => `<div class="report__tile" data-report-tile="${key}"><p class="report__label">${label}</p><p class="report__value">${value}</p></div>`;
  return `<p class="report__period">Отчёт за ${esc(period)}</p>
    <div class="report__tiles">
      ${tile('revenue', 'Выручка', nbsp(money(total('revenue'))))}
      ${tile('paid', 'Оплачено заказов', num(total('paid')))}
      ${tile('avg', 'Среднее время доставки', minutesText(avg))}
      ${tile('late', 'Опоздания', num(total('late')))}
    </div>
    ${reportTable('Точки', ['Точка', 'Выручка', 'Заказов', 'Самовывоз', 'Доставлено', 'Деньги курьеров', 'Среднее время', 'Опоздания', 'Оценка'],
    branches.map((b) => [esc(reportBranch(b.branch)), nbsp(money(b.revenue || 0)), num(b.paid), num(b.pickup), num(b.delivered),
      nbsp(money(b.delivery_sum || 0)), minutesText(b.avg_minutes), num(b.late), ratingText(b.rating_avg, b.rating_count)]),
    'За этот период оплаченных заказов нет.')}
    ${reportTable('Курьеры', ['Курьер', 'Доставлено', 'Деньги за доставку', 'Среднее время', 'Опоздания', 'Оценка'],
    people.map((c) => [`${esc(c.name)}${c.deleted ? ' <span class="report__deleted">удалён</span>' : ''}`, num(c.delivered), nbsp(money(c.delivery_sum || 0)),
      minutesText(c.avg_minutes), num(c.late), ratingText(c.rating_avg)]),
    'За этот период курьеры ничего не доставили.')}
    ${reportTable('Опоздания', ['№', 'Точка', 'Обещали', 'Доставили', 'На сколько'],
    late.map((l) => [l.day_number ? `№ ${num(l.day_number)}` : '—', esc(reportBranch(l.branch)), stamp(l.promise_at), stamp(l.done_at), `+${num(l.minutes)} мин`]),
    'Опозданий нет.')}`;
}

// Период: сегодня / вчера / 7 дней / свой (даты «с» и «по»)
$('[data-report-range]').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-range]');
  if (!chip) return;
  reportRange = chip.dataset.range;
  document.querySelectorAll('[data-report-range] [data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b === chip)));
  const form = $('[data-report-custom]');
  form.hidden = reportRange !== 'custom';
  if (reportRange === 'custom') {
    const today = todayBishkek();
    form.elements.from.max = form.elements.to.max = today;
    form.elements.from.value ||= shiftDay(today, -6);
    form.elements.to.value ||= today;
  }
  loadReport();
});
$('[data-report-custom]').addEventListener('submit', (e) => {
  e.preventDefault();
  loadReport();
});

/* ---------- Сигнал о заказе ---------- */

let audio;
/** Звук готовим при открытии панели: если браузер его не пускает (не было нажатия), сразу видно предупреждение */
function prepareAudio() {
  if (!audio) {
    try { audio = new AudioContext(); } catch { return; } // звук недоступен
    // Предупреждение убираем чуть позже: иначе страница «подпрыгнет» под пальцем и нажатие попадёт в соседнюю кнопку
    audio.addEventListener('statechange', () => setTimeout(renderUnlock, 400));
  }
  renderUnlock();
}
// Звук не играет: 'suspended' — не было нажатия, 'interrupted' — iPhone после звонка или другого приложения
const audioBlocked = () => !!audio && audio.state !== 'running';
function renderUnlock() {
  $('[data-sound-unlock]').hidden = !soundOn || !audioBlocked() || $('[data-tabs]').hidden;
}
/** Любое нажатие на странице снимает запрет браузера на звук (повторный resume() безвреден) */
let tapped = false; // на странице уже нажимали — значит, отказ в экране не из-за отсутствия нажатия
function onTap(e) {
  if (audio?.state === 'closed') { audio = null; prepareAudio(); }
  if (audioBlocked()) audio.resume().catch(() => { /* попробуем при следующем нажатии */ });
  // Safari даёт держать экран только по нажатию; касание пальцем засчитывается при отпускании — pointerdown не годится
  if (e.type !== 'pointerdown') {
    tapped = true;
    if (awakeOn && !wakeLock && !wakePending && !$('[data-tabs]').hidden) keepAwake();
  }
}
for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) document.addEventListener(type, onTap, true);
// Вернулись из другого приложения — после первого нажатия браузер обычно даёт включить звук без нового
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && audioBlocked()) audio.resume().catch(() => {});
  if (!document.hidden) renderUnlock();
});

function beep() {
  try {
    if (!audio || audio.state === 'closed') { audio = null; prepareAudio(); }
    if (!audio) return;
    if (audio.state === 'running') play();
    // Пока звук остановлен, гудки не копим (иначе при первом нажатии они грянут разом): просим включить
    // и играем, только если включился сразу — то есть это нажатие («🔔 Звук вкл.»)
    else { const asked = Date.now(); audio.resume().then(() => { if (Date.now() - asked < 1000) play(); }, () => {}); }
  } catch { /* звук недоступен */ }
}

function play() {
  try {
    [0, 0.25, 0.5].forEach((t) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      osc.connect(gain); gain.connect(audio.destination);
      gain.gain.setValueAtTime(0.25, audio.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + t + 0.2);
      osc.start(audio.currentTime + t); osc.stop(audio.currentTime + t + 0.2);
    });
  } catch { /* звук недоступен */ }
}

let titleTimer = null;
/** Гудки и вибрация (если звук включён) и мигающий заголовок вкладки */
function signal(text) {
  lastSignal = Date.now();
  if (soundOn) {
    beep();
    // Без нажатия на странице Chrome вибрацию запрещает и пишет об этом в консоль — тогда не просим
    if (navigator.userActivation?.hasBeenActive ?? true) navigator.vibrate?.([300, 150, 300]);
  }
  const base = titleBase(); // с точкой: среди вкладок видно, чья панель зовёт
  let flips = 0;
  clearInterval(titleTimer);
  titleTimer = setInterval(() => {
    document.title = flips++ % 2 ? base : text;
    if (flips > 20 || document.hasFocus()) { clearInterval(titleTimer); document.title = base; }
  }, 800);
}

function updateSoundButton() {
  const b = $('[data-sound]');
  b.setAttribute('aria-pressed', String(soundOn));
  b.textContent = soundOn ? '🔔 Звук вкл.' : '🔕 Звук выкл.';
}
$('[data-sound]').addEventListener('click', () => {
  soundOn = !soundOn;
  try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch { /* ничего */ }
  updateSoundButton();
  if (soundOn) beep(); // заодно разрешает звук в браузере — нужен клик пользователя
  renderUnlock();
});

/* ---------- Экран не гаснет (specs/010) ---------- */

// С погасшим экраном браузер не выполняет код панели — о заказе никто не узнает. Пока панель открыта на экране,
// просим телефон не гасить его (Screen Wake Lock); свернули вкладку — система отпускает сама, вернулись — просим снова
let wakeLock = null;
let wakePending = false;
// '' | 'unsupported' — браузер не умеет | 'needs-tap' — Safari ждёт нажатия | 'denied' — телефон не разрешил (энергосбережение)
let wakeProblem = '';

async function keepAwake() {
  if (!awakeOn || document.hidden || $('[data-tabs]').hidden || wakeLock || wakePending) { renderAwake(); return; }
  if (!navigator.wakeLock) { wakeProblem = 'unsupported'; renderAwake(); return; }
  wakePending = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    wakeProblem = '';
    if (!awakeOn || document.hidden || $('[data-tabs]').hidden) lock.release().catch(() => {}); // пока ждали — выключили или свернули
    else {
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; renderAwake(); });
    }
  } catch {
    if (!document.hidden) wakeProblem = tapped ? 'denied' : 'needs-tap'; // свёрнутой вкладке отказывают всегда — это не ошибка
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
  b.textContent = awakeOn ? '☀️ Экран не гаснет' : '🌙 Экран гаснет';
  const note = !awakeOn || $('[data-tabs]').hidden ? ''
    : wakeProblem === 'unsupported' ? 'Этот браузер не умеет держать экран включённым — на время смены отключите автоблокировку в настройках телефона'
    : wakeProblem === 'needs-tap' ? 'Нажмите в любом месте панели — тогда экран перестанет гаснуть'
    : wakeProblem === 'denied' ? 'Телефон не дал держать экран включённым (например, включено энергосбережение). Подключите зарядку или выключите энергосбережение: с погасшим экраном панель не услышит заказ'
    : '';
  if ($('[data-awake-note]').textContent !== note) $('[data-awake-note]').textContent = note;
}

$('[data-awake]').addEventListener('click', () => {
  awakeOn = !awakeOn;
  try { localStorage.setItem(AWAKE_KEY, awakeOn ? 'on' : 'off'); } catch { /* ничего */ }
  if (awakeOn) keepAwake(); else releaseAwake();
});

/* ---------- Безопасность входа ---------- */

// Квоты тарифа Supabase Pro (с 01.11.2026): база и хранилище файлов (supabase.com/pricing).
// Spend cap включён — сверх квоты не платим, но при превышении проект ограничат
const QUOTA = { db: 8 * 1024 ** 3, dbLabel: '8 ГБ', storage: 100 * 1024 ** 3, storageLabel: '100 ГБ' };
const mb = (bytes) => `${(bytes / 1024 ** 2).toLocaleString('ru-RU', { maximumFractionDigits: bytes < 10 * 1024 ** 2 ? 1 : 0 })} МБ`;

async function fillSecurity() {
  const state = $('[data-mfa-state]');
  const box = $('[data-mfa-settings-enroll]');
  box.innerHTML = '';
  try {
    const [factors, required] = await Promise.all([api.auth.mfa.factors(), api.auth.mfaRequired()]);
    const verified = factors.filter((f) => f.status === 'verified');
    // Пока владелец не запустил require-2fa.sql, код проверяет только эта панель, а база ещё пускает по паролю
    const dbNote = required ? ' База без кода данные не отдаёт ✓'
      : ' Полная защита — после того, как владелец запустит supabase/require-2fa.sql: до этого база ещё пускает по одному паролю.';
    if (verified.length) {
      state.textContent = `Включён на этом аккаунте (подключено ${new Date(verified[0].created_at).toLocaleDateString('ru-RU')}).${dbNote}`;
    } else {
      state.textContent = 'Выключен: в панель можно войти по одному паролю. Включите — приложение привяжется к этому телефону, и без него войти будет нельзя.';
      box.innerHTML = '<button class="btn" type="button" data-mfa-start>Включить двухфакторный вход</button>';
    }
  } catch (err) {
    state.textContent = `Не удалось проверить: ${err.message}`;
  }
  const usage = await api.usage();
  const el = $('[data-usage]');
  if (!usage) { el.textContent = 'Появится после запуска supabase/harden.sql'; return; }
  const dbShare = usage.db_bytes / QUOTA.db;
  const stShare = usage.receipts_bytes / QUOTA.storage;
  el.textContent = `База: ${mb(usage.db_bytes)} из ${QUOTA.dbLabel} · чеки: ${mb(usage.receipts_bytes)} из ${QUOTA.storageLabel} (${usage.receipts_count} файлов)`
    + (Math.max(dbShare, stShare) > 0.7 ? ' — место заканчивается: скачайте архив чеков за старые месяцы и напишите владельцу сайта' : '');
  el.classList.toggle('error', Math.max(dbShare, stShare) > 0.7);
}

$('[data-mfa-settings-enroll]').addEventListener('click', (e) => {
  if (!e.target.closest('[data-mfa-start]')) return;
  startEnroll($('[data-mfa-settings-enroll]'), 'После подключения вход в панель будет по паролю и коду из этого телефона.', fillSecurity);
});

$('[data-password-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const error = $('[data-password-error]');
  error.textContent = '';
  $('[data-password-saved]').textContent = '';
  if (f.password.value !== f.repeat.value) { error.textContent = 'Пароли не совпадают'; return; }
  try {
    await api.auth.updatePassword(f.password.value);
    f.password.value = '';
    f.repeat.value = '';
    $('[data-password-saved]').textContent = 'Пароль изменён ✓ Другие устройства вышли';
  } catch (err) {
    error.textContent = err.status === 401 || /aal2/i.test(err.message) ? 'Сначала выйдите и войдите заново с кодом из приложения'
      : /weak|short|least|characters/i.test(err.message) ? 'Пароль слишком простой — возьмите длиннее, с цифрами и буквами' : err.message;
  }
});

/* ---------- Настройки в базе: чтение и запись ---------- */

// Сохранение отмечаем до и после: ответ на чтение, начатое раньше, чем сохранение закончилось, может нести
// старые значения — такой ответ отбрасываем, иначе полоса на пару минут «откатилась» бы к прежнему
let settingsWrites = 0;
async function readSettings() {
  const mark = settingsWrites;
  const row = await api.settings();
  if (row && mark === settingsWrites) settings = row;
  return settings;
}
async function writeSettings(patch) {
  settingsWrites++;
  try { settings = await api.admin.saveSettings(patch); } finally { settingsWrites++; }
  return settings;
}

/** Приём и время по точкам (branch_settings): сбой сети — ошибка, остаются прежние; таблицы нет — null */
async function readBranches() {
  const mark = settingsWrites;
  const rows = await api.admin.branchSettings();
  if (mark === settingsWrites) branchRows = rows;
  return branchRows;
}

/**
 * Для полос приёма: у двух точек — строки точек; таблицы точек нет или панель до двух точек — общие настройки.
 * У двух точек общие читаем тоже: выключенный общий «Принимаем заказы» закрывает сайт для обеих — плашка «Сайт закрыт».
 * Сбой их чтения полосы не прячет: плашка останется прежней до следующей загрузки
 */
async function readIntake() {
  if (!twoPoints()) { await readSettings(); return; }
  // Предел курьера (specs/014) — заодно; его сбой полосы не прячет: останется прежний
  const [rows] = await Promise.all([readBranches(), readSettings().catch(() => null), readLimits().catch(() => null)]);
  if (!rows && !settings) await readSettings();
}

/** Сколько заказов курьер берёт на руки, по точкам: не чаще раза в 2 минуты; ответ, начатый до сохранения, отбрасываем */
async function readLimits() {
  if (Date.now() - limitsAt < FULL_RELOAD_MS) return courierLimits;
  const mark = settingsWrites;
  // Кто назначает (specs/026) — тем же редким опросом; функции нет (старая заглушка проверки) — переключателя нет
  const [limits, modes] = await Promise.all([api.admin.courierLimits(),
    typeof api.admin.dispatchModes === 'function' ? api.admin.dispatchModes().catch(() => dispatchModes) : null]);
  limitsAt = Date.now();
  if (mark === settingsWrites) { courierLimits = limits; dispatchModes = modes; }
  return courierLimits;
}

/**
 * Сохранить приём, время или предел курьера: '' — общие настройки, иначе строка точки (менеджер точки меняет только свою).
 * Предел (courier_limit, specs/014) запоминаем отдельно: приём и время точки он не трогает
 */
async function writeIntake(target, patch) {
  if (!target) { await writeSettings(patch); return; }
  settingsWrites++;
  try {
    const row = await api.admin.saveBranchSettings(target, patch);
    if ('courier_limit' in patch) courierLimits = { ...courierLimits, [target]: row.courier_limit ?? patch.courier_limit };
    else if ('dispatch' in patch) dispatchModes = { ...dispatchModes, [target]: row.dispatch ?? patch.dispatch };
    else branchRows = { ...branchRows, [target]: { accepting_orders: row.accepting_orders, wait_minutes: row.wait_minutes,
      rain: typeof row.rain === 'boolean' ? row.rain : branchRows?.[target]?.rain ?? null,
      // Дождь переключили отсюда — это решение менеджера (база пишет rain_by = 'manager'); прогноз — прежний
      rain_by: 'rain' in patch ? 'manager' : row.rain_by ?? branchRows?.[target]?.rain_by ?? null,
      weather: row.weather ?? branchRows?.[target]?.weather ?? null } };
  } finally { settingsWrites++; }
}

/* ---------- Приём заказов: быстро остановить и возобновить ---------- */

// Полосы: '' — общая (до двух точек или таблицы точек нет), иначе точка: у менеджера точки — своя, у владельца — обе
const intakeTargets = () => (!twoPoints() || !branchRows ? [''] : isOwner() ? BRANCHES : [me.branch]);
const intakeOf = (t) => (t ? branchRows?.[t] : settings);

let intakeSign = null;
/** Полосы пересоздаём, только когда меняется их набор (вошла другая точка, появилась таблица точек) — фокус не теряется */
function buildIntakes() {
  const targets = intakeTargets();
  const sign = targets.join();
  if (sign === intakeSign) return;
  intakeSign = sign;
  for (const w of [...waits.values(), ...limitSaves.values()]) clearTimeout(w.timer);
  waits.clear();
  limitSaves.clear();
  const two = targets.length > 1;
  const box = $('[data-intakes]');
  box.classList.toggle('intakes--two', two);
  // У полосы точки — ещё строка «Курьер берёт до N заказов» (specs/014); видна, когда база знает предел
  box.innerHTML = targets.map((t) => `<div class="intake${two ? ' intake--compact' : ''}" data-intake="${t}" hidden>
      <p class="intake__state" data-intake-state aria-live="polite"></p>
      <button class="btn btn--small intake__btn" type="button" data-intake-toggle></button>
      <div class="intake__wait" data-wait-box hidden>
        <label for="wait-quick${t && `-${t}`}">${two ? 'Время доставки' : 'Время доставки для покупателей'}</label>
        <select class="input" id="wait-quick${t && `-${t}`}" data-wait-quick></select>
        <span class="intake__saved" data-wait-saved aria-live="polite"></span>
      </div>${t ? `
      <div class="intake__dispatch" data-dispatch-box hidden>
        <span class="intake__dispatch-label" id="dispatch-${t}">Курьеров назначает</span>
        <div class="seg" role="group" aria-labelledby="dispatch-${t}">
          <button class="seg__btn" type="button" data-dispatch-set="manual" aria-pressed="false">Менеджер</button>
          <button class="seg__btn" type="button" data-dispatch-set="auto" aria-pressed="false">Автоматически</button>
        </div>
        <span class="intake__saved" data-dispatch-saved aria-live="polite"></span>
      </div>
      <div class="intake__limit" data-limit-box hidden>
        <label for="limit-quick-${t}">Курьер берёт до</label>
        <select class="input" id="limit-quick-${t}" data-limit-quick></select>
        <span class="intake__saved" data-limit-saved aria-live="polite"></span>
      </div>
      <div class="intake__rain" data-rain-box hidden>
        <button class="btn btn--small intake__rain-btn" type="button" data-rain-toggle aria-pressed="false"></button>
        <span class="intake__saved" data-rain-saved aria-live="polite"></span>
      </div>` : ''}
    </div>`).join('');
  box.querySelectorAll('[data-wait-quick]').forEach((select) => select.addEventListener('change', onWaitPick));
  box.querySelectorAll('[data-limit-quick]').forEach((select) => select.addEventListener('change', onLimitPick));
}

function renderIntake() {
  buildIntakes();
  document.querySelectorAll('[data-intake]').forEach(renderStrip);
  renderSiteClosed();
}

/* ---------- Сайт закрыт общей настройкой (specs/013) ---------- */

// С двумя точками приём останавливают точки, а общий «Принимаем заказы» (order_settings) при запуске включён и больше
// не рубильник. Выключен — сайт закрыт для всех, какими бы ни были полосы точек. Включить его может только владелец
let siteClosedSign = '';
function renderSiteClosed() {
  const box = $('[data-site-closed]');
  const closed = twoPoints() && Boolean(branchRows) && settings?.accepting_orders === false;
  box.hidden = !closed;
  const sign = !closed ? '' : isOwner() ? 'owner' : 'point';
  if (sign === siteClosedSign) return; // без изменений не трогаем — фокус на кнопке и экранный диктор не сбиваются
  siteClosedSign = sign;
  box.innerHTML = !closed ? ''
    : isOwner() ? `<p class="siteoff__text"><b>Сайт закрыт общей настройкой</b> — заказы не принимает ни одна точка, даже если её полоса зелёная.</p>
      <button class="btn btn--small siteoff__btn" type="button" data-site-open>Открыть сайт</button>`
    : '<p class="siteoff__text"><b>Сайт закрыт владельцем</b> — заказы не принимает ни одна точка. Ваша кнопка приёма этого не изменит.</p>';
}

$('[data-site-closed]').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-site-open]');
  if (!button || button.disabled || !isOwner()) return;
  button.disabled = true;
  button.closest('[data-site-closed]').querySelector('.siteoff__error')?.remove();
  try {
    await writeSettings({ accepting_orders: true });
    renderIntake();
  } catch (err) {
    button.disabled = false;
    button.insertAdjacentHTML('afterend', `<p class="siteoff__error" role="alert">Не получилось: ${esc(err.message)}. Попробуйте ещё раз</p>`);
  }
});

function renderStrip(box) {
  const t = box.dataset.intake;
  const s = intakeOf(t);
  box.hidden = !s;
  if (!s) return;
  const on = s.accepting_orders;
  const name = branchName(t);
  const compact = box.classList.contains('intake--compact');
  box.classList.toggle('is-off', !on);
  box.querySelector('[data-intake-state]').textContent = !t
    ? (on ? 'Сайт принимает заказы' : 'Приём заказов остановлен — покупатели видят «Сейчас мы не принимаем заказы»')
    : on ? `${name} принимает заказы` : `${name}: приём остановлен — покупатели ${SIDE[t]} видят «${branchClosedText(t, true)}»`;
  const button = box.querySelector('[data-intake-toggle]');
  button.textContent = `${on ? '⏸ Остановить' : '▶ Возобновить'}${compact ? '' : ' приём заказов'}`;
  // У владельца две одинаковые кнопки — экранный диктор называет и точку
  if (t) button.setAttribute('aria-label', `${on ? 'Остановить' : 'Возобновить'} приём заказов: ${name}`);
  renderDispatch(box, t);
  renderLimit(box, t);
  renderRain(box, t);
  // Время доставки: колонка wait_minutes появляется после supabase/wait-time.sql, до этого списка нет.
  // Список в фокусе, ждёт сохранения или сохраняется — не трогаем, иначе обновление сбило бы выбор
  const quick = box.querySelector('[data-wait-quick]');
  const w = waitOf(t);
  const has = Number.isInteger(s.wait_minutes);
  box.querySelector('[data-wait-box]').hidden = !has;
  if (!has || w.timer || w.saving || document.activeElement === quick) return;
  fillWait(quick, s.wait_minutes);
  // Время поменяли с другого устройства или в «Настройках» — прежнее «Сохранено ✓ …» уже неправда
  if (s.wait_minutes !== w.confirmed) { box.querySelector('[data-wait-saved]').textContent = ''; w.confirmed = null; }
}

const hasWait = () => Number.isInteger(settings?.wait_minutes);

// Варианты списка; значение из базы, которого среди них нет, тоже показываем — иначе список соврёт
function fillWait(select, minutes = settings.wait_minutes) {
  const values = [...new Set([...wait.options, minutes])].sort((a, b) => a - b);
  select.innerHTML = values.map((m) => `<option value="${m}">${waitLabel(m)}</option>`).join('');
  select.value = String(minutes);
}

// Время доставки сохраняем через 0,6 с после последнего выбора: проход по списку стрелками с клавиатуры
// не публикует покупателям промежуточные значения. Список не блокируем — фокус остаётся на нём
const WAIT_SAVE_DELAY = 600;
// У каждой полосы своё: таймер сохранения, «сохраняем», минуты, о которых сейчас говорит «Сохранено ✓»
const waits = new Map();
function waitOf(t) {
  if (!waits.has(t)) waits.set(t, { timer: null, saving: false, confirmed: null });
  return waits.get(t);
}

function onWaitPick(e) {
  const box = e.target.closest('[data-intake]');
  const w = waitOf(box.dataset.intake);
  box.querySelector('[data-wait-saved]').textContent = 'Сохраняем…';
  w.confirmed = null;
  clearTimeout(w.timer);
  w.timer = setTimeout(() => saveWait(box), WAIT_SAVE_DELAY);
}

async function saveWait(box) {
  const t = box.dataset.intake;
  const w = waitOf(t);
  w.timer = null;
  const select = box.querySelector('[data-wait-quick]');
  const status = box.querySelector('[data-wait-saved]');
  w.saving = true;
  select.setAttribute('aria-busy', 'true');
  try {
    await writeIntake(t, { wait_minutes: Number(select.value) });
    if (!w.timer) {
      const minutes = intakeOf(t).wait_minutes;
      w.confirmed = minutes;
      // Ночью и утром покупатели видят «Доставка начнётся в 12:00» — строка верна в любое время суток (specs/008)
      status.textContent = `Сохранено ✓ ${hours.label[0].toUpperCase()}${hours.label.slice(1)} покупатели${t ? ` ${SIDE[t]}` : ''} видят «примерно за ${waitLabel(minutes)}»`;
    }
  } catch (err) {
    if (!w.timer) status.textContent = `Не сохранилось: ${err.message}. Выберите ещё раз`;
  } finally {
    w.saving = false;
    select.removeAttribute('aria-busy');
    // Пока сохраняли, выбрали другое — его сохранит следующий таймер; иначе в списке то, что в базе
    if (!w.timer) fillWait(select, intakeOf(t).wait_minutes);
  }
}

/* ---------- Идёт дождь — доставка +100 сом (supabase/rain.sql, 11.11.2026) ---------- */

// Менеджер включает надбавку у своей точки, владелец — у любой. Пока включено, сайт прибавляет delivery.rain к доставке
// новых заказов точки и пишет покупателю «Идёт дождь — к доставке +100 сом»; оформленные заказы не меняются.
// Колонки rain в базе нет — кнопки нет
function renderRain(box, t) {
  const row = box.querySelector('[data-rain-box]');
  if (!row) return;
  const on = branchRows?.[t]?.rain;
  row.hidden = typeof on !== 'boolean';
  if (row.hidden) return;
  row.classList.toggle('is-on', on);
  const button = row.querySelector('[data-rain-toggle]');
  if (button.disabled) return; // сохраняется — подпись поменяем после ответа
  // Включила погода (specs/022: сервер раз в 10 минут смотрит прогноз MET Norway) — так и пишем, чтобы менеджер знал откуда
  const auto = on && branchRows?.[t]?.rain_by === 'auto';
  button.textContent = on ? `🌧 Дождь${auto ? ' (по погоде)' : ''}: доставка +${delivery.rain} сом — выключить` : `🌧 Идёт дождь — +${delivery.rain} сом к доставке`;
  button.setAttribute('aria-pressed', String(on));
  button.setAttribute('aria-label', `Надбавка за дождь +${delivery.rain} сом, ${branchName(t)}: ${on ? 'включена, выключить' : 'выключена, включить'}`);
}

$('[data-intakes]').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-rain-toggle]');
  if (!button || button.disabled) return;
  const box = button.closest('[data-intake]');
  const t = box.dataset.intake;
  const on = branchRows?.[t]?.rain;
  if (!t || typeof on !== 'boolean') return;
  const status = box.querySelector('[data-rain-saved]');
  button.disabled = true;
  status.textContent = 'Сохраняем…';
  try {
    await writeIntake(t, { rain: !on });
    status.textContent = !on ? `Сохранено ✓ Покупатели ${SIDE[t]} видят доставку +${delivery.rain} сом и «Идёт дождь»` : 'Сохранено ✓ Надбавка за дождь снята';
  } catch (err) {
    status.textContent = `Не сохранилось: ${err.message}. Нажмите ещё раз`;
  } finally {
    button.disabled = false;
    renderIntake();
  }
});

/* ---------- Кто назначает курьеров (specs/026) ---------- */

// «Менеджер» — заказы точки курьерам назначают в панели (кнопки с именами в карточке заказа), база сама не раздаёт и
// у курьеров нет «Свободных». «Автоматически» — как с 15.11: база раздаёт заказы курьерам на линии, курьер может забрать сам.
// Менеджер меняет режим своей точки, владелец — обеих. Колонки в базе нет — переключателя нет
function renderDispatch(box, t) {
  const row = box.querySelector('[data-dispatch-box]');
  if (!row) return;
  const mode = dispatchModes?.[t];
  row.hidden = mode !== 'manual' && mode !== 'auto';
  if (row.hidden || row.classList.contains('is-saving')) return;
  row.querySelectorAll('[data-dispatch-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dispatchSet === mode)));
}

$('[data-intakes]').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-dispatch-set]');
  if (!button) return;
  const box = button.closest('[data-intake]');
  const t = box.dataset.intake;
  const row = box.querySelector('[data-dispatch-box]');
  const next = button.dataset.dispatchSet;
  if (!t || dispatchModes?.[t] === next || row.classList.contains('is-saving')) return;
  if (next === 'auto' && !confirm(`Включить автоматическое назначение на точке «${branchName(t)}»?\n\nБаза сама будет раздавать заказы курьерам на линии, а курьеры смогут забирать свободные заказы сами.`)) return;
  const status = row.querySelector('[data-dispatch-saved]');
  row.classList.add('is-saving');
  row.querySelectorAll('[data-dispatch-set]').forEach((b) => { b.disabled = true; b.setAttribute('aria-pressed', String(b === button)); });
  status.textContent = 'Сохраняем…';
  try {
    await writeIntake(t, { dispatch: next });
    status.textContent = next === 'manual'
      ? 'Сохранено ✓ Назначайте курьера кнопкой с его именем в карточке заказа — курьер получит заказ со звуком'
      : 'Сохранено ✓ База сама раздаёт заказы курьерам на линии';
    if (next === 'auto') kickDispatch();
  } catch (err) {
    status.textContent = `Не сохранилось: ${err.message}. Нажмите ещё раз`;
  } finally {
    row.classList.remove('is-saving');
    row.querySelectorAll('[data-dispatch-set]').forEach((b) => { b.disabled = false; });
    renderIntake();
    if (orders.length) renderOrders(); // подсказки в карточках зависят от режима
  }
});

/* ---------- Сколько заказов курьер берёт на руки (specs/014) ---------- */

// Курьер сам забирает свободные заказы своей точки — не больше предела точки (по умолчанию 3: горячее комбо, четвёртый
// клиент ждал бы долго). Менеджер меняет предел своей точки, владелец — обеих, от 1 до 6. Сохраняется, как время доставки:
// через 0,6 с после последнего выбора. Менеджера в панели предел не ограничивает — назначить вручную можно и сверх него
const LIMITS = [1, 2, 3, 4, 5, 6];
/** После «до»: «1 заказа», «4 заказов» */
const limitLabel = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'заказа' : 'заказов'}`;
const limitSaves = new Map(); // у каждой полосы: таймер сохранения, «сохраняем», предел, о котором говорит «Сохранено ✓»
function limitOf(t) {
  if (!limitSaves.has(t)) limitSaves.set(t, { timer: null, saving: false, confirmed: null });
  return limitSaves.get(t);
}

function fillLimit(select, n) {
  const values = [...new Set([...LIMITS, n])].sort((a, b) => a - b);
  select.innerHTML = values.map((v) => `<option value="${v}">${limitLabel(v)}</option>`).join('');
  select.value = String(n);
}

/** Строка предела в полосе точки: нет колонки в базе — строки нет; в фокусе или сохраняется — не трогаем */
function renderLimit(box, t) {
  const row = box.querySelector('[data-limit-box]');
  if (!row) return;
  const n = courierLimits?.[t];
  // Назначает менеджер (specs/026) — курьер сам не берёт и база не раздаёт: предел ни на что не влияет, строку прячем
  row.hidden = !Number.isInteger(n) || dispatchModes?.[t] === 'manual';
  const select = row.querySelector('[data-limit-quick]');
  const l = limitOf(t);
  if (row.hidden || l.timer || l.saving || document.activeElement === select) return;
  fillLimit(select, n);
  // Предел поменяли с другого устройства — прежнее «Сохранено ✓ …» уже неправда
  if (n !== l.confirmed) { row.querySelector('[data-limit-saved]').textContent = ''; l.confirmed = null; }
}

function onLimitPick(e) {
  const box = e.target.closest('[data-intake]');
  const l = limitOf(box.dataset.intake);
  box.querySelector('[data-limit-saved]').textContent = 'Сохраняем…';
  l.confirmed = null;
  clearTimeout(l.timer);
  l.timer = setTimeout(() => saveLimit(box), WAIT_SAVE_DELAY);
}

async function saveLimit(box) {
  const t = box.dataset.intake;
  const l = limitOf(t);
  l.timer = null;
  const select = box.querySelector('[data-limit-quick]');
  const status = box.querySelector('[data-limit-saved]');
  l.saving = true;
  select.setAttribute('aria-busy', 'true');
  try {
    await writeIntake(t, { courier_limit: Number(select.value) });
    if (!l.timer) {
      l.confirmed = courierLimits[t];
      status.textContent = `Сохранено ✓ Теперь курьер берёт до ${limitLabel(l.confirmed)}`;
    }
  } catch (err) {
    if (!l.timer) status.textContent = `Не сохранилось: ${err.message}. Выберите ещё раз`;
  } finally {
    l.saving = false;
    select.removeAttribute('aria-busy');
    if (!l.timer && Number.isInteger(courierLimits?.[t])) fillLimit(select, courierLimits[t]);
  }
}

$('[data-intakes]').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-intake-toggle]');
  const box = button?.closest('[data-intake]');
  const t = box?.dataset.intake;
  const s = box && intakeOf(t);
  if (!s) return;
  const on = s.accepting_orders;
  // Точка: кого коснётся остановка и что со второй точкой
  const other = BRANCHES.find((b) => b !== t);
  const otherState = !branchRows?.[other] ? '' : branchRows[other].accepting_orders
    ? ` «${branchName(other)}» продолжит принимать заказы.` : ` Приём на «${branchName(other)}» тоже остановлен — сайт не примет ни одного заказа.`;
  const question = !t ? 'Остановить приём заказов на сайте?\nПокупатели увидят «Сейчас мы не принимаем заказы», кнопка заказа станет неактивной.'
    : `Остановить приём заказов на точке «${branchName(t)}»?\nПокупатели ${SIDE[t]} увидят: «${branchClosedText(t)}»${otherState}`;
  if (on && !confirm(question)) return;
  button.disabled = true;
  try {
    await writeIntake(t, { accepting_orders: !on });
    renderIntake();
    if (!t && !$('[data-pane="settings"]').hidden) fillSettings();
  } catch (err) {
    box.querySelector('[data-intake-state]').textContent = `Не получилось: ${err.message}. Попробуйте ещё раз`;
  } finally {
    button.disabled = false;
  }
});

/* ---------- Настройки ---------- */

// Значения, с которыми открылась форма: «Сохранить» отправляет только то, что поменяли. Иначе форма, открытая
// на ноутбуке с утра, вернула бы старое время доставки или приём заказов, которые днём поменяли с телефона
let formBase = null;
// Две точки (specs/013): приём и время доставки — на полосах «Заказов», у каждой точки свои, поэтому в форме их нет
// (иначе одно и то же меняли бы в двух местах). Цена комбо и доставка общие — их меняет только владелец
const formLocked = () => twoPoints() && !isOwner();

function formValues(f) {
  return {
    ...(twoPoints() ? {} : { accepting_orders: f.accepting_orders.checked }),
    combo_price: Math.max(1, Math.round(Number(f.combo_price.value))),
    delivery_fee: Math.max(0, Math.round(Number(f.delivery_fee.value))),
    ...($('[data-wait-field]').hidden ? {} : { wait_minutes: Number(f.wait_minutes.value) }),
  };
}

async function fillSettings() {
  try { await readSettings(); } catch (err) {
    formBase = null;
    $('[data-settings-error]').textContent = `Настройки не загрузились: ${err.message}. Откройте вкладку ещё раз`;
    return;
  }
  renderIntake();
  const f = $('[data-settings-form]').elements;
  $('[data-common-intake]').hidden = twoPoints();
  f.accepting_orders.checked = settings.accepting_orders;
  for (const k of ['combo_price', 'delivery_fee']) { f[k].value = settings[k]; f[k].readOnly = formLocked(); }
  $('[data-wait-field]').hidden = twoPoints() || !hasWait();
  if (!$('[data-wait-field]').hidden) fillWait(f.wait_minutes);
  const note = $('[data-settings-note]');
  note.hidden = !twoPoints();
  note.textContent = formLocked()
    ? `Цену комбо и доставку меняет владелец: они общие для обеих точек. Приём заказов и время доставки точки «${branchName(me.branch)}» — на вкладке «Заказы».`
    : 'Цена комбо и доставка общие для обеих точек. Приём заказов и время доставки у каждой точки свои — они на вкладке «Заказы».';
  $('[data-settings-submit]').hidden = formLocked();
  formBase = formValues(f);
  // QR и тексты про оплату — файлы сайта, здесь только показываем; менять их из панели нельзя
  $('[data-qr-preview]').src = payment.qrImage;
  $('[data-qr-preview]').hidden = false;
  document.querySelectorAll('[data-fixed]').forEach((el) => { el.textContent = payment[el.dataset.fixed]; });
  $('[data-fixed-recipient]').textContent = payment.recipient.label;
  $('[data-settings-saved]').textContent = '';
  $('[data-settings-error]').textContent = '';
}

$('[data-settings-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  $('[data-settings-error]').textContent = '';
  $('[data-settings-saved]').textContent = '';
  if (formLocked()) return; // менеджер точки цену не меняет (и база не даст)
  if (!formBase) { $('[data-settings-error]').textContent = 'Настройки не загрузились — откройте вкладку «Настройки» ещё раз'; return; }
  const values = formValues(f);
  const patch = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== formBase[k]));
  if (!Object.keys(patch).length) { $('[data-settings-saved]').textContent = 'Изменений нет'; return; }
  try {
    await writeSettings(patch);
    formBase = values;
    renderIntake();
    $('[data-settings-saved]').textContent = 'Сохранено ✓';
  } catch (err) {
    $('[data-settings-error]').textContent = err.message;
  }
});

boot();
