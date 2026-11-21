// Страница заказа: 1) доставка или самовывоз → 2) оплата по QR и чек → экран заказа (specs/018: кольцо обратного отсчёта,
// шкала, чат, детали, оценка). Оболочка мини-приложения (шапка, шторки, «Мои заказы») — app.js; связь — события kokoro:*
// на window (specs/018-mini-app-v1/workers.md). Всё, что видит покупатель, — через tx() (i18n.js): русские строки не меняются
import { api } from './api.js';
import { brand, BRANCHES, branchAt, branchInfo, branchPhone, branchKitchen, branchName, combo, delivery, deliveryAt, deliveryOpen, deliveryStart, door, hours, kmLabel, legal, maxKm, money, ordersLabel, payment, peak, peakNow, READY_STEP, timeInHours, TRACK, TRACK_PICKUP, wait, waitLabel } from './data.js';
import { addressLink, pointLink, ago, inZone, distanceKm } from './maps.js';
import { createMap, geocode, pin, fit, suggestAddresses, reverseAddress, deliveryQuote, roadMinutes, DETOUR } from './map.js';
import { tx, lang, onLang, applyI18n, waitLabelKy, ordersLabelKy, agoKy, WEEKDAYS } from './i18n.js';
import { addresses, history as orderHistory } from './history.js';
import { openChat, hasUnread, chime } from './chat.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
/** Событие для оболочки (app.js): на window, данные — в detail */
const emit = (name, detail = {}) => window.dispatchEvent(new CustomEvent(name, { detail }));
// Слова с числами — на языке покупателя: «1,5 часа» / «1,5 саат», «2 заказа» / «2 буйрутма», «3 мин назад» / «3 мүн мурун»
const waitWords = (minutes) => (lang() === 'ky' ? waitLabelKy(minutes) : waitLabel(minutes));
const ordersWords = (n) => (lang() === 'ky' ? ordersLabelKy(n) : ordersLabel(n));
const agoWords = (iso) => (lang() === 'ky' ? agoKy(iso) : ago(iso));
/** Сумма с неразрывным пробелом перед «сом»: на узком экране не отрывается от числа */
const moneyTight = (n) => money(n).replace(/ (?=сом$)/, ' ');
const form = $('[data-order-form]');
const MAX_QTY = 20;
// Столько же принимает хранилище чеков (supabase/harden.sql, file_size_limit) — больше браузер не пропустит
const MAX_RECEIPT = 5 * 1024 * 1024;
const CONTACT_KEY = 'kokoro.contact';
const PENDING_KEY = 'kokoro.pending';
const TRACK_KEY = 'kokoro.track'; // оплаченный заказ, статус которого показываем покупателю
const TRACK_HOURS = 12;
const REMEMBERED = ['name', 'phone', 'address', 'entrance', 'floor', 'apartment'];
// Самовывоз: что показать на кнопке-чипе в шапке и в «Откуда заберёте» (ориентир рядом с кухней)
const PICKUP_PLACE = { kulieva: 'Ош базар', kokzhar: 'ул. Кок-Жайык, 120а' };

let qty = 1;
let price = combo.price;
let deliveryFee = null; // null — сумма доставки неизвестна (база не ответила)
let accepting = true; // общий приём заказов (панель → «Настройки»)
let waitMinutes = wait.minutes; // время ожидания доставки — менеджер ставит в панели
let waitKnown = false; // база ответила, waitMinutes — из панели, а не запасное
// Приём и время доставки по точкам (specs/013): { kulieva: { accepting_orders, wait_minutes }, kokzhar: {…} };
// null — точек в базе ещё нет (или не прочитались): работаем по общим accepting и waitMinutes, как раньше
let branches = null;
let settings = null;
let pending = null; // { number, total, token, phone, branch } — заказ, который ждёт оплаты
let currentStep = 'form'; // 'form' | 'pay' | 'done'
let trackShown = false; // шкала статуса оплаченного заказа заполнена и её можно показывать
let receipt = null; // Blob чека, готовый к отправке
let receiptName = ''; // имя файла чека — в подписи поля
let quote = null; // сумма доставки до адреса покупателя — см. refreshQuote
let quoteBy = ''; // по чему посчитана: 'point' — по точке на карте, 'address' — по тексту адреса (примерно)
let quoteAt = null; // { lat, lon } — где нашли адрес без точки на карте: по нему же точка заказа (Кулиева или Кок-Жар)
let quoteBusy = false; // считаем прямо сейчас
// Адрес без точки на карте уже искали: нашли или нет (не нашли, сервис адресов не ответил) — точка заказа по нему известна
// или так и не определилась. Сбрасывается с каждой сменой адреса и точки (refreshQuote)
let addrTried = false;
let markAsked = false; // при оформлении попросили отметить дом на карте (точка не определилась) — плашка видна до смены адреса
let submitting = false; // заказ оформляется: кнопка занята, пока не придёт ответ (досчитанная сумма её не освобождает)

const storage = {
  get(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
  set(key, value) { try { value ? localStorage.setItem(key, JSON.stringify(value)) : localStorage.removeItem(key); } catch { /* приватный режим */ } },
};

// Заказ по ссылке ?z=, открытой там, где уже отслеживается свой недавний заказ: показываем его только на этой
// странице, свой не трогаем (старая или чужая ссылка не должна стереть сегодняшний заказ). Иначе — kokoro.track
let linkTrack = null;
const getTrack = () => linkTrack || storage.get(TRACK_KEY);
const setTrack = (value) => { if (linkTrack) linkTrack = value; else storage.set(TRACK_KEY, value); };
// «Ко времени: 18:30» → «18:30» (и «Ко времени: 18:30, 12.11» — тоже «18:30»: день — отдельно, deliveryAt)
const whenOf = (deliveryTime) => /Ко времени:\s*(\d{1,2}:\d{2})/.exec(deliveryTime || '')?.[1] || '';

$('[data-combo-list]').innerHTML = combo.items
  .map((i) => `<li><b>${i.count}</b><span>${i.title}</span></li>`)
  .join('');

// Доставка — в форме и на шаге оплаты: платится курьеру, в сумму по QR не входит. Расценки по расстоянию покупателю
// не показываем (владелец, 09.11.2026): только итоговая сумма до его адреса, которую сайт считает сам (tariff__quote).
// Тариф — в data.js (delivery), его видят панель и курьер
const tariffHtml = `<p class="tariff__title"></p>
  <p class="tariff__quote" data-quote aria-live="polite"></p>`;
document.querySelectorAll('[data-tariff]').forEach((el) => { el.innerHTML = tariffHtml; });
const renderTariffTitles = () => $$('.tariff__title').forEach((el) => { el.textContent = tx('Доставка — курьеру при получении'); });
renderTariffTitles();

// Сумма доставки, которую посчитал сайт: { km, price, from, approx, branch } — от кухни точки покупателя (map.js → deliveryQuote).
// price: null — дальше 15 км, сумму называет менеджер. approx — примерно: по адресу без точки или по прямой
const deliverySum = (q) => (q?.price ? (q.approx ? tx('около {sum}', { sum: money(q.price) }) : money(q.price)) : tx('сумму назовёт менеджер'));
const QUOTE_EMPTY = 'Сумму доставки посчитаем, когда укажете адрес.';

/** Строка с суммой доставки; суммы ещё нет — подсказка, что её посчитаем по адресу */
function showQuote(box, text) {
  const line = box.querySelector('[data-quote]');
  // На узком экране «ул.», «сом» и «км» не отрываются от своих слов и чисел
  // (\b в JS — только для латиницы, поэтому границы слов — через \p{L})
  line.textContent = (text || tx(QUOTE_EMPTY)).replace(/ (?=(сом|км)(?!\p{L}))/gu, ' ').replace(/(^|[^\p{L}])ул\. /gu, '$1ул. ');
}
$('[data-done-contact]').textContent = tx(payment.doneContact);

/* Две точки (specs/013): город делится по ул. Абдрахманова (бывшей Советской) — запад возит Кулиева, восток Кок-Жар.
   Точка заказа — по точке на карте, без неё — по найденному адресу; у каждой точки свои приём заказов и время доставки */

/** Точка заказа с доставкой: 'kulieva' | 'kokzhar' | null — не определилась (адреса ещё нет, не нашли, за концами линии) */
function orderBranch() {
  if (point) return branchAt(point.lat, point.lon);
  return quoteAt ? branchAt(quoteAt.lat, quoteAt.lon) : null;
}
/* Самовывоз (specs/018): заказ забирают на кухне выбранной точки — адрес, точка на карте, квартира и сумма доставки не нужны */
const isPickup = () => form.elements.fulfillment.value === 'pickup';
/** Точка самовывоза: 'kulieva' | 'kokzhar' | null — ещё не выбрали */
const pickupBranch = () => (BRANCHES.includes(form.elements.pickup_branch.value) ? form.elements.pickup_branch.value : null);
/** Точка, по которой судим о приёме и времени: самовывоз — выбранная кухня, доставка — точка адреса */
const modeBranch = () => (isPickup() ? pickupBranch() : orderBranch());
/** Какие точки сейчас принимают заказы; строки точки нет — её не останавливали. Точек в базе нет — null */
const openBranches = () => (branches ? BRANCHES.filter((x) => branches[x]?.accepting_orders !== false) : null);
/**
 * Принимаем ли заказ точки b: общий приём и приём этой точки. Точка неизвестна — открыта хоть одна (сама отправка ещё
 * проверяет onlyOpen). Точек в базе нет (branches null: two-points.sql не запущен или точки не прочитались) — только общий
 * приём, как раньше. Общий приём с запуском двух точек всегда включён, но выключит его владелец — закрыто для всех
 */
function acceptingFor(b) {
  if (!accepting || !branches) return accepting;
  return b ? branches[b]?.accepting_orders !== false : openBranches().length > 0;
}
/**
 * Точка заказа не определилась, а принимает только одна: без точки база отдала бы заказ ей, хотя дом может быть на стороне
 * закрытой. Такой заказ не отправляем — просим отметить дом на карте. Возвращает ту, что принимает, иначе null
 */
function onlyOpen() {
  if (!accepting || !branches) return null;
  const open = openBranches();
  return open.length === 1 ? open[0] : null;
}
/**
 * Время доставки из панели; null — база ещё не ответила. Точки в базе есть — только их время (общее order_settings.wait_minutes
 * с запуском двух точек никто не ведёт): своей точки, а точка не определилась — наибольшее из принимающих. Точек нет — общее
 */
function knownWait(b) {
  if (!branches) return waitKnown ? waitMinutes : null;
  const own = branchWait(b);
  if (own) return own;
  const open = openBranches();
  const all = (open.length ? open : BRANCHES).map(branchWait).filter(Boolean);
  return all.length ? Math.max(...all) : null;
}
/** Время доставки точки b из панели; null — неизвестно (точки нет, настройки точек не прочитались) */
function branchWait(b) {
  const minutes = Number(b && branches?.[b]?.wait_minutes);
  return minutes > 0 ? minutes : null;
}
const waitFor = (b) => knownWait(b) ?? (branches ? wait.minutes : waitMinutes);
// Номера за день у каждой точки свои (с № 1) — рядом с номером пишем точку: «№ 5 · Кулиева»; точки нет — просто «№ 5»
const orderNo = (number, branch) => `№ ${number}${branchName(branch) ? ` · ${tx(branchName(branch))}` : ''}`;
/** Номер на экране «Заказ принят»: крупно номер, точка — помельче, не отрываясь от номера на узком экране */
function renderNo(el, number, branch) {
  el.textContent = `№ ${number}`;
  if (!branchName(branch)) return;
  const name = document.createElement('span');
  name.className = 'done__branch';
  name.textContent = `· ${tx(branchName(branch))}`;
  el.append(' ', name);
}

// «Заказ принят»: заказали «Ко времени» — это время; иначе час, к которому привезём: время оплаты плюс время
// доставки своей точки из панели на тот момент. Час, а не «через 2 часа» — вернувшись на сайт позже, покупатель видит то же.
// Время при оплате не известно (база не ответила, заказ из прошлой версии сайта) — берём нынешнее из панели
const clock = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit' });
// Оплачен ночью или утром, вне часов доставки (data.js → hours): везём после 12:00, точный час и «20 минут» не обещаем
const paidAt = (t) => Number(t.at) || Date.now();
const paidLater = (t) => deliveryStart(paidAt(t)) > paidAt(t);
/* День «ко времени» (specs/018): сегодня или завтра. Дата доставки по Бишкеку; «00:00» — полночь в конце дня, поэтому день
   считаем по минуте раньше. Сегодня — без подписи (как раньше: «к 18:30»), завтра — «18:30, завтра, пт 12.11» */
const BISHKEK_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;
const bishkekDay = (ms) => Math.floor((ms + BISHKEK_MS) / DAY_MS); // номер суток по Бишкеку
const dayFormat = (ms) => {
  const d = new Date(ms - 1 + BISHKEK_MS); // поля UTC = местное время Бишкека
  return `${WEEKDAYS[lang()][d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
/** Подпись дня доставки: '' — сегодня; «завтра, пт 12.11»; другой день — «пт 12.11» */
function dayWords(ms) {
  const diff = bishkekDay(ms - 1) - bishkekDay(Date.now());
  if (diff === 0) return '';
  return diff === 1 ? `${tx('завтра')}, ${dayFormat(ms)}` : dayFormat(ms);
}
/** «18:30» или «18:30, завтра, пт 12.11» — час, который назвал покупатель */
const whenLabel = (t) => (Number.isFinite(t.whenAt) && dayWords(t.whenAt) ? `${t.when}, ${dayWords(t.whenAt)}` : t.when);
// Самовывоз — те же строки своими словами (data.js → payment.pickup*): заказ не везём, а готовим к выдаче на кухне точки
const doneTime = (t) => {
  const pickup = fulfillmentOf(t) === 'pickup';
  if (t.when) return tx(pickup ? payment.pickupDoneTimeExact : payment.doneTimeExact, { time: whenLabel(t) });
  if (paidLater(t)) return tx(pickup ? payment.pickupDoneTimeLater : payment.doneTimeLater);
  const minutes = Number(t.wait) > 0 ? Number(t.wait) : waitFor(t.branch);
  // Оплачен в час пик (18:00–21:00) — «примерно к …» не обещаем: ожидание может составить 2–2,5 часа
  if (peakNow(paidAt(t))) return tx(peak.note);
  return tx(pickup ? payment.pickupDoneTime : payment.doneTime, { at: clock.format(new Date(paidAt(t) + minutes * 60_000)) });
};
const doneContact = (t) => tx(paidLater(t) ? payment.doneContactLater : payment.doneContact);
// Под кнопкой заказа: в часы доставки — через сколько привезём (точка адреса известна — её время), ночью и утром — когда
// начнём возить. На шаге оплаты ночью и утром — то же до оплаты: оформил в 23:50, платит в 00:05 — узнаёт про 12:00 до оплаты.
// Самовывоз — через сколько приготовим на выбранной кухне
function waitHint() {
  if (!deliveryOpen(Date.now())) return tx(isPickup() ? payment.pickupFormWaitLater : payment.formWaitLater);
  if (peakNow(Date.now())) return tx(peak.note); // час пик 18:00–21:00 — вместо обычного времени точки
  const words = waitWords(waitFor(modeBranch()));
  return tx(isPickup() ? payment.pickupWait : payment.formWait, { wait: words });
}
function renderHours() {
  $('[data-wait-hint]').textContent = waitHint();
  // «Побыстрее ≈ 1,5 часа» на кнопке-сегменте; ночью — «с 12:00»
  $('[data-when-wait]').textContent = !deliveryOpen(Date.now()) ? tx('с {time}', { time: hours.start })
    : peakNow(Date.now()) ? `≈ ${tx(peak.label)}` : `≈ ${waitWords(waitFor(modeBranch()))}`;
  const later = $('[data-pay-hours]');
  later.hidden = deliveryOpen(Date.now());
  later.textContent = later.hidden ? '' : tx(pending?.fulfillment === 'pickup' ? payment.pickupPayLater : payment.payLater);
}
// Страница открыта в 12:00 или в полночь — строки меняются сами
setInterval(renderHours, 60_000);

/* ---------- Шаг 1: доставка ---------- */

/** «До двери» отмечено (и доступно: только при доставке и указанной квартире) */
const doorOn = () => !isPickup() && form.elements.door.checked && !form.elements.door.disabled;

/**
 * Суммы заказа (specs/018): по QR — комбо (и доставка, если в панели она не 0); курьеру — доставка, которую посчитал сайт, и
 * «до двери». known — сумма доставки известна (самовывоз — доставки нет); approx — примерная (по адресу без точки или по прямой)
 */
function sums() {
  const items = qty * price;
  const pickup = isPickup();
  const fee = pickup ? 0 : deliveryFee || 0; // самовывоз — доставки нет и в сумме по QR (база обнулит delivery_fee)
  const doorFee = doorOn() ? door.fee : 0;
  const road = !pickup && !fee && quote?.price ? quote.price : 0;
  return { items, qr: items + fee, doorFee, road, courier: road + doorFee, all: items + fee + road + doorFee,
    known: pickup || fee > 0 || road > 0, approx: road > 0 && Boolean(quote.approx) };
}

function render() {
  const s = sums();
  const total = s.qr;
  const pickup = isPickup();
  // Счётчиков на странице несколько (меню, шторка товара, форма) — все показывают одно число
  $$('[data-qty-value]').forEach((el) => { el.textContent = qty; });
  $$('[data-qty="-1"]').forEach((b) => { b.disabled = qty <= 1; });
  $$('[data-qty="1"]').forEach((b) => { b.disabled = qty >= MAX_QTY; });
  $('[data-price]').textContent = price;
  $('[data-step-mode]').textContent = tx(pickup ? 'Самовывоз' : 'Доставка');
  $('[data-sum-qty]').textContent = qty;
  $('[data-sum-items]').textContent = money(s.items);
  // 0 в панели — доставка курьеру: сумма, которую посчитал сайт, или «курьеру при получении»; больше 0 — эта сумма входит в оплату по QR
  $('[data-sum-delivery]').textContent = deliveryFee ? money(deliveryFee) : quoteBusy ? tx('считаем…')
    : quote?.price ? tx('{sum} курьеру', { sum: `${quote.approx ? '≈ ' : ''}${money(quote.price)}` }) : quote ? tx('назовёт менеджер') : tx('курьеру при получении');
  $('[data-sum-delivery-row]').hidden = pickup;
  $('[data-sum-door]').hidden = !s.doorFee;
  $('[data-sum-door-value]').textContent = tx('{sum} курьеру', { sum: money(door.fee) });
  // Итого: всё вместе; доставка примерная — «≈», суммы доставки ещё нет — «1 400 сом + доставка»
  $('[data-sum-all]').textContent = s.known ? `${s.approx ? '≈ ' : ''}${money(s.all)}` : tx('{sum} + доставка', { sum: money(s.all) });
  // Два платежа (13.11.2026): 1 — по QR (комбо, и доставка, если в панели она не 0), 2 — курьеру при получении. Курьеру —
  // при любой доставке, даже пока сумма не посчитана (самовывоз и доставка в сумме по QR без «до двери» — строки нет)
  $('[data-sum-qr-what]').textContent = tx(!pickup && deliveryFee ? 'за комбо и доставку — сейчас' : 'за комбо — сейчас');
  const courierRow = !pickup && !(deliveryFee && !s.doorFee);
  $('[data-sum-courier]').hidden = !courierRow;
  $('[data-sum-note]').hidden = !courierRow || Boolean(deliveryFee);
  $('[data-sum-courier-value]').textContent = s.road ? `${s.approx ? '≈ ' : ''}${money(s.courier)}`
    : deliveryFee ? money(s.doorFee)
      : s.doorFee ? tx('{sum} + доставка', { sum: money(s.doorFee) })
        : quoteBusy ? tx('считаем…') : quote ? tx('назовёт менеджер') : tx('посчитаем по адресу');
  // Суммы ещё нет — подпись обычным шрифтом, а не крупными цифрами
  $('[data-sum-courier-value]').classList.toggle('is-text', !s.road && !deliveryFee && !s.doorFee);
  // Блок доставки в форме; на шаге оплаты его прячет fillPayment (самовывоз, доставка в сумме по QR)
  form.querySelector('[data-tariff]').hidden = Boolean(deliveryFee) || pickup;
  showQuote(form.querySelector('[data-tariff]'), quoteText());
  $('[data-sum-total]').textContent = money(total);
  emit('kokoro:cart', { qty, price, itemsTotal: s.items });
  // Неразрывный пробел: на узком экране «сом» не уезжает на вторую строку кнопки. Пока заказ оформляется —
  // «Секунду…» и кнопка занята: иначе досчитанная сумма доставки освободила бы её, и второе нажатие дало бы второй заказ
  if (!submitting) $('[data-submit]').textContent = `${tx('Перейти к оплате')} · ${moneyTight(total)}`;
  // Приём — у точки адреса (пересчитываем при каждой смене точки и адреса); точка ещё неизвестна — открыт, если работает хоть одна.
  // Самовывоз — у выбранной кухни (закрытую выбрать нельзя — renderPickup); плашки двух точек — только о доставке
  renderPickup();
  const branch = modeBranch();
  const open = acceptingFor(branch);
  const openAnywhere = acceptingFor(null);
  $('[data-submit]').disabled = !open || submitting;
  // Приём закрыт совсем — «сейчас привозим» и «принимаем круглосуточно» не обещаем, над формой — «не принимаем»
  $('[data-hours-open]').hidden = !openAnywhere;
  $('[data-hours-closed]').hidden = openAnywhere;
  $('[data-closed]').hidden = openAnywhere;
  $('[data-closed]').textContent = openAnywhere ? '' : tx(payment.closedMessage);
  const text = pickup ? '' : plaqueText(branch, open, openAnywhere);
  $('[data-wait-hint]').hidden = !open || Boolean(text);
  setPlaque(text);
  renderHours();
  emitMode();
}

/* Плашка над кнопкой заказа (две точки, specs/013): закрыта точка адреса, а другая работает, — какая и что делать
   (кнопка тогда неактивна); точка не определилась, а принимает одна, — отметить дом на карте */
const plaque = $('[data-branch-closed]');

/** Текст плашки; '' — плашки нет */
function plaqueText(branch, open, openAnywhere) {
  if (!openAnywhere) return ''; // не принимает никто — общее «не принимаем» над формой
  if (branch && !open) {
    const text = tx(payment.branchClosedMessage, { name: tx(branchName(branch)) });
    // Сторону города определили по найденному адресу, без точки на карте, — адрес мог найтись не тот
    return point ? text : `${text} ${tx(payment.branchClosedApprox)}`;
  }
  // Точку искали и не нашли (или уже пробовали оформить) — просим отметить дом; пока адрес ищется — ничего не говорим
  const only = branch ? null : onlyOpen();
  return only && (addrTried || markAsked) ? tx(payment.branchUnknownMessage, { name: tx(branchName(only)) }) : '';
}

/**
 * Текст плашки с живыми фразами: «напишите нам» — ссылка на WhatsApp KOKORO, «отметьте дом на карте» — кнопка, открывающая
 * карту (регистр фразы — как в тексте). Нет фразы в тексте (переписали в data.js) — просто текст. На кыргызском фразы ищем
 * в переводе (tx('напишите нам')) — ссылка и кнопка работают на обоих языках
 */
const LIVE = [
  { phrase: 'напишите нам', make(text) {
    if (!brand.phone) return null;
    const a = document.createElement('a');
    a.href = `https://wa.me/${brand.phone}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = text;
    return a;
  } },
  { phrase: 'отметьте дом на карте', make(text) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'linkbtn';
    b.dataset.markHome = '';
    b.textContent = text;
    return b;
  } },
];
function fillLive(el, text) {
  el.textContent = '';
  let rest = text;
  while (rest) {
    const low = rest.toLowerCase();
    const next = LIVE.map((l) => ({ l, phrase: tx(l.phrase).toLowerCase() })).map((x) => ({ ...x, i: x.phrase ? low.indexOf(x.phrase) : -1 }))
      .filter((x) => x.i >= 0).sort((a, b) => a.i - b.i)[0];
    if (!next) { el.append(rest); return; }
    const end = next.i + next.phrase.length;
    const piece = rest.slice(next.i, end);
    el.append(rest.slice(0, next.i), next.l.make(piece) || piece);
    rest = rest.slice(end);
  }
}

