// Страница курьера: вход по личному коду, свои заказы (обновляются сами), «Забрал — еду» / «Доставил»,
// 2GIS, звонок, карта с порядком объезда. Место курьера передаёт Telegram (бот), здесь — подключение бота
// и состояние трансляции. Ниже своих — свободные заказы точки: курьер забирает их сам (specs/014), и пока
// он что-то везёт, страница сама отправляет его место раз в 30 секунд — до «Закончить смену».
// С автоназначением (specs/015) база сама отдаёт заказ курьеру на смене: такой заказ приходит в «Мои заказы» со звуком
// и пометкой «Назначен вам», у него есть «Не могу взять». Не на смене — плашка «Начать смену». Курьеру «обе точки»
// заказы приходят с обеих кухонь — к номеру своего заказа дописываем кухню (board.points).
// Мини-приложение (specs/018): вход по коду из 6 цифр (обмен на прежний длинный ключ), блок «Сегодня» — доставлено и
// заработано за рабочий день, в карточке «до двери» и «готов ли с кухни», чат по заказу с покупателем и KOKORO.
// База без 018 — ничего из этого не видно, страница работает как раньше.
// Вид «как у курьеров Яндекса и Glovo» (specs/026, 21.11.2026): нижние вкладки «Заказы / Карта / Доход / Профиль», в шапке —
// «На линии», «Забрал — еду» и «Доставил» — свайпом (с клавиатуры — Enter), новый заказ — шторка со звуком до «Понятно».
// Точка в режиме «назначает менеджер» (board.dispatch = 'manual') — «Свободных» нет, заказы приходят от менеджера.
import { api } from './api.js';
import { brand, branchInfo, branchName, delivery, door, kmLabel, money, STATUSES } from './data.js';
import { orderNo } from './cashbox.js';
import { chime, hasUnread, openChat } from './chat.js';
import { addressLink, ago, isFresh, planRoute, routeLinks } from './maps.js';
import { createMap, deliveryQuote, geocode, pin, fit, forgetGeocoded } from './map.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY_STORE = 'kokoro.courier';
const POLL_MS = 15_000;
const FRESH_MS = 60_000; // новый заказ подсвечен минуту
const TO_PICK = ['new', 'confirmed', 'cooking'];
const DISABLED = 'Менеджер закрыл вам вход. Уточните у него — когда откроет, страница войдёт сама.';
// Вход по коду из 6 цифр (specs/018): что не так с введённым и что ответила база (courier_login)
const FORMAT = 'Введите 6 цифр кода (или код из 12 знаков из ссылки)';
// Ключ перестал подходить: вход по коду на другом телефоне выдал новый ключ, или менеджер сменил код или ссылку
// (код одноразовый — прежний уже сгорел, нужен новый)
const GONE = 'Ваш код больше не действует: вы вошли на другом телефоне или менеджер сменил код — попросите у менеджера новый код';
const TODAY_MS = 60_000; // «Сегодня» — раз в минуту и сразу после «Доставил»
const TO_COOK = ['confirmed', 'cooking']; // у этих заказов кухня ещё может готовить — показываем, готов ли пакет
const GONE_RETRY_MS = 3_000; // ключ не подошёл — переспросить один раз, прежде чем выходить

const storage = {
  get() { try { return localStorage.getItem(KEY_STORE); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(KEY_STORE, v) : localStorage.removeItem(KEY_STORE); } catch { /* приватный режим */ } },
};

let key = null;
let me = null;
let orders = [];
let knownIds = null; // заказы, которые курьер уже видел: новый — сигнал и подсветка
const freshUntil = new Map(); // id нового заказа → до какого времени подсвечен
let timer = null;
let busyId = null;   // заказ, по которому идёт запрос «Забрал»/«Доставил»
let goneOnce = false; // база один раз ответила «ключ не подходит» — переспрашиваем, прежде чем выходить
let cardErrors = {};
let here = null;     // место по кнопке «Где я» (когда Telegram не передаёт): { lat, lon, at }
const found = new Map(); // адрес → примерная точка по поиску (null — не нашли), для заказов без отмеченной точки
let mapReady = null; // Promise<{ L, map, layer }> — карта заказов, создаётся один раз
// Свободные заказы (specs/014): ответ courier_board или null — база без этой функции или ещё не ответила
let board = null;
let takingId = null;  // свободный заказ, который сейчас забираем
let freeError = '';   // отказ базы при «Забрал — еду» — строкой над списком
let freeErrorAt = 0;  // когда случился отказ
let freeErrorSnap = null; // список свободных в первом ответе после отказа: поменялся — строку убираем
const takenHere = new Set(); // взятые с этой страницы: в «Мои заказы» приходят без сигнала «Новый заказ»
// Растёт с каждым «Забрал — еду» на этой странице (и взятым, и отказом), с кнопками своих заказов, а с автоназначением
// (specs/015) — и с «Не могу взять», «Начать смену» и «Закончить смену»: ответ опроса, ушедшего раньше, устарел
let takeSeq = 0;
// Автоназначение (specs/015): смена и «Не могу взять»
let shiftBusy = false;  // идёт запрос «Начать смену»
let shiftError = '';    // «Начать смену» не прошло — строкой в плашке
let ordersNote = '';    // строка над «Моими заказами»: заказ снят с курьера или отказ, когда карточки уже нет
let ordersNoteError = false;
let ordersNoteAt = 0;
// Назначенные доской заказы, которых не было в «Моих заказах», — за ними уже спросили ещё раз (см. applyBoard)
let chasedIds = '';
// Мини-приложение (specs/018). null — база без 018 (или ещё не ответила): соответствующего на экране нет
let extra = null;       // courier_extra: { "<id>": { door, door_fee, ready_at, promise_at } } — свои и свободные заказы
let chats = null;       // courier_chat_summary: Map(id заказа → { last_id, last_author, count }) по своим заказам
const chatSeen = new Map(); // id заказа → последнее сообщение, о котором уже знаем: новое от покупателя или KOKORO — сигнал
let chatPrimed = false; // первая сводка после входа — без сигнала: старые сообщения не «новые»
let chatBox = null;     // открытое окно чата и его заказ
let chatOpenId = null;
let today = null;       // courier_today: { since, delivered, earned, unknown, orders }
let todayAt = 0;        // когда спрашивали «Сегодня»
let todayStale = false; // курьер нажал «Доставил» — спросить «Сегодня» с ближайшим обновлением
let contact = null;     // courier_contact (specs/021): { phone, chat: { last_id, last_author } | null } или null — база без 021
let phoneEditing = false; // курьер нажал «Изменить» у своего номера
let staffLast = 0;      // последнее сообщение чата с менеджером, о котором уже знаем: новое от менеджера — сигнал
let staffPrimed = false; // первая сводка после входа — без сигнала
let staffBox = null;    // открытое окно чата с менеджером
// Итог дня и сумма по месту (specs/024)
let todayBack = 0;      // какой день показывает блок итога: 0 — сегодня, 1 — вчера
let earningsOff = false; // база без 024 (courier_earnings нет) — блок «Сегодня» по-старому (courier_today)
const quoting = new Set(); // заказы, у которых сейчас считается сумма доставки по месту

/**
 * Код из любого текста: ссылки (…/courier#K7M2-QX9P-4TAB), сообщения менеджера целиком или самого кода.
 * Знаки кода — без 0/O и 1/I/L, поэтому слова из ссылки и сообщения за код не принимаются
 */
