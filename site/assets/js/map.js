// Карта на страницах сайта: Leaflet 1.9.4 (assets/vendor/leaflet), подложка — векторная OpenFreeMap (specs/023, ниже), запасная —
// картинки OpenStreetMap. Библиотека грузится,
// только когда карта нужна (форма с точкой, курьер с заказами, «Карта» в панели, «Едем» у покупателя).
// Поиск адреса текстом и адрес по точке — OpenStreetMap Nominatim: не чаще раза в секунду (их правило).
// Подсказки при наборе — Photon (komoot, тоже данные OpenStreetMap): у Nominatim подсказки при наборе запрещены.
// Расстояние до кухни по дорогам для суммы доставки — OSRM (тоже OpenStreetMap), запасной — Valhalla; у них же — время в пути
// для оценки «курьер приедет примерно через …» (specs/016).
import { branchAt, delivery, deliveryPrice } from './data.js';
import { distanceKm, inZone } from './maps.js';

export const BISHKEK = { lat: 42.8746, lon: 74.5698 };

let loading = null;
/** Загрузить Leaflet один раз — window.L */
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'assets/vendor/leaflet/leaflet.css';
      document.head.append(css);
      const script = document.createElement('script');
      script.src = 'assets/vendor/leaflet/leaflet.js';
      script.onload = () => resolve(window.L);
      script.onerror = () => { loading = null; reject(new Error('Карта не загрузилась')); };
      document.head.append(script);
    });
  }
  return loading;
}

/* ---------- Чёткая карта (specs/023): векторная OpenFreeMap поверх Leaflet ---------- */

// Картинки OpenStreetMap на телефоне размыты (256 точек растягиваются на экран с плотностью 2–3), подписи вперемешку
// по-кыргызски и по-русски, номеров домов почти не видно. Векторная карта OpenFreeMap (бесплатно, для коммерции тоже, без
// ключа; данные OpenStreetMap) рисуется на экране сама — чёткая при любом приближении. Подписи — по-русски, где есть
// (name:ru), номера домов — с приближения 16. Движок — MapLibre GL 6.16.0 (assets/vendor/maplibre, лицензия BSD), к Leaflet —
// плагином @maplibre/maplibre-gl-leaflet 0.1.4: метки, подгонка и всё остальное в коде — прежние. Нет WebGL2 (старый телефон),
// движок со стилем не загрузились за 12 секунд или карта не дорисовалась за 15 — прежние картинки OpenStreetMap
const VECTOR_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const VECTOR_ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const RASTER_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
let vectorLoading = null;

// MapLibre 6 рисует только через WebGL2 (без него падает на старте): телефоны с одним WebGL1 (старые Mali, PowerVR) —
// сразу на картинки OpenStreetMap
function hasWebGL2() {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch { return false; }
}
// Движок (1,1 МБ) по медленной связи может грузиться минуту: не ждём дольше 12 секунд — карта на картинках сразу, а движок
// догрузится для следующих карт
const VECTOR_WAIT_MS = 12_000;
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('долго')), ms))]);
// Когда вкладку последний раз открыли: пока она скрыта, браузер не рисует, — отсчёт «не дорисовалась» идёт только при открытой
let visibleSince = Date.now();
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden) visibleSince = Date.now(); });

/** Движок векторной карты и плагин к Leaflet — один раз (после Leaflet: плагин берёт window.L) */
function loadVector() {
  if (!vectorLoading) {
    vectorLoading = (async () => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'assets/vendor/maplibre/maplibre-gl.css';
      document.head.append(css);
      window.maplibregl = await import('../vendor/maplibre/maplibre-gl.mjs');
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'assets/vendor/maplibre/leaflet-maplibre-gl.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('плагин векторной карты не загрузился'));
        document.head.append(script);
      });
      if (typeof window.L?.maplibreGL !== 'function') throw new Error('плагин векторной карты не подключился');
    })().catch((err) => { vectorLoading = null; throw err; });
  }
  return vectorLoading;
}

/**
 * Стиль карты — скачиваем сами и правим до того, как отдать движку (правка стиля на ходу останавливала первую отрисовку):
 * подписи по-русски (name:ru, нет — как на карте) и номера домов с приближения 16 (Leaflet). Один раз на страницу
 */