/** Показать текст в плашке. Тот же текст не перерисовываем: экранный диктор (role="alert") не перечитывает его, фокус не теряется */
function setPlaque(text) {
  plaque.hidden = !text;
  if (plaque.dataset.text === text) return;
  plaque.dataset.text = text;
  fillLive(plaque, text);
}

/** Отказ при оформлении — не молча: плашка посреди экрана (на телефоне она могла быть за краем) и в фокусе; mark — фокус на «отметьте дом» */
function revealPlaque(mark) {
  if (plaque.hidden) return;
  plaque.scrollIntoView({ block: 'center' });
  ((mark && plaque.querySelector('[data-mark-home]')) || plaque).focus({ preventScroll: true });
}

/** «Отметьте дом на карте» в плашке: открыть карту точки доставки, прокрутить к ней и поставить фокус на карту (стрелки её двигают) */
async function markOnMap() {
  if ($('[data-point-box]').hidden) $('[data-point-open]').click();
  $('[data-point]').scrollIntoView({ block: 'start' });
  const view = await pointView();
  (view ? view.map.getContainer() : $('[data-point-open]')).focus({ preventScroll: true });
}
plaque.addEventListener('click', (e) => { if (e.target.closest('[data-mark-home]')) markOnMap(); });

// Все счётчики «− 1 +» на странице (меню, шторка товара, форма; и те, что оболочка дорисует позже) — одно количество
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-qty]');
  if (!b || b.disabled) return;
  qty = Math.min(MAX_QTY, Math.max(1, qty + Number(b.dataset.qty)));
  render();
});

/* ---------- Когда: «Побыстрее» или «Ко времени» на сегодня или завтра ---------- */

