// Страница шефа: продукты кухни по категориям — цены, добавить, исправить, убрать (specs/011-kitchen-products).
// Вход — по личной ссылке kokoro.com.kg/kitchen#XXXX-XXXX-XXXX-XXXX: её выдаёт владелец в Supabase SQL Editor
// (supabase/kitchen.sql). Ни на сайте, ни в панели менеджера ссылок сюда нет.
import { api } from './api.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY_STORE = 'kokoro.kitchen';
const POLL_MS = 60_000;   // правки с другого телефона
const UNDO_MS = 8_000;    // сколько держится «Вернуть»
const SAVED_MS = 2_000;   // зелёная рамка у сохранённой цены
const NEW_CATEGORY = '__new';
const NO_PRICE = '__noprice';
const GONE = 'Ссылка больше не действует. Попросите у владельца новую.';

const storage = {
  get() { try { return localStorage.getItem(KEY_STORE); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(KEY_STORE, v) : localStorage.removeItem(KEY_STORE); } catch { /* приватный режим */ } },
};

let key = null;
let products = [];
let query = '';
let category = '';            // '' — все, NO_PRICE — без цены, иначе название категории
let editing = null;           // продукт в окне правки; null — новый
let timer = null;
const pending = new Map();    // id → цена, которая сейчас сохраняется
const rowErrors = new Map();  // id → { text, value }: цена не сохранилась — что не так и что ввели

/** Код из любого текста: ссылки, сообщения владельца целиком или самого кода (16 знаков без 0/O и 1/I/L) */
function extractCode(text) {
  const up = String(text || '').toUpperCase();
  const found = up.match(/[2-9A-HJKMNP-Z]{4}(?:-?[2-9A-HJKMNP-Z]{4}){3}/g);
  if (found) return found[found.length - 1].replace(/-/g, '');
  const plain = up.replace(/[^0-9A-Z]/g, '');
  return plain.length === 16 ? plain : null;
}
const label = (code) => code.match(/.{4}/g).join('-');
const isNetwork = (err) => err instanceof TypeError; // нет связи и обрыв по времени (supabase-lite) — TypeError

const money = (v) => (v == null ? '' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 }));
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
const plural = (n, one, few, many) => {
  const d = n % 10;
  const dd = n % 100;
  return d === 1 && dd !== 11 ? one : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
};

