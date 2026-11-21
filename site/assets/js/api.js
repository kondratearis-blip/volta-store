// Слой данных заказов поверх Supabase (таблицы, функции и хранилище — supabase/orders.sql).
import { config } from './config.js';
import { createClient } from './supabase-lite.js';

const db = createClient(config.supabaseUrl, config.supabaseKey);

// QR и тексты про оплату (qr_url, payment_note, whatsapp_template, closed_message) из базы не читаем:
// они в data.js → payment, с паролем менеджера их не подменить
const SETTINGS_FIELDS = 'accepting_orders,combo_price,delivery_fee';
// Колонки заказа для панели — без секретного pay_token (после harden.sql менеджеру он и не виден;
// select=* тогда отказал бы). Проверено 31.10.2026: все колонки есть в базе; day_number — после supabase/day-numbers.sql,
// courier_id и track_code (код ссылки на статус для покупателя) — после supabase/couriers.sql, lat/lon (точка доставки) —
// после supabase/order-points.sql
// branch, branch_guessed — точка заказа (specs/013, после supabase/two-points.sql; без него сайт не выкладывается)
const BASE_COLUMNS = 'id,day_number,created_at,paid_at,updated_at,status,qty,total,delivery_fee,name,phone,address,entrance,floor,apartment,delivery_time,payment,comment,receipt_path,manager_note,courier_id,track_code,lat,lon,branch,branch_guessed';
// Колонки, которых в базе может ещё не быть: delivery_quote — сумма доставки, которую посчитал сайт покупателя
// (supabase/delivery-price.sql); delivering_at — когда заказ ушёл «В пути» (supabase/courier-pickup.sql, specs/014);
// dispatched_at — когда база сама назначила курьера (supabase/auto-dispatch.sql, specs/015).
// Пока файл не запущен, на колонку база отвечает 400 — тогда читаем заказы без неё (без суммы доставки / без «в пути N мин»)
// С 018 (supabase/mini-app.sql): fulfillment — доставка или самовывоз, door — «до двери», wait_minutes — время ожидания заказа,
// ready_at — «готово к выдаче» с кухни, done_at — когда доставлен, rating / courier_rating / rating_comment / rated_at — оценка
let OPTIONAL_COLUMNS = ['delivery_quote', 'delivering_at', 'dispatched_at',
  'fulfillment', 'door', 'wait_minutes', 'ready_at', 'done_at', 'rating', 'courier_rating', 'rating_comment', 'rated_at'];
let ORDER_COLUMNS = [BASE_COLUMNS, ...OPTIONAL_COLUMNS].join(',');
async function withOrderColumns(read, base = BASE_COLUMNS, wanted = null) {
  for (;;) {
    const optional = wanted ? OPTIONAL_COLUMNS.filter((c) => wanted.includes(c)) : OPTIONAL_COLUMNS;
    try { return await read(base === BASE_COLUMNS && !wanted ? ORDER_COLUMNS : [base, ...optional].join(',')); } catch (err) {
      const missing = err.status === 400 && OPTIONAL_COLUMNS.find((c) => new RegExp(`\\b${c}\\b`).test(err.message));
      if (!missing) throw err;
      OPTIONAL_COLUMNS = OPTIONAL_COLUMNS.filter((c) => c !== missing);
      ORDER_COLUMNS = [BASE_COLUMNS, ...OPTIONAL_COLUMNS].join(',');
    }
  }
}
// Экрану кухни (/cook) имя, телефон и адрес покупателя не нужны — только то, что он показывает (specs/018, ревью)
const COOK_COLUMNS = 'id,day_number,created_at,paid_at,updated_at,status,qty,delivery_time,comment,branch';
const COOK_OPTIONAL = ['fulfillment', 'door', 'wait_minutes', 'ready_at'];
// Курьер ходит в базу по своему коду, без входа менеджера (supabase/couriers.sql). В подъезде и лифте связь «висит» —
// через 15 секунд считаем, что её нет, и говорим об этом, а не держим кнопку серой минутами
const asCourier = (fn, args) => db.rpc(fn, args, { auth: false, timeout: 15_000 });
// Шеф — так же, по коду из своей ссылки (supabase/kitchen.sql): вход менеджера ему не нужен и не помогает
const asChef = (fn, args) => db.rpc(fn, args, { auth: false, timeout: 15_000 });
// Функции мини-приложения (specs/018, supabase/mini-app.sql): пока файл не запущен, база отвечает 404 — тогда null, без ошибки
async function optional404(call) {
  try { return await call(); } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * Приём заказов и время доставки по точкам (specs/013, supabase/two-points.sql):
 * { kulieva: { accepting_orders, wait_minutes }, kokzhar: {…} } или null — таблицы ещё нет (до запуска двух точек)
 */
// «Идёт дождь — доставка +100 сом» (supabase/rain.sql, 11.11.2026): колонки rain может ещё не быть — тогда читаем без неё
// и больше не спрашиваем до перезагрузки страницы. rain: true/false, null — колонки нет (панель прячет переключатель)
let rainColumn = true;
let weatherColumns = true; // rain_by и weather (supabase/courier-pay.sql) — только для панели
async function readBranchSettings() {
  try {
    let rows;
    try {
      rows = await db.select('branch_settings', `select=branch,accepting_orders,wait_minutes${rainColumn ? ',rain' : ''}`);
    } catch (err) {
      if (err.status !== 400 || !rainColumn) throw err;
      rainColumn = false;
      rows = await db.select('branch_settings', 'select=branch,accepting_orders,wait_minutes');
    }
    return rows.length ? Object.fromEntries(rows.map((r) => [r.branch, {
      accepting_orders: r.accepting_orders, wait_minutes: r.wait_minutes, rain: typeof r.rain === 'boolean' ? r.rain : null,
    }])) : null;
  } catch (err) {
    if (err.status === 404 || err.status === 400) return null; // two-points.sql не запускали — работаем по общим настройкам
    throw err;
  }
}

function fileId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };

