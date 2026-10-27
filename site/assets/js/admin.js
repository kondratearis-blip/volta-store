// Панель менеджера: заказы за день (обновляются сами), статусы, WhatsApp, настройки.
import { api } from './api.js';
import { STATUSES, PAYMENTS, money } from './data.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const POLL_MS = 10_000;
const SOUND_KEY = 'kokoro.sound';

let settings = null;
let orders = [];
let filter = 'active';
let knownIds = null;
let pollTimer = null;
let soundOn = true;
try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off'; } catch { /* ничего */ }

const todayBishkek = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek' }).format(new Date());
const isActive = (o) => o.status !== 'done' && o.status !== 'canceled';

/* ---------- Вход ---------- */

async function boot() {
  if (await api.auth.isAdmin()) return openApp();
  $('[data-login]').hidden = false;
}

$('[data-login-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const error = $('[data-login-error]');
  error.textContent = '';
  try {
    await api.auth.signIn(f.email.value.trim(), f.password.value);
    if (!(await api.auth.isAdmin())) {
      await api.auth.signOut();
      error.textContent = 'У этого пользователя нет доступа к панели KOKORO (таблица admins).';
      return;
    }
    $('[data-login]').hidden = true;
    openApp();
  } catch (err) {
    error.textContent = /invalid/i.test(err.message) ? 'Неверная почта или пароль' : err.message;
  }
});

$('[data-signout]').addEventListener('click', async () => {
  clearInterval(pollTimer);
  await api.auth.signOut();
  location.reload();
});

async function openApp() {
  $('[data-tabs]').hidden = false;
  $('[data-signout]').hidden = false;
  $('[data-day]').value = todayBishkek();
  updateSoundButton();
  showTab('orders');
  try { settings = await api.settings(); } catch { /* шаблон сообщения подтянется при следующем открытии */ }
  await loadOrders();
  pollTimer = setInterval(loadOrders, POLL_MS);
}

/* ---------- Вкладки ---------- */

function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === name)));
  document.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  if (name === 'settings') fillSettings();
}
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* ---------- Заказы ---------- */

$('[data-day]').addEventListener('change', () => { knownIds = null; loadOrders(); });

async function loadOrders() {
  const day = $('[data-day]').value || todayBishkek();
  let rows;
  try {
    rows = await api.admin.listOrders(day);
    $('[data-orders-status]').textContent = '';
  } catch (err) {
    $('[data-orders-status]').textContent = `Не удалось обновить заказы: ${err.message}`;
    if (err.status === 401) location.reload();
    return;
  }
  const fresh = knownIds ? rows.filter((o) => !knownIds.has(o.id)) : [];
  knownIds = new Set(rows.map((o) => o.id));
  orders = rows;
  if (fresh.length) notifyNew(fresh.length);
  renderOrders();
}