// Кнопки-сегмент управляют списком when (его значение читают форма и проверки). «Ко времени» — день: по умолчанию сегодня,
// а если сегодня до 00:00 ничего не осталось (нужно хотя бы 30 минут) — завтра
// База принимает «ко времени» не раньше чем через 30 минут; сайт просит 35 — запас на оформление и оплату
const TIME_LEAD_MS = 35 * 60_000;
/** Сегодня ещё можно «ко времени»: хотя бы до 00:00 (конец доставки) осталось 35 минут */
const todayLeft = () => Date.now() + TIME_LEAD_MS <= timedAt('today', '00:00');
function renderWhen() {
  const timed = form.elements.when.value === 'time';
  $$('[data-when-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.whenPick === form.elements.when.value)));
  $('[data-time-field]').hidden = !timed;
  $('[data-day-field]').hidden = !timed;
}
$('[data-when]').addEventListener('change', (e) => {
  if (e.target.value === 'time' && !form.elements.time.value && !todayLeft()) form.elements.day.value = 'tomorrow';
  renderWhen();
});
$$('[data-when-pick]').forEach((b) => b.addEventListener('click', () => {
  if (form.elements.when.value === b.dataset.whenPick) return;
  form.elements.when.value = b.dataset.whenPick;
  form.elements.when.dispatchEvent(new Event('change', { bubbles: true }));
  if (b.dataset.whenPick === 'time') form.elements.time.focus();
}));
form.elements.day.addEventListener('change', () => { errorBox.textContent = ''; });

/**
 * Назначенный час «ко времени» в мс: day — 'today' | 'tomorrow', hhmm — «18:30». «00:00» — полночь в конце выбранного дня.
 * null — время не прочитать
 */
function timedAt(day, hhmm) {
  const [, h, m] = /^(\d{1,2}):(\d{2})/.exec(String(hhmm)) || [];
  if (h === undefined) return null;
  const minutes = Number(h) * 60 + Number(m);
  const date = (bishkekDay(Date.now()) + (day === 'tomorrow' ? 1 : 0)) * DAY_MS - BISHKEK_MS; // полночь начала дня по Бишкеку
  return date + (minutes === 0 ? DAY_MS : minutes * 60_000);
}

// Постоянным клиентам не нужно вводить контакты заново
const savedContact = storage.get(CONTACT_KEY) || {};
for (const k of REMEMBERED) if (savedContact[k]) form.elements[k].value = savedContact[k];
// Прошлый раз забирал сам — снова самовывоз с той же кухни (сменить — одно нажатие)
if (savedContact.fulfillment === 'pickup') form.elements.fulfillment.value = 'pickup';
if (BRANCHES.includes(savedContact.pickup)) form.elements.pickup_branch.value = savedContact.pickup;

/* ---------- Адрес с подсказками и точка доставки на карте ---------- */

const addrInput = form.elements.address;
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Откуда текст адреса: saved — из прошлого заказа, typed — набрал сам, suggest — выбрал дом из подсказок,
// street — выбрал улицу и ещё не дописал номер, map — подставлен по точке.
// По точке на карте адрес подставляем сами, только если поле пустое или адрес и так пришёл от нас — набранное руками не трогаем
let addrSource = addrInput.value ? 'saved' : 'empty';
let addrEdit = 0; // растёт, когда покупатель сам меняет адрес (набор, выбор подсказки): поздний адрес по точке его не перетирает
/**
 * Адрес — тот же дом, что start: совпадает начало, а дальше не продолжение номера.
 * «155, подъезд 2», «155 кв 5» — тот же; «1555», «155а», «155/1», «155 А», «155 к2», «155 корп. 2» — другой
 */
const sameStart = (text, start) => {
  const t = String(text).trim().toLowerCase();
  const s = String(start || '').trim().toLowerCase();
  if (!s) return true;
  const rest = t.slice(s.length);
  return t.startsWith(s) && !/^[\p{L}\p{N}/-]/u.test(rest) && !/^\s*(\p{L}(?!\p{L})|(к|корп|корпус|стр|строение)\.?\s*\d)/u.test(rest);
};
/** К какому адресу отнести точку при сохранении: дописанный адрес того же дома (улица → улица с номером) — полностью */
const pointLabel = (value) => (sameStart(value, point.label) ? value : point.label);

// Точка — { lat, lon, from, label }. from: restored — из прошлого заказа, suggest — дом из подсказок, map — отмечена на карте
// (нажал, «Я сейчас здесь», «в центре»); label — адрес, к которому она относится. Адрес поменяли (не просто дописали
// подъезд) — точка из подсказки или прошлого заказа уже о другом доме: снимаем, курьеру она не уйдёт.
// Отмеченную на карте сейчас не снимаем — покупатель ставил её сам, только просим проверить.
// Карта грузится, только когда покупатель открыл её (или выбрал адрес из подсказок); точка уходит в базу после оформления
const savedPoint = savedContact.point;
let point = savedPoint && savedPoint.address === addrInput.value && inZone(savedPoint.lat, savedPoint.lon)
  ? { lat: savedPoint.lat, lon: savedPoint.lon, from: 'restored', label: savedPoint.label || savedPoint.address } : null;
let pointMoved = false; // адрес поменяли после точки, отмеченной на карте, — «⚠ Точка — проверьте на карте»
let pointSeq = 0; // растёт при каждой смене точки: поздний ответ «Я сейчас здесь» не перетирает выбранное после нажатия
let pointReady = null; // Promise<{ L, map, layer }> — карта в форме создаётся один раз
let mapTouched = false; // покупатель нажал на карту или двигал её, пока искали адрес, — найденный вид сами не двигаем

function renderPoint(view = null) {
  $('[data-point-state]').textContent = point ? tx(pointMoved ? '⚠ Точка — проверьте на карте' : '✓ Точка отмечена') : '';
  $('[data-point-clear]').hidden = !point;
  $('[data-point-open]').textContent = tx(point ? '📍 Изменить точку на карте' : '📍 Отметить точку доставки на карте');
  view?.layer.clearLayers();
  if (view && point) pin(view.L, point, '🏠', 'home', tx('Точка доставки')).addTo(view.layer);
}
// Подсказка под картой, пока покупатель ничего не нажимал, — на его языке (потом её пишут setPoint и «Я сейчас здесь»)
let pointHintKey = 'Нажмите на карте место, где вас встретить. Так курьер найдёт вас быстрее.';
function pointHint(text) {
  pointHintKey = '';
  $('[data-point-hint]').textContent = text;
}
function renderPointTexts() {
  renderPoint();
  if (pointHintKey) $('[data-point-hint]').textContent = tx(pointHintKey);
}

async function pointView() {
  try { return await pointReady; } catch { pointReady = null; return null; } // не загрузилась — в следующий раз заново
}

async function setPoint(next, hint = '') {
  if (next && !inZone(next.lat, next.lon)) { pointHint(tx('Это за пределами зоны доставки — отметьте место в Бишкеке.')); return; }
  point = next;
  pointMoved = false;
  pointSeq += 1;
  refreshQuote(); // доставка — до новой точки (точку убрали — по адресу, когда его допишут)
  addrHint(''); // подсказка под адресом («По карте здесь…») была о прежней точке
  pointHint(hint || tx(point ? 'Точка отмечена. Можно нажать на карте ещё раз, чтобы поправить.' : 'Нажмите на карте место, где вас встретить.'));
  renderPoint(pointReady ? await pointView() : null);
}

/** Показать карту точки (открыть, создать при первом показе); null — не загрузилась */
async function openPointMap() {
  $('[data-point-box]').hidden = false;
  $('[data-point-open]').setAttribute('aria-expanded', 'true');
  const fresh = !pointReady;
  pointReady ||= createMap($('[data-point-map]'));
  const view = await pointView();
  if (!view) { pointHint(tx('Карта не загрузилась — ничего страшного, курьер найдёт вас по адресу. Можно открыть ещё раз.')); return null; }
  view.map.invalidateSize();
  if (fresh) {
    // Точку ставим не сразу: двойное нажатие — это приближение карты, а не точка на дороге
    let clickTimer = null;
    // Мышью ждём дольше: двойной щелчок в Windows — до 500 мс между нажатиями, касание Leaflet считает двойным до 200 мс
    view.map.on('click', (ev) => {
      mapTouched = true;
      clearTimeout(clickTimer);
      const mouse = ev.originalEvent?.pointerType ? ev.originalEvent.pointerType === 'mouse' : !matchMedia('(pointer: coarse)').matches;
      clickTimer = setTimeout(() => pickOnMap({ lat: ev.latlng.lat, lon: ev.latlng.lng }), mouse ? 500 : 300);
    });
    view.map.on('dblclick', () => clearTimeout(clickTimer));
    view.map.on('dragstart', () => { mapTouched = true; });
    renderPoint(view);
  }
  return view;
}

/** Подсказка под полем адреса; apply — кнопка «Подставить» этот адрес, пока точка та же, по которой он найден */
function addrHint(text, apply = '') {
  const el = $('[data-addr-hint]');
  el.textContent = text;
  if (!apply) return;
  const forPoint = point;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'linkbtn';
  button.textContent = tx('Подставить');
  button.addEventListener('click', () => {
    if (point !== forPoint) { addrHint(''); return; }
    addrInput.value = apply;
    addrSource = 'map';
    if (point) point.label = apply;
    addrHint(tx('Адрес по точке: {address}.', { address: apply }));
  });
  el.append(' ', button);
}

/**
 * Точку поставили на карте («нажал на дом», «Я сейчас здесь», «в центре») — подписываем адрес по ней, как в 2GIS.
 * since — номер правки адреса на момент нажатия: покупатель с тех пор правил адрес — поле не трогаем, только предлагаем.
 * precise: false — место неточное (геопозиция хуже 100 м): адрес сами не меняем, только предлагаем
 */
async function pickOnMap(at, hint = '', { since = addrEdit, precise = true } = {}) {
  const next = { lat: at.lat, lon: at.lon, from: 'map', label: addrInput.value };
  await setPoint(next, hint);
  if (point !== next) return; // точка вне зоны — не приняли
  const found = await reverseAddress(next, () => point !== next).catch(() => null);
  if (point !== next) return; // пока искали адрес, точку уже поменяли
  const value = addrInput.value.trim();
  if (!found) {
    if (addrSource === 'map') addrSource = 'typed'; // в поле адрес прежней точки — дальше сами его не меняем
    addrHint(tx(value ? 'Адрес по этой точке не определился — проверьте, что в поле нужный адрес.' : 'Адрес по этой точке не определился — напишите его в поле.'));
    return;
  }
  const { label, exact } = found;
  // Сами меняем адрес, только если поле пустое или адрес пришёл от нас (подсказка, прежняя точка, улица без номера),
  // и только на адрес с номером дома: «проспект Чуй» без номера не заменит выбранный «проспект Чуй, 155»
  const ours = ['suggest', 'map'].includes(addrSource) || (addrSource === 'street' && value.endsWith(','));
  // Адрес в поле от прошлого нажатия на другой улице, а здесь номера нет — ставим улицу и просим номер.
  // Выбранный из подсказок дом так не меняем: нажали у входа — Nominatim часто отдаёт соседнюю улицу
  const otherStreet = !exact && ['map', 'street'].includes(addrSource) && !sameStart(value, label);
  if (precise && addrEdit === since && (!value || (exact && ours) || otherStreet)) {
    addrInput.value = exact ? label : `${label}, `;
    addrSource = exact ? 'map' : 'street';
    next.label = addrInput.value;
    addrHint(exact ? tx('Адрес по точке: {address}. Поправьте, если нужно; подъезд и квартиру — ниже.', { address: label }) : tx('По точке: {address} — номер дома на карте не нашли, допишите его.', { address: label }));
  } else if (value.toLowerCase() !== label.toLowerCase()) {
    addrHint(exact ? tx('По карте здесь: {address}.', { address: label }) : tx('По карте здесь: {address} (номер дома не нашли).', { address: label }), exact ? label : '');
  }
}

$('[data-point-open]').addEventListener('click', async () => {
  if (!$('[data-point-box]').hidden) {
    $('[data-point-box]').hidden = true;
    $('[data-point-open]').setAttribute('aria-expanded', 'false');
    return;
  }
  mapTouched = false;
  const view = await openPointMap();
  if (!view) return;
  if (point) { view.map.setView([point.lat, point.lon], 17); return; }
  // Адрес уже написан — показываем это место, чтобы точку не искать по всему городу.
  // Пока искали, покупатель уже нажал на карту или двигал её — вид не трогаем
  const found = await geocode(addrInput.value).catch(() => null);
  if (found && !point && !mapTouched) view.map.setView([found.lat, found.lon], 17);
});

// С клавиатуры: двигаем карту стрелками (на ней фокус) и ставим точку в её центр
$('[data-point-center]').addEventListener('click', async () => {
  const view = await pointView();
  if (!view) return;
  const c = view.map.getCenter();
  pickOnMap({ lat: c.lat, lon: c.lng }, tx('Точка — в центре карты. Можно передвинуть карту и нажать ещё раз.'));
});

$('[data-point-here]').addEventListener('click', () => {
  if (!navigator.geolocation) { pointHint(tx('Телефон не даёт определить место — нажмите на карте.')); return; }
  pointHint(tx('Определяем, где вы…'));
  // Пока телефон думает (до 15 с), покупатель мог выбрать дом из подсказок или нажать на карте — тогда ответ уже не нужен;
  // а если он правил адрес — точку ставим, но адрес не трогаем
  const seq = pointSeq;
  const since = addrEdit;
  navigator.geolocation.getCurrentPosition(async (pos) => {
    if (seq !== pointSeq) return;
    const meters = Math.round(pos.coords.accuracy || 0);
    const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    const view = pointReady ? await pointView() : null;
    if (seq !== pointSeq) return;
    if (view && inZone(here.lat, here.lon)) view.map.setView([here.lat, here.lon], 17);
    // В помещении телефон часто ошибается на сотни метров — честно говорим и просим поправить
    await pickOnMap(here, meters > 100
      ? tx('Телефон определил место неточно (±{meters} м). Проверьте точку и при необходимости нажмите на карте нужное место.', { meters })
      : tx('Точка — там, где вы сейчас. Если заказ не сюда — нажмите на карте нужное место.'), { since, precise: meters <= 100 });
  }, () => {
    if (seq === pointSeq) pointHint(tx('Не получилось определить место (нет разрешения) — нажмите на карте.'));
  }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
});

$('[data-point-clear]').addEventListener('click', () => setPoint(null));
renderPoint();

/* Сумма доставки: от кухни точки покупателя по дорогам. По точке — сразу; без точки — по тексту адреса, когда покупатель
   его дописал (ушёл из поля, оформляет заказ, вернулся на сайт): искать адрес на каждую букву — лишняя нагрузка на Nominatim */

let quoteKey = ''; // для какой точки или адреса посчитано (или считается прямо сейчас)
let quoteJob = null; // Promise этого расчёта — оформление ждёт его недолго
let quoteSeq = 0; // растёт с каждым новым расчётом: поздний ответ о прежнем адресе отбрасываем

/** По чему считать: точка — «@широта,долгота», адрес — «#текст»; '' — не по чему (улица без номера дома — тоже) */
function quoteTarget() {
  if (point) return `@${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;
  if (addrSource === 'street' && /,\s*$/.test(addrInput.value)) return '';
  const address = addrInput.value.replace(/[\s,]+$/, '').trim().toLowerCase();
  return address.length >= 3 ? `#${address}` : '';
}

/**
 * Пересчитать сумму доставки, если поменялись точка или адрес. settled — адрес дописан; пока покупатель печатает
 * без точки, прежнюю сумму только снимаем. Возвращает Promise расчёта или null — считать не по чему.
 * Promise отдаёт место, по которому считали ({ lat, lon } в зоне доставки; null — адрес не нашли или сервис не ответил), —
 * даже если адрес с тех пор поменяли: оформление берёт точку заказа по адресу на момент нажатия
 */
function refreshQuote(settled = document.activeElement !== addrInput) {
  const key = quoteTarget();
  if (key && key === quoteKey) return quoteJob;
  const seq = ++quoteSeq;
  quote = null;
  quoteBy = '';
  quoteAt = null; // точка или адрес уже другие — и точка заказа по прежнему адресу не та
  quoteBusy = false;
  quoteKey = '';
  quoteJob = null;
  addrTried = false;
  markAsked = false;
  if (!key || (!point && !settled)) { render(); return null; }
  quoteKey = key;
  quoteBusy = true;
  render();
  const at = point ? { lat: point.lat, lon: point.lon } : null;
  const address = addrInput.value.replace(/[\s,]+$/, '');
  quoteJob = (async () => {
    let where = null;
    try {
      where = at || await geocode(address);
      if (where && !inZone(where.lat, where.lon)) where = null;
      if (seq !== quoteSeq) return where;
      // Без точки на карте точку заказа определяем по найденному адресу — сразу, не дожидаясь маршрута:
      // оформление ждёт сумму не дольше 6 секунд, а точка нужна и без неё. Не нашли — точка заказа не определилась
      // exact — нашёлся сам дом (улица и номер совпали, specs/023): такая точка уходит в заказ, как отмеченная на карте
      if (!at) { quoteAt = where && { lat: where.lat, lon: where.lon, exact: Boolean(where.exact) }; addrTried = true; render(); }
      // Покупатель переставил точку, пока расчёт ждал очереди к серверам маршрутов, — этот запрос уже не отправляем
      const found = where ? await deliveryQuote(where, () => seq !== quoteSeq) : null;
      if (seq !== quoteSeq) return where;
      // По адресу без точки место найдено примерно — и сумма примерная; нашёлся сам дом (specs/023) — как по точке.
      // base — по тарифу, без надбавки за дождь
      const precise = Boolean(at || where?.exact);
      quote = found && withRain({ ...found, approx: found.approx || !precise, base: found.price });
      quoteBy = precise ? 'point' : 'address';
    } catch {
      // Сбой сети — посчитаем заново при следующем поводе; точка заказа по адресу пока не определилась
      if (seq === quoteSeq) { quoteKey = ''; if (!at) addrTried = true; }
    } finally {
      if (seq === quoteSeq) { quoteBusy = false; render(); }
    }
    return where;
  })();
  return quoteJob;
}

// «Идёт дождь — к доставке +100 сом» (supabase/rain.sql, 11.11.2026): менеджер включает надбавку у своей точки. Точка — та,
// чья кухня везёт (у адреса за концами линии — ближайшая). Пересчитываем от base при каждом свежем чтении настроек
const quoteBranch = (q) => q?.branch || delivery.kitchens.find((k) => k.label === q?.from)?.branch || null;
function withRain(q) {
  if (!q) return q;
  const rain = q.base && branches?.[quoteBranch(q)]?.rain ? delivery.rain : 0;
  return { ...q, rain, price: q.base ? q.base + rain : q.base };
}
const rainNote = (q) => (q?.rain ? ` ${tx('Идёт дождь — к доставке +{sum}.', { sum: money(q.rain) })}` : '');

/** Пояснение к сумме в форме: сколько км и от какой кухни, итоговая сумма — без расценок по расстоянию */
function quoteText() {
  // Адрес искали и не нашли (или нашли не то — specs/023): просим отметить дом на карте, а не «укажите адрес»
  if (!quote && !quoteBusy && addrTried && !point && !quoteAt && form.elements.address.value.trim()) {
    return tx('Дом на карте не нашли — отметьте точку доставки на карте: так посчитаем сумму, а курьер не будет искать.');
  }
  if (!quote) return quoteBusy ? tx('Считаем доставку до вашего адреса…') : '';
  // Везёт кухня точки покупателя (specs/013); точка не определилась — ближайшая, и пишем просто «от кухни»
  const from = tx(quote.branch ? 'от кухни вашей точки на {kitchen}' : 'от кухни на {kitchen}', { kitchen: tx(quote.from) });
  const rough = quoteBy === 'address' || quote.approx; // по тексту адреса без точки или по прямой (сервис маршрутов не ответил)
  const km = `${rough ? `${tx('примерно')} ` : ''}${kmLabel(quote.km)} ${from}`;
  const byAddress = quoteBy === 'address' ? ` ${tx('Точнее посчитаем, если выбрать дом из подсказок или отметить точку на карте.')}` : '';
  if (!quote.price) return `${tx('До вас {km} — это дальше {max} км. Стоимость доставки назовёт менеджер.', { km, max: maxKm })}${byAddress}`;
  return `${tx('Доставка — {sum} ({km}).', { sum: rough ? tx('около {sum}', { sum: money(quote.price) }) : money(quote.price), km })}${rainNote(quote)}${byAddress}`;
}

/** Сумма доставки на шаге оплаты — та, что ушла с заказом */
function payQuoteText(q) {
  if (!q) return '';
  if (!q.price) return tx('До вас {km} от кухни на {kitchen} — стоимость доставки назовёт менеджер.', { km: `${q.approx ? `${tx('примерно')} ` : ''}${kmLabel(q.km)}`, kitchen: tx(q.from) });
  return tx('Доставка — {sum} ({km} от кухни на {kitchen}). Оплатите курьеру при получении.', { sum: deliverySum(q), km: kmLabel(q.km), kitchen: tx(q.from) }) + rainNote(q);
}

/* Подсказки при наборе адреса: начал писать — список домов; выбрал — адрес в поле и точка на карте */

const addrPop = $('[data-addr-pop]'); // список и подпись источника под ним
const addrList = $('[data-addr-list]');
const addrStatus = $('[data-addr-status]');
let addrOptions = [];
let addrActive = -1;
let addrTimer = null;
let addrSeq = 0;

function closeAddrList() {
  addrPop.hidden = true;
  addrList.hidden = true;
  addrInput.setAttribute('aria-expanded', 'false');
  addrInput.removeAttribute('aria-activedescendant');
  addrActive = -1;
  addrOptions = [];
  addrList.innerHTML = ''; // устаревшие варианты не остаются в разметке — экранный диктор их не прочтёт
  addrStatus.textContent = '';
}

function renderAddrList(items) {
  addrOptions = items;
  addrActive = -1;
  addrList.innerHTML = items.map((s, i) => `<li class="addr__item" id="addr-opt-${i}" role="option" aria-selected="false" data-i="${i}">
      <b>${escHtml(s.label)}</b>${s.sub ? `<span>${escHtml(s.sub)}</span>` : ''}</li>`).join('');
  addrPop.hidden = false;
  addrList.hidden = false;
  addrList.scrollTop = 0;
  addrInput.setAttribute('aria-expanded', 'true');
  addrInput.removeAttribute('aria-activedescendant');
  addrStatus.textContent = tx('Подсказок: {n}. Стрелки — выбрать, Enter — подставить.', { n: items.length });
}

function highlightAddr(i) {
  addrActive = i;
  addrList.querySelectorAll('[role="option"]').forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
  const li = addrList.querySelector(`#addr-opt-${i}`);
  if (li) { addrInput.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
}

async function chooseAddr(s) {
  closeAddrList();
  addrEdit += 1;
  if (!s.exact) {
    // Улица без дома — дописать номер: точку по середине улицы не ставим, курьер бы не нашёл.
    // Точка прежнего дома к новой улице не относится
    if (point && point.from !== 'map') await setPoint(null);
    addrInput.value = `${s.value}, `;
    addrSource = 'street';
    addrInput.focus();
    addrHint(tx('Допишите номер дома и выберите его из подсказок — или нажмите свой дом на карте.'));
    return;
  }
  addrInput.value = s.value;
  addrSource = 'suggest';
  await setPoint({ lat: s.lat, lon: s.lon, from: 'suggest', label: s.value }, tx('Точка — по выбранному адресу. Если дом не тот — нажмите на карте свой.'));
  const view = await openPointMap();
  if (view && point) view.map.setView([point.lat, point.lon], 17);
}

addrInput.addEventListener('input', () => {
  addrSource = 'typed';
  addrEdit += 1;
  const value = addrInput.value;
  // Подсказка под полем видна и при свёрнутой карте: что стало с точкой после правки адреса
  let hint = '';
  if (point && point.from !== 'map' && !sameStart(value, point.label)) {
    setPoint(null, tx('Адрес поменялся — точку прежнего дома убрали.'));
    hint = tx('Адрес поменялся — точку прежнего дома убрали. Выберите дом из подсказок или отметьте его на карте.');
  } else if (point?.from === 'map') {
    const moved = !sameStart(value, point.label);
    if (moved) hint = tx('Адрес изменили — проверьте, что точка на карте там, где вас встретить.');
    pointMoved = moved;
    $('[data-point-state]').textContent = tx(moved ? '⚠ Точка — проверьте на карте' : '✓ Точка отмечена');
  }
  if ($('[data-addr-hint]').textContent !== hint) addrHint(hint);
  refreshQuote(); // без точки сумма по прежнему адресу уже не о том — посчитаем, когда адрес допишут
  clearTimeout(addrTimer);
  closeAddrList(); // подсказки к прежнему тексту уже не о том — чтобы Enter не выбрал устаревшую
  const q = value.trim();
  if (q.length < 3) return;
  addrTimer = setTimeout(async () => {
    const seq = ++addrSeq;
    try {
      const items = await suggestAddresses(q);
      if (seq !== addrSeq || addrInput.value.trim() !== q || document.activeElement !== addrInput) return;
      if (items.length) renderAddrList(items);
      else if (!$('[data-addr-hint]').textContent) addrHint(tx('Такой адрес в подсказках не нашли — допишите его как есть или отметьте дом на карте ниже.'));
    } catch (err) {
      if (seq === addrSeq && err?.name !== 'AbortError') closeAddrList(); // сервис подсказок не ответил — пишут адрес сами
    }
  }, 350);
});

addrInput.addEventListener('keydown', (e) => {
  if (addrList.hidden || !addrOptions.length) return;
  const n = addrOptions.length;
  if (e.key === 'ArrowDown') { e.preventDefault(); highlightAddr(addrActive < 0 ? 0 : (addrActive + 1) % n); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); highlightAddr(addrActive <= 0 ? n - 1 : addrActive - 1); }
  // Enter при открытом списке не оформляет заказ: выбирает выделенный дом или просто закрывает список
  else if (e.key === 'Enter') { e.preventDefault(); if (addrActive >= 0) chooseAddr(addrOptions[addrActive]); else closeAddrList(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeAddrList(); }
});
// Нажатие по подсказке: mousedown не уводит фокус из поля (иначе список закрылся бы раньше выбора)
addrPop.addEventListener('mousedown', (e) => e.preventDefault());
addrPop.addEventListener('click', (e) => {
  const li = e.target.closest('[data-i]');
  if (li) chooseAddr(addrOptions[Number(li.dataset.i)]);
  else setTimeout(closeAddrList); // подпись источника: ссылка откроется, список закроется
});
addrInput.addEventListener('blur', () => setTimeout(closeAddrList, 150));
// Адрес дописан и покупатель ушёл из поля — считаем доставку (без точки — по тексту адреса, примерно)
addrInput.addEventListener('change', () => refreshQuote(true));

/* ---------- Способ получения, самовывоз, «до двери», «Мои адреса» (specs/018) ---------- */

/**
 * Самовывоз: блок доставки скрыт (его поля не обязательны и в заказ не уходят), кухня, которая не принимает заказы, выключена
 * («Сейчас не принимает»; выбранная закрылась — выбор снят). Ничего не выбрано — первая принимающая
 */
function renderPickup() {
  const pickup = isPickup();
  $('[data-pickup-box]').hidden = !pickup;
  $('[data-delivery-box]').hidden = pickup;
  addrInput.required = !pickup;
  const inputs = [...form.querySelectorAll('[name="pickup_branch"]')];
  for (const input of inputs) {
    const closed = !acceptingFor(input.value);
    input.disabled = closed;
    if (closed && input.checked) input.checked = false;
    $(`[data-pickup-state="${input.value}"]`).textContent = closed ? tx('Сейчас не принимает') : '';
    input.closest('.pickup__item').classList.toggle('is-off', closed);
  }
  if (pickup && !pickupBranch()) {
    const first = inputs.find((i) => !i.disabled);
    if (first) first.checked = true;
  }
  const b = pickupBranch();
  $('[data-pickup-note]').textContent = b ? `${tx('Заберёте сами на {address}', { address: tx(branchInfo[b].kitchen) })}.` : '';
}
form.addEventListener('change', (e) => {
  if (e.target.name === 'fulfillment' || e.target.name === 'pickup_branch') {
    errorBox.textContent = '';
    render();
  }
});

/** «До двери» +50 сом — только квартирам: без квартиры выключено с подсказкой; с квартирой — «до подъезда», если не отметить */
function renderDoor() {
  const input = form.elements.door;
  const flat = Boolean(form.elements.apartment.value.trim());
  input.disabled = !flat;
  if (!flat) input.checked = false;
  $('[data-door-title]').textContent = tx(`До двери +${door.fee} сом`);
  $('[data-door-hint]').textContent = tx(!flat ? 'Только для квартир — укажите квартиру' : input.checked ? 'Курьер поднимется к квартире' : 'Без отметки — до подъезда');
  $('[data-door]').classList.toggle('is-off', !flat);
}
form.elements.apartment.addEventListener('input', () => { renderDoor(); render(); renderSavedAddrs(); });
form.elements.door.addEventListener('change', () => { renderDoor(); render(); });

// Согласие на обработку данных — только когда опубликованы юридические тексты (data.js → legal.ready); тогда обязательно
$('[data-consent]').hidden = !legal.ready;
$('[data-consent-link]').href = legal.privacy;

/* «Мои адреса» чипами над полем адреса: три свежих + «ещё»; нажатие подставляет адрес, подъезд, этаж, квартиру и точку.
   Выбранный — обведён (aria-pressed). Адреса хранятся только на этом телефоне (history.js) */
let savedAll = false; // нажали «ещё» — показываем все сохранённые
const normText = (v) => String(v ?? '').trim().toLowerCase().replace(/[\s.,]+/g, ' ').trim();
const isCurrent = (a) => normText(a.address) === normText(addrInput.value) && normText(a.apartment) === normText(form.elements.apartment.value);
function renderSavedAddrs() {
  const box = $('[data-saved-addrs]');
  const list = addresses.list();
  box.hidden = !list.length;
  box.textContent = '';
  if (!list.length) return;
  const title = document.createElement('p');
  title.className = 'saved__title';
  title.id = 'saved-title';
  title.textContent = tx('Мои адреса');
  const row = document.createElement('div');
  row.className = 'saved__list';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-labelledby', title.id);
  for (const a of savedAll ? list : list.slice(0, 3)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.savedId = a.id;
    chip.setAttribute('aria-pressed', String(isCurrent(a)));
    const name = document.createElement('b');
    name.textContent = tx(a.label);
    const where = document.createElement('span');
    where.textContent = `${a.address}${a.apartment ? `, ${tx('кв.')} ${a.apartment}` : ''}`;
    chip.append(name, ' · ', where);
    row.append(chip);
  }
  if (!savedAll && list.length > 3) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'chip chip--more';
    more.dataset.savedMore = '';
    more.textContent = tx('ещё {n}', { n: list.length - 3 });
    row.append(more);
  }
  const fresh = document.createElement('button');
  fresh.type = 'button';
  fresh.className = 'chip chip--new';
  fresh.dataset.savedNew = '';
  fresh.textContent = `+ ${tx('Новый адрес')}`;
  row.append(fresh);
  box.append(title, row);
}
// Набирают адрес — обводка выбранного чипа следует за полем
addrInput.addEventListener('input', () => renderSavedAddrs());
$('[data-saved-addrs]').addEventListener('click', (e) => {
  const chip = e.target.closest('button');
  if (!chip) return;
  if (chip.dataset.savedId) fillAddress(addresses.get(chip.dataset.savedId));
  else if (chip.dataset.savedMore !== undefined) {
    savedAll = true;
    renderSavedAddrs();
    $('[data-saved-addrs] .chip:nth-child(4)')?.focus();
  } else if (chip.dataset.savedNew !== undefined) {
    fillAddress({ address: '', entrance: '', floor: '', apartment: '', point: null });
    addrInput.focus();
  }
});

/**
 * Подставить адрес (чип «Мои адреса», «Повторить» или выбор в «Мои адреса» оболочки): адрес, подъезд, этаж, квартира и точка на
 * карте — как из прошлого заказа (поменяют адрес — точка снимется). Способ — доставка
 */
async function fillAddress(entry) {
  if (!entry) return;
  form.elements.fulfillment.value = 'delivery';
  closeAddrList();
  addrInput.value = entry.address || '';
  for (const k of ['entrance', 'floor', 'apartment']) form.elements[k].value = entry[k] || '';
  if (entry.comment && !form.elements.comment.value) form.elements.comment.value = entry.comment;
  addrSource = addrInput.value ? 'saved' : 'empty';
  addrEdit += 1;
  addrHint('');
  const p = entry.point;
  point = p && inZone(p.lat, p.lon) ? { lat: p.lat, lon: p.lon, from: 'restored', label: p.label || entry.address } : null;
  pointMoved = false;
  pointSeq += 1;
  errorBox.textContent = '';
  renderDoor();
  refreshQuote(true);
  render();
  renderSavedAddrs();
  const view = pointReady ? await pointView() : null;
  renderPoint(view);
  if (view && point) view.map.setView([point.lat, point.lon], 17);
}

/* Чип способа в шапке (app.js): «Доставка · ул. Токтогула, 120» или «Самовывоз · Кулиева, Ош базар» — шлём, когда сменились
   способ, кухня или адрес (и язык: подпись label — уже переведённая) */
let modeSent = '';
function emitMode() {
  const pickup = isPickup();
  const branch = pickup ? pickupBranch() : orderBranch();
  const address = pickup ? (branch ? branchInfo[branch].kitchen : '') : addrInput.value.replace(/[\s,]+$/, '').trim();
  const label = pickup ? (branch ? `${tx(branchName(branch))}, ${tx(PICKUP_PLACE[branch])}` : tx('Самовывоз')) : address || tx('Укажите адрес');
  const detail = { fulfillment: pickup ? 'pickup' : 'delivery', branch: branch || null, address, label };
  const key = JSON.stringify(detail);
  if (key === modeSent) return;
  modeSent = key;
  emit('kokoro:mode', detail);
}

async function loadSettings() {
  try {
    settings = await api.settings();
    if (settings) {
      price = settings.combo_price;
      deliveryFee = settings.delivery_fee;
      accepting = settings.accepting_orders;
      branches = settings.branches || null;
      quote = withRain(quote); // дождь могли включить или выключить — сумма до адреса по свежим настройкам
      if (settings.wait_minutes) { waitMinutes = settings.wait_minutes; waitKnown = true; }
      // Экран «Заказ принят» мог открыться раньше, чем пришли настройки (время при оплате не запомнено)
      const paid = getTrack();
      // Пока на шкале оценка прибытия курьера — «Заказ уже в пути», а не «примерно к …» (doneTimeLine)
      if (currentStep === 'done' && paid) $('[data-done-time]').textContent = doneTimeLine(paid);
      if (currentStep === 'done') renderOrderScreen(); // кольцо без order_extra считается от времени точки из панели
    }
  } catch { /* покажем цену по умолчанию; итог всё равно посчитает база */ }
  render();
  if (pending) fillPayment();
}

const errorBox = $('[data-form-error]');
const errorHome = errorBox.previousElementSibling;

/** Ошибка формы: под полем input (или после anchor — выбор кухни, галочка согласия); без поля — над кнопкой */
function fail(input, message, anchor = null) {
  errorBox.textContent = message;
  const after = anchor || input?.closest('.field');
  if (after) {
    // На телефоне строка ошибки над кнопкой уходила за экран — показываем её прямо под полем
    after.after(errorBox);
    input?.setAttribute('aria-invalid', 'true');
    input?.setAttribute('aria-describedby', errorBox.id);
    input?.focus();
  } else {
    errorHome.after(errorBox);
  }
}
form.addEventListener('input', (e) => {
  e.target.removeAttribute?.('aria-invalid');
  e.target.removeAttribute?.('aria-describedby');
  errorBox.textContent = '';
});

const networkMessage = (err) => tx(err instanceof TypeError ? 'Нет связи. Проверьте интернет и попробуйте ещё раз.' : err.message);

// Отказы хранилища чеков приходят по-английски — переводим. Отказ в загрузке бывает и тогда, когда чек
// уже принят (ответ потерялся, покупатель нажал ещё раз): заказ уже не «ждёт оплаты», и папка закрыта
function receiptMessage(err) {
  const text = `${err?.status || ''} ${err?.message || ''}`;
  if (/row-level security|unauthorized|\b403\b/i.test(text)) {
    return tx('Чек не прикрепился. Если вы уже отправляли его — заказ принят, менеджер напишет в WhatsApp. Если нет — напишите нам: {phone}', { phone: branchPhone(pending?.branch).phoneLabel });
  }
  if (/maximum allowed size|too large|\b413\b/i.test(text)) return tx('Файл больше 5 МБ — сделайте скриншот чека');
  if (/mime|\b415\b/i.test(text)) return tx('Прикрепите фото, скриншот (JPG, PNG) или PDF');
  return networkMessage(err);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (submitting) return; // заказ уже оформляется — второе нажатие или Enter не создают второй
  const f = form.elements;
  $('[data-form-error]').textContent = '';
  if (f.website.value) return; // ловушка для ботов
  if (!f.name.value.trim()) return fail(f.name, tx('Укажите имя'));
  const digits = f.phone.value.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return fail(f.phone, tx('Укажите номер телефона с WhatsApp'));
  // Самовывоз: адрес, точка и квартира не нужны — только кухня, откуда заберут
  const pickup = isPickup();
  const pickupAt = pickup ? pickupBranch() : null;
  if (pickup && !pickupAt) return fail(form.querySelector('[name="pickup_branch"]:not(:disabled)'), tx('Выберите, откуда заберёте заказ'), $('[data-pickup-box]'));
  if (!pickup) {
    if (f.address.value.trim().length < 3) return fail(f.address, tx('Укажите адрес доставки'));
    // Выбрал улицу и не дописал дом — просим номер; лишнюю запятую в конце («ул. Токтогула 100, ») просто убираем
    if (addrSource === 'street' && /,\s*$/.test(f.address.value)) return fail(f.address, tx('Допишите номер дома после запятой'));
    f.address.value = f.address.value.replace(/[\s,]+$/, '');
  }
  // «Ко времени»: в часы доставки, шаг 5 минут; сегодня — не раньше чем через 30 минут (то же проверяет база, set_order_options)
  const timed = f.when.value === 'time';
  const day = timed && f.day.value === 'tomorrow' ? 'tomorrow' : 'today';
  if (timed && !f.time.value) return fail(f.time, tx('Укажите время доставки'));
  if (timed && !timeInHours(f.time.value)) return fail(f.time, tx(payment.timeOutside));
  const whenAt = timed ? timedAt(day, f.time.value) : null;
  if (timed && Number(f.time.value.slice(3, 5)) % 5) return fail(f.time, tx('Выберите время с шагом 5 минут'));
  if (timed && !(whenAt >= Date.now() + TIME_LEAD_MS)) return fail(f.time, tx('Это время уже близко — выберите позже или «Побыстрее»'));
  if (legal.ready && !f.consent.checked) return fail(f.consent, tx('Отметьте согласие на обработку данных'), $('[data-consent]'));

  submitting = true;
  const button = $('[data-submit]');
  button.disabled = true;
  button.textContent = tx('Секунду…');
  // Снимок в момент нажатия: заказ, точка на карте и адрес. Пока ждём базу, покупатель может переставить точку или поправить
  // адрес — проверяем и отправляем то, что было при нажатии, а не смесь старого и нового.
  // Самовывоз — в place_order адрес «Самовывоз — ул. Кулиева, 40» (так его видят панель и чек), подъезда и квартиры нет
  const kitchen = pickupAt ? branchInfo[pickupAt].kitchen : '';
  const doorWanted = doorOn();
  const order = {
    qty,
    name: f.name.value,
    phone: f.phone.value,
    address: pickup ? `Самовывоз — ${kitchen}` : f.address.value,
    entrance: pickup ? '' : f.entrance.value,
    floor: pickup ? '' : f.floor.value,
    apartment: pickup ? '' : f.apartment.value,
    deliveryTime: timed ? `Ко времени: ${f.time.value}` : 'Как можно скорее',
    comment: f.comment.value,
  };
  const when = timed ? f.time.value : '';
  const sentPoint = !pickup && point ? { lat: point.lat, lon: point.lon } : null;
  // Точку помним вместе с адресом: тот же адрес в следующий раз — та же точка. Самовывоз прежний адрес доставки не затирает
  const before = storage.get(CONTACT_KEY) || {};
  const contact = pickup
    ? { ...before, name: f.name.value, phone: f.phone.value, fulfillment: 'pickup', pickup: pickupAt }
    : { ...Object.fromEntries(REMEMBERED.map((k) => [k, f[k].value])),
      point: sentPoint ? { ...sentPoint, address: order.address, label: pointLabel(order.address) } : null,
      fulfillment: 'delivery', pickup: before.pickup || null };
  // Сумма доставки: адрес могли дописать и сразу нажать «Перейти к оплате» — досчитываем (адрес уже без запятой в конце)
  const quoteReady = pickup ? null : refreshQuote(true);
  const quoteFor = quoteKey; // для какой точки или адреса эта сумма: поменяют, пока ждём, — сумму не отправляем
  let reveal = null; // отказ из-за точки: после render показать плашку ('closed') или попросить отметить дом ('mark')
  // Точку на карте не ставили, но адрес нашёлся до самого дома (улица и номер совпали, specs/023) — эта точка уходит в заказ:
  // курьер видит дом на карте, а раздача «по пути» знает, куда заказ. Не запоминаем её как отмеченную покупателем
  let housePoint = null;
  try {
    // Менеджер мог остановить приём, пока страница была открыта, — проверяем перед оформлением. Точки не прочитались —
    // ещё одна попытка сразу; снова нет (сеть) — остаёмся при прежних, а не было и их — работаем по общему приёму, как раньше
    const fresh = await api.settings({ retryBranches: true }).catch(() => null);
    if (fresh?.wait_minutes) { waitMinutes = fresh.wait_minutes; waitKnown = true; }
    if (fresh) {
      accepting = fresh.accepting_orders;
      branches = fresh.branches || (fresh.branchesFailed ? branches : null);
      quote = withRain(quote);
      // Цену и доставку в панели могли поменять, пока страница была открыта, — суммы и pending по свежим
      if (Number(fresh.combo_price) > 0) price = fresh.combo_price;
      if (fresh.delivery_fee !== undefined) deliveryFee = fresh.delivery_fee;
    }
    if (!accepting) {
      fail(null, tx(payment.closedMessage));
      return;
    }
    let branch = pickupAt;
    if (pickup) {
      // Кухня самовывоза остановила приём, пока заполняли форму, — заказ не уходит (в форме она станет выключенной)
      if (!acceptingFor(branch)) {
        if (!acceptingFor(null)) fail(null, tx(payment.closedMessage));
        else fail(null, tx('Точка «{name}» сейчас не принимает заказы — выберите другую.', { name: tx(branchName(branch)) }), $('[data-pickup-box]'));
        return;
      }
    } else {
      // Ждём сумму доставки не дольше 6 секунд (адрес без точки: поиск адреса и маршрут — до 6 с по замеру 03.11):
      // не успели — заказ уходит без неё, сумму назовёт менеджер. Вместе с ней приходит место адреса — по нему точка заказа
      const where = quoteReady ? await Promise.race([quoteReady, new Promise((r) => setTimeout(() => r(null), 6000))]) : null;
      // Точка заказа — по точке на карте или найденному адресу (на момент нажатия). Её приём — по свежим настройкам:
      // остановлена — заказ не уходит, над кнопкой плашка (render в finally)
      const from = sentPoint || where;
      branch = from ? branchAt(from.lat, from.lon) : null;
      if (!sentPoint && where?.exact && inZone(where.lat, where.lon)) housePoint = { lat: where.lat, lon: where.lon };
      if (!acceptingFor(branch)) {
        if (!acceptingFor(null)) fail(null, tx(payment.closedMessage));
        else reveal = 'closed';
        return;
      }
      // Точка не определилась: принимают обе — заказ уходит без неё (база поставит первую принимающую с пометкой «проверьте
      // адрес», менеджер передаст); принимает одна — не отправляем, просим отметить дом на карте
      if (!branch && onlyOpen()) {
        markAsked = true;
        reveal = 'mark';
        return;
      }
    }
    const sentQuote = !pickup && !deliveryFee && quoteFor && quoteKey === quoteFor && !quoteBusy && quote
      ? { km: quote.km, price: quote.price, from: quote.from, approx: quote.approx, ...(quote.rain ? { rain: quote.rain } : {}) } : null;
    const previous = pending?.token;
    const result = await api.placeOrder(order);
    // Параметры сверх place_order (specs/018, решение 3) — сразу, до QR: самовывоз, «до двери», день и час «ко времени»,
    // согласие. Не записались — QR не показываем (иначе самовывоз или завтрашний заказ потерялся бы), заказ отменяем.
    // База без 018 (404) — пропускаем, только если всё как раньше: доставка, без «до двери», сегодня
    const options = { fulfillment: pickup ? 'pickup' : 'delivery', branch: branch || null, door: doorWanted,
      deliver_at: whenAt ? new Date(whenAt).toISOString() : null, consent: Boolean(legal.ready && f.consent.checked) };
    const special = pickup || doorWanted || day === 'tomorrow';
    if (special || timed || options.consent) {
      const { problem, saved } = await saveOptions(result.token, options, special);
      // Самовывоз: база обнуляет доставку в заказе и пересчитывает сумму — к оплате берём её
      if (Number(saved?.total) > 0) result.total = Number(saved.total);
      if (problem) {
        api.cancelUnpaid(result.token).catch(() => { /* без чека заказ всё равно не повезут */ });
        failOptions(problem, timed);
        return;
      }
    }
    storage.set(CONTACT_KEY, contact);
    // Точку на карте помним и при заказе: по ней «курьер приедет примерно через …», если в базу она не записалась (specs/016).
    // Остальное — для экрана заказа, «Мои заказы» и «Мои адреса» (после оплаты, showDone)
    pending = { ...result, phone: order.phone, when, whenAt, delivery: sentQuote, branch, point: sentPoint || housePoint,
      qty: order.qty, fee: deliveryFee || 0, fulfillment: options.fulfillment, address: pickup ? kitchen : order.address,
      entrance: order.entrance, floor: order.floor, apartment: order.apartment, door: doorWanted, comment: order.comment };
    storage.set(PENDING_KEY, pending);
    if (!pickup) {
      // Точка — отдельным запросом по ключу оплаты; не записалась (связь) — заказ всё равно оформлен, курьер найдёт по адресу.
      // Точку заказа (Кулиева или Кок-Жар) база тогда считает сама по этим координатам
      if (sentPoint || housePoint) api.setOrderPoint(result.token, sentPoint || housePoint).catch(() => { /* без точки — по адресу */ });
      // Точки на карте нет — точку заказа по найденному адресу передаём сами; не записалась — база поставит первую
      // принимающую с пометкой «проверьте адрес», менеджер передаст заказ, если надо
      else if (branch) api.setOrderBranch(result.token, branch).catch(() => { /* решит менеджер */ });
      // Сумма доставки — так же; не записалась (связь, supabase/delivery-price.sql не запущен) — менеджер назовёт её сам
      if (sentQuote) api.setOrderDelivery(result.token, sentQuote).catch(() => { /* сумму назовёт менеджер, как раньше */ });
    }
    // Покупатель начал заказ заново — прежний неоплаченный отменяем, чтобы он не висел у менеджеров.
    // Только после того как новый принят: если новый не прошёл (лимит, нет связи), прежний можно оплатить
    if (previous) api.cancelUnpaid(previous).catch(() => { /* без чека прежний заказ всё равно не повезут */ });
    showPayment();
  } catch (err) {
    fail(null, networkMessage(err));
  } finally {
    submitting = false;
    render();
    if (reveal) revealPlaque(reveal === 'mark');
  }
});

/**
 * Записать параметры заказа (set_order_options). '' — записали (или база без 018, а параметры обычные — special false);
 * иначе — текст для покупателя: отказ проверки базы («Это время уже близко…»), нет связи, база без 018
 */
async function saveOptions(token, options, special) {
  try {
    const saved = await api.setOrderOptions(token, options);
    return { problem: saved ? '' : tx('Не получилось оформить заказ — попробуйте ещё раз.'), saved };
  } catch (err) {
    if (err?.status === 404) return { problem: special ? tx('Самовывоз, «до двери» и заказ на завтра пока недоступны — выберите доставку на сегодня') : '', saved: null };
    return { problem: networkMessage(err), saved: null };
  }
}
/** Отказ параметров — под полем, о котором он: время, «до двери», кухня самовывоза; иначе — над кнопкой */
function failOptions(message, timed) {
  const f = form.elements;
  const is = (ru) => message === tx(ru);
  const aboutTime = ['Выберите время с 12:00 до 00:00', 'Можно заказать на сегодня или завтра', 'Выберите время с шагом 5 минут',
    'Это время уже близко — выберите позже или «Побыстрее»', 'Не получилось прочитать время — выберите его ещё раз'].some(is);
  if (timed && aboutTime) return fail(f.time, message);
  if (is('До двери — только для квартир: укажите квартиру')) return fail(null, message, $('[data-door]'));
  if (is('Выберите, откуда заберёте заказ')) return fail(null, message, $('[data-pickup-box]'));
  return fail(null, message);
}

/* ---------- Шаг 2: оплата и чек ---------- */

function show(step) {
  currentStep = step;
  // Шкала статуса оплаченного заказа видна над формой и на экране «Заказ принят», но не на шаге оплаты
  $('[data-track]').hidden = step === 'pay' || !trackShown;
  if (step !== 'done') $('[data-track-map]').hidden = true; // карта «Едем» — только на экране «Заказ принят»
  form.hidden = step !== 'form';
  if (step === 'form') showResume();
  $('[data-pay]').hidden = step !== 'pay';
  $('[data-done]').hidden = step !== 'done';
  if (step === 'done') renderOrderScreen();
  if (step !== 'form') {
    const el = $(step === 'pay' ? '[data-pay]' : '[data-done]');
    el.focus({ preventScroll: true });
    $('[data-order-card]').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // Оболочка открывает шторку на шаге оплаты и экране заказа (на телефоне), плашка активного заказа — по kokoro:track
  emit('kokoro:step', { step });
}

// QR и подсказка берутся из файлов сайта (data.js → payment), не из базы. Не открылся файл —
// вместо QR просьба написать в WhatsApp; при следующем показе шага оплаты пробуем ещё раз
let qrBroken = false;
$('[data-qr-img]').addEventListener('error', () => {
  qrBroken = true;
  $('[data-qr]').hidden = true;
  $('[data-qr-missing]').hidden = false;
});

/**
 * Что отдать курьеру карточкой: { sum — крупно итог, detail — из чего (доставка + до двери, надбавка за дождь) }.
 * q — сумма доставки (как у курьера), doorFee — «до двери» (0 — нет). Суммы доставки нет — «назовёт менеджер»
 */
function courierCard(q, doorFee) {
  const road = Number(q?.price) || 0;
  if (!road) return { sum: doorFee ? tx('{sum} + доставка', { sum: moneyTight(doorFee) }) : tx('сумму назовёт менеджер'), detail: '', text: !doorFee };
  const total = moneyTight(road + doorFee);
  const detail = [doorFee ? tx('доставка {road} + до двери {door}', { road: moneyTight(road), door: moneyTight(doorFee) }) : '',
    Number(q.rain) > 0 ? tx('в том числе за дождь {sum}', { sum: moneyTight(Number(q.rain)) }) : ''].filter(Boolean).join(', ');
  return { sum: q.approx ? tx('около {sum}', { sum: total }) : total, detail };
}

/**
 * Два платежа крупно (13.11.2026): box — [data-pay-split] или [data-done-split]. qr — сумма по QR, qrWhat — за что;
 * courier — courierCard(…) (null — курьеру ничего: самовывоз или доставка в сумме по QR)
 */
function fillSplit(box, { qr, qrWhat, courier }) {
  if (!box) return;
  box.hidden = !(qr > 0);
  box.querySelector('[data-split-qr]').textContent = money(qr);
  box.querySelector('[data-split-qr-what]').textContent = qrWhat;
  const card = box.querySelector('[data-split-courier-card]');
  card.hidden = !courier;
  box.querySelector('[data-split-courier]').textContent = courier?.sum || '';
  box.querySelector('[data-split-courier]').classList.toggle('is-text', Boolean(courier?.text));
  box.querySelector('[data-split-courier-detail]').textContent = courier?.detail || '';
  const note = box.querySelector('[data-split-note]');
  if (note) note.hidden = !courier;
  box.classList.toggle('split--one', !courier);
}

function fillPayment() {
  $('[data-pay-total]').textContent = money(pending.total);
  // Два платежа: по QR — только комбо (и доставка, если она в сумме по QR), доставку — курьеру
  const payPickup = pending.fulfillment === 'pickup';
  const payFee = Number(pending.fee) || 0;
  const payCourier = () => (payPickup ? null : payFee ? (pending.door ? { sum: moneyTight(door.fee), detail: tx('до двери') } : null)
    : courierCard(pending.delivery, pending.door ? door.fee : 0));
  const paySplit = () => fillSplit($('[data-pay-split]'), { qr: Number(pending.total) || 0,
    qrWhat: tx(!payPickup && payFee ? 'за комбо и доставку' : 'за комбо'), courier: payCourier() });
  paySplit();
  // Сумма доставки, которая ушла с заказом, — над тарифом (тариф тогда свёрнут)
  // Самовывоз — доставки нет, блока о ней на шаге оплаты тоже; доставка без посчитанной суммы — «сумму назовёт менеджер»
  const payTariff = $('[data-pay] [data-tariff]');
  payTariff.hidden = Boolean(deliveryFee) || pending.fulfillment === 'pickup';
  const managerSays = tx('сумму назовёт менеджер');
  const showPayQuote = () => showQuote(payTariff, payQuoteText(pending.delivery) || `${managerSays.charAt(0).toUpperCase()}${managerSays.slice(1)}.`);
  showPayQuote();
  // Пока покупатель оплачивает, могли включить дождь (+100 к заказам точки) — сумму берём из заказа, ту же, что у курьера
  const token = pending.token;
  if (pending.fulfillment !== 'pickup' && typeof api.orderDelivery === 'function') {
    api.orderDelivery(token).then((fresh) => {
      if (!fresh?.price || pending?.token !== token || fresh.price === pending.delivery?.price) return;
      pending = { ...pending, delivery: { ...(pending.delivery || {}), km: fresh.km, price: fresh.price, approx: fresh.approx, from: fresh.from || pending.delivery?.from,
        ...(Number(fresh.rain) > 0 ? { rain: Number(fresh.rain) } : {}) } };
      storage.set(PENDING_KEY, pending);
      showPayQuote();
      paySplit();
    }).catch(() => { /* без связи — сумма, что ушла с заказом */ });
  }
  const img = $('[data-qr-img]');
  if (qrBroken) { qrBroken = false; img.removeAttribute('src'); }
  $('[data-qr]').hidden = false;
  $('[data-qr-missing]').hidden = true;
  if (img.getAttribute('src') !== payment.qrImage) img.src = payment.qrImage;
  $('[data-pay-note]').textContent = tx(payment.note);
  renderHours();
}

function showPayment() {
  setReceipt(null);
  $('[data-pay-error]').textContent = '';
  fillPayment();
  show('pay');
}

function setReceipt(blob, name = '') {
  receipt = blob;
  const preview = $('[data-receipt-preview]');
  $('[data-send-receipt]').disabled = !blob;
  receiptName = name;
  if (!blob) {
    preview.hidden = true;
    preview.style.backgroundImage = '';
    receiptHint();
    $('[data-receipt]').value = '';
    return;
  }
  preview.hidden = false;
  if (blob.type.startsWith('image/') && blob.type !== 'image/heic') {
    preview.textContent = '';
    preview.style.backgroundImage = `url("${URL.createObjectURL(blob)}")`;
  } else {
    preview.style.backgroundImage = '';
    preview.textContent = blob.type === 'application/pdf' ? 'PDF' : tx('Фото');
  }
  receiptHint();
}
/** Подпись поля чека: «Прикрепить чек» или «Чек прикреплён · имя файла · нажмите, чтобы заменить» (и при смене языка) */
function receiptHint() {
  $('[data-receipt-hint]').innerHTML = receipt
    ? `<b>${escHtml(tx('Чек прикреплён'))}</b><br>${receiptName ? `${escHtml(receiptName)} · ` : ''}${escHtml(tx('нажмите, чтобы заменить'))}`
    : `<b>${escHtml(tx('Прикрепить чек'))}</b><br>${escHtml(tx('скриншот или фото оплаты, до 5 МБ'))}`;
}

// Фото чека ужимаем в браузере: быстрее загружается с мобильного интернета и меньше места в хранилище
// (бесплатно у Supabase 1 ГБ на все чеки). 1600 точек по длинной стороне — текст чека читается и глазом,
// и распознаванием в панели; выходит ~100–200 КБ вместо 1–3 МБ скриншота.
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 150 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // прозрачный PNG не станет чёрным в JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

async function takeFile(file) {
  $('[data-pay-error]').textContent = '';
  if (!file) return;
  const type = file.type || (/\.heic$/i.test(file.name) ? 'image/heic' : '');
  if (!/^image\/(jpeg|png|webp|heic)$|^application\/pdf$/.test(type)) {
    $('[data-pay-error]').textContent = tx('Прикрепите фото, скриншот (JPG, PNG) или PDF');
    return;
  }
  const blob = await shrink(type === file.type ? file : new Blob([file], { type }));
  if (blob.size > MAX_RECEIPT) {
    $('[data-pay-error]').textContent = tx('Файл больше 5 МБ — сделайте скриншот чека');
    return;
  }
  setReceipt(blob, file.name);
}

$('[data-receipt]').addEventListener('change', (e) => takeFile(e.target.files[0]));
const drop = $('[data-receipt-drop]');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('is-over');
  takeFile(e.dataTransfer.files[0]);
});

