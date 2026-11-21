// «Мои адреса» и «Мои заказы» покупателя (specs/018) — только на этом телефоне, в localStorage: без регистрации, как
// решил владелец. Заказы храним год (столько база хранит данные клиентов), адресов — до 10, заказов — до 30.
const ADDR_KEY = 'kokoro.addresses';
const HIST_KEY = 'kokoro.history';
export const MAX_ADDRESSES = 10;
export const MAX_ORDERS = 30;
const YEAR_MS = 365 * 86_400_000;

const store = {
  get(key) { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return Array.isArray(v) ? v : []; } catch { return []; } },
  set(key, list) { try { list.length ? localStorage.setItem(key, JSON.stringify(list)) : localStorage.removeItem(key); } catch { /* приватный режим */ } },
};
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const norm = (v) => text(v).toLowerCase().replace(/[\s.,]+/g, ' ').trim();
const finite = (n) => Number.isFinite(Number(n));
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

/** Точка на карте: { lat, lon, label? } или null */
function cleanPoint(p) {
  if (!p || !finite(p.lat) || !finite(p.lon)) return null;
  const point = { lat: Number(p.lat), lon: Number(p.lon) };
  if (p.label) point.label = text(p.label, 200);
  if (p.address) point.address = text(p.address, 200);
  return point;
}

function cleanAddress(a) {
  if (!a || !text(a.address)) return null;
  return {
    id: text(a.id, 60) || newId(),
    label: text(a.label, 30) || 'Дом',
    address: text(a.address),
    entrance: text(a.entrance, 20),
    floor: text(a.floor, 20),
    apartment: text(a.apartment, 20),
    comment: text(a.comment, 500),
    point: cleanPoint(a.point),
    used: Number(a.used) || 0,
  };
}

export const addresses = {
  /** Свежие первыми */
  list() {
    return store.get(ADDR_KEY).map(cleanAddress).filter(Boolean).sort((a, b) => b.used - a.used).slice(0, MAX_ADDRESSES);
  },
  /**
   * Сохранить адрес. Тот же дом и квартира уже есть — обновляем его (название остаётся, если новое не задано);
   * иначе — новый в начало. Больше 10 — самый давний уходит. Возвращает сохранённый
   */
  save(entry) {
    const next = cleanAddress({ ...entry, used: Date.now() });
    if (!next) return null;
    const list = this.list();
    const same = list.find((a) => a.id === entry?.id)
      || list.find((a) => norm(a.address) === norm(next.address) && norm(a.apartment) === norm(next.apartment));
    if (same) {
      Object.assign(same, { ...next, id: same.id, label: entry?.label ? next.label : same.label });
    } else {
      list.unshift(next);
    }
    store.set(ADDR_KEY, list.sort((a, b) => b.used - a.used).slice(0, MAX_ADDRESSES));
    return same || next;
  },
  remove(id) {
    store.set(ADDR_KEY, this.list().filter((a) => a.id !== id));
  },
  get(id) {
    return this.list().find((a) => a.id === id) || null;
  },
};

const STATUSES = ['awaiting_payment', 'new', 'confirmed', 'cooking', 'delivering', 'done', 'canceled'];
function cleanOrder(o) {
  if (!o || !text(o.token, 80)) return null;
  const at = Number(o.at) || 0;
  return {
    token: text(o.token, 80),
    number: o.number == null ? null : text(o.number, 20),
    branch: ['kulieva', 'kokzhar'].includes(o.branch) ? o.branch : null,
    at,
    qty: Math.max(1, Math.min(20, Math.round(Number(o.qty) || 1))),
    total: o.total != null && finite(o.total) ? Number(o.total) : null,
    fulfillment: o.fulfillment === 'pickup' ? 'pickup' : 'delivery',
    address: text(o.address),
    entrance: text(o.entrance, 20),
    floor: text(o.floor, 20),
    apartment: text(o.apartment, 20),
    door: o.door === true,
    when: text(o.when, 40),
    delivery: o.delivery && finite(o.delivery.price) ? { price: Number(o.delivery.price), approx: !!o.delivery.approx } : null,
    point: cleanPoint(o.point),
    status: STATUSES.includes(o.status) ? o.status : 'new',
    rated: o.rated === true,
  };
}

export const history = {
  /** Свежие первыми; старше года — забываем */
  list(now = Date.now()) {
    const list = store.get(HIST_KEY).map(cleanOrder).filter(Boolean);
    const kept = list.filter((o) => now - o.at < YEAR_MS).sort((a, b) => b.at - a.at).slice(0, MAX_ORDERS);
    if (kept.length !== list.length) store.set(HIST_KEY, kept);
    return kept;
  },
  /** Новый заказ (или обновить тот же ключ) */
  add(entry) {
    const next = cleanOrder({ ...entry, at: entry?.at || Date.now() });
    if (!next) return null;
    const list = this.list().filter((o) => o.token !== next.token);
    list.unshift(next);
    store.set(HIST_KEY, list.sort((a, b) => b.at - a.at).slice(0, MAX_ORDERS));
    return next;
  },
  /** Поменять поля заказа по ключу (номер, статус, точка, «оценён») → обновлённый или null */
  update(token, patch) {
    const list = this.list();
    const i = list.findIndex((o) => o.token === token);
    if (i < 0) return null;
    const next = cleanOrder({ ...list[i], ...patch, token: list[i].token, at: list[i].at });
    list[i] = next;
    store.set(HIST_KEY, list);
    return next;
  },
  get(token) {
    return this.list().find((o) => o.token === token) || null;
  },
  remove(token) {
    store.set(HIST_KEY, this.list().filter((o) => o.token !== token));
  },
};
