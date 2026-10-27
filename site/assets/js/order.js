// Страница заказа: 1) доставка → 2) оплата по QR и чек → «Заказ принят».
import { api } from './api.js';
import { combo, money } from './data.js';

const $ = (s) => document.querySelector(s);
const form = $('[data-order-form]');
const MAX_QTY = 20;
const MAX_RECEIPT = 10 * 1024 * 1024;
const CONTACT_KEY = 'kokoro.contact';
const PENDING_KEY = 'kokoro.pending';
const REMEMBERED = ['name', 'phone', 'address', 'entrance', 'floor', 'apartment'];

let qty = 1;
let price = combo.price;
let deliveryFee = null; // null — сумма доставки неизвестна (база не ответила)
let accepting = true;
let settings = null;
let pending = null; // { number, total, token, phone } — заказ, который ждёт оплаты
let receipt = null; // Blob чека, готовый к отправке

const storage = {
  get(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
  set(key, value) { try { value ? localStorage.setItem(key, JSON.stringify(value)) : localStorage.removeItem(key); } catch { /* приватный режим */ } },
};

$('[data-combo-list]').innerHTML = combo.items
  .map((i) => `<li><b>${i.count}</b><span>${i.title}</span></li>`)
  .join('');

/* ---------- Шаг 1: доставка ---------- */

function render() {
  const total = qty * price + (deliveryFee || 0);
  $('[data-qty-value]').textContent = qty;
  document.querySelector('[data-qty="-1"]').disabled = qty <= 1;
  document.querySelector('[data-qty="1"]').disabled = qty >= MAX_QTY;
  $('[data-price]').textContent = price;
  $('[data-sum-qty]').textContent = qty;
  $('[data-sum-items]').textContent = money(qty * price);
  $('[data-sum-delivery]').textContent = deliveryFee === null ? 'уточнит менеджер' : deliveryFee ? money(deliveryFee) : 'бесплатно';
  $('[data-sum-total]').textContent = money(total);
  $('[data-submit]').textContent = `Перейти к оплате · ${money(total)}`;
  $('[data-submit]').disabled = !accepting;
}

document.querySelectorAll('[data-qty]').forEach((b) => b.addEventListener('click', () => {
  qty = Math.min(MAX_QTY, Math.max(1, qty + Number(b.dataset.qty)));
  render();
}));
$('[data-when]').addEventListener('change', (e) => {
  $('[data-time-field]').hidden = e.target.value !== 'time';
});

// Постоянным клиентам не нужно вводить контакты заново
const savedContact = storage.get(CONTACT_KEY) || {};
for (const k of REMEMBERED) if (savedContact[k]) form.elements[k].value = savedContact[k];

async function loadSettings() {
  try {
    settings = await api.settings();
    if (settings) {
      price = settings.combo_price;
      deliveryFee = settings.delivery_fee;
      accepting = settings.accepting_orders;
      $('[data-closed]').hidden = accepting;
      $('[data-closed]').textContent = settings.closed_message;
    }
  } catch { /* покажем цену по умолчанию; итог всё равно посчитает база */ }
  render();
  if (pending) fillPayment();
}

function fail(input, message) {
  $('[data-form-error]').textContent = message;
  if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
}
form.addEventListener('input', (e) => {
  e.target.removeAttribute?.('aria-invalid');
  $('[data-form-error]').textContent = '';
});

const networkMessage = (err) => (err instanceof TypeError ? 'Нет связи. Проверьте интернет и попробуйте ещё раз.' : err.message);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = form.elements;
  $('[data-form-error]').textContent = '';
  if (f.website.value) return; // ловушка для ботов
  if (!f.name.value.trim()) return fail(f.name, 'Укажите имя');
  const digits = f.phone.value.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return fail(f.phone, 'Укажите номер телефона с WhatsApp');
  if (f.address.value.trim().length < 3) return fail(f.address, 'Укажите адрес доставки');
  if (f.when.value === 'time' && !f.time.value) return fail(f.time, 'Укажите время доставки');

  const button = $('[data-submit]');
  button.disabled = true;
  button.textContent = 'Секунду…';
  try {
    const result = await api.placeOrder({
      qty,
      name: f.name.value,
      phone: f.phone.value,
      address: f.address.value,
      entrance: f.entrance.value,
      floor: f.floor.value,
      apartment: f.apartment.value,
      deliveryTime: f.when.value === 'time' ? `Ко времени: ${f.time.value}` : 'Как можно скорее',
      comment: f.comment.value,
    });
    storage.set(CONTACT_KEY, Object.fromEntries(REMEMBERED.map((k) => [k, f[k].value])));
    pending = { ...result, phone: f.phone.value };
    storage.set(PENDING_KEY, pending);
    showPayment();
  } catch (err) {
    fail(null, networkMessage(err));
  } finally {
    render();
  }
});

