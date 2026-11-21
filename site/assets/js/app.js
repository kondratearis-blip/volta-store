// Оболочка приложения KOKORO (specs/018; вид, вкладки и экраны — specs/025): шапка (способ получения и адрес, язык RU/KG),
// панель вкладок и экраны «Меню», «Заказы», «Точки», «Профиль», шторки, карточка товара, кнопка корзины, плашка активного
// заказа, «Как в прошлый раз». Логика заказа — в order.js; связь — события kokoro:* на window
// (specs/018-mini-app-v1/workers.md). Анимации — motion.js: подставляет функции в motion (ниже), без него (нет GSAP,
// «уменьшить движение») всё открывается и меняется мгновенно.
import { api } from './api.js';
import { brand, BRANCHES, branchInfo, combo, extras, legal, menu, money, TRACK, TRACK_PICKUP } from './data.js';
import { addresses, history as orderLog } from './history.js';
import { applyI18n, lang, onLang, setLang, tx } from './i18n.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const html = document.documentElement;
const DESKTOP = matchMedia('(min-width: 1024px)');
const MAX_QTY = 20; // как в order.js
const FRESH_MS = 12 * 3_600_000; // «свежий» заказ — столько же order.js показывает экран заказа после оплаты
const STATUS_EVERY = 60_000; // статус заказов в «Мои заказы» спрашиваем не чаще раза в минуту
const CLOSED = ['done', 'canceled'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// «сом» не отрывается от числа на узком экране
const sum = (n) => money(n).replace(/ (?=сом$)/, ' ');
const emit = (name, detail = {}) => window.dispatchEvent(new CustomEvent(name, { detail }));
const form = $('[data-order-form]');
// Прокрутку экранов ведём сами («Меню» открывается там, где его оставили): иначе на шаге «Назад» браузер поверх нашей
// прокрутки ставит ту, что запомнил у записи истории, — ноль
if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
// Экраны вкладок (specs/025): какой сейчас на виду. Объявлено здесь — шторки и корзина ниже смотрят на него
const SCREENS = ['menu', 'orders', 'points', 'profile'];
let screen = 'menu';

/**
 * Анимации из motion.js: sheet(шторка, открыть?, готово) — выезд и уход шторки; added(откуда) — фото летит в корзину;
 * roll(элемент, было, стало, формат) — перекат суммы; tick(элемент) — смена числа; flip(элемент, правка) — бегунок вкладок
 * и переключателей; screen(экран, куда: 1 — вправо, -1 — влево) — вход экрана вкладки.
 * drag — шторки тянет Draggable (тогда свой свайп ниже молчит). null/false — без анимации
 */
export const motion = { sheet: null, added: null, roll: null, tick: null, flip: null, screen: null, drag: false };

/* ---------- Шторки: оформление (на телефоне) и «Комбо» ---------- */

const orderSheet = $('[data-order-sheet]');
const sheetOf = (name) => {
  const root = $(`[data-sheet="${name}"]`);
  return { name, root, panel: $('.sheet__panel', root), backdrop: $('.sheet__backdrop', root), grab: $('.sheet__top', root) || $('[data-sheet-handle]', root) };
};
export const sheets = {
  order: { name: 'order', root: orderSheet, panel: $('[data-order-card]'), backdrop: $('[data-order-backdrop]'),
    grab: $('.ordersheet__bar') || $('[data-order-card] [data-sheet-handle]') },
  product: sheetOf('product'),
};
const opened = []; // открытые шторки, верхняя — последняя
const opener = new Map(); // кому вернуть фокус после закрытия
const isOpen = (name) => opened.includes(name);
const top = () => sheets[opened[opened.length - 1]];
/** Оформление — шторка только до 1023 px; шире — неподвижная правая колонка */
const sheetMode = () => !DESKTOP.matches;
let booting = true; // первые мгновения после загрузки: шторку открываем сразу, без анимации
window.addEventListener('load', () => setTimeout(() => { booting = false; }, 600), { once: true });
let pendingClose = null; // как закрыть шторку, когда придёт popstate от «Назад»

const target = (focus) => (typeof focus === 'string' ? $(focus) : focus);
function focusIn(s, focus) {
  if (focus === false) return;
  const el = target(focus);
  if (el) { el.focus(); if (el.select && el.value) el.select(); return; }
  (s.name === 'order' ? orderSheet : s.panel).focus({ preventScroll: true });
}

/**
 * Открыть шторку. focus — что получит фокус (селектор, элемент; false — не трогать фокус), from — кому вернуть фокус,
 * nav — запись в истории браузера: 'push' (кнопка «Назад» на телефоне закрывает шторку), 'replace', 'none'
 */
export function openSheet(name, { instant = false, focus = null, from = document.activeElement, nav = 'push' } = {}) {
  const s = sheets[name];
  if (!s?.root) return;
  if (name === 'order' && !sheetMode()) { focusOrder(focus); return; }
  if (isOpen(name)) { focusIn(s, focus); return; }
  opener.set(name, from);
  opened.push(name);
  if (name === 'order') s.root.classList.add('is-open'); else s.root.hidden = false;
  s.root.inert = false;
  html.classList.add('sheet-open');
  if (!instant && motion.sheet) motion.sheet(s, true, () => {});
  focusIn(s, focus);
  const url = name === 'order' ? `${location.pathname}${location.search}#checkout` : location.href;
  // Шторка помнит вкладку, над которой открыта: шаг «Назад» закрывает шторку и оставляет покупателя на том же экране
  const state = { kokoroSheet: name, ...(screen !== 'menu' ? { kokoroTab: screen } : {}) };
  if (nav === 'push') window.history.pushState(state, '', url);
  else if (nav === 'replace') window.history.replaceState(state, '', url);
  emit('kokoro:sheet', { name, open: true });
}

/** Закрыть шторку (без истории браузера). restore — вернуть фокус туда, откуда открыли */
export function closeSheet(name, { instant = false, restore = true } = {}) {
  if (!isOpen(name)) return;
  const s = sheets[name];
  opened.splice(opened.indexOf(name), 1);
  s.root.inert = true;
  if (!opened.length) html.classList.remove('sheet-open');
  const finish = () => {
    if (isOpen(name)) return; // успели открыть снова
    if (name === 'order') s.root.classList.remove('is-open'); else s.root.hidden = true;
    s.panel.style.transform = '';
  };
  if (!instant && motion.sheet) motion.sheet(s, false, finish); else finish();
  const back = opener.get(name);
  if (restore && back?.isConnected && back.getClientRects().length && !back.closest('[inert]')) back.focus({ preventScroll: true });
  if (name === 'order' && /^#(checkout|order)$/.test(location.hash) && !window.history.state?.kokoroSheet) {
    window.history.replaceState(window.history.state, '', `${location.pathname}${location.search}`);
  }
  emit('kokoro:sheet', { name, open: false });
}

/** Закрыть по действию покупателя (крестик, «← Назад», Esc, затемнение, свайп): своя запись в истории — шагом «Назад» */
export function closeByUser(name, options = {}) {
  if (!isOpen(name)) return;
  if (window.history.state?.kokoroSheet === name) {
    pendingClose = options;
    window.history.back(); // закроет popstate — так «Назад» и крестик ведут себя одинаково
    return;
  }
  closeSheet(name, options);
}

window.addEventListener('popstate', (e) => {
  // Переход по якорю (#checkout, набранный руками) — не шаг вкладок: оформление откроет hashchange, экран остаётся
  if (e.state === null && location.hash) return;
  const want = window.history.state?.kokoroSheet || null;
  for (const name of [...opened].reverse()) if (name !== want) closeSheet(name, pendingClose || {});
  pendingClose = null;
  // Кнопка «Назад» телефона: с любой вкладки — в «Меню», из «Меню» — выход из приложения (как в приложениях Android)
  showScreen(window.history.state?.kokoroTab || 'menu'); // тот же экран (закрылась шторка над ним) — ничего не меняется
});
// Перешли по ссылке на #checkout или #order на этой же странице — открыть оформление. Запись истории не помечаем: шаг
// «Назад» из неё мог бы увести с сайта (запись без нажатия браузер пропускает); крестик просто уберёт # из адреса
window.addEventListener('hashchange', () => {
  if (!/^#(checkout|order)$/.test(location.hash) || isOpen('order')) return;
  openSheet('order', { nav: 'none' }); // на компьютере — фокус в колонку оформления
  if (!sheetMode()) window.history.replaceState(window.history.state, '', location.pathname + location.search);
});
// Перезагрузили страницу с открытой шторкой: старая запись истории принадлежит прежней загрузке — забываем её (вкладку,
// на которой были, помним: её вернёт запуск внизу файла)
const bootTab = window.history.state?.kokoroTab || null;
// …кроме оформления по адресу #checkout: оно откроется снова (запуск внизу), и его запись остаётся записью шторки — иначе в
// истории оказались бы две одинаковые записи вкладки и первое «Назад» ничего бы не делало
const bootSheet = window.history.state?.kokoroSheet === 'order' && /^#(checkout|order)$/.test(location.hash);
if (window.history.state?.kokoroSheet && !bootSheet) window.history.replaceState(bootTab ? { kokoroTab: bootTab } : null, '', location.href);

/** С экрана вкладки — в оформление («Повторить», «Использовать», «Открыть», «+ Добавить адрес», «Заберу отсюда») */
function switchToOrder(focus = null, from = document.activeElement) {
  openSheet('order', { from, focus }); // телефон — шторка поверх экрана; компьютер — фокус в колонку оформления
}

/** Компьютер: оформление — колонка справа; прокрутить к нужному месту и поставить фокус */
function focusOrder(focus) {
  if (focus === false) return;
  const el = target(focus);
  if (el) { el.focus(); if (el.select && el.value) el.select(); return; }
  orderSheet.scrollTo?.({ top: 0 });
  orderSheet.focus({ preventScroll: true });
}

// Esc закрывает верхнюю шторку (не трогаем, если Esc уже обработали — подсказки адреса — или открыт чат: у <dialog> свой Esc).
// Tab не уходит из открытой шторки
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]';
function focusables(root) {
  return $$(FOCUSABLE, root).filter((el) => {
    if (el.tabIndex < 0 || !el.getClientRects().length || el.closest('[hidden], [inert]')) return false;
    if (getComputedStyle(el).visibility === 'hidden') return false;
    // Из группы переключателей Tab попадает только на выбранный
    if (el.type === 'radio' && !el.checked) return !$$(`input[type="radio"][name="${el.name}"]`, root).some((r) => r.checked);
    return true;
  });
}
document.addEventListener('keydown', (e) => {
  const s = top();
  if (!s || document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape') {
    if (e.defaultPrevented) return;
    e.preventDefault();
    closeByUser(s.name);
  } else if (e.key === 'Tab') {
    const items = focusables(s.root);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1], active = document.activeElement;
    const inside = s.root.contains(active) && items.includes(active);
    if (e.shiftKey ? (!inside || active === first) : (!inside || active === last)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }
});

/** Свайп вниз за язычок — когда нет GSAP (с ним — Draggable из motion.js): шторка идёт за пальцем, далеко или быстро — закрыть */
function swipe(s) {
  const grab = s.grab;
  if (!grab) return;
  grab.addEventListener('pointerdown', (e) => {
    if (motion.drag || !isOpen(s.name) || e.button > 0 || e.target.closest('button, a')) return;
    if (s.name === 'order' && !sheetMode()) return;
    const y0 = e.clientY, t0 = e.timeStamp;
    let dy = 0;
    const move = (ev) => { dy = Math.max(0, ev.clientY - y0); s.panel.style.transform = dy ? `translateY(${dy}px)` : ''; };
    const end = (ev) => {
      grab.removeEventListener('pointermove', move);
      grab.removeEventListener('pointerup', end);
      grab.removeEventListener('pointercancel', end);
      const fast = dy > 40 && dy / Math.max(1, ev.timeStamp - t0) > 0.6;
      if (dy > 110 || fast) closeByUser(s.name, { instant: true });
      s.panel.style.transform = '';
    };
    grab.setPointerCapture?.(e.pointerId);
    grab.addEventListener('pointermove', move);
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
  });
}
Object.values(sheets).forEach(swipe);

// Кнопки шторок
$('[data-checkout-open]')?.addEventListener('click', (e) => openSheet('order', { from: e.currentTarget }));
$('[data-order-close]')?.addEventListener('click', () => closeByUser('order'));
$('[data-order-back]')?.addEventListener('click', () => {
  if (sheetMode()) closeByUser('order');
  else window.scrollTo({ top: 0 });
});
sheets.order.backdrop?.addEventListener('click', () => closeByUser('order'));
$$('[data-sheet-close]', sheets.product.root).forEach((b) => b.addEventListener('click', () => closeByUser('product')));
$('[data-product-open]')?.addEventListener('click', (e) => openSheet('product', { from: e.currentTarget }));
$('[data-product-add]')?.addEventListener('click', (e) => {
  const from = e.currentTarget.getBoundingClientRect();
  closeByUser('product');
  motion.added?.(from);
});
window.addEventListener('kokoro:open-checkout', (e) => {
  const section = e.detail?.section;
  openSheet('order', { focus: section === 'mode' ? modeFocus() : section === 'address' ? '#order-address' : null });
});

// Оформили заказ, пока шторка закрыта (Enter в поле, проверка формы): открыть сразу — до того, как order.js покажет ошибку
// у поля и поставит на него фокус. Ловим на window в фазе погружения — раньше обработчика order.js
window.addEventListener('submit', (e) => {
  if (e.target === form && sheetMode() && !isOpen('order')) openSheet('order', { instant: true, focus: false, nav: 'none' });
}, true);

/** На телефоне — шторка с ролью диалога; на компьютере — обычная колонка, всегда видна */
function syncLayout() {
  if (sheetMode()) {
    orderSheet.setAttribute('role', 'dialog');
    orderSheet.setAttribute('aria-modal', 'true');
    orderSheet.setAttribute('aria-label', tx('Оформление заказа'));
    orderSheet.inert = !isOpen('order');
  } else {
    ['role', 'aria-modal', 'aria-label'].forEach((a) => orderSheet.removeAttribute(a));
    orderSheet.inert = false;
    if (isOpen('order')) opened.splice(opened.indexOf('order'), 1);
    orderSheet.classList.remove('is-open');
    sheets.order.panel.style.transform = '';
    html.classList.toggle('sheet-open', opened.length > 0);
  }
}
orderSheet.tabIndex = -1;
DESKTOP.addEventListener('change', syncLayout);

/* ---------- Шаги заказа: форма → оплата → экран заказа ---------- */

let step = 'form';
function readStep() {
  if ($('[data-done]') && !$('[data-done]').hidden) return 'done';
  if ($('[data-pay]') && !$('[data-pay]').hidden) return 'pay';
  return 'form';
}
function setStep(next) {
  if (!['form', 'pay', 'done'].includes(next) || next === step) return;
  step = next;
  orderSheet.classList.toggle('is-full', step === 'done');
  renderCartbar();
  renderHomeMode(); // на шаге оплаты и экране заказа способ получения на главной не меняют
  if (step !== 'form' && sheetMode() && !isOpen('order')) {
    openSheet('order', { instant: booting, nav: booting ? 'none' : 'push', focus: step === 'pay' ? '[data-pay]' : '[data-done]' });
  }
}
window.addEventListener('kokoro:step', (e) => setStep(e.detail?.step));
// Запасной путь: шаг виден по hidden у формы, оплаты и экрана заказа (событие могло прийти до загрузки app.js)
const stepWatch = new MutationObserver(() => setStep(readStep()));
['[data-order-form]', '[data-pay]', '[data-done]'].forEach((s) => { if ($(s)) stepWatch.observe($(s), { attributes: true, attributeFilter: ['hidden'] }); });

/* ---------- Корзина: счётчики, панель внизу, кнопка в шторке «Комбо» ---------- */

const cart = { qty: 1, price: combo.price, itemsTotal: combo.price };
let cartEvents = false; // order.js шлёт kokoro:cart — запасное чтение счётчика не нужно
function setCart(d) {
  const qty = Math.min(MAX_QTY, Math.max(1, Math.round(Number(d.qty) || 1)));
  const price = Number(d.price) > 0 ? Number(d.price) : cart.price;
  const prevQty = cart.qty;
  Object.assign(cart, { qty, price, itemsTotal: Number.isFinite(Number(d.itemsTotal)) && d.itemsTotal !== null ? Number(d.itemsTotal) : qty * price });
  // Один счётчик на меню, шторку и форму: везде одно число
  $$('[data-qty-value]').forEach((el) => { if (el.textContent !== String(qty)) el.textContent = qty; });
  $$('[data-qty="-1"]').forEach((b) => { b.disabled = qty <= 1; });
  $$('[data-qty="1"]').forEach((b) => { b.disabled = qty >= MAX_QTY; });
  renderCartbar(prevQty !== qty);
  renderAdd();
}
window.addEventListener('kokoro:cart', (e) => { cartEvents = true; setCart(e.detail || {}); });
document.addEventListener('click', (e) => {
  if (cartEvents || !e.target.closest('[data-qty]')) return;
  // order.js без событий пишет только первый счётчик — разносим его число по остальным
  const qty = Number($('[data-qty-value]')?.textContent) || cart.qty;
  const price = Number($('[data-price]')?.textContent) || cart.price;
  setCart({ qty, price, itemsTotal: qty * price });
});

const cartbar = $('[data-cartbar]');
function setMoney(el, value) {
  if (!el) return;
  const prev = el.dataset.value === undefined ? null : Number(el.dataset.value);
  el.dataset.value = value;
  if (motion.roll && prev !== null && prev !== value) motion.roll(el, prev, value, sum);
  else el.textContent = sum(value);
}
function renderCartbar(qtyChanged = false) {
  if (!cartbar) return;
  cartbar.hidden = step === 'done' || screen !== 'menu'; // заказ оформлен — наверху плашка заказа; корзина — только в «Меню»
  const qtyEl = $('[data-cartbar-qty]', cartbar);
  qtyEl.textContent = tx('Комбо × {n}', { n: cart.qty });
  if (qtyChanged) motion.tick?.(qtyEl);
  setMoney($('[data-cartbar-total]', cartbar), cart.itemsTotal);
  $('.cartbar__go', cartbar).textContent = tx(step === 'pay' ? 'К оплате' : 'Оформить');
}
function renderAdd() {
  const add = $('[data-product-add]');
  if (add) add.textContent = tx('Добавить · {sum}', { sum: sum(cart.itemsTotal) });
}

/* ---------- Шапка: способ получения и адрес ---------- */

const chip = $('[data-mode-chip]');
let mode = null; // последнее kokoro:mode и язык, на котором order.js собрал подпись
const formMode = () => (form?.elements.fulfillment?.value === 'pickup' ? 'pickup' : 'delivery');
function chipLabel(f) {
  if (mode?.label && mode.lang === lang()) return mode.label;
  if (f === 'pickup') {
    const info = branchInfo[mode?.branch || form?.elements.pickup_branch?.value];
    return info ? `${tx(info.name)}, ${tx(info.kitchen)}` : tx('Откуда заберёте');
  }
  return String(mode?.address ?? form?.elements.address?.value ?? '').trim() || tx('Укажите адрес');
}
function renderChip() {
  if (!chip) return;
  const f = mode?.fulfillment === 'pickup' || mode?.fulfillment === 'delivery' ? mode.fulfillment : formMode();
  const modeText = tx(f === 'pickup' ? 'Самовывоз' : 'Доставка');
  const label = chipLabel(f);
  $('[data-mode-chip-mode]', chip).textContent = modeText;
  $('[data-mode-chip-addr]', chip).textContent = label;
  chip.setAttribute('aria-label', `${tx('Способ получения и адрес')}: ${modeText}, ${label}`);
}
window.addEventListener('kokoro:mode', (e) => { mode = { ...(e.detail || {}), lang: lang() }; renderChip(); renderHomeMode(); });
// Пока order.js не прислал kokoro:mode — подпись по самой форме
form?.addEventListener('change', (e) => {
  if (!['fulfillment', 'pickup_branch', 'address'].includes(e.target.name)) return;
  if (!mode) renderChip();
  if (e.target.name === 'fulfillment') renderHomeMode();
});
const modeFocus = () => $('[data-mode] input:checked') || $('[data-mode] input') || $('[data-mode]');
chip?.addEventListener('click', () => openSheet('order', { from: chip, focus: modeFocus() }));

/* ---------- Язык ---------- */

$$('[data-lang-set]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.langSet)));
function renderLang() {
  $$('[data-lang-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.langSet === lang())));
}
// Тексты, разметку которых сверяют проверки (test-client, check-track): состав комбо и часы. Сам HTML не меняем —
// переводим на лету и помним русский оригинал (вместе с <b>), чтобы вернуть его как был
const ruHtml = new Map();
function phrase(el) {
  if (!ruHtml.has(el)) ruHtml.set(el, el.innerHTML);
  const ru = ruHtml.get(el);
  const tpl = document.createElement('template');
  tpl.innerHTML = ru;
  const text = tpl.content.textContent.replace(/\s+/g, ' ').trim();
  const ky = lang() === 'ky' ? tx(text) : text;
  if (ky === text) { if (el.innerHTML !== ru) el.innerHTML = ru; } else el.textContent = ky;
}
function translateStatic() {
  $$('.combo__list span, .combo__hours [data-hours-open], .combo__hours [data-hours-closed], .combo__hours [data-hours], .footer [data-hours], .block [data-hours]').forEach(phrase);
}

/* ---------- Плашка активного заказа ---------- */

const activeBar = $('[data-active-order]');
let track = null; // последнее kokoro:track с active: true
let activeToken; // undefined — order.js ещё не сказал; null — заказа в работе нет
function stepLabel(status, fulfillment) {
  if (status === 'awaiting_payment') return 'Ждёт оплаты';
  if (status === 'canceled') return 'Отменён';
  const own = (fulfillment === 'pickup' ? TRACK_PICKUP : TRACK).find((s) => s.status === status);
  return (own || TRACK.find((s) => s.status === status))?.label || '';
}
function etaText(t) {
  if (CLOSED.includes(t.status)) return '';
  const at = typeof t.promise_at === 'number' ? t.promise_at : Date.parse(t.promise_at);
  if (!Number.isFinite(at)) return '';
  const min = Math.ceil((at - Date.now()) / 60_000);
  if (min <= 0) return tx(t.fulfillment === 'pickup' ? 'Уже почти готово' : 'Скоро будем');
  return tx('ещё {n} мин', { n: min });
}
function renderActive() {
  if (!activeBar) return;
  const was = activeBar.hidden;
  activeBar.hidden = !track;
  html.classList.toggle('has-active-order', Boolean(track)); // колонка оформления на компьютере — ниже плашки
  const dot = $('[data-profile-dot]');
  if (dot) dot.hidden = !track;
  if (track) {
    const parts = [track.number ? tx('Заказ № {n}', { n: track.number }) : tx('Ваш заказ'), tx(stepLabel(track.status, track.fulfillment))];
    const left = etaText(track);
    if (left) parts.push(left);
    activeBar.innerHTML = `<span class="activebar__dot" aria-hidden="true"></span><span class="activebar__text">${esc(parts.filter(Boolean).join(' · '))}</span><span class="activebar__go" aria-hidden="true">›</span>`;
  }
  if (was !== activeBar.hidden) emit('kokoro:layout');
}
window.addEventListener('kokoro:track', (e) => {
  const d = e.detail || {};
  track = d.active ? d : null;
  activeToken = track ? (track.token ?? null) : null;
  renderActive();
  if (screen === 'orders') renderHistory();
  renderReorder();
});
setInterval(() => { if (track) renderActive(); }, 30_000);
activeBar?.addEventListener('click', () => {
  emit('kokoro:show-order');
  openSheet('order', { from: activeBar });
});

/* ---------- Экраны «Заказы» и «Профиль»: заказы и адреса (только на этом телефоне, history.js) ---------- */

const histBox = $('[data-history]');
const addrBox = $('[data-addresses]');
let editId = null; // адрес, который переименовывают
let deleteId = null; // адрес, удаление которого подтверждают
const checkedAt = new Map(); // ключ заказа → когда последний раз спрашивали статус
let statusTimer = 0;

function storedTrackToken() {
  try {
    const t = JSON.parse(localStorage.getItem('kokoro.track') || 'null');
    return t?.token && (!t.at || Date.now() - Number(t.at) < FRESH_MS) ? t.token : null;
  } catch { return null; }
}
const activeOf = () => (activeToken === undefined ? storedTrackToken() : activeToken);
const canOpen = (o) => o.token === activeOf() && !CLOSED.includes(o.status);
const dateLocale = () => (lang() === 'ky' && Intl.DateTimeFormat.supportedLocalesOf(['ky']).length ? 'ky-KG' : 'ru-RU');
const dateLabel = (at) => new Intl.DateTimeFormat(dateLocale(), { timeZone: 'Asia/Bishkek', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
const kitchenOf = (b) => (branchInfo[b] ? tx(branchInfo[b].kitchen) : '');

function histItem(o) {
  const title = o.number ? `№ ${o.number}${branchInfo[o.branch] ? ` · ${tx(branchInfo[o.branch].name)}` : ''}` : tx('Ваш заказ');
  const what = `${tx('Комбо × {n}', { n: o.qty })}${o.total !== null ? ` · ${sum(o.total)}` : ''}`;
  const where = o.fulfillment === 'pickup' ? `${tx('Самовывоз')} — ${kitchenOf(o.branch)}`.replace(/ — $/, '') : o.address;
  const open = canOpen(o);
  return `<li class="hist__item${open ? ' is-active' : ''}" data-token="${esc(o.token)}">
    <div class="hist__head"><span class="hist__date">${esc(dateLabel(o.at))}</span><span class="status status--${esc(o.status)}">${esc(tx(stepLabel(o.status, o.fulfillment)))}</span></div>
    <p class="hist__title">${esc(title)}</p>
    <p class="hist__what">${esc(what)}</p>
    ${where ? `<p class="hist__where">${esc(where)}</p>` : ''}
    <div class="hist__actions">
      ${open ? `<button class="btn btn--small btn--tray" type="button" data-open-order>${esc(tx('Открыть'))}</button>` : ''}
      <button class="btn btn--small btn--ghost" type="button" data-repeat>${esc(tx('Повторить'))}</button>
    </div>
  </li>`;
}
let histMarkup = '';
function renderHistory() {
  if (!histBox) return;
  const list = orderLog.list();
  const markup = list.length ? `<ul class="hist" role="list">${list.map(histItem).join('')}</ul>`
    : `<div class="empty">
        <span class="empty__icon" aria-hidden="true"><svg class="ico" focusable="false"><use href="#i-receipt"/></svg></span>
        <p class="profile__empty">${esc(tx('Здесь появятся ваши заказы'))}</p>
        <button class="btn btn--small" type="button" data-go-menu>${esc(tx('В меню'))}</button>
      </div>`;
  // Та же разметка — не трогаем: кнопка, с которой открыли оформление, остаётся в странице, и на неё вернётся фокус
  // (опрос статусов раз в минуту перерисовывал список, пока оформление было открыто)
  if (markup === histMarkup && histBox.firstElementChild) return;
  histMarkup = markup;
  histBox.innerHTML = markup;
}

function placeItem(a) {
  const meta = [a.entrance && tx('подъезд {v}', { v: a.entrance }), a.floor && tx('этаж {v}', { v: a.floor }), a.apartment && tx('кв. {v}', { v: a.apartment })]
    .filter(Boolean).join(' · ');
  let tail;
  if (editId === a.id) {
    tail = `<form class="place__rename" data-rename novalidate>
      <label class="field"><span>${esc(tx('Название'))}</span><input name="label" maxlength="30" autocomplete="off" required value="${esc(tx(a.label))}"></label>
      <div class="place__row">
        <button class="btn btn--small btn--tray" type="submit">${esc(tx('Сохранить'))}</button>
        <button class="btn btn--small btn--ghost" type="button" data-rename-cancel>${esc(tx('Отмена'))}</button>
      </div>
    </form>`;
  } else if (deleteId === a.id) {
    tail = `<div class="place__confirm" role="alert">
      <p>${esc(tx('Удалить этот адрес?'))}</p>
      <div class="place__row">
        <button class="btn btn--small place__yes" type="button" data-delete-yes>${esc(tx('Да, удалить'))}</button>
        <button class="btn btn--small btn--ghost" type="button" data-delete-no>${esc(tx('Отмена'))}</button>
      </div>
    </div>`;
  } else {
    tail = `<div class="place__row">
      <button class="btn btn--small btn--tray" type="button" data-address-use>${esc(tx('Использовать'))}</button>
      <button class="btn btn--small btn--ghost" type="button" data-address-edit>${esc(tx('Изменить'))}</button>
      <button class="btn btn--small btn--ghost place__del" type="button" data-address-delete>${esc(tx('Удалить'))}</button>
    </div>`;
  }
  return `<li class="place" data-id="${esc(a.id)}">
    <p class="place__label">${esc(tx(a.label))}</p>
    <p class="place__addr">${esc(a.address)}</p>
    ${meta ? `<p class="place__meta">${esc(meta)}</p>` : ''}
    ${tail}
  </li>`;
}
function renderAddresses() {
  if (!addrBox) return;
  const list = addresses.list();
  addrBox.innerHTML = `${list.length ? `<ul class="places" role="list">${list.map(placeItem).join('')}</ul>`
    : `<p class="profile__empty">${esc(tx('Адресов пока нет — сохраним после первого заказа'))}</p>`}
    <button class="btn btn--ghost btn--block places__add" type="button" data-address-add>${esc(tx('+ Добавить адрес'))}</button>`;
}
/** Статус свежих незакрытых заказов — из базы (order_status), не чаще раза в минуту на заказ */
async function refreshStatuses() {
  const now = Date.now();
  const due = orderLog.list(now).filter((o) => now - o.at < FRESH_MS && !CLOSED.includes(o.status) && now - (checkedAt.get(o.token) || 0) >= STATUS_EVERY);
  if (!due.length) return;
  due.forEach((o) => checkedAt.set(o.token, now));
  const replies = await Promise.all(due.map((o) => Promise.resolve().then(() => api.orderStatus(o.token)).catch(() => null)));
  let changed = false;
  replies.forEach((s, i) => {
    if (!s?.status) return;
    const o = due[i];
    const patch = { status: s.status };
    if (s.day_number) patch.number = s.day_number;
    if (s.branch) patch.branch = s.branch;
    if (o.status !== patch.status || (patch.number && String(o.number) !== String(patch.number)) || (patch.branch && o.branch !== patch.branch)) {
      orderLog.update(o.token, patch);
      changed = true;
    }
  });
  if (!changed) return;
  if (screen === 'orders') renderHistory();
  renderReorder();
}
/** Экран «Заказы» открыт — статусы свежих заказов раз в минуту; ушли с экрана — перестаём спрашивать */
function watchStatuses() {
  refreshStatuses();
  clearInterval(statusTimer);
  statusTimer = setInterval(() => { if (screen === 'orders') refreshStatuses(); else clearInterval(statusTimer); }, STATUS_EVERY);
}

histBox?.addEventListener('click', (e) => {
  if (e.target.closest('[data-go-menu]')) { goScreen('menu'); return; }
  const item = e.target.closest('[data-token]');
  if (!item) return;
  if (e.target.closest('[data-repeat]')) {
    const entry = orderLog.get(item.dataset.token);
    if (!entry) return;
    emit('kokoro:repeat', { entry });
    switchToOrder();
  } else if (e.target.closest('[data-open-order]')) {
    emit('kokoro:show-order');
    switchToOrder();
  }
});

const placeButton = (id, sel) => $(`.place[data-id="${CSS.escape(id)}"] ${sel}`, addrBox);
addrBox?.addEventListener('click', (e) => {
  if (e.target.closest('[data-address-add]')) {
    // Новый адрес — в оформление на поле адреса (самовывоз → доставка); текст поля выделен: набранное заменит прежний адрес
    const delivery = form?.querySelector('input[name="fulfillment"][value="delivery"]');
    if (delivery && !delivery.checked) delivery.click();
    switchToOrder('#order-address');
    return;
  }
  const item = e.target.closest('.place');
  if (!item) return;
  const id = item.dataset.id;
  if (e.target.closest('[data-address-use]')) {
    const entry = addresses.get(id);
    if (!entry) return;
    emit('kokoro:use-address', { entry });
    switchToOrder();
  } else if (e.target.closest('[data-address-edit]')) {
    editId = id; deleteId = null;
    renderAddresses();
    placeButton(id, 'input[name="label"]')?.select();
    placeButton(id, 'input[name="label"]')?.focus();
  } else if (e.target.closest('[data-rename-cancel]')) {
    editId = null;
    renderAddresses();
    placeButton(id, '[data-address-edit]')?.focus();
  } else if (e.target.closest('[data-address-delete]')) {
    deleteId = id; editId = null;
    renderAddresses();
    placeButton(id, '[data-delete-no]')?.focus();
  } else if (e.target.closest('[data-delete-no]')) {
    deleteId = null;
    renderAddresses();
    placeButton(id, '[data-address-delete]')?.focus();
  } else if (e.target.closest('[data-delete-yes]')) {
    addresses.remove(id);
    deleteId = null;
    renderAddresses();
    emit('kokoro:history', { source: 'app' });
    ($('[data-address-use]', addrBox) || $('[data-address-add]', addrBox))?.focus();
  }
});
addrBox?.addEventListener('submit', (e) => {
  const box = e.target.closest('[data-rename]');
  if (!box) return;
  e.preventDefault();
  const id = box.closest('.place').dataset.id;
  const label = box.elements.label.value.trim();
  if (!label) { box.elements.label.focus(); return; }
  const entry = addresses.get(id);
  if (entry) addresses.save({ ...entry, label });
  editId = null;
  renderAddresses();
  emit('kokoro:history', { source: 'app' });
  placeButton(id, '[data-address-edit]')?.focus();
});
// order.js записал заказ или адрес — списки на открытом экране свежие, «Как в прошлый раз» — тоже
window.addEventListener('kokoro:history', (e) => {
  if (e.detail?.source !== 'app') {
    if (screen === 'orders') renderHistory();
    if (screen === 'profile') renderAddresses();
  }
  renderReorder();
});

/* ---------- Меню: шторка «Комбо», «Добавить к заказу», подвал ---------- */

function renderProduct() {
  const item = menu[0];
  const list = $('[data-product-list]');
  if (list && item) list.innerHTML = item.items.map((i) => `<li><b>${esc(i.count)}</b><span>${esc(tx(i.title))}</span></li>`).join('');
  const halal = $('.product-sheet__halal');
  if (halal) halal.hidden = !item?.halal;
  renderAdd();
}
function renderExtras() {
  const box = $('[data-extras]');
  if (!box) return;
  const was = box.hidden;
  box.hidden = !extras.length;
  if (extras.length) {
    $('[data-extras-list]', box).innerHTML = extras.map((x) => `<article class="extra">
      ${x.photo ? `<img class="extra__photo" src="${esc(x.photo)}" alt="${esc(tx(x.alt || x.name))}" width="${Number(x.photoWidth) || 320}" height="${Number(x.photoHeight) || 320}" loading="lazy">` : ''}
      <h3 class="extra__name">${esc(tx(x.name))}</h3>
      ${Number.isFinite(Number(x.price)) && x.price !== null ? `<p class="extra__price">${esc(sum(x.price))}</p>` : ''}
    </article>`).join('');
  }
  if (was !== box.hidden) emit('kokoro:layout');
}
function renderLegal() {
  // Ссылки — в подвале (компьютер) и на экране «Профиль» (телефон: подвала там нет)
  const links = legal.ready ? [[legal.offer, 'Публичная оферта'], [legal.privacy, 'Политика конфиденциальности'], [legal.delivery, 'Доставка и возврат']]
    .filter(([href]) => href).map(([href, label]) => `<a href="${esc(href)}">${esc(tx(label))}</a>`).join(' · ') : '';
  $$('[data-legal-links]').forEach((box) => {
    box.hidden = !legal.ready;
    box.innerHTML = links;
  });
}

/* ---------- Экраны и панель вкладок (specs/025) ---------- */

const tabbar = $('[data-tabbar]');
const screens = Object.fromEntries(SCREENS.map((n) => [n, $(`[data-screen="${n}"]`)]));
const scrollAt = new Map(); // где остановились на каждом экране
const icon = (id) => `<svg class="ico" aria-hidden="true" focusable="false"><use href="#i-${id}"/></svg>`;
const calm = matchMedia('(prefers-reduced-motion: reduce)');
/** Лёгкий вибро-отклик на «+», «−» и вкладки — где телефон умеет (Android); iPhone молчит */
const buzz = () => { try { navigator.vibrate?.(8); } catch { /* запрещено настройками */ } };

/** Наполнить экран перед показом: списки берутся с телефона в момент открытия */
function fillScreen(name) {
  if (name === 'orders') { renderHistory(); watchStatuses(); }
  else if (name === 'profile') { editId = null; deleteId = null; renderAddresses(); renderInstall(); }
  else if (name === 'points') renderPoints();
}

/** Показать экран вкладки (без истории браузера). focus — поставить фокус на экран (переход с клавиатуры) */
function showScreen(next, { focus = false } = {}) {
  if (!SCREENS.includes(next) || !screens[next] || next === screen) return;
  const prev = screen;
  scrollAt.set(prev, window.scrollY);
  fillScreen(next);
  const change = () => {
    screen = next;
    SCREENS.forEach((n) => { if (screens[n]) screens[n].hidden = n !== next; });
    $$('[data-tab]').forEach((b) => { if (b.dataset.tab === next) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (tabbar) tabbar.dataset.active = next;
    html.dataset.screen = next;
  };
  const thumb = tabbar && $('.tabbar__thumb', tabbar);
  if (motion.flip && thumb) motion.flip(thumb, change); else change();
  renderCartbar();
  // «Меню» открывается там, где его оставили; остальные экраны — с начала
  window.scrollTo(0, next === 'menu' ? (scrollAt.get('menu') || 0) : 0);
  motion.screen?.(screens[next], SCREENS.indexOf(next) > SCREENS.indexOf(prev) ? 1 : -1);
  if (focus) screens[next].focus({ preventScroll: true });
  emit('kokoro:layout');
  emit('kokoro:screen', { name: next });
}

/**
 * Перейти на вкладку по действию покупателя. В истории браузера — один шаг на все вкладки: кнопка «Назад» телефона
 * возвращает в «Меню», из «Меню» — выходит (так ведут себя приложения Android)
 */
export function goScreen(next, options) {
  if (!SCREENS.includes(next)) return;
  if (next === screen) { window.scrollTo({ top: 0, behavior: calm.matches ? 'auto' : 'smooth' }); return; } // нажали открытую вкладку — наверх
  const state = window.history.state;
  const onTab = Boolean(state?.kokoroTab) && !state.kokoroSheet;
  if (next === 'menu') {
    if (onTab) window.history.back(); // «Меню» покажет popstate — тот же путь, что у кнопки «Назад»
    else showScreen('menu', options);
    return;
  }
  showScreen(next, options);
  // Запись вкладки — без якоря (#checkout остаётся только у записи шторки): иначе «Назад» на запись с якорем пропускался бы
  const url = location.pathname + location.search;
  if (onTab) window.history.replaceState({ kokoroTab: next }, '', url);
  else window.history.pushState({ kokoroTab: next }, '', url);
}
export const currentScreen = () => screen;

// «К содержимому» (для клавиатуры и экранного диктора) — фокус на открытый экран, без якоря в адресе: якорь добавил бы шаг
// «Назад» и увёл бы на «Меню»
$('.skiplink')?.addEventListener('click', (e) => { e.preventDefault(); screens[screen]?.focus(); });
// Липкая полоса кнопки в оформлении бывает высокой (плашка «точка не принимает»): запас прокрутки снизу — по её настоящей
// высоте, чтобы поле в фокусе и поле с ошибкой не оказывались под ней (order.css → scroll-padding)
if ('ResizeObserver' in window) {
  const orderBars = $$('[data-order-card] .order__bar');
  const barHeight = new ResizeObserver(() => {
    const h = Math.max(0, ...orderBars.map((b) => b.offsetHeight));
    if (h) [orderSheet, sheets.order.panel].forEach((el) => el?.style.setProperty('--bar-h', `${h}px`));
  });
  orderBars.forEach((b) => barHeight.observe(b));
}
// Как в приложении: долгое нажатие на фото комбо не открывает меню картинки (на Android -webkit-touch-callout не действует).
// QR-код оплаты не трогаем — его сохраняют именно долгим нажатием
document.addEventListener('contextmenu', (e) => { if (e.target.closest?.('.combo__zoom img, .product-sheet__photo')) e.preventDefault(); });

tabbar?.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) goScreen(tab.dataset.tab);
});
// Логотип — «домой»: в «Меню», к началу. Страницу не перезагружаем (как в приложении)
$('.appbar .topbar__logo')?.addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
  e.preventDefault();
  goScreen('menu');
});
document.addEventListener('click', (e) => { if (e.target.closest('[data-qty], [data-tab], [data-home-mode-set]')) buzz(); });

/* ---------- Главная: «Доставка / Самовывоз», сколько ждать, «Как в прошлый раз» ---------- */

const homeMode = $('[data-home-mode]');
const currentMode = () => (mode?.fulfillment === 'pickup' || mode?.fulfillment === 'delivery' ? mode.fulfillment : formMode());
/** Переключатель на главной показывает тот же способ, что радиокнопки формы; на шаге оплаты и экране заказа — выключен */
function renderHomeMode() {
  if (!homeMode) return;
  const f = currentMode();
  const change = () => {
    $$('[data-home-mode-set]', homeMode).forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.homeModeSet === f));
      b.disabled = step !== 'form';
    });
    homeMode.dataset.active = f;
  };
  const thumb = $('.homeseg__thumb', homeMode);
  if (motion.flip && thumb && homeMode.dataset.active !== f) motion.flip(thumb, change); else change();
}
homeMode?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-home-mode-set]');
  if (!b || b.disabled) return;
  const radio = form?.querySelector(`input[name="fulfillment"][value="${b.dataset.homeModeSet}"]`);
  if (radio && !radio.disabled && !radio.checked) radio.click(); // order.js пересчитает форму и пришлёт kokoro:mode
  renderHomeMode();
});