/** «1 250», «99,5», «1250 сом» → число; пусто → null (цены нет) */
function parsePrice(text) {
  const s = String(text || '').replace(/\s/g, '').replace(/сом\.?$/i, '').replace(',', '.');
  if (!s) return { value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Цена — число, например 1250 или 99,50' };
  const value = Number(s);
  if (value >= 1e8) return { error: 'Слишком большая цена — проверьте нули' };
  return { value };
}

// «цена от 05.11»; прошлый год — с годом
function dayLabel(iso) {
  const opts = { day: '2-digit', month: '2-digit', timeZone: 'Asia/Bishkek' };
  const year = (d) => d.toLocaleDateString('ru-RU', { year: 'numeric', timeZone: 'Asia/Bishkek' });
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', year(d) === year(new Date()) ? opts : { ...opts, year: 'numeric' });
}

/* ---------- Вход ---------- */

// Код из ссылки (kokoro.com.kg/kitchen#XXXX-…) запоминаем и убираем из адреса: на сервер часть после # не уходит,
// а из адресной строки и истории её лучше убрать
function codeFromLink() {
  let text = location.hash.slice(1);
  try { text = decodeURIComponent(text); } catch { /* битая ссылка — разберём как есть */ }
  const code = extractCode(text);
  if (!code) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return code;
}

function showLogin(message = '', code = '') {
  stop();
  key = null;
  // Общий планшет на кухне: после выхода список не остаётся на экране
  products = [];
  pending.clear();
  rowErrors.clear();
  closeDialog();
  $('[data-toast]').hidden = true;
  $('[data-list]').innerHTML = '';
  $('[data-cats]').innerHTML = '';
  $('[data-count]').textContent = '';
  $('[data-app]').hidden = true;
  $('[data-signout]').hidden = true;
  $('[data-who]').textContent = '';
  $('[data-login]').hidden = false;
  $('[data-login-error]').textContent = message;
  if (code) $('[data-login-form]').elements.code.value = label(code);
}

// Одно устройство — одна роль: когда устройство становится устройством шефа (код запомнен), вход в панель менеджера,
// если на нём когда-то входили, закрываем (здесь — сразу, на сервере — следом; остальные менеджеры остаются в панели)
// и стираем распознанные тексты чеков (ключ — STORE_KEY в receipt-ocr.js). Иначе шеф открыл бы панель без пароля:
// сайт один, а вход менеджера хранится на устройстве бессрочно. Панель со своей стороны не открывается там, где есть код шефа.
// Неверная или старая ссылка ничего не трогает
const RECEIPTS_STORE = 'kokoro.receiptOcr.v2';
function dropManagerHere() {
  try { localStorage.removeItem(RECEIPTS_STORE); } catch { /* приватный режим */ }
  if (api.auth.user()) api.auth.signOutHere().catch(() => {});
}

/** Войти по коду. fallback — сохранённый код: если код из старой ссылки не подошёл, рабочий не стираем */
async function enter(code, fallback = null) {
  let who;
  try {
    who = await api.kitchen.me(code);
  } catch (err) {
    // Нет связи — код запоминаем (неверный сотрёт первый же ответ базы) и пробуем дальше
    if (isNetwork(err)) {
      key = code;
      storage.set(code);
      dropManagerHere();
      showApp();
      status('Нет связи — пробуем ещё раз…');
      return;
    }
    // Функций нет в базе — supabase/kitchen.sql ещё не запускали
    if (err.status === 404) { showLogin('Список продуктов ещё не подключён к базе. Сообщите владельцу.', code); return; }
    showLogin(`Не удалось проверить ссылку: ${err.message}. Нажмите «Войти» ещё раз.`, code);
    return;
  }
  if (!who) {
    if (fallback && fallback !== code) { await enter(fallback); return; }
    storage.set(null);
    showLogin('Ссылка не подошла. Попросите у владельца новую.');
    return;
  }
  key = code;
  storage.set(code);
  dropManagerHere();
  $('[data-who]').textContent = who.name;
  showApp();
}

function gone() {
  storage.set(null);
  showLogin(GONE);
}

function showApp() {
  $('[data-login]').hidden = true;
  $('[data-app]').hidden = false;
  $('[data-signout]').hidden = false;
  refresh();
  stop();
  timer = setInterval(() => { if (canRefresh()) refresh(); }, POLL_MS);
}

function stop() { clearInterval(timer); timer = null; }

$('[data-login-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = extractCode(e.target.elements.code.value);
  const error = $('[data-login-error]');
  if (!code) { error.textContent = 'В коде 16 знаков: буквы и цифры. Проще всего — открыть ссылку от владельца или вставить её сюда целиком'; return; }
  const button = e.target.querySelector('button');
  button.disabled = true;
  error.textContent = '';
  try { await enter(code); } finally { button.disabled = false; }
});

$('[data-signout]').addEventListener('click', () => {
  if (!confirm('Выйти? Чтобы войти снова, понадобится ссылка от владельца.')) return;
  storage.set(null);
  showLogin();
});

/* ---------- Список: обновляется сам ---------- */

const status = (text) => { $('[data-status]').textContent = text; };
const announce = (text) => { $('[data-live]').textContent = text; };

// Пока печатают цену, сохраняют или открыто окно правки — список не перерисовываем
const canRefresh = () => !document.hidden && !pending.size && !$('[data-dialog]').hasAttribute('open') && !document.activeElement?.matches?.('[data-price]');