function extractCode(text) {
  const found = String(text || '').toUpperCase().match(/[2-9A-HJKMNP-Z]{4}-?[2-9A-HJKMNP-Z]{4}-?[2-9A-HJKMNP-Z]{4}/g);
  if (found) return found[found.length - 1].replace(/-/g, ''); // не метод at: его нет в Safari до iOS 15.4
  const plain = String(text || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return plain.length === 12 ? plain : null;
}
/**
 * Код входа из 6 цифр (specs/018) внутри текста — например, вставили сообщение менеджера целиком: «…Код для входа: 482913».
 * Без опережающих проверок «назад» (?<!…): их нет в Safari до iOS 16.4 — модуль не загрузился бы вовсе
 */
function pinFrom(text) {
  const found = [...String(text || '').matchAll(/(?:^|\D)(\d{6})(?=\D|$)/g)];
  return found.length ? found[found.length - 1][1] : null;
}
const label = (code) => `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
const isNetwork = (err) => err instanceof TypeError; // fetch без связи и обрыв по времени (supabase-lite) — TypeError
// Сбой самого сервера (5xx) при проверке ключа — тоже не повод выкидывать курьера на ввод кода (21.11.2026): пробуем снова
const isTransient = (err) => isNetwork(err) || Number(err?.status) >= 500;

/* ---------- Вход ---------- */

// Код из ссылки менеджера (kokoro.com.kg/courier#XXXX-XXXX-XXXX) запоминаем и убираем из адреса:
// часть после # на сервер не уходит, а из адресной строки и истории её лучше убрать
function codeFromLink() {
  const code = extractCode(decodeURIComponent(location.hash.slice(1)));
  if (!code) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return code;
}

/**
 * Общий телефон: всё, что относится к прежнему курьеру, — заказы (имена, телефоны, адреса), свободные заказы,
 * ошибки, отправка места — не остаётся ни на экране, ни в памяти. При выходе и при входе другим кодом поверх
 * открытой страницы (новая ссылка менеджера)
 */
function resetCourierState() {
  me = null;
  orders = [];
  knownIds = null;
  cardErrors = {};
  busyId = null;
  freshUntil.clear();
  paint($('[data-orders]'), ''); // через paint: иначе он помнил бы прежние карточки и не нарисовал бы такие же снова
  $('[data-count]').textContent = '';
  paint($('[data-tg]'), '');
  $('[data-mapbox]').hidden = true;
  $('[data-route-stops]').innerHTML = '';
  here = null;
  whereError = '';
  board = null;
  takingId = null;
  setFreeError('');
  takenHere.clear();
  takeSeq++; // ответы, ушедшие при прежнем курьере, не применяем
  goneOnce = false;
  shiftEnded = null;
  shiftBusy = false;
  shiftError = '';
  chasedIds = '';
  setOrdersNote('');
  // Мини-приложение (specs/018): заработок, чат и отметки кухни прежнего курьера — тоже стираем
  extra = null;
  chats = null;
  chatSeen.clear();
  chatPrimed = false;
  const box = chatBox;
  chatBox = null;
  chatOpenId = null;
  box?.close();
  today = null;
  todayAt = 0;
  todayStale = false;
  todayBack = 0;
  earningsOff = false;
  quoting.clear();
  // Связь с менеджером (specs/021): номер и чат прежнего курьера
  contact = null;
  phoneEditing = false;
  staffLast = 0;
  staffPrimed = false;
  const staff = staffBox;
  staffBox = null;
  staff?.close();
  renderContact();
  renderToday();
  renderNote();
  renderShift();
  renderFree();
  syncWatch();
  lastSent = 0;
  // Вид (specs/026): шторка нового заказа и сводка дохода прежнего курьера уходят, вкладка — «Заказы»
  closeAlert();
  todaySummary = null;
  renderEarn();
  setTab('orders');
}

function showLogin(message = '', code = '') {
  stop();
  key = null;
  resetCourierState();
  $('[data-app]').hidden = true;
  $('[data-nav]').hidden = true;
  $('[data-signout]').hidden = true;
  $('[data-who]').textContent = '';
  $('[data-top-point]').textContent = '';
  $('[data-login]').hidden = false;
  $('[data-login-error]').textContent = message;
  if (code) $('[data-login-form]').elements.code.value = label(code);
}

/**
 * Войти по коду. fallback — сохранённый код: если код из старой ссылки не подошёл, рабочий не стираем.
 * fresh — ключ только что выдал вход по коду из 6 цифр (specs/018): код одноразовый и уже сгорел, поэтому ключ запоминаем
 * при любом сбое проверки — иначе вход пропал бы вместе с кодом
 */
async function enter(code, fallback = null, fresh = false) {
  let who;
  try {
    who = await api.courier.me(code);
  } catch (err) {
    // Нет связи или сбой сервера — код запоминаем (неверный сотрёт первый же ответ базы) и пробуем дальше
    if (isTransient(err)) {
      if (key !== code) resetCourierState();
      key = code;
      storage.set(code);
      showApp();
      $('[data-status]').textContent = 'Нет связи — пробуем ещё раз…';
      return;
    }
    showLogin(`Не удалось проверить код: ${err.message}. Нажмите «Войти» ещё раз.`, code);
    if (fresh) storage.set(code); // «Войти» (ключ уже в поле) или перезагрузка войдут с ним
    return;
  }
  if (!who) {
    if (fallback && fallback !== code) { await enter(fallback); return; }
    const stored = storage.get();
    if (stored && stored !== code) { await enter(stored); return; } // вошли заново в другой вкладке — её ключ свежий
    if (stored === code) storage.set(null);
    showLogin('Код не подошёл. Введите код из 6 цифр от менеджера или попросите у него новую ссылку.');
    return;
  }
  if (who.disabled) {
    storage.set(code); // менеджер включит снова — войдём с тем же кодом
    showLogin(DISABLED);
    return;
  }
  // Вошли другим кодом поверх открытой страницы — заказы, ошибки и отправку места прежнего курьера стираем, как при выходе
  if (key !== code) resetCourierState();
  key = code;
  me = who;
  storage.set(code);
  showApp();
}

function showApp() {
  $('[data-login]').hidden = true;
  $('[data-app]').hidden = false;
  $('[data-nav]').hidden = false;
  $('[data-signout]').hidden = false;
  renderMe();
  refresh();
  stop();
  timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
}

function stop() { clearInterval(timer); timer = null; }

/**
 * Вход по коду из 6 цифр (specs/018): база меняет его на длинный ключ — дальше всё как при входе по ссылке, а телефон
 * помнит ключ. Код одноразовый и живёт 72 часа: после первого входа сгорает. Вход на новом телефоне закрывает прежний.
 * Неверные попытки база считает и после пяти подряд просит подождать
 */
async function pinLogin(pin) {
  const error = $('[data-login-error]');
  let reply;
  try {
    reply = await api.courier.login(pin);
  } catch (err) {
    // 404 — в базе ещё нет входа по коду (supabase/mini-app.sql не запущен): остаётся ссылка менеджера
    // Ответ не пришёл (нет связи или долго нет ответа): база могла код принять — и тогда он уже сгорел
    error.textContent = err?.status === 404 ? 'Вход по коду пока не работает — откройте ссылку от менеджера'
      : isNetwork(err) ? 'Ответ не пришёл. Обновите страницу; если вход не случился — попросите у менеджера новый код (этот мог уже сгореть)'
        : `Не удалось войти: ${err.message}. Нажмите «Войти» ещё раз.`;
    return;
  }
  const code = typeof reply?.key === 'string' ? extractCode(reply.key) : null;
  if (code) {
    $('[data-login-form]').elements.code.value = '';
    await enter(code, null, true);
    return;
  }
  const minutes = Number(reply?.minutes) || 0;
  error.textContent = {
    // Код одноразовый и живёт 72 часа: использованный и просроченный база тоже отвечает wrong
    wrong: 'Код не подошёл. Проверьте 6 цифр. Код одноразовый — если вы уже входили им или прошло больше 3 дней, попросите у менеджера новый',
    locked: `Много неверных попыток — подождите ${minutes || 15} минут`,
    busy: 'Вход по коду временно закрыт — подождите или попросите у менеджера ссылку',
    disabled: 'Менеджер закрыл вам вход. Уточните у него — когда откроет, введите код снова.',
  }[reply?.error] || FORMAT;
}

$('[data-login-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = e.target.elements.code.value;
  const error = $('[data-login-error]');
  // Сначала — ровно 6 цифр (пробелы и дефисы не в счёт), потом код из 12 знаков или ссылка, потом 6 цифр внутри сообщения
  const plain = text.replace(/[\s-]/g, '');
  const code = /^\d{6}$/.test(plain) ? null : extractCode(text);
  const pin = /^\d{6}$/.test(plain) ? plain : code ? null : pinFrom(text);
  if (!code && !pin) { error.textContent = FORMAT; return; }
  const button = e.target.querySelector('button');
  button.disabled = true;
  error.textContent = '';
  try { await (code ? enter(code) : pinLogin(pin)); } finally { button.disabled = false; }
});

$('[data-signout]').addEventListener('click', () => {
  if (!confirm('Выйти? Чтобы войти снова, понадобится ссылка или код от менеджера.')) return;
  storage.set(null);
  forgetGeocoded(); // адреса покупателей на телефоне не оставляем
  found.clear();
  showLogin();
});

/* ---------- Заказы и Telegram — обновляются сами ---------- */

// Один запрос за раз: опрос, нажатие кнопки и возврат на вкладку не наслаиваются (ответы не придут вперемешку).
// Попросили обновить, пока шёл прежний опрос, или его ответ устарел (нажали кнопку, пока он шёл) — спрашиваем ещё раз
// в том же обещании: кто ждёт refresh(), получает список после повторной загрузки, а не устаревший
let inflight = null;
let again = false;
function refresh() {
  if (!key) return Promise.resolve();
  if (inflight) { again = true; return inflight; }
  inflight = (async () => {
    try {
      do { again = false; await load(); } while (again && key);
    } finally {
      inflight = null;
      again = false;
    }
  })();
  return inflight;
}

// Запрос со своим разбором ошибок: { data } или { error }. Promise.resolve().then — чтобы и синхронный сбой не уронил опрос
const settle = (call) => Promise.resolve().then(call).then((data) => ({ data }), (error) => ({ error }));

async function load() {
  const k = key;
  const seq = takeSeq;
  // Свободные заказы — отдельным запросом со своим разбором ошибок: его сбой (404 — supabase/courier-pickup.sql
  // ещё не запущен) не трогает свои заказы
  const boardReply = settle(() => api.courier.board(k));
  // Мини-приложение (specs/018) — так же отдельно и параллельно: «до двери» и «готов» по заказам, сводка чата, а «Сегодня» —
  // раз в минуту и сразу после «Доставил». База без 018 отвечает null — этого просто нет на экране
  const extraReply = settle(() => api.courier.extra(k));
  const chatReply = settle(() => api.courier.chatSummary(k));
  const wantToday = todayStale || Date.now() - todayAt >= TODAY_MS;
  if (wantToday) { todayStale = false; todayAt = Date.now(); }
  const todayReply = wantToday ? settle(() => dayReport(k)) : null;
  // Точка курьера (specs/019) — тем же опросом; нет функции (старая база / заглушка проверки) — блока нет
  const pointReply = typeof api.courier.point === 'function' ? settle(() => api.courier.point(k)) : null;
  // Свой номер и чат с менеджером (specs/021) — так же; нет функции — блока нет
  const contactReply = typeof api.courier.contact === 'function' ? settle(() => api.courier.contact(k)) : null;
  let list;
  let who;
  try {
    [list, who] = await Promise.all([api.courier.orders(k), api.courier.me(k)]);
  } catch (err) {
    if (wantToday) todayStale = true; // «Сегодня» спросим со следующей попыткой, а не через минуту
    if (k === key) $('[data-status]').textContent = isNetwork(err) ? 'Нет связи — пробуем ещё раз…' : `Не удалось обновить: ${err.message}`;
    return;
  }
  if (k !== key) return; // пока ждали ответ, курьер вышел или вошёл с другим кодом
  // Пока ждали ответ, курьер нажал «Забрал — еду»: ответ мог уйти до взятия и вернул бы заказ в «Свободные» с рабочей
  // кнопкой (и убрал бы его из «Моих»). Такой ответ не применяем — сразу спрашиваем заново
  if (seq !== takeSeq) { if (wantToday) todayStale = true; again = true; return; }
  if (who?.disabled) { showLogin(DISABLED); return; }
  // Код сменили или вошли этим кодом на другом телефоне (specs/018: вход выдаёт новый ключ) — выходим
  if (list === null || who === null) {
    // 21.11.2026: курьеров выкидывало при возврате из другого приложения. Страница бывает открыта в двух вкладках (значок на
    // экране и ссылка из WhatsApp): вошли заново в одной — у другой в памяти старый ключ. Раньше та стирала с телефона и новый
    // ключ, и выходили обе. Теперь: на телефоне другой ключ — берём его; тот же — переспрашиваем один раз через 3 с и только
    // потом выходим, стирая лишь свой ключ
    const stored = storage.get();
    if (stored && stored !== k) { enter(stored, k); return; }
    if (!goneOnce) {
      goneOnce = true;
      $('[data-status]').textContent = 'Проверяем вход…';
      setTimeout(() => { if (key === k) refresh(); }, GONE_RETRY_MS);
      return;
    }
    goneOnce = false;
    if (storage.get() === k) storage.set(null);
    showLogin(GONE);
    return;
  }
  goneOnce = false;
  // Ответы 018 спрошены вместе с заказами и обычно уже пришли. Пока ждали, курьер вышел или нажал кнопку — как выше
  const [extraGot, chatGot, todayGot] = await Promise.all([extraReply, chatReply, todayReply]);
  if (k !== key) return;
  if (seq !== takeSeq) { if (wantToday) todayStale = true; again = true; return; }
  applyExtra(extraGot);
  applyChats(chatGot);
  if (todayGot) applyToday(todayGot);
  storage.set(k); // код проверен базой — помним его и после перезагрузки страницы
  me = who;
  // Взятый самим курьером заказ — не «новый»: без звука и подсветки, даже если ответ опроса, ушедшего до нажатия,
  // перезапишет knownIds
  const fresh = list.filter((o) => knownIds && !knownIds.has(o.id) && !takenHere.has(o.id));
  fresh.forEach((o) => freshUntil.set(o.id, Date.now() + FRESH_MS));
  if (fresh.length) notify(fresh.length);
  knownIds = new Set(list.map((o) => o.id));
  orders = list;
  // Шторка «Новый заказ» (specs/026): новые — в неё; заказ, который сняли или уже везут, из неё уходит
  if (fresh.length) showAlert(fresh);
  else if (alertIds.length) {
    alertIds = alertIds.filter((id) => orders.some((o) => o.id === id && TO_PICK.includes(o.status)));
    if (alertIds.length) renderAlert(); else closeAlert();
  }
  $('[data-status]').textContent = '';
  renderMe();
  renderOrders();
  syncWatch();
  applyBoard(await boardReply, k, seq);
  if (pointReply) {
    const got = await pointReply;
    if (k !== key) return;
    if (got.data !== undefined) point = got.data; // сбой связи — прежняя точка остаётся на экране
    else if (!isNetwork(got.error)) point = null;
  }
  renderPoint();
  if (contactReply) {
    const got = await contactReply;
    if (k !== key) return;
    applyContact(got);
  }
  renderContact();
}

/* ---------- Точка курьера (specs/019) ---------- */

// Где курьер работает и с какой части города ему приходят заказы. В начале смены (первый раз за рабочий день — с 06:00 по
// Бишкеку, это 00:00 UTC — и после «Начать смену») — крупно, с «Понятно»; потом — одной строкой. Точку ставит менеджер;
// курьер без точки выбирает её здесь один раз
let point = null; // { branch: 'kulieva' | 'kokzhar' | null, chosen } или null — база без 019
const HELLO_KEY = 'kokoro.courier.hello';
const POINT_TEXT = {
  kulieva: { name: 'Кулиева', kitchen: 'ул. Кулиева, 40', side: 'Заказы приходят только с западной части города — западнее ул. Абдрахманова (бывшей Советской).', short: 'запад города' },
  kokzhar: { name: 'Кок-Жар', kitchen: 'ул. Кок-Жайык, 120а', side: 'Заказы приходят только с восточной части города — восточнее ул. Абдрахманова (бывшей Советской).', short: 'восток города' },
};
const workdayKey = () => new Date().toISOString().slice(0, 10); // рабочий день с 06:00 по Бишкеку = сутки UTC
const helloMark = () => `${workdayKey()}|${point?.branch ?? 'both'}`;
const readHello = () => { try { return localStorage.getItem(HELLO_KEY); } catch { return null; } };

function renderPoint() {
  const box = $('[data-point-box]');
  if (!box) return;
  // Шапка (specs/026): под именем — точка и часть города
  const top = point?.chosen ? (point.branch ? `Точка «${POINT_TEXT[point.branch].name}» · ${POINT_TEXT[point.branch].short}` : 'Обе точки · весь город') : '';
  setText($('[data-top-point]'), key ? top : '');
  if (!point) { box.hidden = true; return; }
  box.hidden = false;
  const choose = $('[data-point-choose]');
  const ok = $('[data-point-ok]');
  const info = point.branch ? POINT_TEXT[point.branch] : null;
  if (!point.chosen) {
    box.className = 'cr-point cr-point--ask';
    $('[data-point-title]').textContent = 'На какой точке вы работаете?';
    $('[data-point-text]').textContent = 'Выберите один раз: заказы будут приходить только с вашей части города. Сменить точку потом может менеджер.';
    choose.hidden = false;
    ok.hidden = true;
    return;
  }
  choose.hidden = true;
  const hello = onShift() !== false && readHello() !== helloMark();
  box.className = `cr-point${hello ? ' cr-point--hello' : ''}`;
  if (hello) {
    $('[data-point-title]').textContent = info ? `Вы на точке «${info.name}» — ${info.kitchen}` : 'Вы работаете на обеих точках';
    $('[data-point-text]').textContent = info ? info.side : 'Заказы приходят со всего города — с обеих точек.';
    ok.hidden = false;
  } else {
    // Строка точки теперь в шапке (specs/026) — плашка уходит, чтобы над заказами было пусто
    $('[data-point-title]').textContent = info ? `📍 Точка «${info.name}» · ${info.short}` : '📍 Обе точки · весь город';
    $('[data-point-text]').textContent = '';
    ok.hidden = true;
    box.hidden = true;
  }
}

$('[data-point-ok]')?.addEventListener('click', () => {
  try { localStorage.setItem(HELLO_KEY, helloMark()); } catch { /* приватный режим */ }
  renderPoint();
});

document.addEventListener('click', async (e) => {
  const pick = e.target.closest('[data-point-pick]');
  if (!pick || !key) return;
  const branch = pick.dataset.pointPick;
  const name = POINT_TEXT[branch]?.name;
  if (!confirm(`Вы работаете на точке «${name}»? Сменить точку потом сможет только менеджер.`)) return;
  const err = $('[data-point-error]');
  err.textContent = '';
  document.querySelectorAll('[data-point-pick]').forEach((b) => { b.disabled = true; });
  try {
    await api.courier.choosePoint(key, branch);
    point = { branch, chosen: true };
    try { localStorage.removeItem(HELLO_KEY); } catch { /* приватный режим */ }
    renderPoint();
    refresh(); // «Свободные» и назначение — уже по точке
  } catch (error) {
    err.textContent = isNetwork(error) ? 'Нет связи — попробуйте ещё раз' : error.message;
    if (/уже выбрана/.test(error.message)) refresh();
  } finally {
    document.querySelectorAll('[data-point-pick]').forEach((b) => { b.disabled = false; });
  }
});

/* ---------- Связь с менеджером (specs/021): свой номер и чат ---------- */

// Номер видят покупатель заказа «В пути» (кнопка «Позвонить курьеру», specs/024) и менеджер — позвонить или написать
// в WhatsApp. Без номера (specs/024) заказы не приходят: база не назначает, «Свободные», смена, Telegram и «Сегодня» скрыты —
// на странице поле для номера (и свои заказы, если менеджер уже что-то назначил: довезти их надо). Чат с менеджером — без
// заказа: менеджеры точки курьера (у «обеих точек» — обеих) и владелец. Новое сообщение менеджера — тот же тихий сигнал,
// что у чата по заказу, и метка на кнопке
const STAFF_KEY = 'courier-staff';
const phoneLabel = (p) => (/^\+996\d{9}$/.test(p || '') ? `+996 ${p.slice(4, 7)} ${p.slice(7, 10)} ${p.slice(10)}` : p || '');
let phoneGate = false; // сейчас страница просит номер: при первом показе — фокус в поле

function applyContact({ data, error }) {
  if (error) { if (!isNetwork(error)) contact = null; return; } // обрыв связи — оставляем, что было
  contact = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  const chat = contact?.chat || null;
  const last = Number(chat?.last_id) || 0;
  if (staffPrimed && last > staffLast && chat.last_author !== 'courier' && !staffBox && hasUnread(STAFF_KEY, chat, 'courier') && audio) chime();
  staffLast = Math.max(staffLast, last);
  staffPrimed = true;
}

function renderContact() {
  const box = $('[data-contact]');
  if (!box) return;
  const gate = !!contact && !contact.phone;
  $('[data-app]').classList.toggle('cr-app--phone', gate);
  const opened = gate && !phoneGate;
  const changed = gate !== phoneGate;
  phoneGate = gate;
  if (changed && key) { renderOrders(); renderShift(); renderEarn(); } // пустой список, «На линии» и доход зависят от номера
  const form = $('[data-phone-form]');
  // Поле номера (specs/026) — над вкладками, вне блока «Профиля»: без номера его видно на любой вкладке
  if (!contact) { box.hidden = true; form.hidden = true; return; }
  box.hidden = false;
  const has = !!contact.phone;
  form.hidden = has && !phoneEditing;
  form.classList.toggle('cr-gate--edit', has);
  $('[data-phone-title]').textContent = has ? 'Новый номер телефона' : 'Впишите свой номер телефона — без него заказы не приходят';
  if (opened) {
    form.scrollIntoView({ block: 'start' });
    const input = form.elements.phone;
    if (!input.value) input.focus({ preventScroll: true });
  }
  $('[data-phone-cancel]').hidden = !has;
  $('[data-phone-line]').hidden = !has || phoneEditing;
  $('[data-phone-value]').textContent = phoneLabel(contact.phone);
  const unread = hasUnread(STAFF_KEY, contact.chat, 'courier');
  $('[data-staff-dot]').hidden = !unread;
  $('[data-nav-dot]').hidden = !unread; // метка на вкладке «Профиль»: там чат с менеджером
  $('[data-staff-chat]').setAttribute('aria-label', `Чат с менеджером${unread ? ' — есть новое сообщение' : ''}`);
  // Звонок на свою точку; у «обеих точек» номера два — тогда только чат
  const call = $('[data-point-call]');
  const info = point?.branch ? branchInfo[point.branch] : null;
  call.hidden = !info?.phone;
  if (info?.phone) {
    call.href = `tel:+${info.phone}`;
    call.textContent = `📞 Позвонить на точку ${info.name}`;
  }
}

$('[data-phone-form]')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const input = form.elements.phone;
  const err = $('[data-phone-error]');
  err.textContent = '';
  const value = input.value.trim();
  if (!value) { err.textContent = 'Впишите номер, например 0555 123 456'; input.focus(); return; }
  if (!key) return;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const res = await api.courier.setPhone(key, value);
    const first = !contact?.phone;
    contact = { ...(contact || { chat: null }), phone: res?.phone || value };
    phoneEditing = false;
    input.value = '';
    renderContact();
    keepFocus($('[data-staff-chat]'));
    if (first) refresh(); // номер есть — смена, «Свободные» и назначение открылись: показываем сразу, не через 15 с
  } catch (error) {
    err.textContent = isNetwork(error) ? 'Нет связи — попробуйте ещё раз' : error.message;
    input.focus();
  } finally { button.disabled = false; }
});

$('[data-phone-edit]')?.addEventListener('click', () => {
  phoneEditing = true;
  renderContact();
  const form = $('[data-phone-form]');
  const input = form.elements.phone;
  input.value = phoneLabel(contact?.phone);
  form.scrollIntoView({ block: 'start', behavior: 'smooth' });
  input.focus({ preventScroll: true });
});

$('[data-phone-cancel]')?.addEventListener('click', () => {
  phoneEditing = false;
  $('[data-phone-error]').textContent = '';
  renderContact();
  keepFocus($('[data-phone-edit]'));
});

$('[data-staff-chat]')?.addEventListener('click', () => {
  if (!key) return;
  const k = key;
  const box = openChat({
    title: 'Чат с менеджером',
    mine: 'courier',
    labels: { manager: 'Менеджер' },
    load: (after) => api.courier.staffChat(k, after),
    send: (body) => api.courier.staffSend(k, body),
    readKey: STAFF_KEY,
    closedNote: 'Чат недоступен — обновите страницу',
    onClose: () => {
      if (staffBox === box) staffBox = null;
      if (k !== key) return;
      renderContact(); // метка «есть новое» уходит: всё прочитано
      keepFocus($('[data-staff-chat]'));
    },
  });
  staffBox = box;
});

/**
 * Ответ courier_board → секция «Свободные заказы». 404 (функции нет) и прочие отказы — секцию прячем;
 * обрыв связи — оставляем прежний список (в подъезде связь мигает, а список не должен мигать вместе с ней)
 */
function applyBoard({ data, error }, k, seq) {
  if (k !== key) return;
  if (seq !== takeSeq) { again = true; return; } // запрос ушёл до «Забрал — еду» — ответ устарел
  const before = ordersMarks();
  if (error) { if (!isNetwork(error)) board = null; }
  else {
    board = data && Array.isArray(data.free) ? data : null;
    if (board) settleFreeError();
    // Доска сама назначила заказ (specs/015: courier_board зовёт назначение), а «Мои заказы» спрашивали параллельно и его
    // ещё не видели — спрашиваем ещё раз сразу: карточка и сигнал придут за доли секунды, а не с опросом через 15 с.
    // За одним и тем же набором — один раз: если база почему-то не отдаёт заказ в «Мои заказы», по кругу не спрашиваем
    const missing = Array.isArray(board?.assigned)
      ? board.assigned.map(Number).filter((id) => !orders.some((o) => Number(o.id) === id)).sort((a, b) => a - b).join(',') : '';
    if (missing && missing !== chasedIds) again = true;
    chasedIds = missing;
  }
  if (onShift() !== false) shiftError = ''; // смена идёт — прежний сбой «Начать смену» больше не нужен
  // Текст пустого списка «Мои заказы» зависит от свободных заказов ниже и от смены, пометка «Назначен вам» — от assigned
  if (before !== ordersMarks()) renderOrders();
  renderMe(); // «Закончить смену» видна и на смене без места на карте (specs/015)
  renderShift();
  renderFree();
}

/* ---------- Мини-приложение (specs/018): «до двери», «готов», чат, «Сегодня» ---------- */

// Обрыв связи — оставляем, что было (в подъезде связь мигает); прочие отказы и null (база без 018) — убираем с экрана
function applyExtra({ data, error }) {
  if (error) { if (!isNetwork(error)) extra = null; return; }
  extra = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}
/** Отметки заказа из courier_extra или null */
const extraOf = (o) => (extra && extra[o.id] && typeof extra[o.id] === 'object' ? extra[o.id] : null);
/** Сколько курьер возьмёт за «до двери»: 0 — не нужно */
const doorFeeOf = (o) => { const ex = extraOf(o); return ex?.door ? Number(ex.door_fee) || door.fee : 0; };

/**
 * Сводка чата: метки «есть новое» на кнопках «💬 Чат». Новое сообщение покупателя или KOKORO — короткий сигнал (тише,
 * чем «Новый заказ»), кроме чата, который сейчас открыт. Звук — после первого касания страницы, как и сигнал о заказе
 */
function applyChats({ data, error }) {
  if (error) { if (!isNetwork(error)) chats = null; return; }
  if (!Array.isArray(data)) { chats = null; return; }
  let ring = false;
  for (const item of data) {
    const id = Number(item.order_id);
    const last = Number(item.last_id) || 0;
    if (chatPrimed && last > (chatSeen.get(id) || 0) && item.last_author !== 'courier' && id !== chatOpenId
      && hasUnread(`courier:${id}`, item, 'courier')) ring = true;
    chatSeen.set(id, Math.max(last, chatSeen.get(id) || 0));
  }
  chatPrimed = true;
  chats = new Map(data.map((item) => [Number(item.order_id), item]));
  if (ring && audio) chime();
}

function chatButton(o) {
  const unread = hasUnread(`courier:${o.id}`, chats.get(Number(o.id)), 'courier');
  const name = `Чат по заказу ${myNo(o)}${unread ? ' — есть новое сообщение' : ''}`;
  return `<button class="btn btn--ghost cr-ord__chat" type="button" data-chat aria-label="${esc(name)}">💬 Чат${unread
    ? '<span class="chat-dot" aria-hidden="true"></span>' : ''}</button>`;
}

/** Окно чата по своему заказу: покупатель, KOKORO (менеджер) и вы. Прочитанное помнит этот телефон */
function showChat(order) {
  const k = key;
  const id = order.id;
  chatOpenId = Number(id);
  chatBox = openChat({
    title: `Чат по заказу ${myNo(order)}`,
    mine: 'courier',
    labels: { client: 'Покупатель', manager: 'KOKORO' },
    load: (after) => api.courier.chat(k, id, after),
    send: (body) => api.courier.chatSend(k, id, body),
    readKey: `courier:${id}`,
    onClose: () => {
      if (chatOpenId === Number(id)) { chatOpenId = null; chatBox = null; }
      if (k !== key) return;
      renderOrders(); // метка «есть новое» уходит: всё прочитано
      keepFocus(document.querySelector(`.cr-ord[data-id="${id}"] [data-chat]`) || undefined);
    },
  });
}

$('[data-orders]').addEventListener('click', (e) => {
  const button = e.target.closest('[data-chat]');
  if (!button) return;
  const order = orders.find((o) => String(o.id) === button.closest('[data-id]')?.dataset.id);
  if (order) showChat(order);
});

/**
 * Итог дня: courier_earnings (specs/024) за день todayBack, база без 024 — courier_today (только сегодня, без расшифровки).
 * К ответу приписываем, за какой день спрашивали (back), и old — ответ по-старому
 */
async function dayReport(k) {
  const back = todayBack;
  if (!earningsOff && typeof api.courier.earnings === 'function') {
    const got = await api.courier.earnings(k, back);
    if (got && typeof got === 'object') return { ...got, back };
    if (got === null && k === key) earningsOff = true; // null с рабочим ключом — функции нет (404): дальше по-старому
  }
  const old = await api.courier.today(k);
  return old && typeof old === 'object' ? { ...old, back: 0, old: true } : null;
}

function applyToday({ data, error }) {
  if (error) {
    if (isNetwork(error)) todayStale = true; // нет связи — спросим со следующим обновлением
    else today = null;
  } else if (data && typeof data === 'object' && !Array.isArray(data)) {
    // Пока ждали ответ, курьер переключил «Сегодня / Вчера» — этот ответ уже не про тот день
    if (!data.old && Number(data.back) !== todayBack) todayStale = true;
    else today = data;
  } else {
    today = null;
  }
  renderToday();
}

const clock = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek' });
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);

/** Строка заказа в итоге дня: № и время, сумма, адрес, из чего сумма */
function dayLine(o, old) {
  const known = o.fee != null;
  const bits = [];
  if (!known) bits.push('адрес не нашёлся на карте — сумму уточните у менеджера');
  else if (old) { if (o.door) bits.push('с «до двери»'); }
  else {
    if (o.qr) bits.push('доставка в оплате по QR');
    else if (Number(o.road)) bits.push(`доставка ${money(o.road)}`);
    if (Number(o.rain)) bits.push(`🌧 дождь ${money(o.rain)}`);
    if (Number(o.door)) bits.push(`🚪 до двери ${money(o.door)}`);
  }
  if (!old && Number.isFinite(o.km)) bits.push(`${kmLabel(o.km)}${o.by === 'courier' ? ', по месту' : o.approx ? ', примерно' : ''}`);
  return `<li class="${known ? '' : 'cr-today__unknown'}">
      <span class="cr-today__no">${o.day_number ? `№ ${esc(o.day_number)}` : 'без №'}</span>
      <span class="cr-today__at">${o.done_at ? esc(clock(o.done_at)) : ''}</span>
      <b class="cr-today__fee">${known ? esc(money(o.fee)) : 'не посчитано'}</b>
      ${o.address ? `<span class="cr-today__addr">${esc(o.address)}</span>` : ''}
      ${bits.length ? `<span class="cr-today__bits">${esc(bits.join(' · '))}</span>` : ''}
    </li>`;
}

// Итог рабочего дня (с 06:00 до 06:00 по Бишкеку): сколько заработали, из чего сумма (доставка, дождь, «до двери») и каждый
// заказ. Деньги — доставка и «до двери», их курьер берёт с клиента себе. «Вчера» — чтобы утром свериться за прошлый день
function renderToday() {
  const box = $('[data-today]');
  const t = key && today ? today : null;
  box.hidden = !t;
  $('[data-money-empty]').hidden = !!t;
  // Строка «Сегодня» на вкладке «Заказы» (specs/026) — только по ответу за сегодня: «Вчера» её не меняет
  if (t && (t.old || Number(t.back) === 0)) todaySummary = { earned: Number(t.earned) || 0, delivered: Number(t.delivered) || 0 };
  if (!t) todaySummary = null;
  renderEarn();
  if (!t) return;
  const old = Boolean(t.old);
  const waiting = !old && Number(t.back) !== todayBack; // переключили день — ответ ещё в пути
  $('[data-today-days]').hidden = old;
  document.querySelectorAll('[data-today-back]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.todayBack) === todayBack)));
  const yesterday = !old && todayBack === 1;
  setText($('[data-today-title]'), yesterday ? 'Итог за вчера' : 'Итог за сегодня');
  const list = !waiting && Array.isArray(t.orders) ? t.orders : [];
  const delivered = Number(t.delivered) || 0;
  const unknown = Number(t.unknown) || 0;
  const earned = Number(t.earned) || 0;
  setText($('[data-today-sum]'), waiting ? 'Загружаем…' : delivered ? `Заработали ${money(earned)}`
    : yesterday ? 'Вчера доставок не было' : 'Пока ничего не доставлено');
  let parts = '';
  if (!waiting && delivered) {
    const bits = [];
    if (!old && Number(t.road)) bits.push(`доставка ${money(t.road)}`);
    if (!old && Number(t.rain)) bits.push(`🌧 дождь ${money(t.rain)}${Number(t.rain_orders) > 1 ? ` (${t.rain_orders} ${plural(Number(t.rain_orders), 'заказ', 'заказа', 'заказов')})` : ''}`);
    if (!old && Number(t.door)) bits.push(`🚪 до двери ${money(t.door)}`);
    parts = `${delivered} ${plural(delivered, 'доставка', 'доставки', 'доставок')}${bits.length > 1 ? `: ${bits.join(' + ')}` : ''}`;
  }
  setText($('[data-today-parts]'), parts);
  setText($('[data-today-note]'), !waiting && unknown
    ? `У ${upToOrders(unknown)} сумма не посчитана — адрес не нашёлся на карте. В итог ${unknown === 1 ? 'он не вошёл' : 'они не вошли'} — уточните у менеджера`
    : '');
  $('[data-today-more]').hidden = !list.length;
  setText($('[data-today-count]'), list.length ? `(${list.length})` : '');
  paint($('[data-today-list]'), list.map((o) => dayLine(o, old)).join(''));
}

/* ---------- Вид как в приложении курьера (specs/026): вкладки, доход одной строкой, «На линии», шторка нового заказа ---------- */

let todaySummary = null; // { earned, delivered } за сегодня — строка над «Моими заказами»

function renderEarn() {
  const el = $('[data-earn]');
  const s = key && !phoneGate ? todaySummary : null;
  el.hidden = !s;
  if (!s) return;
  setText($('[data-earn-sum]'), money(s.earned));
  setText($('[data-earn-count]'), s.delivered ? `${s.delivered} ${plural(s.delivered, 'доставка', 'доставки', 'доставок')}` : 'доставок пока нет');
  el.setAttribute('aria-label', `Сегодня заработано ${money(s.earned)}, ${s.delivered} ${plural(s.delivered, 'доставка', 'доставки', 'доставок')}. Открыть доход`);
}
$('[data-earn]').addEventListener('click', () => setTab('money', { focus: true }));

const TABS = ['orders', 'map', 'money', 'profile'];
let tab = 'orders';
/** Показать вкладку. focus — фокус на её кнопку (выбор с клавиатуры или по ссылке со страницы) */
function setTab(name, { focus = false } = {}) {
  if (!TABS.includes(name)) return;
  const changed = name !== tab;
  tab = name;
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  document.querySelectorAll('[data-tab]').forEach((b) => {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus({ preventScroll: true });
  });
  if (changed) window.scrollTo({ top: 0 });
  // Карта рисуется, только когда её видно: в скрытой вкладке у неё нулевой размер. Открыли — подгоняем заново
  if (name === 'map' && key) { fitKey = ''; renderOrders(); }
}
$('[data-nav]').addEventListener('click', (e) => {
  const button = e.target.closest('[data-tab]');
  if (button) setTab(button.dataset.tab);
});
// Стрелки по вкладкам — как у обычного переключателя вкладок
$('[data-nav]').addEventListener('keydown', (e) => {
  const i = TABS.indexOf(tab);
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  setTab(TABS[(next + TABS.length) % TABS.length], { focus: true });
});

// «На линии» в шапке: тот же «Начать смену» / «Закончить смену», что в плашке и в «Профиле»
function renderToggle() {
  const toggle = $('[data-shift-toggle]');
  const s = onShift();
  toggle.hidden = !key || s === null || phoneGate;
  if (toggle.hidden) return;
  toggle.classList.toggle('is-on', s === true);
  toggle.setAttribute('aria-pressed', String(s === true));
  toggle.disabled = shiftBusy;
  setText($('[data-shift-toggle-text]'), shiftBusy ? 'Секунду…' : s ? 'На линии' : 'Не на линии');
  toggle.setAttribute('aria-label', s ? 'На линии. Нажмите, чтобы закончить смену' : 'Не на линии. Нажмите, чтобы начать смену');
}
$('[data-shift-toggle]').addEventListener('click', () => {
  if (onShift() === false) startShift();
  else if (onShift() === true) stopShift();
});

/*
 * Новый заказ — шторка снизу: номер, кухня, адрес. Сигнал повторяется раз в 8 с (до 6 раз), пока курьер не нажмёт
 * «Понятно»: заказы назначает менеджер, и курьер должен заметить заказ, даже если телефон лежит в кармане
 */
const ALERT_REPEAT_MS = 8_000;
const ALERT_REPEATS = 6;
let alertIds = [];
let alertTimer = null;
let alertRings = 0;

/** Новые заказы в шторку; сигнал повторяется заново, только если среди них есть ещё не показанный */
function showAlert(list) {
  const added = list.some((o) => !alertIds.includes(o.id));
  alertIds = [...new Set([...alertIds, ...list.map((o) => o.id)])];
  renderAlert(added);
}

function renderAlert(ring = false) {
  const shown = alertIds.map((id) => orders.find((o) => o.id === id)).filter(Boolean);
  if (!shown.length) { closeAlert(); return; }
  setText($('[data-alert-title]'), shown.length === 1 ? myNo(shown[0]) : `${shown.length} ${plural(shown.length, 'заказ', 'заказа', 'заказов')}`);
  $('[data-alert-list]').innerHTML = shown.map((o) => {
    const kitchen = o.branch && branchInfo[o.branch] ? `Заберите на кухне «${branchInfo[o.branch].name}»` : 'Заберите на кухне';
    return `<li><b>${esc(shown.length > 1 ? myNo(o) : o.address)}</b>${shown.length > 1 ? `<span>${esc(o.address)}</span>` : ''}<span>${esc(TO_PICK.includes(o.status) ? kitchen : 'Уже в пути у вас')}</span></li>`;
  }).join('');
  const box = $('[data-alert]');
  const opening = box.hidden;
  box.hidden = false;
  if (!ring) return;
  alertRings = 0;
  clearInterval(alertTimer);
  alertTimer = setInterval(() => {
    if (document.hidden) return;
    if (++alertRings > ALERT_REPEATS) { clearInterval(alertTimer); alertTimer = null; return; }
    beep();
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* не везде есть */ }
  }, ALERT_REPEAT_MS);
  if (opening && !typing()) $('[data-alert-ok]').focus({ preventScroll: true });
}

function closeAlert() {
  clearInterval(alertTimer);
  alertTimer = null;
  alertIds = [];
  const box = $('[data-alert]');
  if (box) box.hidden = true;
}

// Esc — как «Понятно»
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('[data-alert]').hidden) $('[data-alert-ok]').click(); });

$('[data-alert-ok]').addEventListener('click', () => {
  const first = alertIds[0];
  closeAlert();
  setTab('orders');
  const card = document.querySelector(`.cr-ord[data-id="${first}"]`);
  if (card) {
    card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    card.querySelector('[data-next]')?.focus({ preventScroll: true });
  } else keepFocus();
});

$('[data-today-days]')?.addEventListener('click', (e) => {
  const button = e.target.closest('[data-today-back]');
  if (!button || !key) return;
  const back = Number(button.dataset.todayBack);
  if (back === todayBack) return;
  todayBack = back;
  todayStale = true;
  renderToday();
  refresh();
});

/* ---------- Автоназначение (specs/015): смена, «Назначен вам», «Не могу взять» ---------- */

/** На смене ли курьер: true / false, null — база без автоназначения (поля on_shift нет) или ещё не ответила */
const onShift = () => (board && typeof board.on_shift === 'boolean' ? board.on_shift : null);
/** Заказ назначила база сама, и курьер его ещё не забрал (board.assigned): пометка «Назначен вам» и «Не могу взять» */
function isAssigned(o) {
  if (!TO_PICK.includes(o.status) || !Array.isArray(board?.assigned)) return false;
  return board.assigned.some((id) => Number(id) === Number(o.id));
}
/**
 * Кухня своего заказа — только курьеру «обе точки» (board.branch == null): ему заказы приходят с обеих кухонь, а номера
 * дня у точек свои, и «№ 5» есть у обеих. Точку отдаёт courier_board в points ({ "<id>": "kulieva" | "kokzhar" }).
 * Курьер своей точки, старая база без points или заказ без точки — null
 */
function kitchenOf(o) {
  if (!board || board.branch != null || !board.points || typeof board.points !== 'object') return null;
  const point = board.points[o.id];
  return branchName(point) ? point : null;
}
/** Номер своего заказа: «№ 5», курьеру «обе точки» — «№ 5 · Кок-Жар» (на карточке, в карте, вопросах и строках) */
const myNo = (o) => { const point = kitchenOf(o); return `${orderNo(o)}${point ? ` · ${branchName(point)}` : ''}`; };
// Что из ответа courier_board влияет на «Мои заказы»: есть ли ответ, смена, назначенные базой, кухни своих заказов
const ordersMarks = () => (board ? `${board.on_shift}|${board.dispatch || ""}|${Array.isArray(board.assigned) ? board.assigned.join(',') : ''}|${
  board.points && typeof board.points === 'object' ? Object.entries(board.points).sort().join(';') : ''}` : '');

const NOTE_MS = 20_000;
function setOrdersNote(text, error = false) { ordersNote = text; ordersNoteError = error; ordersNoteAt = Date.now(); }
function renderNote() {
  if (ordersNote && Date.now() - ordersNoteAt > NOTE_MS) ordersNote = ''; // строка висит ~20 с, дальше уходит с опросом
  const el = $('[data-orders-note]');
  el.className = `cr-note${ordersNoteError ? ' cr-note--error' : ''}`;
  setText(el, ordersNote);
}

/**
 * Кнопка, на которой стоял фокус, исчезла вместе с карточкой или плашкой — фокус на target (по умолчанию заголовок
 * «Мои заказы»): иначе он уходит в начало страницы, и с клавиатуры или диктором место приходится искать заново
 */
function keepFocus(target = $('#orders-title')) {
  const el = document.activeElement;
  if (!el || el === document.body || !el.isConnected || el.closest('[hidden]')) target.focus({ preventScroll: true });
}

// Плашка «Смена не начата»: только когда база прямо ответила on_shift: false. Старая база (поля нет) — плашки нет
/** Заказы точки курьера назначает менеджер (specs/026): «Свободных» нет, база сама не назначает */
const byManager = () => board?.dispatch === 'manual';

function renderShift() {
  const show = Boolean(key && onShift() === false);
  $('[data-shift]').hidden = !show;
  const button = $('[data-shift-on]');
  button.disabled = shiftBusy;
  setText(button, shiftBusy ? 'Начинаем смену…' : 'Начать смену');
  setText($('[data-shift-error]'), show ? shiftError : '');
  const limit = Number(board?.limit) || 0;
  setText($('[data-shift-state]'), byManager() ? 'Вы не на линии — менеджер видит, что вы не работаете' : 'Смена не начата — заказы вам не назначаются');
  setText($('[data-shift-how]'), !show ? ''
    : byManager() ? 'Нажмите «Начать смену», когда будете у кухни и готовы везти: менеджер увидит, что вы на линии, и назначит вам заказ.'
    : `Нажмите, когда будете у кухни и готовы везти: заказы начнут назначаться вам сами${limit ? `, до ${upToOrders(limit)} на руках` : ''}.`);
  renderToggle();
}

$('[data-shift-on]').addEventListener('click', () => startShift());

async function startShift() {
  if (shiftBusy || !key || onShift() !== false) return;
  const k = key;
  shiftBusy = true;
  shiftError = '';
  renderShift();
  let started = false;
  try {
    await api.courier.shiftOn(k);
    started = true;
    // Смена началась — снова крупно «Вы на точке …» (specs/019)
    try { localStorage.removeItem(HELLO_KEY); } catch { /* приватный режим */ }
  } catch (err) {
    if (k === key) shiftError = isNetwork(err) ? 'Нет связи — нажмите ещё раз' : `Не получилось: ${err.message}`;
  } finally {
    shiftBusy = false;
  }
  if (k !== key) return;
  if (started && board) {
    // Плашку убираем сразу; ответ опроса, ушедшего до нажатия, её не вернёт — takeSeq вырос
    board = { ...board, on_shift: true };
    takeSeq++;
  }
  renderShift();
  renderMe();
  renderOrders();
  keepFocus(started ? undefined : $('[data-shift-on]')); // не вышло — фокус обратно на кнопку, чтобы нажать ещё раз
  await refresh();
}

/** «Не могу взять»: заказ уходит следующему курьеру, этому его больше не назначат (courier_decline) */
async function declineOrder(button) {
  if (busyId) return;
  const card = button.closest('[data-id]');
  const order = orders.find((o) => String(o.id) === card?.dataset.id);
  if (!order || !isAssigned(order)) return;
  const no = myNo(order); // кухня в номере — пока заказ на руках: после отказа её в points уже нет
  if (!confirm(`Не можете взять заказ ${no}?\n${order.address}\n\nОн уйдёт другому курьеру, и вам его больше не назначат. Пакет оставьте на кухне.`)) return;
  const k = key;
  busyId = order.id;
  delete cardErrors[order.id];
  setOrdersNote('');
  renderOrders();
  let declined = false;
  let lost = false; // ответ не дошёл — база могла отказ и выполнить
  try {
    await api.courier.decline(k, order.id);
    declined = true;
  } catch (err) {
    lost = isNetwork(err);
    if (k === key) cardErrors[order.id] = lost ? 'Нет связи — нажмите ещё раз' : err.message;
  } finally {
    if (busyId === order.id) busyId = null;
    takeSeq++; // ответ опроса, ушедшего до нажатия, вернул бы заказ в «Мои заказы» с кнопками
  }
  if (k !== key) return;
  if (declined) {
    // Карточка уходит сразу, не дожидаясь опроса
    orders = orders.filter((o) => o.id !== order.id);
    if (board) {
      board = { ...board, mine: Math.max(0, (Number(board.mine) || 0) - 1),
        assigned: (board.assigned || []).filter((id) => Number(id) !== Number(order.id)) };
    }
    // «Снят», а не «передан»: свободного курьера может не быть — тогда заказ ждёт в «Свободных»
    setOrdersNote(`Заказ ${no} снят с вас — база отдаст его другому курьеру`);
  }
  renderOrders();
  renderFree();
  syncWatch();
  if (declined) keepFocus();
  // refresh() отдаёт список после повторной загрузки, если шёл опрос, — проверка ниже идёт по свежим данным
  await refresh();
  if (k !== key || declined) return;
  // Отказ, а заказа в списке уже нет: строка карточки ушла бы вместе с ней — пишем над списком. Ответ не дошёл,
  // а заказ пропал — база отказ выполнила: «нажмите ещё раз» было бы неправдой, нажимать уже нечего
  if (cardErrors[order.id] && !orders.some((o) => o.id === order.id)) {
    if (lost) setOrdersNote(`Заказ ${no} снят с вас — база отдаст его другому курьеру`);
    else setOrdersNote(`${no}: ${cardErrors[order.id]}`, true);
    delete cardErrors[order.id];
    renderNote();
  }
  // Карточку перерисовали — фокус обратно на «Не могу взять» (заказ ещё ваш) или на «Мои заказы»
  keepFocus(document.querySelector(`.cr-ord[data-id="${order.id}"] [data-decline]`) || undefined);
}

const ERROR_MS = 20_000;
function setFreeError(text) { freeError = text; freeErrorAt = Date.now(); freeErrorSnap = null; }

/**
 * Отказ «Забрал — еду» висит, пока список тот же. Первый ответ после отказа — точка отсчёта: в нём уже учтено то,
 * о чём говорит отказ («уже забрал другой курьер — список обновлён»). Поменялись «у вас» или набор свободных,
 * или прошло ~20 с — строку убираем
 */
function settleFreeError() {
  if (!freeError) return;
  const snap = `${board.mine}|${board.free.map((f) => f.id).sort((a, b) => a - b).join(',')}`;
  if (freeErrorSnap === null) freeErrorSnap = snap;
  else if (snap !== freeErrorSnap || Date.now() - freeErrorAt > ERROR_MS) setFreeError('');
}

// Сигнал о новом заказе: звук (после первого касания страницы — так требуют браузеры), вибрация, заголовок, подсветка
let audio = null;
document.addEventListener('pointerdown', () => {
  if (audio) return;
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* без звука */ }
}, { passive: true });

function beep() {
  if (!audio) return;
  try {
    audio.resume?.();
    [0, 0.25, 0.5].forEach((at) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, audio.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + at + 0.18);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + at);
      osc.stop(audio.currentTime + at + 0.2);
    });
  } catch { /* без звука */ }
}

function notify(n) {
  beep();
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* не везде есть */ }
  document.title = `(${n}) Новый заказ — KOKORO`;
  setTimeout(() => { document.title = 'Курьер — KOKORO'; }, 15_000);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const stored = storage.get();
  if (stored && stored !== key) { enter(stored, key); return; } // вошли в другой вкладке — её ключ
  if (key) refresh();
});
// Вход в другой вкладке этой же страницы — сразу берём новый ключ (событие storage приходит только в другие вкладки)
window.addEventListener('storage', (e) => {
  if (e.key !== KEY_STORE || !e.newValue || e.newValue === key) return;
  enter(e.newValue, key);
});

// Опрос перерисовывает блоки каждые 15 с: одинаковое содержимое не трогаем — экранный диктор не перечитывает
// живую область (aria-live), а кнопка под пальцем не пересоздаётся
const painted = new WeakMap();
function paint(el, html) {
  if (painted.get(el) === html) return;
  painted.set(el, html);
  el.innerHTML = html;
}

/**
 * Идёт ли трансляция в Telegram: live_until в будущем ('infinity' — «Пока не выключу»). Пусто или в прошлом —
 * трансляции нет: место пришло со страницы или разовой точкой (закончившейся трансляции база ставит null)
 */
function isLive(location, now = Date.now()) {
  const until = location?.live_until;
  if (!until) return false;
  if (until === 'infinity') return true;
  const at = Date.parse(until);
  return Number.isFinite(at) && at > now;
}

function renderMe() {
  $('[data-who]').textContent = me ? me.name : '';
  const box = $('[data-tg]');
  if (!me) { box.hidden = true; return; }
  box.hidden = false;
  const how = '<p class="cr-tg__how">В чате с ботом: 📎 → <b>Геопозиция</b> → <b>Транслировать геопозицию</b> → <b>Пока не выключу</b>.</p>';
  const bot = `<a class="btn btn--small btn--ghost" href="https://t.me/${brand.courierBot}" target="_blank" rel="noopener">Открыть бота</a>`;
  // Последнее место есть (даже устаревшее) — его можно убрать «Закончить смену». С автоназначением (specs/015) кнопка
  // нужна и на смене без места: только ею курьер говорит базе «больше не назначайте»
  const off = me.location || onShift() === true ? '<button class="btn btn--small btn--ghost" type="button" data-shift-off>Закончить смену</button>' : '';
  const linkError = '<p class="cr-ord__error" data-tg-error></p>';
  // Место свежее — курьера видно, откуда бы оно ни пришло: из Telegram или с этой страницы (и у курьера без Telegram)
  if (isFresh(me.location)) {
    box.className = 'cr-tg cr-tg--ok';
    // Трансляции нет — место передаёт страница, и останавливать в Telegram нечего
    const end = isLive(me.location) ? 'В конце смены остановите трансляцию в Telegram и нажмите «Закончить смену».'
      : 'Место передаёт эта страница, пока вы везёте заказы и она открыта на экране. В конце смены нажмите «Закончить смену».';
    // Без Telegram место уже идёт со страницы — подключение ниже и по желанию
    const optional = me.tg_linked ? '' : `<p class="cr-tg__how cr-tg__opt">Необязательно: подключите Telegram — тогда вас видно, даже когда открыт 2GIS и экран погашен.</p>`;
    const link = me.tg_linked ? '' : '<button class="btn btn--small btn--ghost" type="button" data-tg-link>Подключить Telegram</button>';
    paint(box, `<p class="cr-tg__state">✓ Вас видно на карте · обновлено ${ago(me.location.at)}</p>
      <p class="cr-tg__how">${end}</p>${optional}
      <div class="cr-tg__actions">${off}${link}</div>${me.tg_linked ? '' : linkError}`);
    return;
  }
  if (!me.tg_linked) {
    box.className = 'cr-tg cr-tg--warn';
    paint(box, `<p class="cr-tg__state">Подключите Telegram — один раз</p>
      <p class="cr-tg__how">Через него менеджер и покупатель видят, где вы, даже когда открыт 2GIS и экран погашен.</p>
      <div class="cr-tg__actions"><button class="btn btn--small" type="button" data-tg-link>Подключить Telegram</button>${off}</div>
      ${linkError}`);
    return;
  }
  box.className = 'cr-tg cr-tg--warn';
  paint(box, `<p class="cr-tg__state">Вас не видно на карте${me.location ? ` · последнее место ${ago(me.location.at)}` : ''}</p>
    ${how}<div class="cr-tg__actions">${bot}${off}</div>`);
}

$('[data-tg]').addEventListener('click', async (e) => {
  if (e.target.closest('[data-tg-link]')) {
    const button = e.target.closest('[data-tg-link]');
    button.disabled = true;
    try {
      const code = await api.courier.telegramCode(key);
      // Ссылка с одноразовым кодом: бот узнает, чей это Telegram, после нажатия «Старт»
      location.href = `https://t.me/${brand.courierBot}?start=${encodeURIComponent(code)}`;
    } catch (err) {
      $('[data-tg-error]').textContent = isNetwork(err) ? 'Нет связи — нажмите ещё раз' : `Не получилось: ${err.message}`;
    } finally {
      button.disabled = false;
    }
  }
  if (e.target.closest('[data-shift-off]')) stopShift();
});