// «Сейчас привозим примерно за 1,5 часа»: order.js пишет это под кнопкой заказа — на главной повторяем слово в слово
const waitHint = $('[data-wait-hint]');
const etaBox = $('[data-home-eta]');
function renderEta() {
  if (!etaBox) return;
  const text = waitHint && !waitHint.hidden ? waitHint.textContent.replace(/\s+/g, ' ').trim() : '';
  const was = etaBox.hidden;
  etaBox.hidden = !text;
  if (text) $('[data-home-eta-text]', etaBox).textContent = text;
  if (was !== etaBox.hidden) emit('kokoro:layout');
}
if (waitHint) new MutationObserver(renderEta).observe(waitHint, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });

const reorderBox = $('[data-reorder]');
/** Последний оплаченный заказ с этого телефона; заказ в работе — наверху его плашка, «повторить» не предлагаем */
function renderReorder() {
  if (!reorderBox) return;
  const last = track ? null : orderLog.list().find((o) => !['awaiting_payment', 'canceled'].includes(o.status)) || null;
  const was = reorderBox.hidden;
  reorderBox.hidden = !last;
  html.classList.toggle('has-history', Boolean(last)); // boot.js ставит этот класс до отрисовки — карточка не «прыгает»
  if (last) {
    const kitchen = kitchenOf(last.branch);
    const where = last.fulfillment === 'pickup' ? `${tx('Самовывоз')}${kitchen ? ` — ${kitchen}` : ''}` : last.address;
    $('[data-reorder-what]', reorderBox).textContent = [tx('Комбо × {n}', { n: last.qty }), where].filter(Boolean).join(' · ');
    reorderBox.dataset.token = last.token;
  }
  if (was !== reorderBox.hidden) emit('kokoro:layout');
}
$('[data-reorder-go]')?.addEventListener('click', (e) => {
  const entry = orderLog.get(reorderBox.dataset.token);
  if (!entry) { renderReorder(); return; }
  emit('kokoro:repeat', { entry });
  switchToOrder(null, e.currentTarget);
});