$('[data-send-receipt]').addEventListener('click', async () => {
  if (!receipt || !pending) return;
  const button = $('[data-send-receipt]');
  button.disabled = true;
  button.textContent = tx('Отправляем чек…');
  $('[data-pay-error]').textContent = '';
  try {
    const paid = await api.sendReceipt(pending.token, receipt);
    showDone(paid?.day_number, paid?.branch);
  } catch (err) {
    // Чек мог дойти, а ответ потеряться (связь) — тогда база уже приняла заказ и дала номер: не держим покупателя на оплате
    const s = await api.orderStatus(pending.token).catch(() => null);
    if (s?.day_number && s.status !== 'awaiting_payment') { showDone(s.day_number, s.branch); return; }
    $('[data-pay-error]').textContent = receiptMessage(err);
    button.disabled = false;
  } finally {
    button.textContent = tx('Отправить чек');
  }
});
$('[data-send-receipt]').textContent = tx('Отправить чек');

$('[data-cancel]').addEventListener('click', async () => {
  if (!pending || !confirm(tx('Отменить заказ на {sum}?', { sum: money(pending.total) }))) return;
  try { await api.cancelUnpaid(pending.token); } catch { /* заказ без чека менеджер всё равно не повезёт */ }
  pending = null;
  storage.set(PENDING_KEY, null);
  show('form');
});