let styleLoading = null;
function vectorStyle() {
  if (!styleLoading) {
    styleLoading = (async () => {
      const res = await fetch(VECTOR_STYLE, { signal: timeoutSignal(8000) });
      if (!res.ok) throw new Error(`стиль карты: ${res.status}`);
      const style = await res.json();
      if (!Array.isArray(style?.layers) || !style.sources?.openmaptiles) throw new Error('стиль карты: не тот вид');
      for (const layer of style.layers) {
        const field = layer.layout?.['text-field'];
        if (layer.type === 'symbol' && field && JSON.stringify(field).includes('name')) {
          layer.layout['text-field'] = ['coalesce', ['get', 'name:ru'], ['get', 'name']];
        }
        // Крупное «Бишкек» посреди улиц не нужно: название города — только на общем виде
        if (layer.type === 'symbol' && layer['source-layer'] === 'place' && /city|capital|town/.test(layer.id)) {
          layer.maxzoom = Math.min(layer.maxzoom ?? 24, 12);
        }
      }
      style.layers.push({
        // minzoom движка 15 — это приближение 16 в Leaflet (у векторных плиток 512 точек: движок на 1 меньше)
        id: 'kokoro-housenumber', type: 'symbol', source: 'openmaptiles', 'source-layer': 'housenumber', minzoom: 15,
        layout: { 'text-field': ['get', 'housenumber'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-padding': 2 },
        paint: { 'text-color': '#5b4334', 'text-halo-color': 'rgba(255,255,255,0.92)', 'text-halo-width': 1.4 },
      });
      return style;
    })().catch((err) => { styleLoading = null; throw err; });
  }
  return styleLoading;
}

function rasterLayer(L) {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: RASTER_ATTRIBUTION });
}

/** Карта в элементе: { L, map, layer } — layer для меток, которые перерисовываем целиком */
export async function createMap(el, { center = BISHKEK, zoom = 12 } = {}) {
  const L = await loadLeaflet();
  const map = L.map(el, { zoomControl: true, tap: true, maxZoom: 19 }).setView([center.lat, center.lon], zoom);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  let base = null;
  if (hasWebGL2()) {
    try {
      const [, style] = await withTimeout(Promise.all([loadVector(), vectorStyle()]), VECTOR_WAIT_MS);
      // Подпись источников — в строке Leaflet (плагин берёт customAttribution; у самого движка своя строка выключена)
      const vector = L.maplibreGL({ style, attributionControl: { customAttribution: VECTOR_ATTRIBUTION } });
      try {
        vector.addTo(map);
      } catch (err) {
        // Движок упал внутри добавления: Leaflet уже повесил слой и его обработчики — снимаем, иначе первый же зум сломает карту
        try { map.removeLayer(vector); } catch { /* уже снят */ }
        throw err;
      }
      base = vector;
      const gl = base.getMaplibreMap();
      if (!gl) throw new Error('движок карты не создался');
      let ready = false;
      gl.once('load', () => { ready = true; gl.resize(); });
      // Ошибки отдельных плиток (связь мигнула) не ломают карту, а без обработчика движок печатает каждую в консоль.
      // Совсем не дорисовалась — ниже переход на картинки OpenStreetMap
      gl.on('error', () => {});
      // Карта создаётся, пока блок только открывается (форма заказа, «Карта» в панели): движок запоминает размер на старте
      // и рисует пустой фон. Размер блока поменялся — подгоняем Leaflet и движок (Leaflet сам зовёт это не всегда)
      const fitSize = () => { map.invalidateSize({ pan: false }); try { gl.resize(); } catch { /* карта уже убрана */ } };
      requestAnimationFrame(fitSize);
      if (typeof ResizeObserver === 'function') new ResizeObserver(fitSize).observe(el);
      // Не дорисовалась за 15 секунд (плитки не идут) — картинки OpenStreetMap. Ошибка одной плитки — не повод. Пока вкладка
      // скрыта, браузер не рисует вовсе — ждём, пока её откроют
      const vectorLayer = base;
      const watch = () => setTimeout(() => {
        if (ready || !map.hasLayer(vectorLayer)) return;
        if (document.hidden || Date.now() - visibleSince < 15_000) { watch(); return; } // скрыта или только что открыли
        map.removeLayer(vectorLayer);
        rasterLayer(L).addTo(map).bringToBack();
      }, 15_000);
      watch();
    } catch {
      if (base && map.hasLayer(base)) { try { map.removeLayer(base); } catch { /* уже снят */ } }
      base = null;
    }
  }
  if (!base) rasterLayer(L).addTo(map);
  const layer = L.layerGroup().addTo(map);
  return { L, map, layer };
}

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Метка-кружок с текстом. kind — через пробел: approx (найдена по адресу, примерно), courier, home, muted (без курьера),
 * wide (длинная подпись); пусто — точка заказа
 */
