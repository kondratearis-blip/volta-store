// Распознавание чеков прямо в браузере менеджера: Tesseract.js лежит на нашем же сайте
// (assets/vendor/tesseract), картинки чеков никуда не отправляются. Распознанный текст и отпечаток файла
// хранятся на этом устройстве (localStorage), а вердикт считается при показе — по текущим данным заказа
// и правилам receipt-check.js — и кешируется до следующего изменения.
import { checkReceiptText, normalizeText, uniqueTxnId } from './receipt-check.js';
import { payment } from './data.js';
import { orderNoDated } from './cashbox.js';

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
const STORE_KEY = 'kokoro.receiptOcr.v2';
const MAX_WIDTH = 1200;          // крупные скриншоты уменьшаем: распознаётся быстрее, точность та же
const MAX_PIXELS = 4_000_000;    // и очень длинные — тоже, чтобы телефон не упёрся в память
const KEEP_DAYS = 90;            // старше — из кеша удаляем
const TEXT_LIMIT = 1500;         // текста чека для сверки хватает с запасом
const START_TIMEOUT = 90_000;    // загрузка модуля и словарей
const RECOGNIZE_TIMEOUT = 60_000;
const IDLE_STOP = 120_000;       // воркер освобождает память, если чеков нет 2 минуты
const RETRY_DELAYS = [30_000, 120_000, 600_000]; // временные сбои: не больше трёх повторов за сессию

let store = load();
let version = 0;                 // растёт при каждом изменении store — по нему сбрасывается кеш вердиктов
let workerPromise = null;
let idleTimer = null;
let blockedUntil = 0;            // после сбоя загрузки модуля не пробуем снова раньше этого времени
let lastError = '';
const queue = [];                // { order, getReceipt }
const queued = new Set();
const attempts = new Map();      // путь → число временных сбоев
let running = false;
let listener = () => {};

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    return Object.fromEntries(Object.entries(data).filter(([, e]) => e.at > cutoff));
  } catch { return {}; }
}

/** Сохраняем, слив с тем, что успела записать другая вкладка; при нехватке места — без самых старых */
function save() {
  let merged = store;
  try { merged = { ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}'), ...store }; } catch { /* ничего */ }
  for (let drop = 0; drop < 5; drop++) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(merged)); store = merged; return; } catch {
      const sorted = Object.entries(merged).sort(([, a], [, b]) => a.at - b.at);
      merged = Object.fromEntries(sorted.slice(Math.ceil(sorted.length / 5)));
    }
  }
}

function withTimeout(promise, ms, message) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('не загрузился модуль распознавания'));
    document.head.append(s);
  });
}

function worker() {
  if (Date.now() < blockedUntil) return Promise.reject(new Error(lastError || 'распознавание временно недоступно'));
  workerPromise ||= withTimeout((async () => {
    if (!window.Tesseract) await loadScript(`${BASE}tesseract.min.js`);
    // workerBlobURL: false — воркер грузится файлом с нашего сайта (CSP не разрешает blob-скрипты)
    return window.Tesseract.createWorker(['rus', 'eng'], 1, {
      workerPath: `${BASE}worker.min.js`, corePath: `${BASE}core`, langPath: `${BASE}lang`, workerBlobURL: false, gzip: true,
      errorHandler: () => {}, // ошибки воркера ловим через тайм-ауты и catch, а не необработанным исключением
    });
  })(), START_TIMEOUT, 'модуль распознавания не загрузился за 90 секунд').catch((err) => {
    stopWorker();
    lastError = err.message;
    blockedUntil = Date.now() + 5 * 60_000;
    throw err;
  });
  return workerPromise;
}

function stopWorker() {
  const w = workerPromise;
  workerPromise = null;
  w?.then((x) => x.terminate()).catch(() => {});
}

async function sha256(blob) {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function imageFor(blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_WIDTH / bitmap.width, Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('не хватило памяти для картинки');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

/** Кто будет получать «чек распознан» — панель перерисовывает отметку этого чека */
export function onReceiptChecked(fn) { listener = fn; }

/**
 * Ставит чеки в очередь распознавания (по одному, в фоне). getReceipt(path) → { blob, ext } | null —
 * та же проверенная загрузка, что у «Открыть» и «Скачать». urgent — чеки с вкладки «Заказы»: в начало очереди.
 */
export function queueReceipts(orders, getReceipt, { urgent = false } = {}) {
  rememberLabels(orders);
  for (const o of orders) {
    if (!o.receipt_path || store[o.receipt_path]) continue;
    if (queued.has(o.receipt_path)) {
      if (urgent) { // уже ждёт в хвосте — переносим в начало
        const at = queue.findIndex((q) => q.order.receipt_path === o.receipt_path);
        if (at > 0) queue.unshift(...queue.splice(at, 1));
      }
      continue;
    }
    if ((attempts.get(o.receipt_path) || 0) > RETRY_DELAYS.length) continue;
    queued.add(o.receipt_path);
    queue[urgent ? 'unshift' : 'push']({ order: o, getReceipt });
  }
  run();
}

/**
 * Подпись заказа для сообщений о повторах — «№ 5 от 31.10». Номер на день появился 02.11.2026 (day-numbers.sql):
 * чеки, распознанные раньше, хранятся без подписи — дописываем, когда их заказ снова на экране
 */
export function rememberLabels(orders) {
  let changed = false;
  for (const o of orders) {
    const entry = o.receipt_path && store[o.receipt_path];
    const label = orderNoDated(o);
    if (entry && entry.order === o.id && label && entry.label !== label) { entry.label = label; changed = true; }
  }
  if (changed) { version++; save(); }
}

/** Убрать из очереди ещё не начатые чеки, кроме нужных (сменили месяц или вкладку) */
export function keepOnly(paths) {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!paths.has(queue[i].order.receipt_path)) { queued.delete(queue[i].order.receipt_path); queue.splice(i, 1); }
  }
}