/* ---------- Готово ---------- */

// Номер заказа на день (с № 1 каждый день) база даёт, когда приложен чек (supabase/day-numbers.sql).
// До оплаты номера нет; pending.number — внутренний id, показываем его, только если номера на день нет вовсе.
// Номера за день у каждой точки свои — рядом точка заказа: та, что база вернула вместе с номером (если отдаёт),
// иначе та, что определил сайт при оформлении; не определилась (или заказ из прошлой версии сайта) — номер без точки
function showDone(dayNumber, dayBranch) {
  const number = dayNumber || pending.number;
  const branch = (dayNumber && dayBranch) || pending.branch || null;
  // Оплаченный заказ отслеживаем дальше: шкала статуса — до доставки, и после перезагрузки страницы тоже
  // wait: время доставки своей точки на момент оплаты; null — база так и не ответила, запасные 90 минут не запоминаем:
  // возьмём время из панели, когда она ответит. С 018 — ещё способ, состав и адрес: для экрана заказа (самовывоз, «Детали»)
  const track = { token: pending.token, number, branch, total: pending.total, phone: pending.phone, when: pending.when || '', wait: knownWait(branch), at: Date.now(),
    delivery: pending.delivery?.price ? { price: pending.delivery.price, approx: pending.delivery.approx } : null, point: pending.point || null,
    whenAt: Number.isFinite(pending.whenAt) ? pending.whenAt : null, fulfillment: pending.fulfillment === 'pickup' ? 'pickup' : 'delivery',
    qty: Number(pending.qty) || null, fee: Number(pending.fee) || 0, address: pending.address || '', entrance: pending.entrance || '',
    floor: pending.floor || '', apartment: pending.apartment || '', door: pending.door === true };
  linkTrack = null; // только что оплаченный заказ — главный, его и отслеживаем
  storage.set(TRACK_KEY, track);
  orderExtra = null;
  deliveryNow = null;
  fillDone(track);
  $('[data-done-reach]').hidden = false;
  $('[data-done-time]').textContent = doneTime(track);
  $('[data-done-time]').hidden = false;
  rememberOrder(track);
  formChosen = false;
  pending = null;
  storage.set(PENDING_KEY, null);
  setReceipt(null);
  // Шкала, карта и оценка прибытия прошлого заказа не мелькают над новым: до первого ответа базы о нём их нет
  forgetTrackView();
  show('done');
  startTracking();
}
/** Убрать шкалу, карту «Едем» и оценку прибытия прежнего заказа (новый оплачен — его статус ещё не пришёл) */
function forgetTrackView() {
  trackShown = false;
  lastStatus = null;
  etaFor = null;
  etaShown = null;
  etaCourier = null;
  $('[data-track]').hidden = true;
  $('[data-track]').textContent = '';
  $('[data-track-map]').hidden = true;
}

/**
 * «Мои заказы» и «Мои адреса» (history.js) — только на этом телефоне: оплаченный заказ (для «Повторить») и адрес доставки
 * («Дом», если такого адреса ещё нет; название покупатель поменяет в «Мои адреса»). Оболочке — kokoro:history
 */
function rememberOrder(t) {
  if (!t.qty) return; // заказ из прошлой версии сайта (оформлен до 018) — состава не знаем
  const whenText = t.when && Number.isFinite(t.whenAt) && dayWords(t.whenAt) ? `${t.when}, ${dayFormat(t.whenAt).split(' ')[1]}` : t.when;
  orderHistory.add({ token: t.token, number: t.number, branch: t.branch, at: t.at, qty: t.qty, total: t.total, fulfillment: t.fulfillment,
    address: t.address, entrance: t.entrance, floor: t.floor, apartment: t.apartment, door: t.door, when: whenText,
    delivery: t.delivery, point: t.point ? { ...t.point, label: t.address } : null, status: 'new' });
  if (t.fulfillment === 'delivery' && t.address) {
    addresses.save({ address: t.address, entrance: t.entrance, floor: t.floor, apartment: t.apartment,
      point: t.point ? { ...t.point, label: t.address } : null });
    renderSavedAddrs();
  }
  emit('kokoro:history');
}

/* ---------- Статус оплаченного заказа для покупателя ---------- */

// Статус — тот, что менеджер ставит в панели; база отдаёт его только по секретному ключу заказа.
// Пока страница на экране — проверяем раз в 20 секунд, на «Доставлен» и «Отменён» перестаём.
// Заказ в работе и оплачен меньше 3 часов назад — главный экран «Заказ принят» со шкалой. Доставлен, отменён
// или прошло 3 часа (вдруг менеджер забыл поставить «Доставлен») — одна строка над формой, чтобы заказать снова.
// Оплачен ночью или утром — 3 и 12 часов считаем от 12:00, когда начинаем возить (data.js → deliveryStart)
const TRACK_EVERY_MS = 20_000;
const TRACK_FULL_HOURS = 3;
const ACTIVE = ['new', 'confirmed', 'cooking', 'delivering'];
let trackTimer = null;
let formChosen = false; // покупатель нажал «Сделать ещё заказ» — не возвращаем его на экран статуса
// Экран заказа сверх order_status (specs/018, order_extra): способ, «до двери», к какому времени обещали, готово ли с кухни,
// оценка, чат. Спрашиваем вместе со статусом (тот же опрос раз в 20 с); база без 018 — null, экран работает как раньше
let orderExtra = null;
let extraToken = null; // для какого заказа orderExtra
let lastStatus = null; // { s, saved } — последний ответ order_status: кольцо пересчитываем раз в 30 с без нового запроса
const extraOf = (saved) => (saved?.token && extraToken === saved.token ? orderExtra : null);
/** Способ получения заказа: из базы (order_extra), без неё — что запомнил браузер */
const fulfillmentOf = (saved) => (extraOf(saved)?.fulfillment || saved?.fulfillment) === 'pickup' ? 'pickup' : 'delivery';
const doorOf = (saved) => (extraOf(saved) ? extraOf(saved).door === true : saved?.door === true);

// Сумма доставки сейчас — из базы (order_delivery), та же, что у курьера: включили дождь после оформления — у курьера +100,
// и покупатель видит то же (владелец, 13.11.2026). Базы нет или не ответила — что запомнил браузер при оформлении
let deliveryNow = null;
let deliveryToken = null;
const deliveryOf = (saved) => (saved?.token && deliveryToken === saved.token && deliveryNow?.price ? deliveryNow : saved?.delivery);
const rainPart = (q) => (q?.price && Number(q.rain) > 0 ? ` (${tx('в том числе за дождь {sum}', { sum: moneyTight(Number(q.rain)) })})` : '');

/** Что отдать курьеру на экране заказа: доставка (и «до двери», если отмечено) */
const courierText = (saved) => {
  const q = deliveryOf(saved);
  return `${deliverySum(q)}${rainPart(q)}${doorOf(saved) ? ` + ${tx('До двери').toLowerCase()} ${moneyTight(door.fee)}` : ''}`;
};

// «Написать в WhatsApp» на экране заказа (вместо «Позвонить», владелец 17.11.2026) — номер точки заказа (11.11.2026: у Кулиева
// и Кок-Жара свои номера). Сообщение уже начато, с номером заказа и точкой, — менеджеру не переспрашивать. Текст всегда
// по-русски: его читает менеджер, покупатель может поправить перед отправкой
function renderWhatsApp(saved) {
  const link = $('[data-done-wa]');
  if (!link) return;
  const branch = branchName(saved.branch);
  const about = saved.number ? `по заказу № ${saved.number}${branch ? ` (${branch})` : ''}` : 'по заказу с сайта';
  link.href = `https://wa.me/${branchPhone(saved.branch).phone}?text=${encodeURIComponent(`Здравствуйте! Пишу ${about}.`)}`;
}

function fillDone(saved) {
  renderNo($('[data-done-num]'), saved.number, saved.branch);
  renderWhatsApp(saved);
  $('[data-done-total]').textContent = saved.total ? money(saved.total) : '—';
  $('[data-done-phone]').textContent = saved.phone || '';
  // Открыл по ссылке из WhatsApp — менеджер уже на связи, «свяжется в течение 20 минут» не пишем
  $('[data-done-reach]').hidden = !saved.phone;
  $('[data-done-contact]').textContent = doneContact(saved);
  $('[data-done-time]').textContent = doneTimeLine(saved);
  $('[data-done-delivery]').textContent = courierText(saved);
  // Самовывоз — курьера нет: вместо «доставку оплатите курьеру» — где забрать, и подтверждать менеджер будет только время
  const pickup = fulfillmentOf(saved) === 'pickup';
  // Два платежа крупно: комбо оплачено по QR, доставку — курьеру (доставка в сумме по QR — курьеру только «до двери»)
  const savedFee = Number(saved.fee) || 0;
  fillSplit($('[data-done-split]'), { qr: Number(saved.total) || 0, qrWhat: tx(!pickup && savedFee ? 'за комбо и доставку' : 'за комбо'),
    courier: pickup ? null : savedFee ? (doorOf(saved) ? { sum: moneyTight(door.fee), detail: tx('до двери') } : null)
      : courierCard(deliveryOf(saved), doorOf(saved) ? door.fee : 0) });
  const s = statusFor(saved);
  const kitchen = branchInfo[s && s.branch !== undefined ? s.branch || saved.branch : saved.branch]?.kitchen;
  $('[data-done-reach-tail]').textContent = `${tx(pickup ? payment.pickupDoneReach : ', чтобы подтвердить адрес и время доставки.')} `;
  $('[data-done-courier]').hidden = pickup;
  $('[data-done-where]').hidden = !(pickup && kitchen);
  $('[data-done-where]').textContent = pickup && kitchen ? tx(payment.pickupDoneWhere, { address: tx(kitchen) }) : '';
  renderOrderScreen();
}