export function pin(L, { lat, lon }, text, kind = '', title = '') {
  const kinds = kind.split(/\s+/).filter(Boolean).map((k) => ` mk--${k}`).join('');
  return L.marker([lat, lon], {
    icon: L.divIcon({ className: `mk${kinds}`, html: `<span>${escape(text)}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] }),
    title, alt: title, keyboard: Boolean(title),
  });
}

/**
 * Показать все точки; одна — приблизить к ней. Без анимации: перерисовка приходит подряд (опрос, найденный адрес),
 * и анимированные подгонки перебивали друг друга — карта оставалась приближенной к одной точке
 */
export function fit(map, points, zoom = 15) {
  const valid = points.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  if (!valid.length) return;
  map.stop();
  if (valid.length === 1) { map.setView([valid[0].lat, valid[0].lon], zoom, { animate: false }); return; }
  map.fitBounds(valid.map((p) => [p.lat, p.lon]), { padding: [36, 36], maxZoom: 16, animate: false });
}

/* ---------- Адрес → точка (Nominatim) ---------- */

// Найденное помним только до закрытия вкладки (sessionStorage): адреса покупателей не должны оставаться
// на телефоне курьера и в браузере менеджера после смены
const GEO_KEY = 'kokoro.geo';
let geoChain = Promise.resolve();
let lastGeo = 0;

function geoCache() { try { return JSON.parse(sessionStorage.getItem(GEO_KEY) || '{}'); } catch { return {}; } }
function geoSave(key, value) {
  try {
    const cache = geoCache();
    cache[key] = { ...value, t: Date.now() };
    const entries = Object.entries(cache).sort((a, b) => b[1].t - a[1].t).slice(0, 200);
    sessionStorage.setItem(GEO_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* приватный режим — без памяти */ }
}
/** Забыть найденные адреса (выход курьера) */
export function forgetGeocoded() { try { sessionStorage.removeItem(GEO_KEY); } catch { /* ничего */ } }

/** Ограничение времени запроса: AbortSignal.timeout есть не везде (Safari на iOS 15 и старше — нет) */
export function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

// «Бишкек», «Bishkek», «город Бишкек» (так пишет Nominatim) — город по умолчанию, в адрес его не пишем
const isBishkek = (name) => /^(г\.|город)?\s*(бишкек|bishkek)$/i.test(String(name || '').trim());

/**
 * Запрос к Nominatim в общей очереди: по одному, не чаще раза в 1,1 с (их правило); на «слишком часто» (429)
 * и перегрузку (503) — пауза 10 с. isStale() после ожидания очереди — запрос уже не нужен (точку переставили):
 * не отправляем, ответ — undefined. Сбой одного запроса не останавливает очередь
 */
function nominatim(url, isStale = () => false) {
  const job = geoChain.then(async () => {
    const wait = lastGeo + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (isStale()) return undefined;
    lastGeo = Date.now();
    const res = await fetch(url, { signal: timeoutSignal(10_000) });
    if (res.status === 429 || res.status === 503) lastGeo = Date.now() + 10_000;
    if (!res.ok) throw new Error(`Nominatim: ${res.status}`);
    return res.json();
  });
  geoChain = job.catch(() => null);
  return job;
}

/* ---------- Сверка адреса (specs/023): та ли улица и тот ли дом ---------- */

// Раньше бралось первое, что ответил сервис: «Киевская 95» становилась «Кызыл-Кийской 95», «Джал-29, 12» — домом в Джале-23,
// улица целиком сходила за дом. Теперь найденное сверяем с тем, что написал покупатель: слова названия (от 5 букв — каждое,
// по первым пяти буквам: «Ахунбаева» = «Ахунбаев көчөсү»; короче — хотя бы одно), номера микрорайонов («Джал-29») и номер дома.
// Слова-обозначения (улица, мкр, көчөсү…) не сравниваем
const GENERIC = new Set(['улица', 'ул', 'проспект', 'пр', 'просп', 'переулок', 'пер', 'бульвар', 'бул', 'микрорайон', 'мкр', 'мкрн',
  'жилмассив', 'жм', 'массив', 'квартал', 'тупик', 'проезд', 'площадь', 'пл', 'дом', 'корпус', 'корп', 'строение', 'стр', 'город',
  'бишкек', 'bishkek', 'кыргызстан', 'көчөсү', 'кочосу', 'проспектиси', 'проспекти', 'бульвары', 'тыкырчыгы', 'кичи', 'району',
  'район', 'аянты', 'street', 'avenue']);
const LATIN = { a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', k: 'к', m: 'м', o: 'о', c: 'с', p: 'р', x: 'х' };

// «Дж» и «Ж» — одно и то же в русском и кыргызском написании: «Джал-29» = «Жал-29»
function tokens(text) {
  return String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/дж/g, 'ж').split(/[^0-9a-zа-яөүңәһ/]+/i).filter(Boolean);
}
/**
 * Что написал покупатель: { words — слова названия, numbers — номера микрорайонов и прочие, house — номер дома }. Номер через
 * дефис после слова («Джал-29», «Восток-5») — часть названия, не дом; дом — последний из остальных номеров
 */
export function addressParts(text) {
  const raw = String(text || '');
  const named = [...raw.toLowerCase().matchAll(/[a-zа-яёөүң]{2,}-(\d+)/gi)].map((m) => m[1]);
  const all = tokens(raw);
  const words = all.filter((t) => !/\d/.test(t) && t.length >= 3 && !GENERIC.has(t));
  const nums = all.filter((t) => /\d/.test(t));
  const rest = [...nums];
  for (const n of named) { const i = rest.indexOf(n); if (i >= 0) rest.splice(i, 1); }
  const house = rest.length ? rest[rest.length - 1] : '';
  return { words, numbers: [...named, ...rest.slice(0, -1)], house };
}
const stem = (w) => w.slice(0, 5);
const houseKey = (h) => String(h || '').toLowerCase().replace(/\s+/g, '').replace(/[a-z]/g, (c) => LATIN[c] || c);

/**
 * Найденное место подходит к написанному: слова названия и номера микрорайонов есть в адресе места. lastPrefix — последнее
 * слово ещё печатают (подсказки): достаточно начала слова
 */
export function placeMatches(want, placeText, lastPrefix = false) {
  const have = tokens(placeText);
  const words = have.filter((t) => !/\d/.test(t));
  const found = (q, i) => words.some((c) => stem(c) === stem(q) || (lastPrefix && i === want.words.length - 1 && c.startsWith(q)));
  const long = want.words.filter((w) => w.length >= 5);
  const wordsOk = !want.words.length || (long.length ? want.words.every((w, i) => w.length < 5 || found(w, i)) : want.words.some(found));
  const numbersOk = want.numbers.every((n) => have.includes(n));
  return wordsOk && numbersOk;
}
/** Номер дома совпал: «120а» = «120 А» = «120a»; prefix — номер ещё печатают */
export function sameHouse(typed, found, prefix = false) {
  const a = houseKey(typed);
  const b = houseKey(found);
  return Boolean(a && b) && (prefix ? b.startsWith(a) : a === b);
}

/**
 * Точка адреса в Бишкеке: { lat, lon, exact } или null (не нашли или нашли не то). exact — нашли сам дом: улица и номер
 * совпали; иначе — улица или микрорайон целиком (примерно). Сбой сети или сервиса — ошибка (reject): такой ответ не
 * запоминаем, адрес можно искать снова
 */
export async function geocode(address) {
  const raw = String(address || '').trim();
  const key = `v2|${raw.toLowerCase()}`; // v2 — со сверкой; прежние ответы без неё не берём
  if (raw.length < 3) return null;
  const hit = geoCache()[key];
  if (hit) return hit.p ? { lat: hit.p[0], lon: hit.p[1], exact: Boolean(hit.e) } : null;
  const want = addressParts(raw);
  const q = encodeURIComponent(`${raw}, Бишкек`);
  const results = await nominatim(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&countrycodes=kg&accept-language=ru&viewbox=74.35,43.05,74.85,42.70&bounded=1&q=${q}`);
  let point = null;
  for (const r of Array.isArray(results) ? results : []) {
    const a = r.address || {};
    const place = [a.road, a.pedestrian, a.footway, a.residential, a.neighbourhood, a.quarter, a.suburb, a.city_district,
      a.village, a.town, a.hamlet, a.city, r.name].filter(Boolean).join(' ');
    const exact = Boolean(want.house && a.house_number && sameHouse(want.house, a.house_number));
    // Старое название улицы («Советская 120», «Дзержинского 20»): Nominatim находит дом по прежнему имени, а в ответе — новое.
    // Такой ответ берём, если совпал номер дома и номера микрорайонов (Nominatim, в отличие от подсказок, не ищет нечётко)
    const renamed = exact && want.numbers.every((n) => tokens(place).includes(n));
    if (!placeMatches(want, place) && !renamed) continue;
    if (!point || (exact && !point.exact)) point = { lat: Number(r.lat), lon: Number(r.lon), exact };
    if (point.exact || !want.house) break; // дом нашёлся (или номера и не было) — дальше не ищем; иначе вдруг ниже есть сам дом
  }
  if (point && !Number.isFinite(point.lat)) point = null;
  geoSave(key, { p: point ? [point.lat, point.lon] : null, e: point?.exact ? 1 : 0 });
  return point;
}

/* ---------- Подсказки адреса при наборе (Photon) ---------- */

const BBOX = '74.35,42.70,74.85,43.05'; // Бишкек и окрестности
// Вид объекта без номера дома по тегу OpenStreetMap — в подсказке и в адресе
const KINDS = { bus_stop: 'остановка', platform: 'остановка', stop_position: 'остановка', mall: 'ТЦ', marketplace: 'рынок',
  supermarket: 'магазин', school: 'школа', kindergarten: 'детский сад', university: 'вуз', college: 'колледж', hospital: 'больница',
  clinic: 'клиника', hotel: 'гостиница', cafe: 'кафе', restaurant: 'ресторан', bank: 'банк', pharmacy: 'аптека', fuel: 'заправка' };
let suggestAbort = null;
// Названия по-кыргызски (так подписано в OpenStreetMap) — по-русски: «Ахунбаев көчөсү» → «улица Ахунбаев»
const KY_WORDS = [[/\s+көчөсү$/i, 'улица'], [/\s+проспектиси$/i, 'проспект'], [/\s+проспекти$/i, 'проспект'],
  [/\s+бульвары$/i, 'бульвар'], [/\s+тыкырчыгы$/i, 'переулок'], [/\s+кичи району$/i, 'микрорайон'], [/\s+аянты$/i, 'площадь']];
export function ruStreet(name) {
  const s = String(name || '').trim();
  for (const [re, word] of KY_WORDS) if (re.test(s)) return `${word} ${s.replace(re, '')}`;
  return s;
}

/**
 * Подсказки к началу адреса: [{ label: «проспект Чуй, 155», value — что встанет в поле, sub: «ЦУМ · Ленинский район», lat, lon, exact }].
 * exact — точное место: дом с номером или объект с названием (ТЦ, остановка); без номера — улица или микрорайон целиком
 * (точку не ставим, просим номер дома). Вне Бишкека (Маевка, Лебединовка) село идёт в начало адреса: «Маевка, Садовая улица, 5».
 * Одинаковые адреса из разных районов и сёл не схлопываем — покупатель выбирает свой по подписи.
 * Новый запрос отменяет прежний: подсказки не приходят вперемешку. lang=default — названия, как на карте
 * (по-русски), а не на языке браузера (иначе «Chuy Avenue»)
 */
export async function suggestAddresses(query) {
  suggestAbort?.abort();
  const ctrl = new AbortController();
  suggestAbort = ctrl;
  const timer = setTimeout(() => ctrl.abort(), 8000);
  const want = addressParts(query);
  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lang=default&limit=15&lat=${BISHKEK.lat}&lon=${BISHKEK.lon}&bbox=${BBOX}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`подсказки: ${res.status}`);
    const { features = [] } = await res.json();
    const seen = new Set();
    const out = [];
    for (const f of features) {
      const p = f.properties || {};
      const [lon, lat] = f.geometry?.coordinates || [];
      if (!inZone(lat, lon)) continue;
      const street = ruStreet(p.street || (p.type === 'street' ? p.name : ''));
      const house = p.housenumber || '';
      // Сверка (specs/023): Photon ищет нечётко и отдаёт чужую улицу как точный дом («Киевская 95» → «Кызыл-Кийская 95»).
      // Улица или название не те — не показываем; номер дома написан — дома с другим номером не показываем (саму улицу —
      // показываем: можно выбрать её и дописать номер)
      if (!placeMatches(want, [p.street, p.name, ruStreet(p.street || ''), ruStreet(p.name || ''), p.district, p.locality, p.city].filter(Boolean).join(' '), true)) continue;
      if (want.house && house && !sameHouse(want.house, house, true)) continue;
      // Объект без номера дома (остановка, ТЦ, школа) — тоже точное место: подписываем видом и названием,
      // чтобы «остановка «Садовая»» не читалась как улица. Прочие объекты дорог (стройка, развязка) — не место встречи
      const kind = KINDS[p.osm_value] || '';
      const named = p.name && /[«"]/.test(p.name) ? p.name : `«${p.name}»`;
      const object = !house && p.type === 'house' && p.name && (p.osm_key !== 'highway' || kind) ? (kind ? `${kind} ${named}` : p.name) : '';
      const label = house && street ? `${street}, ${house}` : object ? [object, street].filter(Boolean).join(', ') : street || p.name;
      if (!label) continue;
      // Город пишем, только если это не Бишкек: Photon подписывает Бишкек то по-русски, то по-английски
      const city = isBishkek(p.city) ? '' : p.city || '';
      const exact = Boolean((house && street) || object);
      const value = city ? `${city}, ${label}` : label;
      // Дома с одинаковым адресом в разных районах — разные варианты (различаем по месту, ~200 м); улица же одна на весь
      // город (Photon отдаёт её по кусочку на район) — один вариант. Одинаковые дома одного места — один вариант
      const key = (exact ? [label, Math.round(lat * 500), Math.round(lon * 500), city] : [value]).join('|').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const place = p.name && p.type !== 'street' && !label.includes(p.name) ? p.name : '';
      out.push({ label, value, sub: [place, exact ? p.district : '', city].filter(Boolean).join(' · '), lat, lon, exact });
      if (out.length === 6) break;
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Адрес по точке (Nominatim reverse) ---------- */

/**
 * Адрес точки на карте: { label: «проспект Чуй, 155», exact: есть номер дома } или null (не определился) —
 * в той же очереди «раз в секунду», что и поиск. isStale — точку уже переставили: запрос не отправляем
 */
export async function reverseAddress({ lat, lon }, isStale = () => false) {
  const key = `@${lat.toFixed(5)},${lon.toFixed(5)}`;
  const hit = geoCache()[key];
  if (hit) return hit.r;
  const data = await nominatim(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=ru&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`, isStale);
  if (data === undefined) return null;
  const a = data?.address || {};
  const road = ruStreet(a.road || a.pedestrian || a.residential || a.neighbourhood || a.quarter || '');
  const place = a.city || a.town || a.village || a.hamlet || '';
  const found = road ? { label: [isBishkek(place) ? '' : place, road, a.house_number].filter(Boolean).join(', '), exact: Boolean(a.house_number) } : null;
  geoSave(key, { r: found });
  return found;
}

/* ---------- Сумма доставки: расстояние от кухни точки покупателя по дорогам (OSRM) ---------- */

// Маршруты для машины по данным OpenStreetMap — два движка на серверах FOSSGIS (ими строит маршруты сам openstreetmap.org):
// OSRM и Valhalla. Бесплатно и без ключа, просят не больше запроса в секунду: у нас один запрос на точку сразу до всех
// кухонь, ответ помним до закрытия вкладки. Замер 04.11.2026: OSRM на повторные запросы с одного адреса отвечает по 9 с,
// Valhalla — за 0,6–0,8 с. Поэтому OSRM не ответил за 1,5 с (или отказал) — спрашиваем Valhalla, берём первый ответ;
// оба молчат 7 секунд — считаем без них. Демо-сервер router.project-osrm.org убран 04.11.2026: он только для некоммерческого
// использования. url — запрос от точек from (кухни, курьер) до точки to; what — что спрашиваем: 'km' — расстояние (сумма
// доставки), 'min' — время в пути (оценка «курьер приедет через …», specs/016). km и min — ответ для from[i] (NaN — пути нет)
const lonLat = (p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
const latLon = (p) => ({ lat: Number(p.lat.toFixed(6)), lon: Number(p.lon.toFixed(6)) });
const ROUTERS = [
  { // OSRM table: distances[откуда][0] — метры, durations[откуда][0] — секунды (что спросили в annotations), null — пути нет
    url: (from, to, what) => `https://routing.openstreetmap.de/routed-car/table/v1/driving/${[...from, to].map(lonLat).join(';')}`
      + `?sources=${from.map((_, i) => i).join(';')}&destinations=${from.length}&annotations=${what === 'min' ? 'duration' : 'distance'}`,
    km: (data, i) => { const m = data?.code === 'Ok' ? data.distances?.[i]?.[0] : null; return typeof m === 'number' && m >= 0 ? m / 1000 : NaN; },
    min: (data, i) => { const s = data?.code === 'Ok' ? data.durations?.[i]?.[0] : null; return typeof s === 'number' && s >= 0 ? s / 60 : NaN; },
  },
  { // Valhalla: sources_to_targets[откуда][0] — distance уже в километрах, time — в секундах (отдаёт оба сразу), null — пути нет
    url: (from, to) => `https://valhalla1.openstreetmap.de/sources_to_targets?json=${encodeURIComponent(JSON.stringify({ sources: from.map(latLon), targets: [latLon(to)], costing: 'auto' }))}`,
    km: (data, i) => { const d = data?.sources_to_targets?.[i]?.[0]?.distance; return typeof d === 'number' && d >= 0 ? d : NaN; },
    min: (data, i) => { const t = data?.sources_to_targets?.[i]?.[0]?.time; return typeof t === 'number' && t >= 0 ? t / 60 : NaN; },
  },
];
const ROUTER_HEDGE_MS = 1500;
const ROUTER_LIMIT_MS = 7000;
// Оба не ответили — по прямой с запасом: в Бишкеке путь по дорогам в 1,1–1,4 раза длиннее прямой
export const DETOUR = 1.3;

// Общая очередь к серверам маршрутов — для суммы доставки и для оценки «курьер приедет через …» вместе: к каждому серверу
// не чаще раза в секунду (их правило). Иначе при загрузке страницы сумма доставки и оценка уходили к OSRM почти разом.
// В отличие от nominatim() ответа прежнего запроса не ждём — только разносим отправки на 1 с: медленный OSRM (до 9 с) не держит
// очередь. Сумма доставки ждёт не дольше этой 1 с: она идёт впереди оценки прибытия (urgent), а запрос, который уже не нужен
// (ответил другой сервер; покупатель переставил точку — isStale), место в очереди не держит и не отправляется.
// Очередь у каждого сервера своя: запасной Valhalla спрашиваем через 1,5 с после OSRM, общий интервал на оба сервера сдвигал бы
// и его. Время — performance.now(): не зависит от часов телефона (переведут назад — очередь не встанет на минуты)
const ROUTER_GAP_MS = 1000;
const routerQueues = new Map(); // сервер → { last — когда ему ушёл последний запрос, waiting — ждут очереди, timer }

/** Отправить следующий запрос к серверу, если с прошлого прошла 1 с; иначе — поставить таймер на нужный момент */
function routerPump(router) {
  const q = routerQueues.get(router);
  q.waiting = q.waiting.filter((job) => {
    if (!job.signal.aborted && !job.isStale()) return true;
    job.reject(new Error('маршрут: запрос уже не нужен'));
    return false;
  });
  clearTimeout(q.timer);
  q.timer = null;
  if (!q.waiting.length) return;
  const wait = q.last + ROUTER_GAP_MS - performance.now();
  if (wait > 0) { q.timer = setTimeout(() => routerPump(router), wait); return; }
  q.last = performance.now();
  q.waiting.shift().resolve();
  if (q.waiting.length) q.timer = setTimeout(() => routerPump(router), ROUTER_GAP_MS);
}

/**
 * Дождаться очереди к серверу. urgent — сумма доставки: встаёт впереди оценок прибытия (между собой — по порядку).
 * Запрос уже не нужен (signal отменён или isStale(), пока ждали) — ошибка, запрос не отправляем
 */
function routerTurn(router, signal, { urgent = true, isStale = () => false } = {}) {
  if (!routerQueues.has(router)) routerQueues.set(router, { last: -Infinity, waiting: [], timer: null });
  const q = routerQueues.get(router);
  return new Promise((resolve, reject) => {
    const job = { resolve, reject, signal, urgent, isStale };
    const before = urgent ? q.waiting.findIndex((other) => !other.urgent) : -1;
    if (before < 0) q.waiting.push(job);
    else q.waiting.splice(before, 0, job);
    signal.addEventListener('abort', () => routerPump(router), { once: true });
    routerPump(router);
  });
}

/** Ответ одного сервера: [км или минуты | NaN — пути нет]; ошибка — сервер не ответил или ответ не тот */
async function askRouter(router, from, to, what, signal) {
  const res = await fetch(router.url(from, to, what), { signal });
  if (!res.ok) throw new Error(`маршрут: ${res.status}`);
  const data = await res.json();
  // null — пути нет (null / 1000 дало бы 0 км, поэтому router.km и router.min проверяют тип)
  const values = from.map((_, i) => router[what](data, i));
  if (!values.some(Number.isFinite)) throw new Error('маршрут: в ответе нет того, что спрашивали');
  return values;
}

/**
 * По дорогам от каждой точки from до точки to: what 'km' — километры, 'min' — минуты в пути. [число | NaN — пути нет]
 * или null — ни один сервер не ответил (или запрос стал не нужен, пока ждал очереди). Каждый запрос — через общую очередь
 * (routerTurn); turn — его место в ней: { urgent, isStale }
 */
async function roadTable(from, to, what, turn = {}) {
  const ctrl = new AbortController();
  const timers = [];
  try {
    return await new Promise((resolve, reject) => {
      let next = 0;
      let failed = 0;
      const ask = () => {
        if (next >= ROUTERS.length) return null;
        const router = ROUTERS[next++];
        const sent = routerTurn(router, ctrl.signal, turn);
        sent.then(() => askRouter(router, from, to, what, ctrl.signal)).then(resolve, () => {
          failed += 1;
          if (failed === ROUTERS.length) reject(new Error('маршрут: серверы не ответили'));
          else ask(); // отказал быстро — сразу второй
        });
        return sent;
      };
      // «1,5 с до запасного» и «7 с на всё» считаем с отправки первого запроса, а не с ожидания очереди
      ask().then(() => {
        if (ctrl.signal.aborted) return;
        timers.push(setTimeout(ask, ROUTER_HEDGE_MS), setTimeout(() => ctrl.abort(), ROUTER_LIMIT_MS));
      }, () => { /* ошибку первого запроса разбирает ask */ });
    });
  } catch {
    return null;
  } finally {
    timers.forEach(clearTimeout);
    ctrl.abort(); // ответ есть — второй запрос, если он ещё идёт (или ждёт очереди), больше не нужен
  }
}

/**
 * Минуты в пути на машине по дорогам от точки from до точки to — как их считают сервисы маршрутов, по свободным дорогам:
 * поправку на пробки добавляет тот, кто спрашивает. Те же серверы и тот же порядок, что для суммы доставки: OSRM, не ответил
 * за 1,5 с (или отказал) — Valhalla, первый ответ; оба молчат 7 с — null. null и когда пути нет. Очередь к серверам та же, что у
 * суммы доставки (routerTurn: к каждому не чаще раза в секунду), но сумма доставки идёт впереди: оценка подождёт, оформление — нет.
 * Ответ не запоминаем: как часто спрашивать, решает страница (order.js — «курьер приедет примерно через …», specs/016-courier-eta)
 */
export async function roadMinutes(from, to) {
  const minutes = await roadTable([from], to, 'min', { urgent: false });
  return Number.isFinite(minutes?.[0]) ? minutes[0] : null;
}

/**
 * Доставка до точки от кухни её точки (specs/013): { km, price, from, approx, branch }. С 09.11.2026 запад ул. Абдрахманова
 * возит Кулиева, восток — Кок-Жар (data.js → branchAt), даже если другая кухня ближе; точка не определилась (за концами
 * линии по широте) — от ближайшей кухни, как раньше, и branch тогда null. km — по дорогам, до 0,1; price — по тарифу
 * с подачей (null — дальше 15 км, сумму назовёт менеджер); from — адрес кухни; approx — сервисы маршрутов не ответили
 * (или до этой кухни пути нет) и расстояние взято по прямой с запасом. Ответ для точки помним до закрытия вкладки.
 * isStale() — расчёт уже не нужен (покупатель переставил точку): пока ждёт очереди к серверам маршрутов, запрос не отправляем
 * (ответ тогда — по прямой, его всё равно отбросят)
 */
export async function deliveryQuote(at, isStale = () => false, forBranch = null) {
  const key = `~${at.lat.toFixed(5)},${at.lon.toFixed(5)}`;
  const hit = geoCache()[key]?.d;
  let roads = Array.isArray(hit) && hit.length === delivery.kitchens.length ? hit.map((v) => (v === null ? NaN : v)) : null;
  if (!roads) {
    roads = await roadTable(delivery.kitchens, at, 'km', { urgent: true, isStale });
    if (roads) geoSave(key, { d: roads.map((v) => (Number.isFinite(v) ? v : null)) });
  }
  const options = delivery.kitchens.map((k, i) => {
    const straight = distanceKm(k, at);
    // Дорога не короче прямой: сервис «притягивает» точку к ближайшей дороге, бывает — с другой стороны квартала
    return Number.isFinite(roads?.[i]) ? { k, km: Math.max(roads[i], straight), approx: false } : { k, km: straight * DETOUR, approx: true };
  });
  // Км до обеих кухонь всё равно считаем одним запросом (и помним): нужна та, что возит по этому адресу. forBranch — точка
  // заказа уже известна (панель досчитывает сумму заказа, переданного другой точке, specs/022): считаем от её кухни
  const branch = forBranch || branchAt(at.lat, at.lon);
  const own = options.find((o) => o.k.branch === branch);
  const best = own || options.sort((a, b) => a.km - b.km)[0];
  const km = Math.round(best.km * 10) / 10;
  return { km, price: deliveryPrice(km), from: best.k.label, approx: best.approx, branch: own ? branch : null };
}