let inflight = null;
let again = false;
function refresh() {
  if (!key) return Promise.resolve();
  if (inflight) { again = true; return inflight; }
  inflight = load().finally(() => {
    inflight = null;
    if (again) { again = false; refresh(); }
  });
  return inflight;
}

async function load() {
  const k = key;
  let list;
  try {
    list = await api.kitchen.products(k);
  } catch (err) {
    if (k === key) status(isNetwork(err) ? 'Нет связи — пробуем ещё раз…' : `Не удалось обновить список: ${err.message}`);
    return;
  }
  if (k !== key) return; // пока ждали ответ, вышли или вошли по другой ссылке
  if (list === null) { gone(); return; }
  storage.set(k); // код проверен базой — помним его и после перезагрузки
  products = sorted(list);
  status('');
  render();
}

document.addEventListener('visibilitychange', () => { if (key && canRefresh()) refresh(); });

const sorted = (list) => [...list].sort((a, b) => a.sort - b.sort || a.id - b.id);

/** Продукт из ответа базы — на место старого; убранный — из списка */
function replace(row) {
  products = products.filter((p) => p.id !== row.id);
  if (!row.archived) products = sorted([...products, row]);
}

// Категории — в порядке бланка: по первому продукту каждой
const categories = () => [...new Set(products.map((p) => p.category))];

function matches(p) {
  if (category === NO_PRICE ? p.price != null : category && p.category !== category) return false;
  return !query || norm([p.name, p.pack, p.note, p.category].join(' ')).includes(norm(query));
}

function render() {
  renderChips();
  renderList();
}

function renderChips() {
  const cats = categories();
  if (category && category !== NO_PRICE && !cats.includes(category)) category = '';
  const noPrice = products.filter((p) => p.price == null).length;
  if (category === NO_PRICE && !noPrice) category = '';
  $('[data-count]').textContent = `${products.length} ${plural(products.length, 'позиция', 'позиции', 'позиций')}`;
  const chip = (value, text, count, cls = '') =>
    `<button class="chip${cls}" type="button" data-cat="${esc(value)}" aria-pressed="${category === value}">${esc(text)}<b>${count}</b></button>`;
  $('[data-cats]').innerHTML = chip('', 'Все', products.length)
    + cats.map((c) => chip(c, c, products.filter((p) => p.category === c).length)).join('')
    + (noPrice ? chip(NO_PRICE, 'Без цены', noPrice, ' kt-chip--warn') : '');
}

function itemHtml(p) {
  const err = rowErrors.get(p.id);
  const meta = [p.pack, p.price != null && p.price_at ? `цена от ${dayLabel(p.price_at)}` : '', p.note].filter(Boolean).map(esc).join(' · ');
  return `<li class="kt-item" data-id="${p.id}">
    <button class="kt-item__main" type="button" data-edit aria-label="Изменить: ${esc(p.name)}${p.pack ? `, ${esc(p.pack)}` : ''}">
      <span class="kt-item__name">${esc(p.name)}</span>
      ${meta ? `<span class="kt-item__meta">${meta}</span>` : ''}
    </button>
    <label class="kt-price">
      <span class="visually-hidden">Цена за ${p.pack ? esc(p.pack) : 'фасовку'}, сом: ${esc(p.name)}</span>
      <input class="kt-price__input" type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="цена"
        value="${esc(err ? err.value : money(p.price))}" aria-describedby="kt-err-${p.id}" data-price${err ? ' aria-invalid="true"' : ''}>
      <span class="kt-price__cur" aria-hidden="true">сом</span>
    </label>
    <p class="kt-item__error" id="kt-err-${p.id}">${esc(err?.text || '')}</p>
  </li>`;
}

