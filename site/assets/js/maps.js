// Ссылки на карты, порядок объезда и «как давно» — без библиотек (проверяется в node: scripts/test-client.mjs).
// Сама карта на страницах — map.js (Leaflet).

/** Адрес — поиск в 2GIS (в Бишкеке им пользуются чаще всего); на телефоне с 2GIS откроется приложение */
export const addressLink = (address) => `https://2gis.kg/bishkek/search/${encodeURIComponent(`Бишкек, ${address}`)}`;

/** Бишкек и окрестности (доставка до 15 км) — так же проверяет база (supabase/order-points.sql) */
export const inZone = (lat, lon) => lat >= 42.55 && lat <= 43.25 && lon >= 74.05 && lon <= 75.15;

const hasPoint = (s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lon);
const routePoint = (s) => encodeURIComponent(hasPoint(s) ? `${s.lat.toFixed(6)},${s.lon.toFixed(6)}` : `Бишкек, ${s.address}`);

/**
 * Маршрут по точкам по порядку — от того места, где курьер сейчас (первая точка пустая). Точка — { lat, lon }
 * или { address } (тогда адрес текстом). 2GIS в ссылку маршрута берёт только свои объекты, поэтому — Яндекс и Google
 */
export function routeLinks(stops) {
  const points = stops.map(routePoint);
  const last = points[points.length - 1]; // не метод at: его нет в Safari до iOS 15.4
  return {
    yandex: `https://yandex.ru/maps/?rtext=~${points.join('~')}&rtt=auto`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${last}${points.length > 1 ? `&waypoints=${points.slice(0, -1).join('%7C')}` : ''}&travelmode=driving`,
  };
}

/** Точка (место курьера) — метка в Google Картах: открывается и в браузере, и в приложении */
export const pointLink = ({ lat, lon }) => `https://www.google.com/maps/search/?api=1&query=${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;

/** Расстояние по прямой, км */
export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * Порядок объезда: от старта (где курьер) к ближайшей точке и дальше, потом улучшение перестановками (2-opt) —
 * для десятка точек мгновенно. Старта нет — пробуем начать с каждой точки и берём самый короткий путь.
 * По прямой: дороги строит навигатор по кнопке «Маршрут». Возвращает те же объекты в новом порядке
 */
export function planRoute(start, stops) {
  if (stops.length < 2) return [...stops];
  const leg = (i, j) => distanceKm(stops[i], stops[j]);
  const length = (order) => (start ? distanceKm(start, stops[order[0]]) : 0) + order.slice(1).reduce((sum, j, k) => sum + leg(order[k], j), 0);
  let best = null;
  let bestLength = Infinity;
  // Без старта перебираем начальную точку; при большом списке хватит одной — иначе перерисовка подвисала бы
  const seeds = start ? [null] : stops.map((_, i) => i).slice(0, stops.length <= 10 ? stops.length : 1);
  for (const seed of seeds) {
    const left = new Set(stops.map((_, i) => i));
    const order = [];
    let at = seed === null ? start : stops[seed];
    if (seed !== null) { order.push(seed); left.delete(seed); }
    while (left.size) {
      let next = null;
      for (const i of left) if (next === null || distanceKm(at, stops[i]) < distanceKm(at, stops[next])) next = i;
      order.push(next);
      left.delete(next);
      at = stops[next];
    }
    // 2-opt: разворачиваем отрезок пути, пока это сокращает путь
    for (let improved = true; improved;) {
      improved = false;
      for (let i = 0; i < order.length - 1; i++) {
        for (let k = i + 1; k < order.length; k++) {
          const candidate = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
          if (length(candidate) < length(order) - 1e-9) { order.splice(0, order.length, ...candidate); improved = true; }
        }
      }
    }
    const total = length(order);
    if (total < bestLength) { best = order; bestLength = total; }
  }
  return best.map((i) => stops[i]);
}

/** «только что», «3 мин назад», «2 ч назад» */
export function ago(iso, now = Date.now()) {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  return `${Math.floor(min / 60)} ч назад`;
}

/** Свежее ли место: курьер передаёт его каждые несколько секунд; дольше 5 минут тишины — трансляция, видимо, выключена */
export const isFresh = (location, now = Date.now()) => Boolean(location?.at) && now - Date.parse(location.at) < 5 * 60_000;