async function run() {
  if (running) return;
  running = true;
  clearTimeout(idleTimer);
  try {
    while (queue.length) {
      const { order, getReceipt } = queue.shift();
      const path = order.receipt_path;
      let entry;
      try {
        const receipt = await getReceipt(path);
        if (!receipt) entry = { error: 'файл не похож на фото или PDF' };
        else {
          const hash = await sha256(receipt.blob);
          if (receipt.ext === 'pdf' || receipt.ext === 'heic') entry = { hash, error: `${receipt.ext.toUpperCase()} не распознаём — сверьте вручную` };
          else {
            let image;
            try { image = await imageFor(receipt.blob); } catch (err) { entry = { hash, error: `картинку не открыть: ${err.message}` }; }
            if (!entry) {
              const w = await worker();
              const { data } = await withTimeout(w.recognize(image, {}, { text: true, blocks: false, hocr: false, tsv: false }), RECOGNIZE_TIMEOUT, 'распознавание заняло больше минуты');
              const text = data.text.slice(0, TEXT_LIMIT);
              entry = { hash, text, txn: uniqueTxnId(normalizeText(text), payment.recipient) };
            }
          }
        }
      } catch (err) {
        // Временный сбой (сеть, тайм-аут, модуль не загрузился): повторим позже, но не бесконечно
        queued.delete(path);
        if (/больше минуты/.test(err.message)) stopWorker();
        const n = (attempts.get(path) || 0) + 1;
        attempts.set(path, n);
        if (n <= RETRY_DELAYS.length) setTimeout(() => queueReceipts([order], getReceipt), RETRY_DELAYS[n - 1]);
        lastError = err.message;
        listener(path, err);
        continue;
      }
      store[path] = { ...entry, order: order.id, label: orderNoDated(order), at: Date.now() };
      version++;
      save();
      queued.delete(path);
      listener(path);
    }
  } finally {
    running = false;
    idleTimer = setTimeout(stopWorker, IDLE_STOP);
  }
}

export const isQueued = (path) => queued.has(path);
export const queueLength = () => queue.length;
/** Почему чек ещё не сверен: последняя ошибка распознавания (если была) */
export const pendingReason = (path) => (attempts.get(path) ? lastError : '');

let indexVersion = -1;
let byHash = new Map();
let byTxn = new Map();
let labels = new Map();
const verdicts = new Map();

/** Индексы для поиска повторов: отпечаток файла → заказы, номер операции → заказы, заказ → «№ 5 от 31.10» */
function indexes() {
  if (indexVersion === version) return;
  byHash = new Map();
  byTxn = new Map();
  labels = new Map();
  for (const e of Object.values(store)) {
    if (e.hash) byHash.set(e.hash, [...(byHash.get(e.hash) || []), e.order]);
    if (e.txn) byTxn.set(e.txn, [...(byTxn.get(e.txn) || []), e.order]);
    if (e.label) labels.set(e.order, e.label);
  }
  verdicts.clear();
  indexVersion = version;
}

/**
 * Вердикт по чеку заказа или null, если чек ещё не распознан. Повторы ищем среди всех чеков,
 * распознанных на этом устройстве; пока в очереди есть другие чеки, «✓» не ставим — повтор мог не найтись.
 */
export function receiptVerdict(order) {
  const entry = store[order.receipt_path];
  if (!entry) return null;
  indexes();
  const key = `${order.receipt_path}|${order.id}|${order.day_number}|${order.total}|${order.created_at}|${order.paid_at}|${queue.length > 0}`;
  if (verdicts.has(key)) return verdicts.get(key);
  // Повтор — подпись другого заказа («№ 5 от 31.10») или true, если подписи на этом устройстве ещё нет
  const other = (list) => {
    const id = (list || []).find((x) => x !== order.id);
    return id === undefined ? null : labels.get(id) || true;
  };
  const duplicateOf = entry.hash ? other(byHash.get(entry.hash)) : null;
  let result;
  if (entry.error) {
    result = duplicateOf
      ? { level: 'bad', summary: `Не сходится: тот же файл чека уже приложен к ${duplicateOf === true ? 'другому заказу' : `заказу ${duplicateOf}`}`, problems: [], notes: [], fields: {} }
      : { level: 'check', summary: `Сверьте вручную: ${entry.error}`, problems: [], notes: [entry.error], fields: {} };
  } else {
    result = checkReceiptText(entry.text, order, { recipient: payment.recipient, duplicateOf, txnDuplicateOf: entry.txn ? other(byTxn.get(entry.txn)) : null });
    if (result.level === 'ok' && queue.length) {
      result = { ...result, level: 'check', summary: `Сверьте вручную: ждём сверки остальных чеков (проверка на повторы), осталось ${queue.length}` };
    }
  }
  verdicts.set(key, result);
  return result;
}

/** Распознать заново (кнопка «Сверить заново») */
export function forget(path) {
  delete store[path];
  attempts.delete(path);
  version++;
  // save() сливает память с localStorage (там могла писать другая вкладка) — без этого запись вернулась бы оттуда
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    delete saved[path];
    localStorage.setItem(STORE_KEY, JSON.stringify(saved));
  } catch { /* ничего */ }
  save();
}

/** Стереть распознанные тексты на этом устройстве (при выходе из панели) */
export function clear() {
  store = {};
  version++;
  queue.length = 0;
  queued.clear();
  stopWorker();
  try { localStorage.removeItem(STORE_KEY); } catch { /* ничего */ }
}