// Подсказка под шкалой. Оплачен ночью или утром и 12:00 ещё не наступили — «скоро напишет» не обещаем (TRACK → later)
const trackHint = (step, saved) => tx(step.later && Date.now() < deliveryStart(paidAt(saved)) ? step.later : step.hint);

// Курьер и его номер (specs/024): только в «Едем» — база отдаёт номер, пока заказ в пути. Имя курьеры часто пишут
// заглавными («БЕКБОЛСУН») — показываем «Бекболсун»
const nameCase = (name) => (name === name.toUpperCase() ? name.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : name);
const phoneText = (p) => (/^\+996\d{9}$/.test(p) ? `+996 ${p.slice(4, 7)} ${p.slice(7, 10)} ${p.slice(10)}` : p);
function courierCallHtml(s) {
  const c = s.status === 'delivering' ? s.courier : null;
  const phone = typeof c?.phone === 'string' && /^\+[1-9]\d{9,14}$/.test(c.phone) ? c.phone : null;
  if (!phone) return '';
  const name = typeof c.name === 'string' ? c.name.trim().slice(0, 40) : '';
  return `<div class="track__call">
      <p class="track__call-who">${escHtml(name ? tx('Ваш курьер — {name}', { name: nameCase(name) }) : tx('Ваш курьер'))}<span class="track__call-phone">${escHtml(phoneText(phone))}</span></p>
      <a class="btn btn--tray track__call-btn" href="tel:${phone}">${escHtml(tx('📞 Позвонить курьеру'))}</a>
    </div>`;
}

// Где курьер: только в «Едем» и только свежее место (база отдаёт его не старше 15 минут)
function courierHtml(s) {
  const loc = s.status === 'delivering' ? s.courier?.location : null;
  if (!loc) return '';
  return `<p class="track__courier"><a href="${pointLink(loc)}" target="_blank" rel="noopener">${escHtml(tx('📍 Где курьер сейчас'))}</a> · ${escHtml(tx('обновлено {ago}', { ago: agoWords(loc.at) }))}</p>`;
}

// Курьер сам набирает до нескольких заказов (specs/014-courier-pickup), база отдаёт courier.others — сколько ещё его
// заказов в пути. Честно предупреждаем, что наш может быть не первым: только в «Едем» и только если другие есть.
// Ключа нет (база до courier-pickup.sql) или 0 — строки нет. От места курьера не зависит: геопозицию он мог не дать.
// Без aria-live — смену статуса объявляет подсказка, а это оговорка к ней, не повод говорить на каждом опросе
function loadHtml(s) {
  const others = s.status === 'delivering' ? Number(s.courier?.others) : 0;
  if (!(others > 0)) return '';
  return `<p class="track__load">${escHtml(tx('Курьер везёт ещё {orders} — ваш может быть не первым', { orders: ordersWords(others) }))}</p>`;
}

/* ---------- «Курьер приедет примерно через N минут» (specs/016-courier-eta) ---------- */

// Только в «Едем» и только когда известна точка заказа — дом на карте: та, что в базе (order_status отдаёт её по ключу
// оплаты), а нет её там (не записалась) — та, что этот браузер запомнил при заказе. Открыт по коду из ссылки без точки — строки нет.
// 1) Свежее место курьера (не старше 5 минут): время по дорогам от курьера до дома → «примерно через 15 минут».
// 2) Места нет или оно старое (страница курьера закрыта, телефон заблокирован): время выезда + время по дорогам от кухни
//    точки до дома → «примерно к 18:40»; это время прошло — «с минуты на минуту».
//    Место есть, но ему 5–15 минут (база отдаёт до 15 минут, и метка курьера на карте его показывает) — берём позднее из двух:
//    время по кухне или «когда было это место + путь от него» (путь спрашиваем по тем же правилам «раз в минуту и 150 м»).
//    Пути от этого места ещё не знаем — «с минуты на минуту» не пишем, остаётся «Курьер уже едет к вам»: метка может быть далеко.
// Время по дорогам — у тех же бесплатных сервисов, что считают сумму доставки (map.js → roadMinutes), × 1,3 на пробки
// + 3 минуты на передачу заказа. Курьер везёт ещё заказы — вилка: к верхней границе + 10 минут на каждый другой заказ.
// От места курьера — нынешнее число других заказов: считаем от сейчас, отданные заказы позади. От выезда — наибольшее,
// какое видели с выезда (помним вместе с путём от кухни): отдал курьер чужой заказ — время на него с выезда уже потрачено,
// и обещание не должно становиться раньше.
// Сервисы не ответили — по прямой × 1,3 (дороги длиннее прямой) со скоростью 25 км/ч: это уже скорость по городу с пробками,
// поэтому × 1,3 на пробки сверху не добавляем. Округляем до 5 минут, не меньше 5: точнее мы всё равно не знаем.
// Без aria-live: оценка меняется каждую минуту, экранный диктор не должен объявлять её на каждом опросе.
//
// Время выезда. Отдельную отметку «ушёл в путь» order_status не отдаёт (в базе она есть — orders.delivering_at, specs/014,
// но только для панели), поэтому берём updated_at: его ставит база при каждом изменении заказа (harden.sql), а курьер
// кнопкой «Забрал — еду» ставит «В пути» одним действием. Место курьера пишется в отдельную таблицу и updated_at заказа
// не трогает; «Доставил» по чужому заказу — тоже. Неточно в двух случаях:
// 1) updated_at позже выезда: менеджер поставил «В пути» в панели, когда курьер уже уехал, или заказ правили уже в пути
//    (сменил курьера, дописал заметку). Оценка выходит позже настоящей — обещаем позже, чем приедет: безопасная сторона.
// 2) updated_at раньше выезда: курьер нажал «Забрал — еду» у первого пакета и ещё ждал у кухни остальные (так задумано —
//    courier-guide.md, specs/015: до 5 минут ожидания). Оценка выходит раньше настоящей на время ожидания. Отчасти это видно
//    и сайту: пока наш заказ «В пути», число других заказов курьера выросло — он добрал заказ, значит, в этот опрос ещё стоял
//    у кухни: выезд считаем не раньше этого опроса (помним вместе с путём от кухни).
// Начнёт база отдавать delivering_at (ключ в ответе) — берём его: правки после ухода «В пути» его не двигают (случай 1),
// но случай 2 он не исправит — ставится в тот же момент, что и updated_at.
// Часы: выезд и место курьера — по часам базы. По часам телефона покупателя — только «сейчас» и время опроса, в который
// курьер добрал заказ (часов базы сайт не знает; телефоны сверяют время сами, расхождение — секунды).
const ETA_FRESH_MS = 5 * 60_000; // место курьера свежее — не старше 5 минут
const ETA_OLD_MS = 15 * 60_000; // место старше 5 минут, но не старше 15 (столько его отдаёт база): «курьер не раньше, чем …»
const ETA_TRAFFIC = 1.3; // поправка на пробки ко времени сервисов (они считают по свободным дорогам)
const ETA_HANDOVER_MIN = 3; // подняться, отдать заказ
const ETA_PER_ORDER_MIN = 10; // на каждый другой заказ курьера — к верхней границе вилки
const ETA_CITY_KMH = 25; // по прямой, когда сервисы не ответили
const ETA_ASK_EVERY_MS = 60_000; // от курьера спрашиваем не чаще раза в минуту…
const ETA_MOVED_KM = 0.15; // …и только если он сдвинулся больше чем на 150 м
// «С минуты на минуту» уже час — оценка явно не сбылась (курьер развозит другие заказы или «Доставлен» забыли поставить):
// дальше не обещаем, остаётся «Курьер уже едет к вам»
const ETA_GIVE_UP_MIN = 60;
// Время от кухни до дома — один раз за заказ, помним до закрытия вкладки (как найденные адреса в map.js); там же —
// сколько других заказов было у курьера с выезда и когда он добрал заказ (etaNote)
const ETA_KEY = 'kokoro.eta';
const ETA_SOON = 'Курьер должен быть у вас с минуты на минуту';
// Экран «Заказ принят», пока на шкале оценка прибытия: вместо «Вы получите заказ примерно к …» (doneTimeLine)
const ETA_DONE_TIME = 'Заказ уже в пути.';

let etaFor = null; // { s, saved } — последний ответ базы: пришёл ответ сервиса — строку дорисовываем по нему
let etaCourier = null; // { token, from, to, at, trip } — последний запрос от курьера: откуда, куда, когда спросили, минут до передачи
let etaMemo = null; // { token, rec } — память заказа (etaRead) и в памяти страницы: без sessionStorage не спрашиваем по кругу
let etaAsking = false; // запрос к сервисам маршрутов идёт — второй не шлём
let etaShown = null; // { token, text } — что показали: пока ждём новый ответ сервиса, строка не пропадает