function renderOrders() {
  const counts = { active: orders.filter(isActive).length, all: orders.length };
  for (const s of Object.keys(STATUSES)) counts[s] = orders.filter((o) => o.status === s).length;
  $('[data-new-count]').textContent = counts.new || '';

  const chips = [['active', 'В работе'], ['all', 'Все'], ...Object.entries(STATUSES)];
  $('[data-filters]').innerHTML = chips
    .map(([k, label]) => `<button class="chip" type="button" data-filter="${k}" aria-pressed="${filter === k}">${label}<b>${counts[k]}</b></button>`)
    .join('');

  // Не перерисовываем карточку, пока менеджер печатает в ней заметку
  if (document.activeElement?.closest?.('.ord')) return;

  const list = orders.filter((o) => filter === 'all' || (filter === 'active' ? isActive(o) : o.status === filter));
  // В работе — сначала самые старые: очередь разбирается сверху вниз
  if (filter === 'active') list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  $('[data-orders]').innerHTML = list.length ? list.map(orderHtml).join('') : '<p>Заказов нет</p>';
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

function waLink(o) {
  const vars = {
    number: o.id, name: o.name, qty: o.qty, total: o.total.toLocaleString('ru-RU'),
    address: fullAddress(o), time: o.delivery_time, payment: PAYMENTS[o.payment] || o.payment,
  };
  const text = (settings?.whatsapp_template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return `https://wa.me/${waPhone(o.phone)}?text=${encodeURIComponent(text)}`;
}

function orderHtml(o) {
  const time = new Date(o.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek' });
  return `<article class="ord ${o.status === 'new' ? 'ord--new' : ''} ${isActive(o) ? '' : 'ord--closed'}" data-id="${o.id}">
    <div class="ord__head">
      <span class="ord__num">№ ${o.id}</span>
      <span class="ord__time">${time}</span>
      <span class="badge badge--${o.status}">${STATUSES[o.status] || esc(o.status)}</span>
    </div>
    <p class="ord__what">Комбо × ${o.qty} <span>— ${money(o.total)}${o.delivery_fee ? ` (доставка ${money(o.delivery_fee)})` : ''}</span></p>
    <div class="ord__info">
      <p><b>${esc(o.name)}</b> · <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></p>
      <p>${esc(fullAddress(o))}</p>
      <p class="ord__muted">${esc(o.delivery_time)} · ${esc(PAYMENTS[o.payment] || o.payment)}</p>
      ${o.comment ? `<p>💬 ${esc(o.comment)}</p>` : ''}
    </div>
    <div class="ord__actions">
      <a class="btn btn--wa" href="${esc(waLink(o))}" target="_blank" rel="noopener">WhatsApp</a>
      <a class="btn btn--ghost" href="tel:${esc(o.phone)}">Позвонить</a>
    </div>
    <select data-status aria-label="Статус заказа">${Object.entries(STATUSES)
      .map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <textarea data-note rows="1" maxlength="500" placeholder="Заметка менеджера" aria-label="Заметка менеджера">${esc(o.manager_note)}</textarea>
  </article>`;
}

$('[data-filters]').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filter]');
  if (!chip) return;
  filter = chip.dataset.filter;
  renderOrders();
});

$('[data-orders]').addEventListener('change', async (e) => {
  const card = e.target.closest('.ord');
  if (!card) return;
  const patch = e.target.matches('[data-status]') ? { status: e.target.value }
    : e.target.matches('[data-note]') ? { manager_note: e.target.value.slice(0, 500) } : null;
  if (!patch) return;
  try {
    const row = await api.admin.updateOrder(card.dataset.id, patch);
    if (row) orders = orders.map((o) => (o.id === row.id ? row : o));
  } catch (err) {
    alert(`Не сохранилось: ${err.message}`);
  }
  e.target.blur();
  renderOrders();
});

/* ---------- Уведомление о новом заказе ---------- */

let audio;
function beep() {
  try {
    audio ??= new AudioContext();
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

function notifyNew(n) {
  if (soundOn) beep();
  const base = 'Заказы — KOKORO';
  let flips = 0;
  const timer = setInterval(() => {
    document.title = flips++ % 2 ? base : `🔴 Новый заказ (${n})`;
    if (flips > 20 || document.hasFocus()) { clearInterval(timer); document.title = base; }
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
});

/* ---------- Настройки ---------- */

async function fillSettings() {
  try { settings = await api.settings(); } catch (err) { $('[data-settings-error]').textContent = err.message; return; }
  const f = $('[data-settings-form]').elements;
  f.accepting_orders.checked = settings.accepting_orders;
  for (const k of ['closed_message', 'combo_price', 'delivery_fee', 'whatsapp_template']) f[k].value = settings[k];
  $('[data-settings-saved]').textContent = '';
  $('[data-settings-error]').textContent = '';
}

$('[data-settings-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  $('[data-settings-error]').textContent = '';
  $('[data-settings-saved]').textContent = '';
  try {
    settings = await api.admin.saveSettings({
      accepting_orders: f.accepting_orders.checked,
      closed_message: f.closed_message.value.trim() || 'Сейчас мы не принимаем заказы. Загляните позже!',
      combo_price: Math.max(1, Math.round(Number(f.combo_price.value))),
      delivery_fee: Math.max(0, Math.round(Number(f.delivery_fee.value))),
      whatsapp_template: f.whatsapp_template.value,
    });
    $('[data-settings-saved]').textContent = 'Сохранено ✓';
  } catch (err) {
    $('[data-settings-error]').textContent = err.message;
  }
});

boot();