/* ---------- Экран «Точки»: кухни KOKORO — позвонить, маршрут, «Заберу отсюда» ---------- */

const pointsBox = $('[data-points]');
let pointsMarkup = '';
const pickupRadio = (b) => form?.querySelector(`input[name="pickup_branch"][value="${b}"]`);
/** Адрес, ссылка на 2GIS и «не принимает» — из блока самовывоза формы (их ведёт order.js): на экране то же, что в оформлении */
function renderPoints() {
  if (!pointsBox) return;
  const markup = `<ul class="points" role="list">${BRANCHES.filter((b) => branchInfo[b]).map((b) => {
    const info = branchInfo[b];
    const item = pickupRadio(b)?.closest('.pickup__item');
    const off = Boolean(item?.classList.contains('is-off'));
    const state = $(`[data-pickup-state="${b}"]`)?.textContent.trim() || tx('Сейчас не принимает');
    const addr = (item && $('.pickup__addr', item)?.textContent.replace(/\s+/g, ' ').trim()) || tx(info.kitchen);
    const map = $(`[data-pickup-map="${b}"]`)?.getAttribute('href') || '';
    return `<li class="pointcard${off ? ' is-off' : ''}" data-point-branch="${esc(b)}">
      <div class="pointcard__head">
        <span class="pointcard__pin" aria-hidden="true">${icon('pin')}</span>
        <div class="pointcard__where">
          <h2 class="pointcard__name">${esc(tx(info.name))}</h2>
          <p class="pointcard__addr">${esc(addr)}</p>
          <p class="pointcard__phone">${esc(info.phoneLabel)}</p>
        </div>
      </div>
      ${off ? `<p class="pointcard__state">${esc(state)}</p>` : ''}
      <div class="pointcard__actions">
        <a class="btn btn--small btn--ghost" href="tel:+${esc(info.phone)}" aria-label="${esc(`${tx('Позвонить')}: ${info.phoneLabel}`)}">${icon('phone')}<span>${esc(tx('Позвонить'))}</span></a>
        ${map ? `<a class="btn btn--small btn--ghost" href="${esc(map)}" target="_blank" rel="noopener" aria-label="${esc(tx('Маршрут в 2GIS'))}">${icon('route')}<span>${esc(tx('Маршрут'))}</span></a>` : ''}
        <button class="btn btn--small pointcard__pick" type="button" data-point-pickup="${esc(b)}"${off ? ' disabled' : ''}>${esc(tx('Заберу отсюда'))}</button>
      </div>
    </li>`;
  }).join('')}</ul>`;
  // Та же разметка — не трогаем: «Заберу отсюда» меняет блок самовывоза формы, наблюдатель зовёт нас снова, а кнопка,
  // с которой открыли оформление, должна остаться в странице — на неё вернётся фокус
  if (markup === pointsMarkup) return;
  pointsMarkup = markup;
  pointsBox.innerHTML = markup;
}
pointsBox?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-point-pickup]');
  if (!b) return;
  let focus = null;
  if (step === 'form') {
    const pickup = form?.querySelector('input[name="fulfillment"][value="pickup"]');
    if (pickup && !pickup.disabled && !pickup.checked) pickup.click();
    const radio = pickupRadio(b.dataset.pointPickup);
    if (radio && !radio.disabled) { if (!radio.checked) radio.click(); focus = radio; }
  }
  switchToOrder(focus, b);
});
// Точка остановила или возобновила приём (order.js меняет блок самовывоза) — карточки на открытом экране свежие
const pickupBox = $('[data-pickup-box]');
if (pickupBox) {
  new MutationObserver(() => { if (screen === 'points') renderPoints(); })
    .observe(pickupBox, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
}

/* ---------- Экран «Профиль»: значок на главный экран, «Поделиться»; сообщение внизу; «нет интернета» ---------- */

let installEvent = null; // Android: браузер готов поставить значок — показываем свою строку
let installHelp = false; // iPhone: нажали строку — показываем путь в Safari
const standalone = () => ['standalone', 'minimal-ui', 'fullscreen'].some((m) => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
function renderInstall() {
  const row = $('[data-install-row]');
  if (!row) return;
  // Внутри приложения из магазина «установить» не предлагаем: оно уже установлено
  row.hidden = html.classList.contains('in-app') || standalone() || !(installEvent || isIos());
  const hint = $('[data-install-hint]', row);
  if (hint) hint.textContent = tx(installHelp ? 'В Safari нажмите «Поделиться», затем «На экран „Домой“»' : 'Значок KOKORO на главном экране — заказ в одно нажатие');
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; renderInstall(); });
window.addEventListener('appinstalled', () => { installEvent = null; renderInstall(); });
$('[data-install]')?.addEventListener('click', async () => {
  if (installEvent) {
    const ask = installEvent;
    installEvent = null;
    try { await ask.prompt(); await ask.userChoice; } catch { /* окно установки не открылось */ }
  } else {
    installHelp = true; // у Safari на iPhone своей кнопки установки нет
  }
  renderInstall();
});

// Офлайн-экран (sw.js): без интернета приложение показывает свой экран, а не ошибку браузера — требование магазинов
// приложений. Регистрируем после загрузки, чтобы не отнимать сеть у первого экрана; не вышло (старый браузер, приложение
// из файлов) — сайт работает как раньше
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); }, { once: true });
}