const etaPlace = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && inZone(p.lat, p.lon);
const samePlace = (a, b) => Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;
const placeKey = (p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

/**
 * Что помним о заказе до закрытия вкладки: key и trip — путь от кухни до дома (минут до передачи) и для какой кухни и дома;
 * most — наибольшее число других заказов курьера, виденное «В пути»; last — сколько их было в прошлый опрос;
 * after — выезд не раньше этого времени (мс): курьер добрал заказ, пока наш уже был «В пути»
 */
function etaRead(token) {
  if (etaMemo?.token === token) return etaMemo.rec;
  try {
    const hit = JSON.parse(sessionStorage.getItem(ETA_KEY) || '{}')[token];
    return hit && typeof hit === 'object' ? hit : {};
  } catch { return {}; }
}
function etaWrite(token, patch) {
  const rec = { ...etaRead(token), ...patch, t: Date.now() };
  etaMemo = { token, rec };
  try {
    const all = JSON.parse(sessionStorage.getItem(ETA_KEY) || '{}');
    all[token] = rec;
    const recent = Object.entries(all).sort((a, b) => b[1].t - a[1].t).slice(0, 10); // старые заказы не копим
    sessionStorage.setItem(ETA_KEY, JSON.stringify(Object.fromEntries(recent)));
  } catch { /* приватный режим — помним только до перезагрузки страницы */ }
}

/** Путь от кухни до дома этого заказа (минут до передачи), если уже спрашивали; key — какая кухня и какой дом */
function etaKitchenKnown(token, key) {
  const rec = etaRead(token);
  return rec.key === key && Number.isFinite(rec.trip) ? rec.trip : null;
}
const etaKitchenSave = (token, key, trip) => etaWrite(token, { key, trip });

/**
 * Опрос «В пути»: запомнить, сколько других заказов у курьера. Отдаёт { most — наибольшее с выезда, after — выезд не раньше
 * (мс; null — не знаем) }. Число выросло с прошлого опроса — курьер добрал заказ, то есть в этот опрос ещё стоял у кухни
 */
function etaNote(token, others, now) {
  const rec = etaRead(token);
  const patch = {};
  if (!(rec.most >= others)) patch.most = others;
  if (Number.isFinite(rec.last) && others > rec.last) patch.after = Math.max(Number(rec.after) || 0, now);
  if (rec.last !== others) patch.last = others;
  if (Object.keys(patch).length) etaWrite(token, patch);
  const seen = { ...rec, ...patch };
  return { most: seen.most, after: Number.isFinite(seen.after) ? seen.after : null };
}
/** Заказ не «В пути» (вернули в «Готовится» — повезут заново): прежняя поездка не в счёт, путь от кухни остаётся */
function etaForget(token) {
  const rec = etaRead(token);
  if (['most', 'last', 'after'].some((k) => rec[k] !== undefined)) etaWrite(token, { most: undefined, last: undefined, after: undefined });
}

/** Кухня, откуда везут: своей точки; точки нет — по дому (Кулиева или Кок-Жар); дом за концами линии — ближайшая */
function etaKitchen(branch, to) {
  return branchKitchen(branch) || branchKitchen(branchAt(to.lat, to.lon))
    || [...delivery.kitchens].sort((a, b) => distanceKm(a, to) - distanceKm(b, to))[0];
}

const round5 = (minutes) => Math.max(5, Math.round(minutes / 5) * 5);
const roundClock = (ms) => Math.round(ms / 300_000) * 300_000; // до 5 минут
/** «примерно через 15 минут», с вилкой — «15–35 минут». Числа кратны 5, поэтому всегда «минут» */
function etaIn(trip, others) {
  const lo = round5(trip);
  const hi = round5(trip + ETA_PER_ORDER_MIN * others);
  return tx('Курьер приедет примерно через {n} минут', { n: lo === hi ? lo : `${lo}–${hi}` });
}
/**
 * К часу (от выезда; lo и hi — начало и конец вилки, мс): «примерно к 18:40», с вилкой — «к 18:40–19:00». Начало вилки
 * прошло — «к 19:00»: курьер может быть у дома в любую минуту до неё; прошла и верхняя граница — «с минуты на минуту»;
 * прошёл ещё час — ничего
 */
function etaAt(lo, hi, now) {
  lo = roundClock(lo);
  hi = roundClock(hi);
  if (now >= hi + ETA_GIVE_UP_MIN * 60_000) return '';
  if (now >= hi) return tx(ETA_SOON);
  if (now >= lo || lo === hi) return tx('Курьер приедет примерно к {t}', { t: clock.format(hi) });
  return tx('Курьер приедет примерно к {t}', { t: `${clock.format(lo)}–${clock.format(hi)}` });
}

/**
 * Оценка по тому, что уже известно: null — строки нет совсем (не «Едем», нет точки заказа, не от чего считать);
 * { text, ask, keep } — text: строка ('' — сервисы ещё не спрашивали), ask: что спросить у сервисов маршрутов сейчас
 * (или null), keep: false — пока ждём ответ, прежнюю строку не оставлять
 */
function etaState(s, saved, now = Date.now()) {
  if (s.status !== 'delivering') { etaForget(saved.token); return null; }
  const others = Math.max(0, Number(s.courier?.others) || 0);
  const seen = etaNote(saved.token, others, now); // и без точки заказа: поездку помним целиком
  const to = etaPlace(s.point) ? s.point : etaPlace(saved.point) ? saved.point : null;
  if (!to) return null;
  const loc = s.courier?.location;
  const age = etaPlace(loc) ? now - Date.parse(loc.at) : NaN;
  // Путь от места курьера: спрашивали меньше минуты назад или курьер сдвинулся не больше чем на 150 м — берём прежний
  const known = etaCourier?.token === saved.token && samePlace(etaCourier.to, to) ? etaCourier : null;
  const courierAsk = () => (!known || (now - known.at >= ETA_ASK_EVERY_MS && distanceKm(known.from, loc) > ETA_MOVED_KM)
    ? { kind: 'courier', from: { lat: loc.lat, lon: loc.lon }, to } : null);
  if (age <= ETA_FRESH_MS) return { text: known ? etaIn(known.trip, others) : '', ask: courierAsk() };
  const server = Date.parse(s.delivering_at || s.updated_at);
  if (!Number.isFinite(server)) return null;
  const left = Math.max(server, seen.after ?? -Infinity); // добрал заказ после «В пути» — выезд не раньше того опроса
  const kitchen = etaKitchen(saved.branch, to);
  const key = `${placeKey(kitchen)}>${placeKey(to)}`;
  const trip = etaKitchenKnown(saved.token, key);
  if (trip === null) return { text: '', ask: { kind: 'kitchen', from: { lat: kitchen.lat, lon: kitchen.lon }, to, key } };
  // От выезда — наибольшее число других заказов с выезда: отданные заказы потраченное на них время не возвращают
  const most = Math.max(others, seen.most || 0);
  let lo = left + trip * 60_000;
  let hi = left + (trip + ETA_PER_ORDER_MIN * most) * 60_000;
  if (!(age <= ETA_OLD_MS)) return { text: etaAt(lo, hi, now), ask: null };
  // Место 5–15 минут назад: курьер приедет не раньше, чем «тогда + путь оттуда» (вилка — по нынешнему числу заказов,
  // как от свежего места). Берём позднее из двух
  const ask = courierAsk();
  if (known) {
    const at = Date.parse(loc.at);
    lo = Math.max(lo, at + known.trip * 60_000);
    hi = Math.max(hi, at + (known.trip + ETA_PER_ORDER_MIN * others) * 60_000);
    return { text: etaAt(lo, hi, now), ask };
  }
  // Пути от этого места ещё не знаем — «с минуты на минуту» не обещаем (и прежнюю строку не держим): метка может быть далеко
  const text = etaAt(lo, hi, now);
  return text === tx(ETA_SOON) ? { text: '', ask, keep: false } : { text, ask };
}

/**
 * Спросить время в пути у сервисов маршрутов и дорисовать строку. Не ответили (или пути нет) — по прямой. Ответ помним
 * и когда сервисы молчали: от кухни больше не спрашиваем за этот заказ, от курьера — по тем же правилам «раз в минуту и 150 м».
 * Ошибка здесь не должна ломать страницу — строки просто не будет
 */
async function etaAsk(ask, token) {
  if (etaAsking) return;
  etaAsking = true;
  const sentAt = Date.now();
  try {
    const road = await roadMinutes(ask.from, ask.to).catch(() => null);
    const trip = road !== null
      ? road * ETA_TRAFFIC + ETA_HANDOVER_MIN
      : distanceKm(ask.from, ask.to) * DETOUR / ETA_CITY_KMH * 60 + ETA_HANDOVER_MIN;
    if (ask.kind === 'courier') etaCourier = { token, from: ask.from, to: ask.to, at: sentAt, trip };
    else etaKitchenSave(token, ask.key, trip);
  } catch {
    return;
  } finally {
    etaAsking = false;
  }
  etaPlaceLine();
}

/** Строка оценки для шкалы; нужен новый ответ сервиса — спрашиваем (строку дорисует etaPlaceLine) */
function etaHtml(s, saved) {
  const state = etaState(s, saved);
  if (!state) { etaShown = null; return ''; }
  if (state.ask) etaAsk(state.ask, saved.token);
  // Ждём ответ — оставляем прежнюю строку этого заказа (например, «к 18:40», пока считаем путь от курьера)
  const text = state.text || (state.ask && state.keep !== false && etaShown?.token === saved.token ? etaShown.text : '');
  etaShown = text ? { token: saved.token, text } : null;
  // Неразрывные пробелы: на узком экране «минут» не отрывается от числа, а «к» — от часа
  return text ? `<p class="track__eta">${text.replace(/ минут$/, '\u00a0минут').replace(/ к /, ' к\u00a0')}</p>` : '';
}

/** Ответ сервиса пришёл — строка по последнему ответу базы, на своём месте: сразу под подсказкой «Курьер уже едет к вам» */
function etaPlaceLine() {
  if (!etaFor || etaFor.saved.token !== getTrack()?.token) return;
  const box = $('[data-track]');
  const html = etaHtml(etaFor.s, etaFor.saved);
  const old = box.querySelector('.track__eta');
  if (old) old.remove();
  if (html) box.querySelector('.track__hint')?.insertAdjacentHTML('afterend', html);
  $('[data-done-time]').textContent = doneTimeLine(etaFor.saved); // оценка появилась или пропала — и строка о времени
}

// Строка о времени на экране «Заказ принят». Пока на шкале оценка прибытия курьера, прежнее «Вы получите заказ примерно
// к …» (время оплаты + время доставки точки) — второй, другой срок на том же экране, а когда курьер опаздывает, ещё и
// прошедший: вместо него «Заказ уже в пути». Заказали «Ко времени» — «Вы просили привезти к …» оставляем: это не наше
// обещание, а время, которое назвал сам покупатель
function doneTimeLine(t) {
  return !t.when && etaShown?.token === t.token ? tx(ETA_DONE_TIME) : doneTime(t);
}

/**
 * Шкала для покупателя (specs/018): доставка — TRACK, а когда кухня отметила готовность (ready_at) — с шагом «Готов» между
 * «Готовится» и «Едем»; самовывоз — TRACK_PICKUP («Готов — заберите» по ready_at). i — текущий шаг (-1 — «Ждёт оплаты»)
 */
function trackSteps(s, saved) {
  const readyAt = Boolean(extraOf(saved)?.ready_at);
  const ready = readyAt && ['confirmed', 'cooking'].includes(s.status);
  if (fulfillmentOf(saved) === 'pickup') {
    const status = ready || s.status === 'delivering' ? 'ready' : s.status;
    return { steps: TRACK_PICKUP, i: TRACK_PICKUP.findIndex((step) => step.status === status) };
  }
  const steps = readyAt ? [...TRACK.slice(0, 3), READY_STEP, ...TRACK.slice(3)] : TRACK;
  return { steps, i: steps.findIndex((step) => step.status === (ready ? 'ready' : s.status)) };
}

function renderTrack(s, saved) {
  const box = $('[data-track]');
  // Ссылка «Написать в WhatsApp» — в fillDone: менеджер передал заказ другой точке — ниже fillDone с новой точкой и номером
  etaFor = { s, saved };
  const before = lastStatus?.saved.token === saved.token ? lastStatus.s.status : null; // что было на прошлом опросе
  lastStatus = { s, saved };
  // Точка заказа — та, что в базе (order_status отдаёт её с two-points.sql): менеджер мог передать заказ другой точке, а заказу,
  // у которого сайт точку не определил, база ставит её сама при оплате. Ключа нет (база без two-points.sql) — точка от сайта
  const branch = s.branch !== undefined ? s.branch || null : saved.branch || null;
  // Открыт по ссылке ?z= — о заказе в этом браузере ничего не было: номер, точка, сумма, время оплаты и «ко времени» — из базы
  if (saved.link) {
    const paid = Date.parse(s.paid_at) || saved.at;
    setTrack(Object.assign(saved, { total: s.total, number: s.day_number || s.number, branch, at: paid, when: whenOf(s.delivery_time), whenAt: deliveryAt(paid, s.delivery_time) }));
  }
  // Номер или точка сменились: менеджер передал заказ другой точке (там у него новый номер), база поставила точку сама
  // или заказ оплачен до номеров по дням. Запоминаем; «примерно к …» — по времени новой точки, если оно известно
  // (неизвестно — wait: null, возьмём время точки из панели, когда та ответит). Открыт экран «Заказ принят» —
  // крупный номер и время перерисовываем; на форме нового заказа — только строка над ней
  const number = s.day_number || saved.number;
  if (number !== saved.number || branch !== (saved.branch || null)) {
    const patch = { number, branch };
    if (branch !== (saved.branch || null)) patch.wait = branchWait(branch);
    setTrack(Object.assign(saved, patch));
    if (currentStep === 'done') fillDone(saved);
  }
  const { steps, i } = trackSteps(s, saved);
  const full = ACTIVE.includes(s.status) && !formChosen && Date.now() - deliveryStart(saved.at) < TRACK_FULL_HOURS * 3_600_000;
  // Вернулся на сайт с заказом в работе — сразу экран «Заказ принят», а не форма нового заказа
  if (full && currentStep === 'form' && !pending) { fillDone(saved); show('done'); }
  // Оценка прибытия — раньше строки о времени: пока она на шкале, «Вы получите заказ примерно к …» не пишем (doneTimeLine)
  const eta = etaHtml(s, saved);
  $('[data-done-time]').textContent = doneTimeLine(saved);
  // Доставлен или отменён, пока открыт экран «Заказ принят», — обещание «привезём к …» убираем. По ссылке, без
  // времени оплаты (взят в работу без чека) и без «ко времени» — не от чего считать, не обещаем
  $('[data-done-time]').hidden = !ACTIVE.includes(s.status) || (saved.link && !s.paid_at && !saved.when);
  const title = `<p class="track__title">${escHtml(tx('Ваш заказ'))} ${escHtml(orderNo(Number(s.day_number || saved.number || s.number), saved.branch))}${i >= 0 ? ` · <span>${escHtml(tx(steps[i].label))}</span>` : ''}</p>`;
  // После доставки — «Оценить заказ» прямо в строке над формой (экран заказа с оценкой — по нажатию)
  const rate = !full && extraOf(saved)?.can_rate && !rated.has(saved.token)
    ? `<button class="linkbtn track__rate" type="button" data-rate-open${currentStep === 'done' ? ' hidden' : ''}>${escHtml(tx('Оценить заказ'))}</button>` : '';
  if (s.status === 'canceled') {
    // «Напишите нам» — ссылка на WhatsApp точки (17.11.2026: вместо звонка)
    box.innerHTML = `${title}<p class="track__hint track__hint--bad">${escHtml(tx('Заказ отменён. Если вы уже оплатили — напишите нам:'))} <a href="https://wa.me/${branchPhone(saved.branch).phone}" target="_blank" rel="noopener">WhatsApp ${branchPhone(saved.branch).phoneLabel}</a></p>`;
  } else if (i >= 0 && !full) {
    // Свёрнутая строка над формой: заказ ещё едет — оговорка про другие заказы курьера тоже здесь, как и «Где курьер»
    box.innerHTML = `${title}<p class="track__hint" aria-live="polite">${escHtml(trackHint(steps[i], saved))}</p>${eta}${courierCallHtml(s)}${courierHtml(s)}${loadHtml(s)}${rate}`;
  } else if (i >= 0) {
    box.innerHTML = `${title}<ol class="track__steps track__steps--${steps.length}">${steps.map((step, k) =>
      `<li class="${k < i ? 'is-done' : k === i ? 'is-now' : ''}"${k === i ? ' aria-current="step"' : ''}><span class="track__dot" aria-hidden="true"></span>${escHtml(tx(step.label))}</li>`).join('')}</ol>
      <p class="track__hint" aria-live="polite">${escHtml(trackHint(steps[i], saved))}</p>${eta}${courierCallHtml(s)}${courierHtml(s)}${loadHtml(s)}`;
  } else {
    trackShown = false; // «Ждёт оплаты» — шкалу не показываем, у покупателя свой шаг оплаты
    box.hidden = true;
    emitTrack(s, saved);
    return;
  }
  trackShown = true;
  box.hidden = currentStep === 'pay';
  renderTrackMap(s, full);
  // Движение: новый шаг шкалы «вспыхивает»; доставлен или выдан, пока открыт экран заказа, — салют из крошек
  const stepKey = `${saved.token}:${i >= 0 ? steps[i].status : s.status}:${steps.length}`;
  if (full && i >= 0 && lastStepKey?.startsWith(`${saved.token}:`) && lastStepKey !== stepKey) flashStep(box);
  lastStepKey = stepKey;
  if (before && ACTIVE.includes(before) && s.status === 'done' && currentStep === 'done') salute();
  syncHistory(s, saved);
  emitTrack(s, saved);
  renderOrderScreen();
}

/**
 * Плашка активного заказа в оболочке (app.js): номер, точка, статус, способ и к какому времени обещали. Заказа в работе
 * больше нет (доставлен, отменён, забыт) — { active: false }
 */
function emitTrack(s, saved) {
  if (!s || !saved || !ACTIVE.includes(s.status)) { emit('kokoro:track', { active: false }); return; }
  const promise = promiseAt(s, saved);
  emit('kokoro:track', { active: true, token: saved.token, number: s.day_number || saved.number || null,
    branch: s.branch !== undefined ? s.branch || null : saved.branch || null, status: s.status, fulfillment: fulfillmentOf(saved),
    promise_at: Number.isFinite(promise) ? new Date(promise).toISOString() : null });
}

/** «Мои заказы»: статус, номер и точка заказа — как в базе (на телефоне, history.js); поменялось — оболочке kokoro:history */
function syncHistory(s, saved) {
  const entry = orderHistory.get(saved.token);
  if (!entry) return;
  const patch = { status: s.status, number: s.day_number || saved.number || entry.number, branch: s.branch !== undefined ? s.branch || null : entry.branch };
  if (extraOf(saved)?.rated_at) patch.rated = true;
  const same = patch.status === entry.status && String(patch.number ?? '') === String(entry.number ?? '') && patch.branch === entry.branch
    && (!patch.rated || entry.rated);
  if (same) return;
  orderHistory.update(saved.token, patch);
  emit('kokoro:history');
}

// Карта «Едем»: курьер (свежее место) и своя точка доставки (её база отдаёт только по ключу оплаты). На экране
// «Заказ принят» и только пока заказ в пути; карту не пересоздаём на каждом опросе — двигаем метки
let trackReady = null; // Promise<{ L, map, layer }>: два опроса подряд не создают карту дважды
async function renderTrackMap(s, full) {
  const el = $('[data-track-map]');
  const loc = s.status === 'delivering' ? s.courier?.location : null;
  const show = Boolean(full && loc && currentStep === 'done');
  el.hidden = !show;
  if (!show) return;
  try {
    trackReady ||= createMap(el);
    const { L, map, layer } = await trackReady;
    map.invalidateSize();
    layer.clearLayers();
    pin(L, loc, '🛵', 'courier', tx('Курьер')).addTo(layer);
    if (s.point) pin(L, s.point, '🏠', 'home', tx('Точка доставки')).addTo(layer);
    fit(map, [loc, s.point]);
  } catch {
    trackReady = null; // не загрузилась — со следующим опросом попробуем снова
    el.hidden = true;  // а пока остаётся ссылка «Где курьер сейчас»
  }
}

function stopTracking() {
  clearInterval(trackTimer);
  trackTimer = null;
}

// Опросы не накладываются: пока идёт один, новый повод (таймер, вкладка снова на экране) — ещё один опрос после него
let trackBusy = false;
let trackAgain = false;
async function refreshTrack() {
  if (trackBusy) { trackAgain = true; return; }
  trackBusy = true;
  try {
    await refreshTrackOnce();
  } finally {
    trackBusy = false;
    if (trackAgain) { trackAgain = false; refreshTrack(); }
  }
}
async function refreshTrackOnce() {
  const saved = getTrack();
  if (!saved?.token) { stopTracking(); emitTrack(null); return; }
  try {
    // Статус и экран заказа (order_extra) — одним опросом. order_extra не ответил (сеть) — остаётся прежний; базы без 018 — null
    const [s, extra, delivery] = await Promise.all([api.orderStatus(saved.token), api.orderExtra(saved.token).catch(() => undefined),
      typeof api.orderDelivery === 'function' ? api.orderDelivery(saved.token).catch(() => undefined) : undefined]);
    // Пока ждали ответ, отслеживать стали другой заказ (оплатили новый, открыли ссылку) — этот ответ уже не о нём
    if (getTrack()?.token !== saved.token) return;
    if (extra !== undefined) {
      noteChat(saved, extra);
      orderExtra = extra;
      extraToken = saved.token;
    }
    if (delivery !== undefined) { // сумма доставки сейчас — как у курьера; поменялась (дождь) — «курьеру» сразу новая
      const changed = deliveryToken !== saved.token || JSON.stringify(delivery) !== JSON.stringify(deliveryNow);
      deliveryNow = delivery;
      deliveryToken = saved.token;
      if (changed && currentStep === 'done') fillDone(getTrack() || saved);
    }
    if (!s) { // заказа с таким ключом нет — забываем
      const fromLink = Boolean(linkTrack);
      setTrack(null);
      if (fromLink && getTrack()) { refreshTrack(); return; } // неверная ссылка — показываем свой заказ, как было
      trackShown = false;
      $('[data-track]').hidden = true;
      stopTracking();
      emitTrack(null);
      renderOrderScreen();
      return;
    }
    renderTrack(s, saved);
    if (s.status === 'done' || s.status === 'canceled') stopTracking();
  } catch (err) {
    // Функции статуса в базе ещё нет (order-status.sql не запускали) — шкалу просто не показываем
    if (err?.status === 404) stopTracking();
  }
}

function startTracking() {
  stopTracking();
  refreshTrack();
  trackTimer = setInterval(() => { if (!document.hidden) refreshTrack(); }, TRACK_EVERY_MS);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && trackTimer) refreshTrack(); });

/* ---------- Экран заказа (specs/018): кольцо, самовывоз, чат, детали, отмена, оценка ---------- */

/** Последний ответ order_status именно этого заказа (или null) */
const statusFor = (saved) => (lastStatus && saved && lastStatus.saved.token === saved.token ? lastStatus.s : null);

/**
 * К какому времени обещали заказ, мс: из базы (order_extra.promise_at — то же время, что в отчёте «опоздания»); без неё —
 * «ко времени» — названный час, иначе по прежнему расчёту: начало доставки (оплата; ночью — 12:00) + время ожидания.
 * null — не от чего считать (открыт по ссылке, заказ взяли в работу без оплаты)
 */
function promiseAt(s, saved) {
  const fromDb = Date.parse(extraOf(saved)?.promise_at);
  if (Number.isFinite(fromDb)) return fromDb;
  if (saved.when) return Number.isFinite(saved.whenAt) ? saved.whenAt : deliveryAt(paidAt(saved), `Ко времени: ${saved.when}`);
  if (saved.link && !s?.paid_at) return null;
  const minutes = Number(saved.wait) > 0 ? Number(saved.wait) : waitFor(saved.branch);
  return deliveryStart(paidAt(saved)) + minutes * 60_000;
}
/** Назначенный час «ко времени», мс, или NaN («Побыстрее») */
function exactAt(saved) {
  const fromDb = Date.parse(extraOf(saved)?.delivery_at);
  if (Number.isFinite(fromDb)) return fromDb;
  if (!saved.when) return NaN;
  return Number.isFinite(saved.whenAt) ? saved.whenAt : deliveryAt(paidAt(saved), `Ко времени: ${saved.when}`) ?? NaN;
}

/**
 * Кольцо обратного отсчёта: в центре — сколько минут осталось до обещанного («47 мин»), дуга заполняется от оплаты к сроку.
 * Срок прошёл — «Скоро будем» (самовывоз — «Уже почти готово»); «Едем» — дуга полная, в центре 🛵; самовывоз готов — ✓;
 * «ко времени» — сам час и день («18:30», «завтра, пт 12.11»). Пересчитываем раз в 30 секунд
 */
function renderRing() {
  const ring = $('[data-eta-ring]');
  const saved = getTrack();
  const s = statusFor(saved);
  const status = s?.status ?? 'new'; // только что оплатили, статуса ещё нет — заказ новый
  if (!saved?.token || currentStep !== 'done' || !ACTIVE.includes(status)) { ring.hidden = true; return; }
  const pickup = fulfillmentOf(saved) === 'pickup';
  const start = paidAt(saved);
  const progress = (end) => (end > start ? Math.min(1, Math.max(0, (Date.now() - start) / (end - start))) : 1);
  const exact = exactAt(saved);
  const promise = promiseAt(s, saved);
  let big = '';
  let small = '';
  let label = '';
  let frac = 1;
  let kind = 'minutes';
  if (status === 'delivering' && !pickup) {
    big = '🛵';
    kind = 'icon';
    label = tx('Курьер уже едет к вам');
  } else if (pickup && extraOf(saved)?.ready_at) {
    big = '✓';
    small = tx('Готов');
    kind = 'icon';
    label = tx('Заказ готов — можно забирать');
  } else if (Number.isFinite(exact)) {
    big = clock.format(exact);
    small = dayWords(exact) || tx('сегодня');
    kind = 'clock';
    label = `${big}, ${small}`;
    frac = progress(exact);
  } else if (Number.isFinite(promise)) {
    const left = promise - Date.now();
    if (left > 0) {
      const n = Math.ceil(left / 60_000);
      big = String(n);
      small = tx('мин');
      label = tx('ещё {n} мин', { n });
      frac = progress(promise);
    } else {
      small = tx(pickup ? 'Уже почти готово' : 'Скоро будем');
      kind = 'text';
      label = small;
    }
  } else {
    ring.hidden = true;
    return;
  }
  const appeared = ring.hidden; // кольцо только что появилось — дуга заполняется с нуля
  ring.hidden = false;
  ring.dataset.kind = kind;
  ring.setAttribute('aria-label', label);
  $('[data-eta-ring-value]').textContent = big;
  $('[data-eta-ring-unit]').textContent = small;
  setRingOffset(Math.round((1 - frac) * 1000) / 10, appeared);
}
setInterval(() => { if (!document.hidden && currentStep === 'done') renderRing(); }, 30_000);

/** Самовывоз: куда прийти (адрес кухни крупно и 2GIS); кухня отметила готовность — «Заказ готов — можно забирать» */
function renderPickupInfo() {
  const box = $('[data-pickup-info]');
  const saved = getTrack();
  const s = statusFor(saved);
  const branch = s && s.branch !== undefined ? s.branch || saved?.branch : saved?.branch;
  const kitchen = branchInfo[branch]?.kitchen;
  const show = Boolean(saved && kitchen && currentStep === 'done' && fulfillmentOf(saved) === 'pickup' && (!s || ACTIVE.includes(s.status)));
  box.hidden = !show;
  if (!show) return;
  const ready = Boolean(extraOf(saved)?.ready_at);
  box.classList.toggle('is-ready', ready);
  box.innerHTML = `${ready ? `<p class="pickupinfo__ready">${escHtml(tx('Заказ готов — можно забирать'))}</p>` : ''}
    <p class="pickupinfo__where"><span aria-hidden="true">🥡 </span>${escHtml(tx('Заберите на {address}', { address: tx(kitchen) }))}</p>
    <a class="pickupinfo__map" href="${escHtml(addressLink(kitchen))}" target="_blank" rel="noopener">${escHtml(tx('Открыть в 2GIS'))}</a>`;
}