/** «Закончить смену» — из «Профиля» и переключателем «На линии» в шапке (specs/026) */
async function stopShift() {
  {
    // Заказ ещё «В пути» — предупреждаем, но закончить даём: покупатель перестанет видеть курьера на карте
    const carrying = orders.filter((o) => o.status === 'delivering');
    const warn = carrying.length ? `У вас ${carrying.length > 1 ? 'заказы' : 'заказ'} ${carrying.map(myNo).join(', ')} ещё в пути — `
      + 'сначала отметьте «Доставил», иначе покупатель перестанет видеть, где вы.\n\n' : '';
    const tg = isLive(me?.location) ? ' Остановите и трансляцию в Telegram.' : '';
    // С автоназначением (specs/015): новые заказы не назначаются, назначенные и не забранные база отдаст другим.
    // Смену снова начинает «Начать смену» или «Забрал — еду» (это база делает сама)
    const waiting = orders.filter(isAssigned);
    const auto = onShift() === null ? ''
      : byManager() ? ' Менеджер увидит, что вы не на линии.'
      : ' Новые заказы вам назначаться не будут, пока не нажмёте «Начать смену» или «Забрал — еду».'
      + (waiting.length ? ` Назначенные и не забранные (${waiting.map(myNo).join(', ')}) уйдут другим курьерам.` : '');
    if (!confirm(`${warn}Закончить смену? Ваше место перестанут видеть, и страница не будет его передавать, пока вы не возьмёте новый заказ.${auto}${tg}`)) return;
    const before = shiftEnded;
    endShift(); // отправку снимаем сразу, не дожидаясь ответа базы
    const k = key;
    try {
      await api.courier.shiftOff(k);
      // Плашка «Начать смену» — сразу, не дожидаясь опроса; ответ опроса, ушедшего до нажатия, её не уберёт
      if (k === key && onShift() !== null) {
        board = { ...board, on_shift: false };
        takeSeq++;
        renderMe();
        renderShift();
        renderOrders();
      }
      await refresh();
      // Кнопка «Закончить смену» могла пропасть вместе с местом — фокус на плашку смены (или на «Мои заказы»)
      if (k === key) keepFocus(onShift() === false ? $('[data-shift]') : undefined);
    } catch (err) {
      shiftEnded = before; // смена не закончилась — место снова передаётся
      syncWatch();
      alert(isNetwork(err) ? 'Нет связи — нажмите ещё раз' : `Не получилось: ${err.message}`);
    }
  }
}