const toastBox = $('[data-toast]');
let toastTimer = 0;
function toast(text) {
  if (!toastBox) return;
  toastBox.textContent = text;
  toastBox.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastBox.hidden = true; }, 3200);
}
$('[data-share]')?.addEventListener('click', async () => {
  const url = $('link[rel="canonical"]')?.href || location.origin;
  const text = tx('Комбо KOKORO: 25 крыльев, 1 кг картошки, 3 соуса и 1 л колы — с доставкой по Бишкеку');
  try {
    if (navigator.share) await navigator.share({ title: brand.name, text, url });
    else { await navigator.clipboard.writeText(url); toast(tx('Ссылка скопирована')); }
  } catch (err) {
    if (err?.name !== 'AbortError') toast(tx('Не получилось поделиться — адрес сайта: kokoro.com.kg'));
  }
});

/* ---------- Шаг оплаты: сохранить QR и скопировать сумму. С того же телефона QR не отсканировать, а сумму в банке вводят
   руками — оба действия одним нажатием (specs/025) ---------- */

$('[data-copy-sum]')?.addEventListener('click', async () => {
  const digits = ($('[data-pay-total]')?.textContent || '').replace(/\D/g, '');
  if (!digits) return;
  try {
    await navigator.clipboard.writeText(digits);
    toast(tx('Сумма скопирована: {sum}', { sum: digits }));
  } catch {
    toast(tx('Не получилось скопировать — сумма: {sum}', { sum: digits }));
  }
});
$('[data-qr-save]')?.addEventListener('click', async (e) => {
  const img = $('[data-qr-img]');
  const src = img?.currentSrc || img?.src;
  if (!src) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const blob = await (await fetch(src)).blob();
    const file = new File([blob], 'kokoro-qr.jpg', { type: blob.type || 'image/jpeg' });
    // iPhone: в окне «Поделиться» есть «Сохранить изображение» — картинка попадает в «Фото», откуда её берёт приложение банка.
    // Остальные: обычная загрузка — файл появляется в галерее
    if (isIos() && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else if (html.classList.contains('in-app')) {
      // Внутри приложения из магазина загрузка файла может молча не сработать — честная подсказка вместо «сохранён»
      toast(tx('Нажмите на QR и удерживайте, чтобы сохранить его в галерею'));
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'kokoro-qr.jpg';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      toast(tx('QR сохранён — найдите его в галерее или загрузках'));
    }
  } catch (err) {
    if (err?.name !== 'AbortError') toast(tx('Не получилось сохранить — нажмите на QR и удерживайте'));
  } finally {
    btn.disabled = false;
  }
});