/* Чат по заказу (chat.js): кнопка — после оплаты, пока чат открыт (order_extra.chat.open); метка — есть непрочитанное от курьера
   или KOKORO; на новое такое сообщение — короткий сигнал. Отмена и изменения — только через менеджера, поэтому рядом подсказка */
let chatSeen = { token: null, lastId: 0 }; // последнее сообщение, которое уже видели в сводке (сигнал — только на новое)
const chatKey = (saved) => `client:${saved.token}`;
function noteChat(saved, extra) {
  const chat = extra?.chat;
  const last = Number(chat?.last_id) || 0;
  const known = chatSeen.token === saved.token;
  if (known && last > chatSeen.lastId && chat.last_author !== 'client' && hasUnread(chatKey(saved), chat, 'client')) chime();
  chatSeen = { token: saved.token, lastId: Math.max(last, known ? chatSeen.lastId : 0) };
}
function renderChat() {
  const saved = getTrack();
  const chat = extraOf(saved)?.chat;
  const s = statusFor(saved);
  const btn = $('[data-chat-open]');
  const open = Boolean(saved && chat?.open && currentStep === 'done');
  btn.hidden = !open;
  const unread = open && hasUnread(chatKey(saved), chat, 'client');
  $('[data-chat-badge]').hidden = !unread;
  $('[data-chat-open-label]').textContent = `💬 ${tx('Написать в чат')}`;
  if (unread) btn.setAttribute('aria-label', `${tx('Написать в чат')} — ${tx('есть новое сообщение')}`);
  else btn.removeAttribute('aria-label');
  $('[data-cancel-hint]').hidden = !(open && (!s || ACTIVE.includes(s.status)));
}
$('[data-chat-open]').addEventListener('click', () => {
  const saved = getTrack();
  if (!saved?.token) return;
  const token = saved.token;
  openChat({
    title: tx('Чат по заказу № {n}', { n: saved.number ?? '' }),
    mine: 'client',
    labels: { client: tx('Вы'), courier: tx('Курьер'), manager: tx('KOKORO') },
    load: (after) => api.chat.get(token, after),
    send: (body) => api.chat.send(token, body),
    readKey: chatKey(saved),
    t: tx,
    onClose: () => renderChat(),
  });
  $('[data-chat-badge]').hidden = true;
});

/** Строка адреса для «Деталей»: «ул. Токтогула 100, подъезд 2, этаж 5, кв. 15» */
const addressLine = (t) => [t.address, t.entrance && `${tx('подъезд')} ${t.entrance}`, t.floor && `${tx('этаж')} ${t.floor}`,
  t.apartment && `${tx('кв.')} ${t.apartment}`].filter(Boolean).join(', ');

/**
 * «Детали заказа»: комбо, адрес или кухня самовывоза, доставка, «до двери», итого и отдельно — что по QR и что курьеру.
 * Состав знает только этот телефон (заказ, открытый по ссылке, без «Деталей»)
 */
function renderDetails() {
  const box = $('[data-details]');
  const saved = getTrack();
  if (!saved?.token || !saved.qty || currentStep !== 'done') { box.hidden = true; return; }
  box.hidden = false;
  const s = statusFor(saved);
  const pickup = fulfillmentOf(saved) === 'pickup';
  const qr = Number(saved.total) || 0;
  const fee = Number(saved.fee) || 0;
  // Сумма доставки — как у курьера (из базы; включили дождь — с надбавкой), без базы — что запомнили при оформлении
  const q = deliveryOf(saved);
  const road = !pickup && !fee && q?.price ? q.price : 0;
  const approx = road > 0 && Boolean(q.approx);
  const doorFee = !pickup && doorOf(saved) ? door.fee : 0;
  const sum = (n) => `${approx ? '≈ ' : ''}${money(n)}`;
  const rows = [[tx('Комбо × {n}', { n: saved.qty }), money(qr - fee)]];
  if (pickup) {
    const branch = s && s.branch !== undefined ? s.branch || saved.branch : saved.branch;
    rows.push([tx('Самовывоз'), tx(branchInfo[branch]?.kitchen || saved.address)]);
  } else {
    rows.push([tx('Адрес'), addressLine(saved)]);
    rows.push([tx('Доставка'), fee ? money(fee) : road ? `${sum(road)}${rainPart(q)}` : tx('назовёт менеджер')]);
    if (doorFee) rows.push([tx('До двери'), money(doorFee)]);
  }
  const all = qr + road + doorFee;
  rows.push([tx('Итого'), pickup || fee || road ? sum(all) : tx('{sum} + доставка', { sum: money(all) })]);
  const courier = road ? sum(road + doorFee) : doorFee ? tx('{sum} + доставка', { sum: money(doorFee) }) : tx('сумму назовёт менеджер');
  const note = pickup ? tx('По QR — {qr}', { qr: moneyTight(qr) }) : tx('По QR — {qr}, курьеру — {courier}', { qr: moneyTight(qr), courier: courier.replace(/ (?=сом$)/, ' ') });
  const body = $('[data-details-body]');
  body.textContent = '';
  for (const [name, value] of rows) {
    const row = document.createElement('div');
    row.className = 'details__row';
    const a = document.createElement('span');
    a.textContent = name;
    const b = document.createElement('span');
    b.textContent = value;
    row.append(a, b);
    body.append(row);
  }
  const p = document.createElement('p');
  p.className = 'details__note';
  p.textContent = note;
  body.append(p);
}

/* Оценка после «Доставлен» / «Выдан» (order_rate): заказ 1–5 звёзд, курьер — если он был и это доставка, пара слов. Звёзды —
   радиогруппа: стрелки и Home/End выбирают, в фокусе одна звезда (выбранная или первая) */
const rated = new Set(); // заказы, оценённые в этой вкладке (база тоже помнит — rated_at)
const rateForm = $('[data-rate]');
const starBoxes = $$('[data-stars]');
function buildStars(box) {
  box.textContent = '';
  for (let n = 1; n <= 5; n++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'star';
    b.setAttribute('role', 'radio');
    b.dataset.value = String(n);
    b.innerHTML = '<span aria-hidden="true">★</span>';
    box.append(b);
  }
  setStars(box, 0);
}
const starValue = (box) => Number(box.dataset.value) || 0;
function setStars(box, n, focus = false) {
  box.dataset.value = String(n);
  box.querySelectorAll('[role="radio"]').forEach((b) => {
    const v = Number(b.dataset.value);
    b.setAttribute('aria-checked', String(v === n));
    b.setAttribute('aria-label', tx('{n} из 5', { n: v }));
    b.classList.toggle('is-on', v <= n);
    b.tabIndex = v === (n || 1) ? 0 : -1;
    if (focus && v === n) b.focus();
  });
}
for (const box of starBoxes) {
  buildStars(box);
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[role="radio"]');
    if (!b) return;
    setStars(box, Number(b.dataset.value));
    $('[data-rate-error]').textContent = '';
  });
  box.addEventListener('keydown', (e) => {
    const now = starValue(box);
    const keys = { ArrowRight: Math.min(5, now + 1), ArrowUp: Math.min(5, now + 1), ArrowLeft: Math.max(1, now - 1), ArrowDown: Math.max(1, now - 1), Home: 1, End: 5 };
    let next = keys[e.key];
    if (next === undefined && (e.key === ' ' || e.key === 'Enter')) next = Number(e.target.closest('[role="radio"]')?.dataset.value) || undefined;
    if (next === undefined) return;
    e.preventDefault();
    setStars(box, next, true);
    $('[data-rate-error]').textContent = '';
  });
}
/** Заказ оценён: форма уходит, «Спасибо за оценку!»; в «Мои заказы» — пометка */
function rateDone(token) {
  rated.add(token);
  if (orderHistory.update(token, { rated: true })) emit('kokoro:history');
  renderRate();
  $$('[data-rate-open]').forEach((b) => b.remove());
}
function renderRate() {
  const saved = getTrack();
  const x = extraOf(saved);
  const done = Boolean(saved?.token && (rated.has(saved.token) || x?.rated_at));
  rateForm.hidden = !(saved?.token && x?.can_rate && !done && currentStep === 'done');
  $('[data-rate-thanks]').hidden = !(done && currentStep === 'done');
  $('[data-rate-courier]').hidden = !(x?.has_courier && fulfillmentOf(saved) === 'delivery');
}
rateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const saved = getTrack();
  if (!saved?.token) return;
  const error = $('[data-rate-error]');
  const [main, courierBox] = [$('[data-stars="rating"]'), $('[data-stars="courier_rating"]')];
  const rating = starValue(main);
  if (!rating) { error.textContent = tx('Поставьте от 1 до 5 звёзд'); main.querySelector('[tabindex="0"]')?.focus(); return; }
  const courierRating = $('[data-rate-courier]').hidden ? null : starValue(courierBox) || null;
  const comment = rateForm.elements.rating_comment.value.trim() || null;
  const button = $('[data-rate-send]');
  button.disabled = true;
  error.textContent = '';
  try {
    await api.rateOrder(saved.token, { rating, courierRating, comment });
    rateDone(saved.token);
  } catch (err) {
    // Уже оценили (с другого устройства или ответ потерялся) — для покупателя это готово: «Спасибо за оценку!»
    if (err?.message === 'Вы уже оценили этот заказ') rateDone(saved.token);
    else error.textContent = networkMessage(err);
  } finally {
    button.disabled = false;
  }
});
// «Оценить заказ» в строке над формой — экран заказа с оценкой
$('[data-track]').addEventListener('click', (e) => {
  if (!e.target.closest('[data-rate-open]')) return;
  const saved = getTrack();
  if (!saved?.token) return;
  fillDone(saved);
  show('done');
  rateForm.scrollIntoView({ block: 'center' });
});

/** Всё, что на экране заказа зависит от order_extra и статуса: кольцо, самовывоз, чат и отмена, детали, оценка */
/* ---------- Движение экрана заказа (design.md → «Движение»): только при GSAP и без «уменьшить движение» — иначе сразу
   конечное состояние. Двигаем только transform, opacity и stroke-dashoffset кольца ---------- */
const motionOn = () => Boolean(window.gsap) && !matchMedia('(prefers-reduced-motion: reduce)').matches;
let lastStepKey = null; // какой шаг шкалы показан: сменился — вспышка
const ringMotion = { v: 100, tween: null }; // дуга кольца: 100 — пустая, 0 — полная
/** Дуга кольца к значению target: плавно (GSAP) или сразу; from0 — кольцо только что появилось, заполняется с пустого */
function setRingOffset(target, from0 = false) {
  const bar = $('[data-eta-ring-bar]');
  ringMotion.tween?.kill();
  ringMotion.tween = null;
  if (!motionOn()) {
    ringMotion.v = target;
    bar.style.strokeDashoffset = String(target);
    return;
  }
  if (from0) ringMotion.v = 100;
  ringMotion.tween = window.gsap.to(ringMotion, { v: target, duration: 0.9, ease: 'power3.out',
    onUpdate: () => { bar.style.strokeDashoffset = String(Math.round(ringMotion.v * 10) / 10); },
    onComplete: () => { bar.style.strokeDashoffset = String(target); } });
}
/** Новый текущий шаг шкалы «вспыхивает»: точка из крупной в обычную, подпись проявляется */
function flashStep(box) {
  if (!motionOn()) return;
  const li = box.querySelector('.track__steps .is-now');
  if (!li) return;
  window.gsap.fromTo(li.querySelector('.track__dot'), { scale: 2.2 }, { scale: 1, duration: 0.7, ease: 'back.out(3)', clearProps: 'transform' });
  window.gsap.fromTo(li, { opacity: 0.35, y: -4 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', clearProps: 'opacity,transform' });
}
/** «Доставлен» / «Выдан» — короткий салют: 8 крошек разлетаются от номера заказа и тают */
function salute() {
  if (!motionOn()) return;
  const layer = document.createElement('span');
  layer.className = 'salute';
  layer.setAttribute('aria-hidden', 'true');
  $('[data-done]').append(layer);
  for (let k = 0; k < 8; k++) {
    const crumb = document.createElement('span');
    crumb.className = 'salute__crumb';
    layer.append(crumb);
    const angle = (k / 8) * Math.PI * 2 + 0.2;
    const far = 70 + (k % 3) * 14;
    window.gsap.fromTo(crumb, { x: 0, y: 0, scale: 0.5, opacity: 1, rotation: 0 },
      { x: Math.cos(angle) * far, y: Math.sin(angle) * far - 12, scale: 1, opacity: 0, rotation: (k % 2 ? 1 : -1) * 160, duration: 0.9, ease: 'power2.out' });
  }
  window.gsap.delayedCall(1, () => layer.remove());
}

function renderOrderScreen() {
  renderRing();
  renderPickupInfo();
  renderChat();
  renderDetails();
  renderRate();
  $$('[data-rate-open]').forEach((b) => { b.hidden = currentStep === 'done'; });
}

$('[data-again]').addEventListener('click', () => {
  qty = 1;
  // Новый заказ может быть по другому адресу: прежняя точка — как из прошлого заказа (поменяли адрес — снимется)
  if (point) point = { ...point, from: 'restored', label: pointLabel(addrInput.value) };
  pointMoved = false;
  addrSource = addrInput.value ? 'saved' : 'empty';
  addrHint('');
  renderPoint();
  refreshQuote(true); // точка или адрес те же — сумма остаётся, считать заново не нужно
  form.elements.comment.value = '';
  formChosen = true;
  show('form');
  render();
  if (trackShown) refreshTrack(); // шкала над формой сворачивается в одну строку
});

// Клиент ушёл на оплату в банк и вернулся: сайт открывается с формы,
// а над ней — напоминание о неоплаченном заказе
function showResume() {
  $('[data-resume]').hidden = !pending;
  if (!pending) return;
  $('[data-resume-total]').textContent = money(pending.total);
}
$('[data-resume-go]').addEventListener('click', showPayment);
$('[data-resume-drop]').addEventListener('click', async () => {
  if (!pending) return;
  try { await api.cancelUnpaid(pending.token); } catch { /* без чека заказ всё равно не повезут */ }
  pending = null;
  storage.set(PENDING_KEY, null);
  showResume();
});

/* ---------- События оболочки (app.js, specs/018) ---------- */

// «Открыть» на плашке активного заказа или в «Мои заказы» — экран отслеживаемого заказа
window.addEventListener('kokoro:show-order', () => {
  const saved = getTrack();
  if (!saved?.token) return;
  formChosen = false;
  fillDone(saved);
  show('done');
  if (!trackTimer) refreshTrack();
});
// «Повторить» из «Мои заказы»: количество, способ, кухня самовывоза или адрес с подъездом, этажом, квартирой, «до двери» и
// точкой; затем форма (оболочка открывает оформление)
window.addEventListener('kokoro:repeat', async (e) => {
  const entry = e.detail?.entry;
  if (!entry) return;
  qty = Math.min(MAX_QTY, Math.max(1, Math.round(Number(entry.qty)) || 1));
  if (entry.fulfillment === 'pickup') {
    form.elements.fulfillment.value = 'pickup';
    if (BRANCHES.includes(entry.branch)) form.elements.pickup_branch.value = entry.branch;
  } else {
    await fillAddress(entry);
    form.elements.door.checked = entry.door === true && !form.elements.door.disabled;
    renderDoor();
  }
  if (getTrack()?.token) formChosen = true;
  show('form');
  render();
  if (trackShown) refreshTrack();
});
// Выбрали адрес в «Мои адреса» — подставляем его в форму (с экрана заказа — сразу к форме)
window.addEventListener('kokoro:use-address', async (e) => {
  const entry = e.detail?.entry;
  if (!entry) return;
  await fillAddress(entry);
  if (currentStep === 'done') {
    formChosen = true;
    show('form');
    if (trackShown) refreshTrack();
  }
});
// «Мои адреса» поменяли в оболочке (переименовали, удалили) — чипы над полем адреса тоже
window.addEventListener('kokoro:history', () => renderSavedAddrs());

/* ---------- Язык (RU/KG): всё, что order.js пишет сам, перерисовываем; разметку с [data-i18n] переводит i18n.js ---------- */

function renderLang() {
  renderTariffTitles();
  renderDoor();
  renderSavedAddrs();
  receiptHint();
  renderPointTexts();
  if (!$('[data-send-receipt]').disabled || receipt === null) $('[data-send-receipt]').textContent = tx('Отправить чек');
  starBoxes.forEach((box) => setStars(box, starValue(box)));
  render();
  if (pending && currentStep === 'pay') fillPayment();
  const saved = getTrack();
  const s = statusFor(saved);
  if (s && trackShown) renderTrack(s, saved);
  if (saved?.token && currentStep === 'done') fillDone(saved);
}
onLang(renderLang);

const saved = storage.get(PENDING_KEY);
if (saved?.token && saved.number) pending = saved;
showResume();

// Личная ссылка из сообщения менеджера (kokoro.com.kg/?z=код): заказ и курьер в любом браузере — даже не там,
// где заказывали (встроенные браузеры Instagram и WhatsApp свою память теряют). Код убираем из адреса
const linkCode = new URLSearchParams(location.search).get('z');
if (linkCode) {
  if (/^[0-9A-Za-z]{12}$/.test(linkCode)) {
    const link = { token: linkCode.toUpperCase(), number: null, total: null, phone: '', when: '', wait: null, at: Date.now(), link: true };
    const own = storage.get(TRACK_KEY);
    // Здесь уже отслеживается свой недавний заказ — его не трогаем, заказ по ссылке показываем только на этой странице
    if (own?.token && !own.link && Date.now() - deliveryStart(own.at) < TRACK_HOURS * 3_600_000) linkTrack = link;
    else storage.set(TRACK_KEY, link);
  }
  history.replaceState(null, '', location.pathname + location.hash);
}

// Покупатель вернулся на сайт после оплаты — над формой его заказ и статус (12 часов, потом забываем;
// оплачен ночью или утром — 12 часов от 12:00)
const tracked = getTrack();
if (tracked?.token && Date.now() - deliveryStart(tracked.at) < TRACK_HOURS * 3_600_000) startTracking();
else {
  if (tracked) setTrack(null);
  emitTrack(null);
}

// Кыргызский выбран раньше (boot.js поставил <html lang>): разметку карточки переводим сразу — оболочка может загрузиться позже
if (lang() === 'ky') applyI18n($('[data-order-card]'));
renderWhen();
renderDoor();
renderSavedAddrs();
renderPointTexts();
render();
loadSettings();
refreshQuote(true); // постоянный покупатель: адрес и точка из прошлого заказа — сумма доставки сразу