function fullAddress(o) {
  return [o.address, o.entrance && `подъезд ${o.entrance}`, o.floor && `этаж ${o.floor}`, o.apartment && `кв. ${o.apartment}`]
    .filter(Boolean).join(', ');
}

// Оплата: чек приложен и менеджер взял заказ в работу — оплачено; «Оплачен — новый» — чек ещё не проверен
function payHtml(o) {
  const combo = money(o.total - (o.delivery_fee || 0));
  if (!o.paid) return '<p class="cr-ord__pay cr-ord__pay--warn">⚠ Оплата по QR не подтверждена — уточните у менеджера</p>';
  if (o.status === 'new') return `<p class="cr-ord__pay cr-ord__pay--warn">Чек на ${combo} получен, менеджер ещё проверяет оплату — уточните перед выездом</p>`;
  return `<p class="cr-ord__pay cr-ord__pay--ok">✓ Комбо оплачено по QR: ${combo}</p>`;
}

/** Адрес кухни точки, как в сумме доставки (delivery_quote.from) */
const kitchenLabel = (branch) => delivery.kitchens.find((k) => k.branch === branch)?.label || null;
/**
 * Суммы доставки от кухни своей точки нет (адрес не нашёлся на карте при оформлении, specs/024): у клиента курьер нажимает
 * «Посчитать доставку» — сумма по месту. Дальше 15 км (сумму называет менеджер) и доставка в оплате по QR — не про это.
 * Старая база (в заказе нет branch) — false, всё как раньше
 */