function emptyHtml() {
  if (query) {
    return `<div class="kt-empty"><p>Ничего не нашлось по запросу «${esc(query)}».</p>
      <button class="btn btn--small" type="button" data-add-named>+ Добавить «${esc(query)}»</button></div>`;
  }
  if (category === NO_PRICE) return '<div class="kt-empty"><p>У всех продуктов есть цена ✓</p></div>';
  return '<div class="kt-empty"><p>Продуктов пока нет.</p><button class="btn btn--small" type="button" data-add-named>+ Добавить продукт</button></div>';
}

function renderList() {
  // Перерисовка не должна сбить того, кто сейчас вводит цену: фокус, курсор и набранное возвращаем на место
  const active = document.activeElement?.matches?.('[data-price]') ? document.activeElement : null;
  const keep = active && { id: active.closest('[data-id]').dataset.id, value: active.value, at: active.selectionStart };
  const groups = new Map();
  for (const p of products.filter(matches)) {
    if (!groups.has(p.category)) groups.set(p.category, []);
    groups.get(p.category).push(p);
  }
  $('[data-list]').innerHTML = groups.size ? [...groups].map(([cat, items]) => `<section class="kt-cat">
      <h2 class="kt-cat__title">${esc(cat)} <span>${items.length}</span></h2>
      <ul class="kt-items">${items.map(itemHtml).join('')}</ul>
    </section>`).join('') : emptyHtml();
  if (keep) {
    const input = document.querySelector(`.kt-item[data-id="${keep.id}"] [data-price]`);
    if (input) {
      input.value = keep.value;
      input.focus();
      try { input.setSelectionRange(keep.at, keep.at); } catch { /* не у всех полей есть курсор */ }
    }
  }
}

/** Одна строка после сохранения цены — без перерисовки всего списка (фокус уже в следующей строке) */
function refreshRow(id, { saved = false, busy = false } = {}) {
  const li = document.querySelector(`.kt-item[data-id="${id}"]`);
  const p = products.find((x) => x.id === id);
  if (!li || !p) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = itemHtml(p).trim();
  li.querySelector('.kt-item__main').replaceWith(tpl.content.querySelector('.kt-item__main'));
  const input = li.querySelector('[data-price]');
  const err = rowErrors.get(id);
  li.querySelector('.kt-item__error').textContent = err?.text || '';
  if (err) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  if (!err && document.activeElement !== input) input.value = money(p.price);
  li.classList.toggle('is-busy', busy);
  if (saved) {
    li.classList.add('is-saved');
    setTimeout(() => li.classList.remove('is-saved'), SAVED_MS);
  }
}

/* ---------- Цена прямо в строке ---------- */

async function commitPrice(input) {
  const id = Number(input.closest('[data-id]').dataset.id);
  const p = products.find((x) => x.id === id);
  if (!p) return;
  const typed = input.value;
  const parsed = parsePrice(typed);
  if (parsed.error) {
    rowErrors.set(id, { text: parsed.error, value: typed });
    refreshRow(id);
    announce(`${p.name}: ${parsed.error}`);
    return;
  }
  if (parsed.value === p.price && !rowErrors.has(id)) {
    if (document.activeElement !== input) input.value = money(p.price);
    return;
  }
  if (pending.has(id) && pending.get(id) === parsed.value) return; // Enter и уход из поля — одно сохранение
  pending.set(id, parsed.value);
  rowErrors.delete(id);
  refreshRow(id, { busy: true });
  const k = key;
  try {
    const row = await api.kitchen.setPrice(k, id, parsed.value);
    if (k !== key) return;
    if (row === null) { gone(); return; }
    replace(row);
    refreshRow(id, { saved: true });
    renderChips();
    announce(`${row.name}: ${row.price == null ? 'цена убрана' : `${money(row.price)} сом, сохранено`}`);
  } catch (err) {
    if (k !== key) return;
    const text = isNetwork(err) ? 'Нет связи — цена не сохранилась. Нажмите Enter в поле, чтобы попробовать ещё раз' : `Не сохранилось: ${err.message}`;
    rowErrors.set(id, { text, value: typed });
    refreshRow(id);
    announce(`${p.name}: ${text}`);
  } finally {
    if (pending.get(id) === parsed.value) pending.delete(id);
  }
}