/* ---------- «Удалить мои данные с телефона» (правила магазинов приложений о личных данных) ---------- */

// Что сайт помнит о покупателе на этом телефоне. Язык (kokoro.lang) — настройка, а не личные данные.
// Неоплаченный заказ (kokoro.pending: телефон, адрес, комментарий) — отменяем и удаляем: без чека его всё равно не повезут.
// Заказ в работе (kokoro.track): убираем из него телефон, адрес и точку дома, оставляем номер и статус — покупатель по-прежнему
// видит курьера (order.js эти поля только показывает)
const PERSONAL_KEYS = ['kokoro.history', 'kokoro.addresses', 'kokoro.contact', 'kokoro.chat.read'];
const PERSONAL_SESSION = ['kokoro.eta', 'kokoro.geo'];
const PENDING_KEY = 'kokoro.pending';
const TRACK_KEY = 'kokoro.track';
const TRACK_PERSONAL = ['phone', 'address', 'entrance', 'floor', 'apartment', 'point', 'comment', 'name'];
const FORGOT_FLAG = 'kokoro.forgot';
const forgetBtn = $('[data-forget]');
const forgetBox = $('[data-forget-box]');
const readJson = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
/** Текст подтверждения — честно про то, что будет с неоплаченным заказом и заказом в работе */
function forgetText() {
  const parts = [tx('Удалить адреса, историю заказов, имя и телефон с этого телефона? Уже оформленные заказы остаются у KOKORO.')];
  const pending = readJson(PENDING_KEY);
  if (pending?.token) {
    const total = Number(pending.total);
    parts.push(Number.isFinite(total) && total > 0 ? tx('Неоплаченный заказ на {sum} отменим.', { sum: sum(total) }) : tx('Неоплаченный заказ отменим.'));
    parts.push(tx('Уже оплатили по QR? Сначала отправьте чек — иначе заказ отменится.'));
  }
  if (readJson(TRACK_KEY)?.token) parts.push(tx('У заказа в работе останутся только номер и статус — чтобы вы видели курьера.'));
  return parts.join(' ');
}
function showForget(open) {
  if (!forgetBox || !forgetBtn) return;
  if (open) { const p = $('[data-forget-text]', forgetBox); if (p) p.textContent = forgetText(); }
  forgetBox.hidden = !open;
  forgetBtn.setAttribute('aria-expanded', String(open));
  (open ? $('[data-forget-no]', forgetBox) : forgetBtn)?.focus();
}
forgetBtn?.addEventListener('click', () => showForget(forgetBox?.hidden !== false));
$('[data-forget-no]')?.addEventListener('click', () => showForget(false));
$('[data-forget-yes]')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = tx('Удаляем…');
  const pending = readJson(PENDING_KEY);
  // Сначала стираем с телефона — даже если связь «висит» и человек закроет страницу, данных здесь уже нет
  try {
    [...PERSONAL_KEYS, PENDING_KEY].forEach((k) => localStorage.removeItem(k));
    const track = readJson(TRACK_KEY);
    if (track) { TRACK_PERSONAL.forEach((k) => delete track[k]); localStorage.setItem(TRACK_KEY, JSON.stringify(track)); }
  } catch { /* приватный режим — нечего удалять */ }
  // Неоплаченный заказ отменяем в базе (как «Отменить его»), но ждём не дольше 6 секунд: без чека его всё равно не повезут
  if (pending?.token) {
    await Promise.race([Promise.resolve().then(() => api.cancelUnpaid(pending.token)).catch(() => {}), new Promise((ok) => setTimeout(ok, 6000))]);
  }
  try { PERSONAL_SESSION.forEach((k) => sessionStorage.removeItem(k)); sessionStorage.setItem(FORGOT_FLAG, '1'); } catch { /* приватный режим */ }
  // Имя, телефон и адрес уже могли попасть в поля формы — чистый запуск страницы надёжнее, чем чистить каждое поле
  location.reload();
});