function needsPlace(o) {
  if (!o.branch || Number(o.delivery_fee) > 0) return false;
  const q = o.delivery_quote;
  return !(q && q.from === kitchenLabel(o.branch) && (Number.isFinite(q.price) || Number(q.km) > 15));
}

function orderHtml(o, stop) {
  const time = new Date(o.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek' });
  const place = needsPlace(o);
  // Сумма доставки, которую сайт назвал покупателю (supabase/delivery-price.sql); примерная или дальше 15 км — сверьте с тарифом.
  // Сумма от чужой кухни (заказ передали другой точке) — не та: считаем по месту
  const q = !place && o.delivery_quote && Number.isFinite(o.delivery_quote.km) ? o.delivery_quote : null;
  // «До двери» (specs/018): +50 сом курьеру сверх доставки — сразу итогом, чтобы не складывать в уме у двери
  const doorFee = doorFeeOf(o);
  // Дождь (supabase/rain-orders.sql): в сумме уже есть надбавка — скажем, сколько из неё за дождь
  const rain = q?.price && Number(q.rain) > 0 ? `, в том числе 🌧 ${money(Number(q.rain))} за дождь` : '';
  const km = q ? `${kmLabel(q.km)}${q.by === 'courier' ? ', по месту' : q.approx ? ', примерно — сверьте с тарифом' : ''}${rain}` : '';
  const delivery = o.delivery_fee ? (o.paid ? `Доставка ${money(o.delivery_fee)} — в сумме по QR` : `Доставка ${money(o.delivery_fee)} — уточните у менеджера`)
    : q?.price && doorFee ? `Возьмите <b>${q.approx ? 'около ' : ''}${money(q.price + doorFee)}</b>: доставка ${money(q.price)} + до двери ${money(doorFee)} (${km})`
    : q?.price ? `Возьмите за доставку <b>${q.approx ? 'около ' : ''}${money(q.price)}</b> (${km})`
    : q ? `Доставка: ${kmLabel(q.km)}${q.approx ? ', примерно' : ''} — сумму скажет менеджер`
    : place ? 'Сумма доставки не посчиталась — адрес не нашёлся на карте'
    : 'Доставку берёте с клиента — по тарифу';
  const what = doorFee && !(q?.price && !o.delivery_fee) ? `${delivery} · до двери — ещё <b>${money(doorFee)}</b>` : delivery;
  // У клиента — посчитать по месту: телефон берёт ваше место, км по дорогам от кухни и тариф (клиент видит ту же сумму)
  const counting = quoting.has(o.id);
  const placeBox = !place ? '' : o.status === 'delivering'
    ? `<p class="cr-ord__place-how">У двери клиента нажмите — сумма посчитается по месту от кухни, клиент увидит её у себя.</p>
      <button class="btn btn--block cr-ord__place" type="button" data-quote-here${counting ? ' disabled' : ''}>${counting ? 'Считаем по месту…' : '📍 Я у клиента — посчитать доставку'}</button>`
    : '<p class="cr-ord__place-how">Сумму доставки посчитаем по месту: у клиента нажмите «Я у клиента — посчитать доставку».</p>';
  // Сумму посчитали по месту, а заказ ещё в пути — нажали не там: можно пересчитать у двери
  const recount = !place && q?.by === 'courier' && o.status === 'delivering'
    ? `<button class="btn btn--ghost btn--small cr-ord__recount" type="button" data-quote-here${counting ? ' disabled' : ''}>${counting ? 'Считаем по месту…' : '📍 Пересчитать у двери клиента'}</button>` : '';
  // Готов ли пакет на кухне (отметка экрана кухни ready_at) — пока заказ принят или готовится
  const ex = extraOf(o);
  const ready = ex && TO_COOK.includes(o.status)
    ? (ex.ready_at ? '<p class="cr-ord__ready cr-ord__ready--yes">✅ Готов — можно забирать</p>' : '<p class="cr-ord__ready cr-ord__ready--no">🍳 Ещё готовят</p>') : '';
  const chat = chats ? chatButton(o) : ''; // база без 018 — кнопки чата нет
  const busy = busyId === o.id ? ' disabled' : '';
  const no = myNo(o);
  const picking = TO_PICK.includes(o.status);
  // Главное действие — свайпом вправо, как в приложениях курьеров (specs/026): случайно на ходу не нажмётся. С клавиатуры —
  // Enter. Текст кнопки — ровно «Забрал — еду» / «Доставил»: стрелка и подсказка нарисованы стилями
  const swipeButton = (status, text) => `<button class="cr-swipe cr-ord__next${status === 'done' ? ' cr-swipe--done' : ''}" type="button" data-next="${status}"
      aria-label="${esc(`${text} — заказ ${no}. Проведите вправо или нажмите Enter`)}"${busy}><span class="cr-swipe__text">${text}</span></button>`;
  const next = picking ? swipeButton('delivering', 'Забрал — еду') : o.status === 'delivering' ? swipeButton('done', 'Доставил') : '';
  const fresh = (freshUntil.get(o.id) || 0) > Date.now();
  // Назначила база сама (specs/015): пометка, подсказка и «Не могу взять» — заказ уйдёт следующему курьеру
  const auto = isAssigned(o);
  const decline = auto ? `<button class="btn btn--ghost btn--block cr-ord__decline" type="button" data-decline
      aria-label="${esc(`Не могу взять заказ ${no}`)}"${busy}>Не могу взять</button>` : '';
  // Назначил менеджер (specs/026): отказаться можно только через него — кнопка открывает чат с менеджером
  const ask = !auto && picking && byManager() && contact
    ? `<button class="cr-ord__ask" type="button" data-ask-manager>Не можете взять этот заказ? Напишите менеджеру</button>` : '';
  // Курьеру «обе точки» — какая кухня: «№ 5 · Кок-Жар» и адрес кухни в подсказке (номера дня у точек свои)
  const kitchen = kitchenOf(o);
  const pickAt = kitchen ? `на кухне <b>«${esc(branchName(kitchen))}»</b>, ${esc(branchInfo[kitchen].kitchen)},` : 'на кухне';
  // Этап: сначала кухня, потом клиент. Кухня — точка заказа (у своей точки курьер её знает, но адрес не помешает)
  const home = o.branch && branchInfo[o.branch] ? branchInfo[o.branch] : null;
  const stage = picking
    ? `<p class="cr-ord__stage"><span class="cr-ord__step">1 из 2</span>Заберите на кухне${home ? ` «${esc(home.name)}» · ${esc(home.kitchen)}` : ''}</p>`
    : o.status === 'delivering' ? '<p class="cr-ord__stage cr-ord__stage--road"><span class="cr-ord__step">2 из 2</span>Везите клиенту</p>' : '';
  const icon = (id) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  return `<article class="ord cr-ord${fresh ? ' ord--new' : ''}${auto ? ' cr-ord--auto' : ''} ${picking ? 'cr-ord--pick' : 'cr-ord--road'}" data-id="${o.id}">
    <div class="ord__head">
      ${stop ? `<span class="cr-ord__stop" title="Точка ${stop} на карте">${stop}</span>` : ''}
      <span class="ord__num">${esc(no)}</span>
      <span class="ord__time">${fresh ? '<b>Новый</b> · ' : ''}${time}</span>
      ${auto ? '<span class="badge cr-ord__auto">Назначен вам</span>' : ''}
      <span class="badge badge--${esc(o.status)}">${STATUSES[o.status] || esc(o.status)}</span>
    </div>
    ${stage}
    <p class="cr-ord__addr">${esc(fullAddress(o))}</p>
    ${doorFee ? `<p class="cr-ord__door">🚪 До двери +${money(doorFee)} — поднимитесь к квартире</p>` : ''}${ready}
    <p class="ord__what">Комбо × ${o.qty} <span>· ${what}</span></p>
    <div class="ord__info">
      <p><b>${esc(o.name)}</b> · <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></p>
      <p class="ord__muted">${esc(o.delivery_time)}</p>
      ${o.comment ? `<p class="cr-ord__comment">💬 ${esc(o.comment)}</p>` : ''}
    </div>
    ${payHtml(o)}
    <div class="ord__actions cr-ord__quick${chat ? ' cr-ord__actions--chat' : ''}">
      <a class="btn btn--ghost" href="tel:${esc(o.phone)}">${icon('phone')}Позвонить</a>
      <a class="btn btn--ghost" href="${esc(addressLink(o.address))}" target="_blank" rel="noopener">${icon('nav')}Открыть в 2GIS</a>
      ${chat}
    </div>
    ${auto ? `<p class="cr-ord__auto-how">Заберите пакет ${pickAt} и сдвиньте «Забрал — еду». Не сможете везти этот заказ — «Не могу взять».</p>` : ''}
    ${placeBox}${recount}${next}${decline}${ask}
    <p class="cr-ord__error" role="alert">${esc(cardErrors[o.id] || '')}</p>
  </article>`;
}

/* ---------- Порядок объезда и карта ---------- */

// Точка заказа: отмеченная покупателем (точно) или найденная по адресу (примерно, пунктиром)
function pointOf(o) {
  if (Number.isFinite(o.lat) && Number.isFinite(o.lon)) return { lat: o.lat, lon: o.lon, approx: false };
  const p = found.get(o.address);
  return p ? { ...p, approx: true } : null;
}

// Откуда считать: место по «Где я», если оно свежее Telegram (курьер сам нажал), иначе Telegram; «Где я» живёт 10 минут
function startPoint() {
  const tg = me?.location;
  const tgOk = isFresh(tg) && Number.isFinite(tg.lat) && Number.isFinite(tg.lon);
  const hereOk = here && Date.now() - here.at < 10 * 60_000;
  if (hereOk && (!tgOk || here.at > Date.parse(tg.at))) return { ...here, from: 'here' };
  // Место из базы: трансляция Telegram (live_until в будущем) или со страницы, пока курьер везёт заказы (specs/014)
  if (tgOk) return { lat: tg.lat, lon: tg.lon, from: isLive(tg) ? 'telegram' : 'phone' };
  return null;
}

/**
 * Маршрут: если что-то уже везёте — только по заказам «В пути» (за остальными сначала на кухню), иначе по всем.
 * stops — точки с номерами для карты, rest — заказы вне маршрута (ещё забрать или нет точки)
 */
function routePlan() {
  const start = startPoint();
  const carrying = orders.some((o) => o.status === 'delivering');
  const onRoute = carrying ? orders.filter((o) => o.status === 'delivering') : orders;
  const withPoint = onRoute.map((o) => ({ order: o, ...pointOf(o) })).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  const stops = planRoute(start, withPoint);
  const routed = [...stops.map((s) => s.order), ...onRoute.filter((o) => !pointOf(o))];
  return { start, stops, routed, carrying };
}

// Адреса без отмеченной точки ищем на карте (по одному в секунду). Не нашлось — помним; сбой сети — попробуем снова
function findMissing() {
  for (const o of orders) {
    if (Number.isFinite(o.lat) || found.has(o.address)) continue;
    found.set(o.address, null);
    geocode(o.address).then((p) => {
      if (!p) return;
      found.set(o.address, p);
      renderOrders();
    }, () => found.delete(o.address));
  }
}

let fitKey = ''; // какие точки сейчас подогнаны: масштаб трогаем, только когда они поменялись, — иначе курьер не приблизит дом
let mapError = false;

async function renderMap({ start, stops, routed, carrying }) {
  const box = $('[data-mapbox]');
  box.hidden = !orders.length;
  $('[data-map-empty]').hidden = orders.length > 0;
  if (!orders.length) return;
  // В навигатор — точка покупателя координатами; найденное по адресу — самим адресом (навигатор ищет точнее)
  const targets = routed.map((o) => { const p = pointOf(o); return p && !p.approx ? p : { address: o.address }; });
  const links = routeLinks(targets);
  $('[data-route-ya]').href = links.yandex;
  // Google Карты на телефоне берут не больше 3 промежуточных точек — больше 4 заказов ведём только в Яндекс
  $('[data-route-g]').hidden = targets.length > 4;
  $('[data-route-g]').href = links.google;
  const later = orders.filter((o) => !routed.includes(o));
  $('[data-route-title]').textContent = routed.length > 1 ? `Порядок объезда · ${routed.length} ${routed.length < 5 ? 'точки' : 'точек'}` : 'Куда ехать';
  $('[data-route-stops]').innerHTML = routed.map((o) => {
    const p = pointOf(o);
    return `<li>${myNo(o)} — ${esc(o.address)}${!p ? ' <i>(нет на карте)</i>' : p.approx ? ' <i>(примерно, по адресу)</i>' : ''}</li>`;
  }).join('') + (carrying && later.length ? `<li class="cr-route__later">Потом забрать: ${later.map(myNo).join(', ')}</li>` : '');
  const from = { here: 'были по кнопке «Где я»', telegram: 'сейчас (Telegram)', phone: 'сейчас (по телефону)' }[start?.from];
  const where = start ? `Порядок — от того места, где вы ${from}. По прямой: дороги построит навигатор.`
    : 'Где вы — неизвестно: включите трансляцию в Telegram или нажмите «Где я», и порядок посчитается от вас.';
  $('[data-route-note]').textContent = whereError || where;
  const el = $('[data-cr-map]');
  // Вкладка «Карта» скрыта — саму карту не трогаем: у скрытой нулевой размер. Нарисуем, когда курьер её откроет (setTab)
  if (tab !== 'map') return;
  try {
    // Перерисовка приходит часто (опрос, найденный адрес) — карту создаём ровно один раз
    mapReady ||= createMap(el);
    const { L, map, layer } = await mapReady;
    el.hidden = false;
    if (mapError) { mapError = false; fitKey = ''; }
    map.invalidateSize();
    layer.clearLayers();
    if (start) pin(L, start, '🛵', 'courier', 'Вы').addTo(layer);
    // Ещё не забранные (пока везёте другие) — серые, без номера: за ними потом на кухню
    for (const o of later) { const p = pointOf(o); if (p) pin(L, p, '⏳', 'muted', `Потом забрать: ${myNo(o)}, ${o.address}`).addTo(layer); }
    stops.forEach((s, i) => pin(L, s, String(i + 1), s.approx ? 'approx' : '', `${i + 1}: ${myNo(s.order)}, ${s.order.address}`).addTo(layer));
    const line = [...(start ? [start] : []), ...stops];
    if (line.length > 1) L.polyline(line.map((p) => [p.lat, p.lon]), { color: '#2B1308', weight: 3, opacity: 0.7, dashArray: '6 8' }).addTo(layer);
    const key = stops.map((s) => `${s.order.id}:${s.lat.toFixed(4)},${s.lon.toFixed(4)}`).join('|') + (start ? '|start' : '');
    if (key !== fitKey) { fitKey = key; fit(map, line); }
  } catch {
    // Карта не загрузилась (сеть) — остаются список и кнопки маршрута; со следующим обновлением пробуем снова
    mapReady = null;
    mapError = true;
    el.hidden = true;
  }
}

// Карточки — всегда в порядке назначения (как пришли из базы): порядок объезда меняется от места курьера и найденных
// адресов, и переставлять карточки под пальцем нельзя — «Забрал» нажался бы не на тот заказ. Номер точки — в кружке
function renderOrders() {
  // Курьер тянет свайп — карточку под пальцем не пересоздаём: нарисуем, когда отпустит (specs/026)
  if (swipe && Date.now() - swipe.at < SWIPE_STALE_MS) { renderLater = true; return; }
  if (swipe) endSwipe(null, true); // брошенный свайп не держит карточки вечно
  $('[data-count]').textContent = orders.length || '';
  setText($('[data-nav-count]'), String(orders.length || ''));
  findMissing();
  const plan = routePlan();
  const seq = new Map(plan.stops.map((s, i) => [s.order.id, i + 1]));
  const shift = onShift(); // null — база без автоназначения (specs/015)
  // paint: одинаковые карточки опрос не пересоздаёт — кнопка под пальцем и фокус с клавиатуры не пропадают каждые 15 с
  paint($('[data-orders]'), orders.length ? orders.map((o) => orderHtml(o, seq.get(o.id))).join('')
    : phoneGate ? '<p>Заказов нет. Впишите свой номер выше — тогда заказы начнут приходить.</p>'
    // Заказы точки назначает менеджер (specs/026): ни «Свободных», ни автоназначения
    : byManager() && shift === false ? '<p>Заказов пока нет. Нажмите «Начать смену» выше — менеджер увидит, что вы на линии, и назначит вам заказ. Он появится здесь со звуком.</p>'
    : byManager() ? '<p>Заказов пока нет. Менеджер назначит вам заказ — он появится здесь со звуком.</p>'
    : shift === true ? '<p>Заказов пока нет. Когда заказ вашей кухни пора будет везти, он назначится вам сам и появится здесь со звуком. Можно и забрать свободный заказ ниже — начните с самого старого.</p>'
    : shift === false ? '<p>Заказов пока нет. Смена не начата — заказы вам не назначаются: нажмите «Начать смену» выше. Свободный заказ ниже можно забрать и так.</p>'
    : board ? '<p>Заказов пока нет. Заберите свободный заказ ниже — начните с самого старого. Если менеджер назначит заказ сам, он появится здесь.</p>'
    : '<p>Заказов пока нет. Когда менеджер назначит вам заказ, он появится здесь сам.</p>');
  renderNote();
  renderMap(plan);
}

let whereError = '';
$('[data-where-me]').addEventListener('click', (e) => {
  const button = e.currentTarget;
  if (!navigator.geolocation) { whereError = 'Телефон не даёт определить место.'; renderOrders(); return; }
  button.disabled = true;
  navigator.geolocation.getCurrentPosition((pos) => {
    here = { lat: pos.coords.latitude, lon: pos.coords.longitude, at: Date.now() };
    whereError = '';
    button.disabled = false;
    renderOrders();
  }, () => {
    button.disabled = false;
    whereError = 'Не получилось определить место — разрешите доступ к геопозиции для этого сайта и нажмите «Где я» ещё раз.';
    renderOrders();
  }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 });
});