const list = $('[data-list]');
list.addEventListener('change', (e) => { if (e.target.matches('[data-price]')) commitPrice(e.target); });
// Enter — сохранить и сразу в цену следующего продукта: бланк заполняется подряд, как таблица
list.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.matches('[data-price]')) return;
  e.preventDefault();
  const inputs = [...list.querySelectorAll('[data-price]')];
  const next = inputs[inputs.indexOf(e.target) + 1];
  commitPrice(e.target);
  if (next) { next.focus(); next.select(); } else e.target.blur();
});
// Ушли из поля, ничего не поменяв («1250» вместо «1 250»), — показываем цену как обычно
list.addEventListener('focusout', (e) => {
  if (!e.target.matches('[data-price]')) return;
  const id = Number(e.target.closest('[data-id]').dataset.id);
  const p = products.find((x) => x.id === id);
  if (p && !rowErrors.has(id) && !pending.has(id) && parsePrice(e.target.value).value === p.price) e.target.value = money(p.price);
});
list.addEventListener('click', (e) => {
  if (e.target.closest('[data-add-named]')) { openDialog(null, { name: query }); return; }
  const edit = e.target.closest('[data-edit]');
  if (!edit) return;
  const p = products.find((x) => String(x.id) === edit.closest('[data-id]').dataset.id);
  if (p) openDialog(p);
});

$('[data-search]').addEventListener('input', (e) => { query = e.target.value.trim(); renderList(); });
$('[data-cats]').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-cat]');
  if (!chip) return;
  category = chip.dataset.cat;
  render();
});
$('[data-add]').addEventListener('click', () => openDialog());

/* ---------- Новый продукт и правка ---------- */

const dialog = $('[data-dialog]');
const form = $('[data-form]');

function openDialog(p = null, preset = {}) {
  editing = p;
  form.reset();
  $('[data-form-error]').textContent = '';
  $('[data-dialog-title]').textContent = p ? 'Изменить продукт' : 'Новый продукт';
  $('[data-remove]').hidden = !p;
  const cats = categories();
  const current = p?.category || (category && category !== NO_PRICE ? category : cats[0]);
  form.elements.category.innerHTML = cats.map((c) => `<option${c === current ? ' selected' : ''}>${esc(c)}</option>`).join('')
    + `<option value="${NEW_CATEGORY}">+ Новая категория…</option>`;
  if (!cats.length) form.elements.category.value = NEW_CATEGORY;
  form.elements.name.value = p?.name ?? preset.name ?? '';
  form.elements.pack.value = p?.pack ?? '';
  form.elements.price.value = money(p?.price);
  form.elements.note.value = p?.note ?? '';
  toggleNewCategory();
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  form.elements.name.focus();
}

function closeDialog() {
  editing = null;
  if (!dialog.hasAttribute('open')) return;
  if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
}

function toggleNewCategory() {
  $('[data-newcat]').hidden = form.elements.category.value !== NEW_CATEGORY;
}

