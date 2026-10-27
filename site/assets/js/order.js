// Страница заказа: количество, форма, отправка в базу через place_order.
import { api } from './api.js';
import { combo, money } from './data.js';

const $ = (s) => document.querySelector(s);
const form = $('[data-order-form]');
const MAX_QTY = 20;
const CONTACT_KEY = 'kokoro.contact';
const REMEMBERED = ['name', 'phone', 'address', 'entrance', 'floor', 'apartment'];

let qty = 1;
let price = combo.price;
let deliveryFee = null; // null — сумма доставки неизвестна (база не ответила)
let accepting = true;

$('[data-combo-list]').innerHTML = combo.items
  .map((i) => `<li><b>${i.count}</b><span>${i.title}</span></li>`)
  .join('');

function render() {
  $('[data-qty-value]').value = qty;
  $('[data-qty-value]').textContent = qty;
  document.querySelector('[data-qty="-1"]').disabled = qty <= 1;
  document.querySelector('[data-qty="1"]').disabled = qty >= MAX_QTY;
  $('[data-price]').textContent = price;
  $('[data-sum-qty]').textContent = qty;
  $('[data-sum-items]').textContent = money(qty * price);
  $('[data-sum-delivery]').textContent = deliveryFee === null ? 'уточнит менеджер' : deliveryFee ? money(deliveryFee) : 'бесплатно';
  $('[data-sum-total]').textContent = money(qty * price + (deliveryFee || 0));
  $('[data-submit]').textContent = `Заказать за ${money(qty * price + (deliveryFee || 0))}`;
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
try {
  const saved = JSON.parse(localStorage.getItem(CONTACT_KEY) || '{}');
  for (const k of REMEMBERED) if (saved[k]) form.elements[k].value = saved[k];
} catch { /* приватный режим */ }

async function loadSettings() {
  try {
    const s = await api.settings();
    if (!s) return;
    price = s.combo_price;
    deliveryFee = s.delivery_fee;
    accepting = s.accepting_orders;
    $('[data-closed]').hidden = accepting;
    $('[data-closed]').textContent = s.closed_message;
  } catch { /* покажем цену по умолчанию; итог всё равно посчитает база */ }
  render();
}

function fail(input, message) {
  $('[data-form-error]').textContent = message;
  if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
}
form.addEventListener('input', (e) => {
  e.target.removeAttribute?.('aria-invalid');
  $('[data-form-error]').textContent = '';
});

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
  button.textContent = 'Отправляем…';
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
      payment: f.payment.value,
      comment: f.comment.value,
    });
    try { localStorage.setItem(CONTACT_KEY, JSON.stringify(Object.fromEntries(REMEMBERED.map((k) => [k, f[k].value])))); } catch { /* ничего */ }
    showDone(result, f.phone.value);
  } catch (err) {
    fail(null, err instanceof TypeError ? 'Нет связи. Проверьте интернет и попробуйте ещё раз.' : err.message);
  } finally {
    render();
  }
});

function showDone({ number, total }, phone) {
  form.hidden = true;
  $('[data-done]').hidden = false;
  $('[data-done-num]').textContent = `№ ${number}`;
  $('[data-done-total]').textContent = money(total);
  $('[data-done-phone]').textContent = phone;
  $('[data-done]').focus();
  $('[data-order-card]').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('[data-again]').addEventListener('click', () => {
  qty = 1;
  form.elements.comment.value = '';
  form.hidden = false;
  $('[data-done]').hidden = true;
  render();
});

render();
loadSettings();