$('[data-orders]').addEventListener('click', (e) => {
  const button = e.target.closest('[data-decline]');
  if (button && !button.disabled) declineOrder(button);
});

/* ---------- Сумма доставки по месту (specs/024) ---------- */

const currentPosition = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) { reject(new Error('Телефон не даёт определить место')); return; }
  navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 });
});

/**
 * Суммы доставки нет (адрес не нашёлся на карте): берём место телефона у клиента, км по дорогам от кухни точки заказа
 * (сервисы маршрутов не ответили — км не шлём, база возьмёт прямую × 1,3) и сохраняем — база проверит км и посчитает по
 * тарифу (в дождь — с надбавкой). quiet — после «Доставил»: заказа на экране уже нет, ошибку не показываем
 */
async function quoteHere(order, { quiet = false } = {}) {
  if (!key || quoting.has(order.id)) return;
  const k = key;
  quoting.add(order.id);
  if (!quiet) { delete cardErrors[order.id]; renderOrders(); }
  try {
    const pos = await currentPosition();
    const at = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    if (k !== key) return;
    here = { ...at, at: Date.now() }; // и порядок объезда — от этого места
    const q = await deliveryQuote(at, () => false, order.branch).catch(() => null);
    const km = q && !q.approx && q.from === kitchenLabel(order.branch) ? q.km : null;
    const res = await api.courier.fillQuote(k, order.id, at.lat, at.lon, km);
    if (k !== key) return;
    // Опрос, ушедший до записи суммы, вернул бы заказ без неё — его ответ не применяем, спросим заново (как после «Забрал»)
    takeSeq++;
    if (res?.delivery_quote) orders = orders.map((o) => (o.id === order.id ? { ...o, delivery_quote: res.delivery_quote } : o));
    todayStale = true;
    if (quiet) refresh();
  } catch (err) {
    if (k !== key || quiet) return;
    // Ошибка геопозиции: 1 — доступ запрещён, 2 — место не определилось, 3 — долго не определялось
    cardErrors[order.id] = err?.code === 1 ? 'Разрешите этому сайту доступ к геопозиции и нажмите ещё раз'
      : err?.code === 2 || err?.code === 3 ? 'Место не определилось — выйдите на открытое место и нажмите ещё раз'
        : isNetwork(err) ? 'Нет связи — нажмите ещё раз' : err?.message || 'Не получилось — нажмите ещё раз';
  } finally {
    quoting.delete(order.id);
    if (k === key) renderOrders();
  }
}