form.elements.category.addEventListener('change', () => {
  toggleNewCategory();
  if (form.elements.category.value === NEW_CATEGORY) form.elements.newCategory.focus();
});
// editing по событию close не сбрасываем: оно приходит позже, и окно, открытое сразу после «Отмена»,
// потеряло бы продукт — «Сохранить» создал бы копию вместо правки
$('[data-cancel]').addEventListener('click', closeDialog);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = form.elements;
  const error = $('[data-form-error]');
  const name = f.name.value.trim();
  if (!name) { error.textContent = 'Напишите название продукта'; f.name.focus(); return; }
  const price = parsePrice(f.price.value);
  if (price.error) { error.textContent = price.error; f.price.focus(); return; }
  const cat = f.category.value === NEW_CATEGORY ? f.newCategory.value.trim() : f.category.value;
  if (!cat) { error.textContent = 'Напишите название новой категории'; f.newCategory.focus(); return; }
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  error.textContent = '';
  const k = key;
  const isNew = !editing;
  try {
    const row = await api.kitchen.save(k, { id: editing?.id ?? null, category: cat, name, pack: f.pack.value.trim(), price: price.value, note: f.note.value.trim() });
    if (k !== key) return;
    if (row === null) { closeDialog(); gone(); return; }
    replace(row);
    rowErrors.delete(row.id);
    closeDialog();
    // Новый или перенесённый продукт должен быть на виду: не попадает под поиск или фильтр — сбрасываем их
    if (!matches(row)) {
      query = '';
      $('[data-search]').value = '';
      category = '';
    }
    render();
    highlight(row.id);
    toast(isNew ? `Добавили: ${row.name}` : `Сохранили: ${row.name}`);
  } catch (err) {
    error.textContent = isNetwork(err) ? 'Нет связи — нажмите «Сохранить» ещё раз' : err.message;
  } finally {
    button.disabled = false;
  }
});

$('[data-remove]').addEventListener('click', async (e) => {
  const p = editing;
  if (!p) return;
  const button = e.currentTarget;
  const error = $('[data-form-error]');
  button.disabled = true;
  const k = key;
  try {
    const row = await api.kitchen.archive(k, p.id, true);
    if (k !== key) return;
    if (row === null) { closeDialog(); gone(); return; }
    replace(row);
    rowErrors.delete(p.id);
    closeDialog();
    render();
    toast(`Убрали: ${p.name}`, { action: 'Вернуть', onAction: () => restore(p.id) });
  } catch (err) {
    error.textContent = isNetwork(err) ? 'Нет связи — нажмите ещё раз' : err.message;
  } finally {
    button.disabled = false;
  }
});

async function restore(id) {
  const k = key;
  try {
    const row = await api.kitchen.archive(k, id, false);
    if (k !== key) return;
    if (row === null) { gone(); return; }
    replace(row);
    render();
    highlight(id);
    toast(`Вернули: ${row.name}`);
  } catch (err) {
    toast(isNetwork(err) ? 'Нет связи — продукт не вернули' : `Не вернули: ${err.message}`);
  }
}

/* ---------- Подсветка и всплывающая строка ---------- */

function highlight(id) {
  const li = document.querySelector(`.kt-item[data-id="${id}"]`);
  if (!li) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  li.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
  li.classList.add('is-new');
  setTimeout(() => li.classList.remove('is-new'), 2500);
}

let toastTimer = null;
function toast(text, { action = '', onAction = null } = {}) {
  const box = $('[data-toast]');
  clearTimeout(toastTimer);
  box.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button" data-toast-action>${esc(action)}</button>` : ''}`;
  box.onclick = (e) => {
    if (!e.target.closest('[data-toast-action]')) return;
    box.hidden = true;
    onAction?.();
  };
  box.hidden = false;
  toastTimer = setTimeout(() => { box.hidden = true; }, action ? UNDO_MS : 3000);
}

/* ---------- Старт ---------- */

const fromLink = codeFromLink();
const saved = storage.get();
if (fromLink) enter(fromLink, saved);
else if (saved) enter(saved);
else showLogin();

// Новая ссылка поверх уже открытой страницы меняет только часть после # — без перезагрузки
window.addEventListener('hashchange', () => {
  const code = codeFromLink();
  if (code && code !== key) enter(code, key);
});

// Код убрали в соседней вкладке (выход шефа или «закрыть её здесь и войти» в панели) — выходит и эта вкладка,
// иначе следующее обновление списка записало бы код обратно
window.addEventListener('storage', (e) => {
  if (e.key === KEY_STORE && !e.newValue && key) showLogin('Страницу закрыли на этом устройстве. Чтобы войти снова, нужна ссылка от владельца.');
});