export const api = {
  /**
   * Общие настройки (цена, доставка, общий приём и время) + branches — приём и время по точкам (null — точек ещё нет).
   * Точки не прочитались из-за сбоя (сеть) — branches: null и branchesFailed: true. retryBranches — перед оформлением заказа:
   * при сбое ещё одна попытка сразу
   */
  async settings({ retryBranches = false } = {}) {
    let row;
    try {
      [row] = await db.select('order_settings', `select=${SETTINGS_FIELDS},wait_minutes&id=eq.1`);
    } catch (err) {
      // Колонки wait_minutes нет (supabase/wait-time.sql не запускали или её потеряли) — база отвечает 400.
      // Приём заказов, цену и доставку читаем всё равно: без них закрытый магазин выглядел бы открытым
      if (err.status !== 400) throw err;
      [row] = await db.select('order_settings', `select=${SETTINGS_FIELDS}&id=eq.1`);
    }
    if (!row) return null;
    // Сбой чтения точек не прячет общие настройки: без точек сайт работает по общим, как до двух точек (order.js)
    const read = () => readBranchSettings().then((branches) => ({ branches }), () => null);
    let got = await read();
    if (!got && retryBranches) got = await read();
    row.branches = got ? got.branches : null;
    if (!got) row.branchesFailed = true;
    return row;
  },
  /** Создаёт заказ «ждёт оплаты». Возвращает { number, total, token }. Сумму считает база. */
  placeOrder(order) {
    return db.rpc('place_order', {
      p_qty: order.qty,
      p_name: order.name,
      p_phone: order.phone,
      p_address: order.address,
      p_entrance: order.entrance,
      p_floor: order.floor,
      p_apartment: order.apartment,
      p_delivery_time: order.deliveryTime,
      p_comment: order.comment,
    });
  },
  /** Загружает чек в папку заказа и отмечает заказ оплаченным. Возвращает { day_number, total } — номер на день даёт база */
  async sendReceipt(token, blob) {
    const ext = EXT[blob.type];
    if (!ext) throw new Error('Прикрепите фото, скриншот или PDF');
    const path = `${token}/${fileId()}.${ext}`;
    await db.storage.upload('receipts', path, blob);
    return db.rpc('attach_receipt', { p_token: token, p_path: path });
  },
  /**
   * Статус заказа для покупателя по секретному ключу или коду ссылки ?z=: { day_number, status, total, paid_at, updated_at,
   * courier: { location: { lat, lon, at } | null } | null } или null (supabase/order-status.sql, day-numbers.sql, couriers.sql).
   * С two-points.sql — ещё branch: 'kulieva' | 'kokzhar' | null — точка заказа в базе (менеджер мог передать заказ другой точке);
   * на базе без него ключа branch нет вовсе
   */
  orderStatus(token) {
    return db.rpc('order_status', { p_token: token });
  },
  /** Точка доставки заказа по ключу оплаты (supabase/order-points.sql); null — убрать. false — заказ уже в пути */
  setOrderPoint(token, point) {
    return db.rpc('set_order_point', { p_token: token, p_lat: point ? point.lat : null, p_lon: point ? point.lon : null });
  },
  /** Сумма доставки { km, price, from, approx } по ключу оплаты неоплаченного заказа (supabase/delivery-price.sql); null — убрать */
  setOrderDelivery(token, quote) {
    return db.rpc('set_order_delivery', { p_token: token, p_quote: quote });
  },
  /**
   * Точка заказа без точки на карте — по координатам адреса (supabase/two-points.sql). С точкой на карте её ставит сама база
   * по lat/lon; без того и другого — при оплате первую принимающую с пометкой «проверьте адрес». Возвращает true, если записали
   */
  setOrderBranch(token, branch) {
    return db.rpc('set_order_branch', { p_token: token, p_branch: branch });
  },
  cancelUnpaid(token) {
    return db.rpc('cancel_unpaid_order', { p_token: token });
  },
  /**
   * Параметры заказа сверх place_order (specs/018, supabase/mini-app.sql): { fulfillment: 'delivery' | 'pickup', branch (точка
   * самовывоза), door, deliver_at: ISO | null («Побыстрее»), consent } → { fulfillment, door, branch, delivery_time, address,
   * total } (total — сумма по QR после выбора способа: у самовывоза без доставки)
   * или null (заказ уже оплачен или не найден). Ошибка проверки — исключение с понятным текстом; база без 018 — 404
   */
  setOrderOptions(token, options) {
    return db.rpc('set_order_options', { p_token: token, p_options: options });
  },
  /**
   * Экран заказа сверх order_status (specs/018): { fulfillment, door, door_fee, wait_minutes, ready_at, done_at, delivery_at,
   * promise_at, rating, courier_rating, rated_at, can_rate, has_courier, chat: { open, can_write, count, last_id, last_author } }
   * или null (неверный ключ или база без 018)
   */
  orderExtra: (token) => optional404(() => db.rpc('order_extra', { p_token: token })),
  /**
   * Сумма доставки заказа сейчас — та же, что видит курьер (specs/022, 13.11.2026): { km, price, approx, from, rain } или null
   * (самовывоз, доставка в сумме по QR, суммы нет, база без функции). rain — сколько из суммы за дождь
   */
  orderDelivery: (token) => optional404(() => db.rpc('order_delivery', { p_token: token })),
  /** Оценка после доставки → { rated_at }; отказ — понятным текстом («Вы уже оценили этот заказ») */
  rateOrder: (token, { rating, courierRating = null, comment = null } = {}) =>
    db.rpc('order_rate', { p_token: token, p_rating: rating, p_courier_rating: courierRating, p_comment: comment }),
  /** Чат по заказу для покупателя (ключ оплаты или код ссылки ?z=): { open, can_write, messages: [{ id, author, body, at }] } */
  chat: {
    get: (token, after = 0) => optional404(() => db.rpc('order_chat', { p_token: token, p_after: after })),
    send: (token, body) => db.rpc('order_chat_send', { p_token: token, p_body: body }),
  },

  auth: {
    user: () => db.auth.user(),
    signIn: (email, password) => db.auth.signIn(email, password),
    signOut: () => db.auth.signOut(),
    async isAdmin() {
      if (!db.session) return false;
      try { return (await db.rpc('is_admin')) === true; } catch { return false; }
    },
    /**
     * 'none' — не менеджер, 'needs_mfa' — менеджер, но вошёл без кода из приложения, 'ok' — можно в панель.
     * Функция admin_status появляется после supabase/harden.sql; до этого — по is_admin.
     */
    async adminStatus() {
      if (!db.session) return 'none';
      try { return await db.rpc('admin_status'); } catch (err) {
        if (err.status !== 404) throw err; // сеть или сбой базы — не «нет доступа»
        return (await this.isAdmin()) ? 'ok' : 'none';
      }
    },
    /** Требует ли база код из приложения: true / false, null — неизвестно (harden.sql не запускали) */
    async mfaRequired() {
      try { return await db.rpc('kokoro_mfa_required'); } catch { return null; }
    },
    signOutHere: () => db.auth.signOut('local'),
    aal: () => db.auth.aal(),
    updatePassword: (password) => db.auth.updatePassword(password),
    mfa: {
      factors: () => db.auth.mfa.factors(),
      enroll: (name) => db.auth.mfa.enroll(name),
      verify: (factorId, code) => db.auth.mfa.verify(factorId, code),
      unenroll: (factorId) => db.auth.mfa.unenroll(factorId),
    },
  },
  /** Страница курьера: всё по личному коду. Неверный или отключённый код — me() и orders() отвечают null */
  courier: {
    me: (key) => asCourier('courier_me', { p_key: key }),
    orders: (key) => asCourier('courier_orders', { p_key: key }),
    setStatus: (key, id, status) => asCourier('courier_set_status', { p_key: key, p_order_id: Number(id), p_status: status }),
    /** Одноразовый код для ссылки t.me/<бот>?start=<код> (30 минут) */
    telegramCode: (key) => asCourier('courier_tg_link', { p_key: key }),
    shiftOff: (key) => asCourier('courier_shift_off', { p_key: key }),
    /**
     * Свободные заказы своей точки (specs/014, supabase/courier-pickup.sql): { branch, limit, mine, free: [{ id, day_number,
     * branch, status, paid, waiting_since, address, lat, lon, delivery_time, qty, delivery_quote, first }] } или null —
     * неверный или отключённый код. Файл не запущен — 404 (SupabaseError, status 404). После supabase/auto-dispatch.sql
     * (specs/015) ещё on_shift (на смене ли курьер) и assigned — id своих заказов, которые база назначила сама и курьер их
     * ещё не забрал. Каждый вызов отмечает, что страница открыта, и запускает автоназначение
     */
    board: (key) => asCourier('courier_board', { p_key: key }),
    /** «Начать смену» (specs/015): заказы снова назначаются этому курьеру → true */
    shiftOn: (key) => asCourier('courier_shift_on', { p_key: key }),
    /**
     * «Не могу взять» заказ, который база назначила сама (specs/015): заказ уходит другому курьеру, этому его больше не
     * назначат → { id }. Отказ базы — понятным текстом («назначил менеджер», «уже в пути», «уже не ваш»)
     */
    decline: (key, id) => asCourier('courier_decline', { p_key: key, p_order_id: Number(id) }),
    /**
     * «Забрал — еду» по свободному заказу: курьер назначается и заказ сразу «В пути» — { id, status, day_number, branch }.
     * point — место телефона в момент нажатия { lat, lon, accuracy } или null (не дал геопозицию — заказ всё равно берётся).
     * Отказ базы — понятным текстом: «уже забрал другой курьер», «это предел точки», «сначала самый старый — № N»
     */
    take: (key, id, point) => asCourier('courier_take', {
      p_key: key, p_order_id: Number(id), p_lat: point?.lat ?? null, p_lon: point?.lon ?? null, p_accuracy: point?.accuracy ?? null,
    }),
    /** Место курьера со страницы, пока он везёт заказы (не чаще раза в 15 с — лишнее база молча пропустит): true — записано */
    putLocation: (key, point) => asCourier('courier_put_location', {
      p_key: key, p_lat: point.lat, p_lon: point.lon, p_accuracy: point.accuracy ?? null,
    }),
    /**
     * Вход по коду из 6 цифр (specs/018) → { key, name } (key — длинный ключ, дальше всё как раньше) или { error: 'format' |
     * 'wrong' | 'disabled' | 'locked' | 'busy', minutes? }. База без 018 — 404 (SupabaseError, status 404)
     */
    login: (pin) => asCourier('courier_login', { p_pin: pin }),
    /** Заработок за рабочий день: { since, delivered, earned, unknown, orders: [{ id, day_number, done_at, fee, door }] } или null */
    today: (key) => optional404(() => asCourier('courier_today', { p_key: key })),
    /** По своим и свободным заказам: { "<id>": { door, door_fee, ready_at, promise_at } } или null */
    extra: (key) => optional404(() => asCourier('courier_extra', { p_key: key })),
    /** Чат своего заказа: { open, can_write, messages } или null (заказ уже не его / база без 018) */
    chat: (key, id, after = 0) => optional404(() => asCourier('courier_chat', { p_key: key, p_order_id: Number(id), p_after: after })),
    chatSend: (key, id, body) => asCourier('courier_chat_send', { p_key: key, p_order_id: Number(id), p_body: body }),
    /** [{ order_id, last_id, last_author, count }] по своим открытым заказам или null */
    chatSummary: (key) => optional404(() => asCourier('courier_chat_summary', { p_key: key })),
    /** Моя точка (specs/019): { branch: 'kulieva' | 'kokzhar' | null — обе, chosen } или null (неверный код / база без 019) */
    point: (key) => optional404(() => asCourier('courier_point', { p_key: key })),
    /** Курьер без точки выбирает её один раз → { branch }; отказ — понятным текстом («уже выбрана — сменить может менеджер») */
    choosePoint: (key, branch) => asCourier('courier_choose_point', { p_key: key, p_branch: branch }),
    /** Свой номер и сводка чата с менеджером (specs/021): { phone, chat: { last_id, last_author } | null } или null (база без 021) */
    contact: (key) => optional404(() => asCourier('courier_contact', { p_key: key })),
    /** Курьер вписывает свой номер → { phone: '+996…' }; не похоже на номер — отказ понятным текстом */
    setPhone: (key, phone) => asCourier('courier_set_phone', { p_key: key, p_phone: phone }),
    /** Чат с менеджером: { open, can_write, messages: [{ id, author, body, at, label }] } или null */
    staffChat: (key, after = 0) => optional404(() => asCourier('courier_staff_chat', { p_key: key, p_after: after })),
    staffSend: (key, body) => asCourier('courier_staff_send', { p_key: key, p_body: body }),
    /**
     * Итог рабочего дня (specs/024): back 0 — сегодня, 1 — вчера. { since, until, delivered, earned, road, rain, rain_orders, door,
     * door_orders, unknown, orders: [{ id, day_number, done_at, address, km, approx, by, qr, road, rain, door, fee }] } или null —
     * база без 024 (тогда — today)
     */
    earnings: (key, back = 0) => optional404(() => asCourier('courier_earnings', { p_key: key, p_back: back })),
    /**
     * Сумма доставки по месту курьера у клиента (адрес не нашёлся на карте): { id, delivery_quote, changed }; отказ — понятным
     * текстом. km — по дорогам с телефона (null — не посчитал: база возьмёт прямую × 1,3)
     */
    fillQuote: (key, id, lat, lon, km) => asCourier('courier_fill_quote', { p_key: key, p_order_id: Number(id), p_lat: lat, p_lon: lon,
      p_km: Number.isFinite(km) ? km : null }),
  },
  /**
   * Продукты кухни (страница шефа /kitchen). Неверный или закрытый код — все функции отвечают null.
   * Продукт: { id, category, name, pack, price (сом или null), note, sort, price_at, updated_at, archived }
   */
  kitchen: {
    me: (key) => asChef('kitchen_me', { p_key: key }),
    products: (key) => asChef('kitchen_products', { p_key: key }),
    /** Новый (id null) или правка */
    save: (key, p) => asChef('kitchen_save', {
      p_key: key, p_id: p.id ?? null, p_category: p.category, p_name: p.name, p_pack: p.pack, p_price: p.price, p_note: p.note,
    }),
    setPrice: (key, id, price) => asChef('kitchen_set_price', { p_key: key, p_id: Number(id), p_price: price }),
    /** archived true — «Убрать», false — «Вернуть» */
    archive: (key, id, archived) => asChef('kitchen_archive', { p_key: key, p_id: Number(id), p_archived: archived }),
  },
  /** Сколько места занято: { db_bytes, receipts_bytes, receipts_count } (после harden.sql) */
  async usage() {
    try { return await db.rpc('kokoro_usage'); } catch { return null; }
  },

  admin: {
    /** Заказы за сутки по Бишкеку (UTC+6); day — 'YYYY-MM-DD' */
    listOrders(day) {
      const from = new Date(`${day}T00:00:00+06:00`);
      const to = new Date(from.getTime() + 24 * 3600_000);
      return withOrderColumns((cols) => db.select('orders', `select=${cols}&created_at=gte.${encodeURIComponent(from.toISOString())}&created_at=lt.${encodeURIComponent(to.toISOString())}&order=created_at.desc&limit=1000`));
    },
    /**
     * Заказы, оформленные или оплаченные с fromDay по toDay включительно (дни по Бишкеку, 'YYYY-MM-DD'), —
     * для кассы: выручка считается по дню оплаты. Постранично, без потолка в 1000 строк.
     */
    listOrdersBetween(fromDay, toDay) {
      const from = new Date(`${fromDay}T00:00:00+06:00`).toISOString();
      const to = new Date(new Date(`${toDay}T00:00:00+06:00`).getTime() + 24 * 3600_000).toISOString();
      const range = (col) => `and(${col}.gte."${from}",${col}.lt."${to}")`;
      return db.selectAll('orders', `select=id,day_number,created_at,paid_at,status,qty,total,delivery_fee,name,receipt_path,branch&or=${encodeURIComponent(`(${range('created_at')},${range('paid_at')})`)}`);
    },
    /**
     * Оплаченные и ещё не принятые заказы, оформленные после since (ISO), за любой день: по ним панель сигналит,
     * даже если выбран другой день (оформлен в 23:55, оплачен в 00:10). Только номера и время — ответ в несколько байт
     */
    waitingOrders(since) {
      return db.select('orders', `select=id,day_number,created_at,paid_at,branch&status=eq.new&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=100`);
    },
    /** Изменилось ли что-то в заказах дня после since (ISO): один id вместо всех заказов — экономит трафик */
    async ordersChangedSince(day, since) {
      const from = new Date(`${day}T00:00:00+06:00`).toISOString();
      const to = new Date(new Date(`${day}T00:00:00+06:00`).getTime() + 24 * 3600_000).toISOString();
      const s = `"${since}"`;
      const rows = await db.select('orders', `select=id&created_at=gte.${encodeURIComponent(from)}&created_at=lt.${encodeURIComponent(to)}&or=${encodeURIComponent(`(created_at.gt.${s},updated_at.gt.${s},paid_at.gt.${s})`)}&limit=1`);
      return rows.length > 0;
    },
    /**
     * Правка заказа из карточки панели. expect — что показывала карточка: { courier_id } (null — «Курьер не назначен»)
     * или { status }. Условие уходит в фильтр PATCH: пока менеджер держал список открытым, курьер мог сам нажать
     * «Забрал — еду» (specs/014) — тогда правка не ляжет и устаревшая карточка не затрёт его. Ошибки:
     * gone — заказ ушёл на другую точку (specs/013); changed — заказ уже изменился, err.row — какой он сейчас
     */
    async updateOrder(id, patch, expect = {}) {
      const where = Object.entries(expect).map(([k, v]) => `&${k}=${v == null ? 'is.null' : `eq.${encodeURIComponent(v)}`}`).join('');
      // Повтор без колонки delivery_quote безопасен: если её нет, база отказала целиком и ничего не поменяла
      const [row] = await withOrderColumns((cols) => db.update('orders', `id=eq.${Number(id)}${where}&select=${cols}`, { ...patch, updated_at: new Date().toISOString() }));
      if (row) return row;
      // Ответ с заказом (return=representation) пуст — правка не легла ни на одну строку. Без условия так бывает, только
      // когда заказ ушёл на другую точку: чужой заказ менеджеру не виден. С условием перечитываем заказ: не виден — то же;
      // виден — его успели изменить. Молча «сохранить» нельзя — панель перечитает список
      let now = null;
      let unknown = false;
      if (where) {
        try { [now] = await withOrderColumns((cols) => db.select('orders', `select=${cols}&id=eq.${Number(id)}`)); } catch { unknown = true; }
      }
      if (!now && !unknown) {
        const err = new Error('Заказ передан другой точке — список обновлён');
        err.gone = true;
        throw err;
      }
      // Заказ уже такой, как выбрал менеджер (например, курьер сам нажал «Доставил», пока менеджер ставил «Доставлен»), — успех
      if (now && Object.entries(patch).every(([k, v]) => now[k] === v)) return now;
      // Курьер сам взял заказ: назначен курьер (не тот, что был в карточке) и заказ «В пути»
      const taken = now && now.courier_id && now.status === 'delivering' && now.courier_id !== expect.courier_id;
      const err = new Error(unknown ? 'Заказ изменился или ушёл на другую точку — список обновлён'
        : taken ? 'Заказ уже изменился — курьер забрал его сам. Список обновлён'
          : 'Заказ уже изменился — список обновлён, посмотрите и выберите ещё раз');
      err.changed = true;
      if (now) err.row = now;
      throw err;
    },
    async saveSettings(patch) {
      const [row] = await db.update('order_settings', 'id=eq.1', { ...patch, updated_at: new Date().toISOString() });
      if (!row) throw new Error('Нет прав на изменение настроек');
      return row;
    },
    /** Кто вошёл (specs/013): { branch: 'kulieva' | 'kokzhar' | null, owner, email } — owner видит обе точки */
    me: () => db.rpc('admin_me'),
    /** Приём и время доставки по точкам: { kulieva: { accepting_orders, wait_minutes }, kokzhar: {…} } или null */
    /**
     * Приём, время и дождь по точкам + кто включил дождь (rain_by: 'auto' — погода, 'manager' — панель) и последний прогноз
     * (weather), specs/022. Колонок ещё нет — как раньше, без них (покупателю они закрыты, поэтому отдельным запросом)
     */
    async branchSettings() {
      const base = await readBranchSettings();
      if (!base || !weatherColumns) return base;
      try {
        const rows = await db.select('branch_settings', 'select=branch,rain_by,weather');
        for (const r of rows) if (base[r.branch]) Object.assign(base[r.branch], { rain_by: r.rain_by ?? null, weather: r.weather ?? null });
      } catch (err) {
        if (err.status === 400 || err.status === 404) weatherColumns = false; // courier-pay.sql не запускали
      }
      return base;
    },
    /**
     * Сумма доставки заказа от кухни его точки (specs/022): панель досчитывает, если суммы нет или она от другой кухни.
     * quote — { km, price, from, approx } → { id, delivery_quote, changed }. Сумма уже от своей кухни — база не трогает
     */
    setDeliveryQuote: (id, quote) => db.rpc('admin_set_delivery_quote', { p_id: Number(id), p_quote: quote }),
    /** Приём или время доставки одной точки: менеджер точки — только своей, владелец — любой */
    async saveBranchSettings(branch, patch) {
      const [row] = await db.update('branch_settings', `branch=eq.${encodeURIComponent(branch)}`, { ...patch, updated_at: new Date().toISOString() });
      if (!row) throw new Error('Нет прав на изменение настроек этой точки');
      return row;
    },
    /**
     * Передать заказ точке: { id, branch, day_number, confirmed? }. from — точка заказа, которую видела панель
     * ('kulieva' | 'kokzhar' | 'none' — без точки): заказ успели передать — база откажет «Заказ уже передан…», и устаревшая
     * карточка не вернёт его обратно. branch = from — «Адрес наш» (confirmed: true, номер прежний). В принявшей точке номер
     * новый; заказ без точки сохраняет номер, если у принявшей такого за день ещё нет
     */
    transferOrder: (id, branch, from) => db.rpc('admin_transfer_order', { p_id: Number(id), p_branch: branch, p_from: from ?? null }),
    /**
     * Курьеры: [{ id, name, active, tg_linked, location: { lat, lon, at, live_until } | null, orders, branch }].
     * branch — точка курьера ('kulieva' | 'kokzhar' | null — обе; после supabase/courier-pickup.sql, specs/014): менеджер
     * точки получает курьеров своей точки и «обе», владелец — всех
     */
    couriers: () => db.rpc('admin_couriers'),
    /** Точка курьера (только владелец): branch null — обе точки. → { id, branch } */
    setCourierBranch: (id, branch) => db.rpc('admin_courier_set_branch', { p_id: Number(id), p_branch: branch ?? null }),
    /**
     * Сколько заказов курьер берёт на руки — по точкам: { kulieva: 3, kokzhar: 3 } или null (колонки ещё нет —
     * supabase/courier-pickup.sql не запущен). Меняется через saveBranchSettings(branch, { courier_limit })
     */
    async courierLimits() {
      try {
        const rows = await db.select('branch_settings', 'select=branch,courier_limit');
        return rows.length ? Object.fromEntries(rows.map((r) => [r.branch, r.courier_limit])) : null;
      } catch (err) {
        if (err.status === 404 || err.status === 400) return null;
        throw err;
      }
    },
    /**
     * Кто назначает курьеров по точкам (specs/026): { kulieva: 'manual' | 'auto', … } или null (колонки ещё нет —
     * supabase/manual-dispatch.sql не запущен). Меняется через saveBranchSettings(branch, { dispatch })
     */
    async dispatchModes() {
      try {
        const rows = await db.select('branch_settings', 'select=branch,dispatch');
        return rows.length ? Object.fromEntries(rows.map((r) => [r.branch, r.dispatch])) : null;
      } catch (err) {
        if (err.status === 404 || err.status === 400) return null;
        throw err;
      }
    },
    /**
     * Автоназначение (specs/015, supabase/auto-dispatch.sql): база раздаёт свободные заказы курьерам на смене → сколько
     * назначено. Повторы чаще раза в 5 с база пропускает (0). Файла ещё нет (404) — 0, без ошибки
     */
    async dispatch() {
      try { return await db.rpc('kokoro_dispatch'); } catch (err) {
        if (err.status === 404) return 0;
        throw err;
      }
    },
    /** Новый курьер — { id, name, code }: код показывается один раз */
    addCourier: (name) => db.rpc('admin_courier_add', { p_name: name }),
    /** Новый код вместо старого — { id, name, code }; Telegram отвязывается */
    resetCourier: (id) => db.rpc('admin_courier_reset', { p_id: Number(id) }),
    setCourierActive: (id, active) => db.rpc('admin_courier_update', { p_id: Number(id), p_active: active }),
    /**
     * Код из 6 цифр для входа курьера (specs/018) → { id, name, pin }: показывается один раз, прежний код перестаёт работать.
     * Код одноразовый и живёт 72 часа: курьер вводит его на своём телефоне, после входа он сгорает
     */
    courierPin: (id) => db.rpc('admin_courier_pin', { p_id: Number(id) }),
    /**
     * Номера курьеров и сводки их чатов с менеджерами (specs/021): [{ id, phone, chat: { last_id, last_author } | null }] —
     * курьеры, которых видит этот вход. База без 021 — null
     */
    async courierContacts() {
      try { return await db.rpc('admin_courier_contacts'); } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },
    /** Чат с курьером: { open, can_write, messages: [{ id, author, body, at, label, own }] } */
    courierChat: (id, after = 0) => db.rpc('admin_courier_chat', { p_id: Number(id), p_after: after }),
    courierChatSend: (id, body) => db.rpc('admin_courier_chat_send', { p_id: Number(id), p_body: body }),
    /** Удалить курьера, который больше не работает (мягко: в отчётах остаётся) → { id } */
    deleteCourier: (id) => db.rpc('admin_courier_delete', { p_id: Number(id) }),
    /** «Готово к выдаче» с экрана кухни (specs/018): ready true / false → { id, status, ready_at } */
    setReady: (id, ready) => db.rpc('admin_order_ready', { p_id: Number(id), p_ready: !!ready }),
    /** Отчёт за дни по Бишкеку 'YYYY-MM-DD' (не больше 62 дней): { from, to, branches, couriers, late } */
    report: (fromDay, toDay) => db.rpc('admin_report', { p_from: fromDay, p_to: toDay }),
    /** Чат заказа для менеджера: { open, can_write, messages: [{ id, author, body, at, courier }] } */
    chat: (id, after = 0) => db.rpc('admin_chat', { p_order_id: Number(id), p_after: after }),
    chatSend: (id, body) => db.rpc('admin_chat_send', { p_order_id: Number(id), p_body: body }),
    /** [{ order_id, last_id, last_author, count }] по видимым заказам с сообщениями после since (ISO); база без 018 — [] */
    async chatSummary(since) {
      try { return await db.rpc('admin_chat_summary', { p_since: since }); } catch (err) {
        if (err.status === 404) return [];
        throw err;
      }
    },
    /**
     * Экран кухни (/cook): принятые и готовящиеся заказы за 36 часов — те, что видит этот вход (RLS по точке). Новые колонки —
     * как в listOrders: без mini-app.sql читаем без них
     */
    cookOrders() {
      const since = new Date(Date.now() - 36 * 3600_000).toISOString();
      return withOrderColumns((cols) => db.select('orders', `select=${cols}&status=in.(confirmed,cooking)&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc&limit=200`),
        COOK_COLUMNS, COOK_OPTIONAL);
    },
    /**
     * Незакрытые заказы (новые, принятые, готовятся, в пути), оформленные за 3 суток до дня day ('YYYY-MM-DD', Бишкек), — чтобы
     * вчерашний заказ «ко времени» на сегодня был виден в списке сегодняшнего дня (specs/018, ревью). Те же колонки, что listOrders
     */
    listOpenBefore(day) {
      const to = new Date(`${day}T00:00:00+06:00`);
      const from = new Date(to.getTime() - 3 * 24 * 3600_000);
      return withOrderColumns((cols) => db.select('orders', `select=${cols}&status=in.(new,confirmed,cooking,delivering)&created_at=gte.${encodeURIComponent(from.toISOString())}&created_at=lt.${encodeURIComponent(to.toISOString())}&order=created_at.desc&limit=200`));
    },
    /** Чек из закрытого хранилища — файлом (для архива) */
    receiptBlob(path) {
      return db.storage.download('receipts', path);
    },
    /** Чек из закрытого хранилища — ссылка на blob для просмотра в браузере */
    async receiptUrl(path) {
      return URL.createObjectURL(await db.storage.download('receipts', path));
    },
  },
};