$('[data-orders]').addEventListener('click', (e) => {
  const button = e.target.closest('[data-quote-here]');
  if (!button || button.disabled) return;
  const order = orders.find((o) => String(o.id) === button.closest('[data-id]')?.dataset.id);
  if (order) quoteHere(order);
});

$('[data-orders]').addEventListener('click', (e) => {
  const button = e.target.closest('[data-next]');
  if (!button || busyId || button.disabled) return;
  // Касание пальцем или мышью (detail ≥ 1) — не свайп: подсказываем «проведите вправо». Свайп делает своё сам (ниже);
  // щелчок сразу после свайпа не считаем. Enter и Пробел с клавиатуры (detail = 0) — сразу действие, с вопросом у «Доставил»
  if (Date.now() < swipeClickUntil) return;
  if (e.detail > 0) { hintSwipe(button); return; }
  const order = orders.find((o) => String(o.id) === button.closest('[data-id]')?.dataset.id);
  if (order) advance(order, button.dataset.next, { ask: true });
});

$('[data-orders]').addEventListener('click', (e) => {
  if (e.target.closest('[data-ask-manager]')) $('[data-staff-chat]').click();
});

/* ---------- Свайп «Забрал — еду» / «Доставил» (specs/026) ---------- */

// Ползунок тянут вправо; дотянули до конца (82% дорожки) — действие, отпустили раньше — он возвращается. Пока тянут, карточки
// не перерисовываются (опрос подождёт): иначе кнопка пропала бы из-под пальца
const SWIPE_DONE = 0.82;
const SWIPE_STALE_MS = 10_000;
let swipe = null; // { button, start, max, x, id }
let swipeClickUntil = 0;
let renderLater = false;

function hintSwipe(button) {
  button.classList.remove('is-hint');
  void button.offsetWidth; // перезапуск анимации подсказки
  button.classList.add('is-hint');
  setTimeout(() => button.classList.remove('is-hint'), 1400);
}

$('[data-orders]').addEventListener('pointerdown', (e) => {
  const button = e.target.closest('.cr-swipe');
  if (!button || button.disabled || busyId || e.button > 0) return;
  // Второй палец, пока тянут первым, — не перехватывает. Свайп, который так и не отпустили (браузер не прислал ни pointerup,
  // ни pointercancel), через 10 с считаем брошенным
  if (swipe && Date.now() - swipe.at < SWIPE_STALE_MS) return;
  if (swipe) endSwipe(null, true);
  const rect = button.getBoundingClientRect();
  const thumb = Math.min(rect.height, 64);
  swipe = { button, start: e.clientX, max: Math.max(1, rect.width - thumb - 8), x: 0, id: e.pointerId, at: Date.now() };
  try { button.setPointerCapture(e.pointerId); } catch { /* старый браузер — тянем без захвата */ }
  button.classList.add('is-drag');
});

// Движение и отпускание — на всём документе: палец мог уйти за пределы списка (захват указателя есть не везде)
document.addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  swipe.x = Math.max(0, Math.min(swipe.max, e.clientX - swipe.start));
  swipe.button.style.setProperty('--swipe-x', `${swipe.x}px`);
  swipe.button.style.setProperty('--swipe-p', String(swipe.x / swipe.max));
});

function endSwipe(e, cancel = false) {
  if (!swipe || (e && e.pointerId !== swipe.id)) return;
  const { button, x, max } = swipe;
  swipe = null;
  button.classList.remove('is-drag');
  const done = !cancel && x >= max * SWIPE_DONE;
  if (x > 8) swipeClickUntil = Date.now() + 600; // это был свайп, а не касание: щелчок после него — не подсказка
  if (done) {
    button.style.setProperty('--swipe-x', `${max}px`);
    button.style.setProperty('--swipe-p', '1');
    try { navigator.vibrate?.(30); } catch { /* не везде есть */ }
    const order = orders.find((o) => String(o.id) === button.closest('[data-id]')?.dataset.id);
    if (order && !busyId) { renderLater = false; advance(order, button.dataset.next, { ask: false }); return; }
  }
  button.style.removeProperty('--swipe-x');
  button.style.removeProperty('--swipe-p');
  if (renderLater) { renderLater = false; renderOrders(); }
}
document.addEventListener('pointerup', (e) => endSwipe(e));
document.addEventListener('pointercancel', (e) => endSwipe(e, true));
// Страница ушла в фон посреди свайпа — отпускаем ползунок, иначе карточки ждали бы отпускания вечно
document.addEventListener('visibilitychange', () => { if (document.hidden && swipe) endSwipe(null, true); });

/** «Забрал — еду» (delivering) или «Доставил» (done). ask — переспросить «доставлен?» (Enter с клавиатуры; свайп — уже подтверждение) */
async function advance(order, status, { ask }) {
  if (busyId) return;
  if (ask && status === 'done' && !confirm(`Заказ ${myNo(order)} доставлен?`)) return;
  busyId = order.id;
  delete cardErrors[order.id];
  setOrdersNote('');
  renderOrders();
  try {
    await api.courier.setStatus(key, order.id, status);
    // «Забрал — еду» после «Закончить смену» — смена снова идёт: место передаётся, а смену в базе начала сама база
    // (specs/015) — плашку «Смена не начата» уберёт ответ доски при обновлении ниже
    if (status === 'delivering') shiftEnded = null;
    if (status === 'done') todayStale = true; // «Сегодня» (specs/018) — сразу с обновлением ниже, а не через минуту
    // Суммы так и не посчитали (specs/024) — по месту «Доставил», тихо: в итог дня заказ войдёт с суммой, а не «не посчитано»
    if (status === 'done' && needsPlace(order)) quoteHere(order, { quiet: true });
  } catch (err) {
    cardErrors[order.id] = isNetwork(err) ? 'Нет связи — нажмите ещё раз' : err.message;
  } finally {
    busyId = null;
    // Ответ опроса, ушедшего до нажатия, показал бы прежний статус, а у назначенного базой — и «Не могу взять»
    takeSeq++;
  }
  renderOrders();
  await refresh();
}