/* ---------- Шаг 2: оплата и чек ---------- */

function show(step) {
  form.hidden = step !== 'form';
  $('[data-pay]').hidden = step !== 'pay';
  $('[data-done]').hidden = step !== 'done';
  if (step !== 'form') {
    const el = $(step === 'pay' ? '[data-pay]' : '[data-done]');
    el.focus({ preventScroll: true });
    $('[data-order-card]').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function fillPayment() {
  $('[data-pay-num]').textContent = `№ ${pending.number}`;
  $('[data-pay-total]').textContent = money(pending.total);
  const qrUrl = settings?.qr_url || '';
  $('[data-qr]').hidden = !qrUrl;
  $('[data-qr-missing]').hidden = Boolean(qrUrl) || !settings;
  if (qrUrl && $('[data-qr-img]').getAttribute('src') !== qrUrl) $('[data-qr-img]').src = qrUrl;
  $('[data-pay-note]').textContent = settings?.payment_note || '';
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
  if (!blob) {
    preview.hidden = true;
    preview.style.backgroundImage = '';
    $('[data-receipt-hint]').innerHTML = '<b>Прикрепить чек</b><br>скриншот или фото оплаты, до 10 МБ';
    $('[data-receipt]').value = '';
    return;
  }
  preview.hidden = false;
  if (blob.type.startsWith('image/') && blob.type !== 'image/heic') {
    preview.textContent = '';
    preview.style.backgroundImage = `url("${URL.createObjectURL(blob)}")`;
  } else {
    preview.style.backgroundImage = '';
    preview.textContent = blob.type === 'application/pdf' ? 'PDF' : 'Фото';
  }
  $('[data-receipt-hint]').innerHTML = `<b>Чек прикреплён</b><br>${name ? name.replace(/[<>&]/g, '') + ' · ' : ''}нажмите, чтобы заменить`;
}

// Фото чека ужимаем в браузере: быстрее загружается с мобильного интернета
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
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
    $('[data-pay-error]').textContent = 'Прикрепите фото, скриншот (JPG, PNG) или PDF';
    return;
  }
  const blob = await shrink(type === file.type ? file : new Blob([file], { type }));
  if (blob.size > MAX_RECEIPT) {
    $('[data-pay-error]').textContent = 'Файл больше 10 МБ — сделайте скриншот чека';
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
  button.textContent = 'Отправляем чек…';
  $('[data-pay-error]').textContent = '';
  try {
    await api.sendReceipt(pending.token, receipt);
    showDone();
  } catch (err) {
    $('[data-pay-error]').textContent = networkMessage(err);
    button.disabled = false;
  } finally {
    button.textContent = 'Отправить чек';
  }
});

$('[data-cancel]').addEventListener('click', async () => {
  if (!pending || !confirm(`Отменить заказ № ${pending.number}?`)) return;
  try { await api.cancelUnpaid(pending.token); } catch { /* заказ без чека менеджер всё равно не повезёт */ }
  pending = null;
  storage.set(PENDING_KEY, null);
  show('form');
});

/* ---------- Готово ---------- */

function showDone() {
  $('[data-done-num]').textContent = `№ ${pending.number}`;
  $('[data-done-total]').textContent = money(pending.total);
  $('[data-done-phone]').textContent = pending.phone;
  pending = null;
  storage.set(PENDING_KEY, null);
  setReceipt(null);
  show('done');
}

$('[data-again]').addEventListener('click', () => {
  qty = 1;
  form.elements.comment.value = '';
  show('form');
  render();
});

// Клиент ушёл на оплату в банк и вернулся — продолжаем с шага оплаты
const saved = storage.get(PENDING_KEY);
if (saved?.token && saved.number) {
  pending = saved;
  showPayment();
}

render();
loadSettings();