const netBar = $('[data-offline]');
function syncNet() {
  if (!netBar) return;
  const was = netBar.hidden;
  netBar.hidden = navigator.onLine !== false;
  html.classList.toggle('is-offline', !netBar.hidden);
  if (was !== netBar.hidden) emit('kokoro:layout');
}
window.addEventListener('online', syncNet);
window.addEventListener('offline', syncNet);

/* ---------- Запуск ---------- */

onLang(() => {
  renderLang();
  translateStatic();
  renderChip();
  renderCartbar();
  renderProduct();
  renderActive();
  renderExtras();
  renderLegal();
  syncLayout();
  renderReorder();
  renderEta();
  renderInstall();
  if (screen === 'orders') renderHistory();
  if (screen === 'profile') renderAddresses();
  if (screen === 'points') renderPoints();
});

renderLang();
if (lang() === 'ky') applyI18n(document);
translateStatic();
renderProduct();
renderExtras();
renderLegal();
setCart({ qty: Number($('[data-qty-value]')?.textContent) || 1, price: Number($('[data-price]')?.textContent) || combo.price });
renderChip();
syncLayout();
html.dataset.screen = screen;
setStep(readStep());
renderHomeMode();
renderEta();
renderActive();
renderReorder();
renderInstall();
syncNet();
// Данные только что удалили (страница перезапустилась) — сказать, что готово
try {
  if (sessionStorage.getItem(FORGOT_FLAG)) { sessionStorage.removeItem(FORGOT_FLAG); setTimeout(() => toast(tx('Данные удалены с этого телефона')), 400); }
} catch { /* приватный режим */ }
// Перезагрузили страницу на вкладке — остаёмся на ней (шаг «Назад» по-прежнему ведёт в «Меню»)
if (bootTab && bootTab !== 'menu') showScreen(bootTab);
if (/^#(checkout|order)$/.test(location.hash)) {
  openSheet('order', { instant: true, nav: bootSheet ? 'replace' : 'none' });
  // Компьютер: оформление — колонка, она уже на экране; якорь из адреса убираем, чтобы «Назад» с вкладки вёл в «Меню»
  if (!sheetMode()) window.history.replaceState(window.history.state, '', location.pathname + location.search);
}