/* ---------- Свободные заказы точки: курьер забирает сам (specs/014) ---------- */

// «до 1 заказа», «до 3 заказов» — после «до» нужен родительный падеж
const upToOrders = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'заказа' : 'заказов'}`;

// Номер на день у каждой точки свой (specs/013): курьеру обеих точек «№ 5» мало — дописываем точку
function freeNo(o) {
  if (!o.day_number) return 'без №';
  return `№ ${o.day_number}${board && !board.branch && o.branch ? ` · ${branchName(o.branch)}` : ''}`;
}

/**
 * «ждёт 12 мин», «ждёт 1 ч 05 мин» — от момента «пора везти» (waiting_since из базы): оплаченный ночью — с 12:00,
 * «ко времени» — за время доставки точки до назначенного часа, остальные — от оплаты
 */
function waitText(iso) {
  const min = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(min)) return '';
  if (min < 1) return 'ждёт меньше минуты';
  if (min < 60) return `ждёт ${min} мин`;
  return `ждёт ${Math.floor(min / 60)} ч ${String(min % 60).padStart(2, '0')} мин`;
}

// Оплата до взятия: только приложен ли чек и проверил ли его менеджер. Имя, телефон, квартира — после «Забрал».
// «Оплачен — новый» (чек не проверен) база в свободные больше не отдаёт — строка про проверку осталась для старой базы
function freePayHtml(o) {
  if (!o.paid) return '<p class="cr-free__pay cr-free__pay--warn">⚠ Чека нет — уточните оплату у менеджера</p>';
  if (o.status === 'new') return '<p class="cr-free__pay cr-free__pay--warn">Чек получен, менеджер ещё проверяет оплату</p>';
  return '<p class="cr-free__pay cr-free__pay--ok">✓ Оплачено по QR</p>';
}

/**
 * Можно ли забрать заказ — те же правила, что проверяет база (courier_take): на руках меньше лимита точки,
 * а без заказов на руках — сначала самый старый (first). Самый старый у каждой точки свой: курьеру обеих точек
 * доступны оба first, а подсказка называет first той же точки, что и карточка. Возвращает пояснение или ''
 */
function takeBlock(o) {
  const mine = Number(board.mine) || 0;
  if (mine >= (Number(board.limit) || 0)) return 'Предел заказов на руках — сначала доставьте свои';
  if (mine === 0 && !o.first) {
    const first = board.free.find((f) => f.first && f.branch === o.branch);
    if (!first) return 'Сначала — самый старый заказ точки';
    return `Сначала — ${freeNo(first)}: ${board.branch ? 'он' : 'на этой точке он'} ждёт дольше всех`;
  }
  return '';
}

function freeHtml(o) {
  const why = takeBlock(o);
  const taking = takingId === o.id;
  const wait = waitText(o.waiting_since);
  const long = Date.now() - Date.parse(o.waiting_since) > 30 * 60_000; // ждёт дольше получаса — время красным
  // Коротко (specs/018): «до двери» — без суммы (денег в свободных не показываем, как и суммы доставки) и готов ли пакет
  const ex = extraOf(o);
  const marks = ex ? [ex.door ? '<span class="cr-ord__door">🚪 До двери</span>' : '',
    TO_COOK.includes(o.status) ? (ex.ready_at ? '<span class="cr-ord__ready cr-ord__ready--yes">✅ Готов</span>'
      : '<span class="cr-ord__ready cr-ord__ready--no">🍳 Готовят</span>') : ''].join('') : '';
  return `<article class="cr-free__card${o.first ? ' cr-free__card--first' : ''}" data-free-id="${esc(o.id)}">
    <div class="cr-free__head">
      <span class="cr-free__num">${esc(freeNo(o))}</span>
      <span class="cr-free__wait${long ? ' cr-free__wait--long' : ''}">${wait}</span>
      <span class="badge badge--${esc(o.status)}">${STATUSES[o.status] || esc(o.status)}</span>
    </div>
    <p class="cr-free__addr">${esc(o.address)}</p>
    <p class="cr-free__meta">${esc(o.delivery_time || '')}${o.qty ? ` · Комбо × ${esc(o.qty)}` : ''}</p>
    ${marks ? `<p class="cr-free__marks">${marks}</p>` : ''}
    ${freePayHtml(o)}
    <a class="cr-free__map" href="${esc(addressLink(o.address))}" target="_blank" rel="noopener">Где это — 2GIS</a>
    <button class="btn btn--block cr-free__take" type="button" data-take${why || takingId ? ' disabled' : ''}>${taking ? 'Забираем…' : 'Забрал — еду'}</button>
    ${why ? `<p class="cr-free__why">${esc(why)}</p>` : ''}
  </article>`;
}

// Текст меняем, только если он другой: строка ошибки — role="alert", диктор зачитывает каждую запись в неё
function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

function renderFree() {
  const section = $('[data-free]');
  // Точка в режиме «назначает менеджер» (specs/026) — свободных нет и забирать самому нечего
  const show = Boolean(key && board && !byManager());
  section.hidden = !show;
  if (!show) {
    // Выход, чужой код или база без функции: адреса свободных заказов на экране не оставляем
    paint($('[data-free-list]'), '');
    setText($('[data-free-count]'), '');
    setText($('[data-free-limit]'), '');
    setText($('[data-free-error]'), '');
    return;
  }
  const free = board.free;
  const limit = Number(board.limit) || 0;
  const mine = Number(board.mine) || 0;
  // У курьера обеих точек самых старых два — по одному на точку, начать можно с любого
  const firsts = free.filter((f) => f.first);
  const full = mine >= limit;
  const tail = full ? ' — это предел. Сначала доставьте свои заказы'
    : mine === 0 && firsts.length > 1 ? `. Начните с самого старого заказа одной из точек — ${firsts.map(freeNo).join(' или ')}, к нему добирайте по пути`
    : mine === 0 && firsts.length ? `. Начните с самого старого — ${freeNo(firsts[0])}, к нему добирайте по пути`
    : free.length ? `. По пути можно добрать ещё ${limit - mine}` : '';
  const line = $('[data-free-limit]');
  line.className = `cr-free__limit${full ? ' cr-free__limit--full' : ''}`;
  setText(line, `Берёте до ${upToOrders(limit)} · у вас ${mine}${tail}`);
  setText($('[data-free-count]'), String(free.length || ''));
  setText($('[data-free-error]'), freeError);
  paint($('[data-free-list]'), free.length ? free.map(freeHtml).join('')
    : '<p>Свободных заказов нет. Новые появятся здесь сами.</p>');
}

/**
 * Место телефона в момент «Забрал — еду»: покупатель сразу видит курьера на карте. Отказ, нет геопозиции или
 * долго думает — берём заказ без точки (не дольше ~8 с: окно разрешения браузер в timeout не считает)
 */
function pointNow() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (point) => { if (!done) { done = true; resolve(point); } };
    if (!navigator.geolocation) { finish(null); return; }
    setTimeout(() => finish(null), 8_000);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => finish({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        () => finish(null),
        { enableHighAccuracy: true, timeout: 6_000, maximumAge: 60_000 });
    } catch { finish(null); }
  });
}

$('[data-free]').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-take]');
  if (!button || button.disabled || takingId || !board) return;
  const card = button.closest('[data-free-id]');
  const order = board.free.find((o) => String(o.id) === card?.dataset.freeId);
  if (!order || takeBlock(order)) return;
  if (!confirm(`Забрать заказ ${freeNo(order)}?\n${order.address}\n\nОн станет вашим и сразу «В пути» — покупатель увидит, что вы едете.`)) return;
  const k = key;
  takingId = order.id;
  setFreeError('');
  renderFree();
  const point = await pointNow();
  if (k !== key) return; // пока ждали геопозицию, курьер вышел
  try {
    await api.courier.take(k, order.id, point);
    // До обновления: заказ придёт в «Мои заказы» без звука и надписи «Новый заказ» — курьер взял его сам
    takenHere.add(order.id);
    knownIds?.add(order.id);
    shiftEnded = null; // взял заказ после «Закончить смену» — смена снова идёт (в базе её начала сама база), место передаётся
    // Карточка уходит сразу, не дожидаясь опроса. Ответ опроса, ушедшего до нажатия, её не вернёт: takeSeq ниже
    // вырастет, и load() такой ответ отбросит и спросит заново
    if (k === key && board) board = { ...board, mine: (Number(board.mine) || 0) + 1, free: board.free.filter((f) => f.id !== order.id) };
  } catch (err) {
    if (k === key) setFreeError(isNetwork(err) ? 'Нет связи — заказ мог не взяться. Список обновится сам, проверьте «Мои заказы»' : err.message);
  } finally {
    if (takingId === order.id) takingId = null;
    takeSeq++; // и при отказе: строку ошибки сверяем только с ответами, ушедшими после него
  }
  if (k !== key) return;
  renderFree();
  syncWatch();
  await refresh();
});

/* ---------- Место курьера со страницы, пока он везёт заказы (specs/014) ---------- */

const SEND_MS = 30_000; // не чаще раза в 30 с: покупателю хватает, батарея и база не страдают
let watchId = null;
let lastSent = 0;
/**
 * После «Закончить смену» — заказы, что были «В пути» в тот момент (Set), иначе null. Пока смена закончена, место
 * не передаём, даже если заказ «В пути» не закрыт. Снова передаём после «Забрал — еду» на этой странице или когда
 * в «Моих заказах» появится другой заказ «В пути» (назначил менеджер) — так же решает и база (courier_put_location).
 * Только в памяти: после перезагрузки страница может начать слать снова — база такое место отклонит, это не ошибка
 */
let shiftEnded = null;

function endShift() {
  shiftEnded = new Set(orders.filter((o) => o.status === 'delivering').map((o) => o.id));
  syncWatch();
}

// Следим за местом, только когда есть заказы «В пути», смена идёт и страница на экране; иначе наблюдение снято
function syncWatch() {
  const carrying = key ? orders.filter((o) => o.status === 'delivering') : [];
  // Новый заказ «В пути», которого не было в момент «Закончить смену», — курьер снова работает
  if (shiftEnded && carrying.some((o) => !shiftEnded.has(o.id))) shiftEnded = null;
  const need = carrying.length > 0 && !shiftEnded && !document.hidden;
  if (need && watchId === null && navigator.geolocation) {
    try {
      watchId = navigator.geolocation.watchPosition(sendPlace, () => { /* отказ — молча: остаются Telegram и «Где я» */ },
        { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 });
    } catch { watchId = null; }
  } else if (!need && watchId !== null) {
    try { navigator.geolocation.clearWatch(watchId); } catch { /* уже снято */ }
    watchId = null;
  }
}

function sendPlace(pos) {
  const k = key;
  if (!k || shiftEnded || Date.now() - lastSent < SEND_MS) return;
  lastSent = Date.now(); // и при сбое: следующая попытка — через 30 с, а не на каждое движение
  const point = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
  // Ответ false — база место не взяла (смена закончена, не чаще 15 с, вне Бишкека): это не ошибка, молчим
  Promise.resolve().then(() => api.courier.putLocation(k, point))
    .catch(() => { /* нет связи или база без функции — место передаст следующая попытка или Telegram */ });
}

document.addEventListener('visibilitychange', syncWatch);

/* ---------- Новая версия страницы (11.11.2026) ---------- */

// После выкладки страница курьера обновляется сама: иначе новое (точка, опрос «На какой точке вы работаете?») курьер увидит,
// только когда сам перезагрузит страницу. Раз в 3 минуты спрашиваем у сайта метку courier.js (ETag); изменилась —
// перезагружаемся, когда курьер ничего не набирает: страница скрыта или минуту её не трогали. Вход хранится на телефоне
const VERSION_URL = '/assets/js/courier.js';
let versionSeen = null;
let newVersion = false;
let touchedAt = Date.now();
['pointerdown', 'keydown'].forEach((type) => document.addEventListener(type, () => { touchedAt = Date.now(); }, { passive: true }));
const typing = () => Boolean(document.activeElement?.matches?.('input, textarea, select'));
function reloadIfIdle() {
  if (!newVersion || typing()) return;
  if (document.hidden || Date.now() - touchedAt > 60_000) location.reload();
}
async function checkVersion() {
  try {
    const res = await fetch(VERSION_URL, { method: 'HEAD', cache: 'no-store' });
    // Сжатый ответ — W/"…", несжатый — "…": версия та же. Сравниваем без W/, иначе страница перезагружалась бы зря
    const raw = res.ok ? res.headers.get('etag') || '' : '';
    const tag = raw.startsWith('W/') ? raw.slice(2) : raw;
    if (!tag) return;
    if (versionSeen === null) versionSeen = tag;
    else if (tag !== versionSeen) newVersion = true;
  } catch { /* нет связи — проверим в следующий раз */ }
  reloadIfIdle();
}
checkVersion();
setInterval(checkVersion, 3 * 60_000);
document.addEventListener('visibilitychange', reloadIfIdle);

/* ---------- Старт ---------- */

const fromLink = codeFromLink();
const saved = storage.get();
if (fromLink) enter(fromLink, saved);
else if (saved) enter(saved);
else showLogin();

// Новая ссылка от менеджера, открытая поверх уже открытой страницы, меняет только часть после # — без перезагрузки
window.addEventListener('hashchange', () => {
  const code = codeFromLink();
  if (code && code !== key) enter(code, key);
});
