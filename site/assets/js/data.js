// Всё, что знаем о KOKORO, — в одном месте. Меняется здесь, вёрстку трогать не нужно.
// Цена комбо и стоимость доставки — в базе (панель → «Настройки»), здесь только запасное значение.
export const brand = {
  name: 'KOKORO',
  phone: '996707331103',
  phoneLabel: '+996 707 331 103',
  instagram: 'kokoro.kgz',
  instagramUrl: 'https://www.instagram.com/kokoro.kgz/',
  courierBot: 'kkurierr_bot', // Telegram-бот курьеров: через него курьер делится местом (supabase/couriers.sql)
};

export const combo = {
  name: 'Комбо KOKORO',
  price: 1400,
  items: [
    { count: '25', title: 'хрустящих крыльев' },
    { count: '1 кг', title: 'деревенской картошки' },
    { count: '3', title: 'больших фирменных соуса' },
    { count: '1 л', title: 'Coca-Cola' },
  ],
};

// Часы доставки (владелец, 04.11.2026): заказы на сайте принимаем круглосуточно, развозим с 12:00 до 00:00 по Бишкеку.
// Оплатили ночью или утром — везём после 12:00, и сайт так и пишет вместо «привезём к …» (specs/008-delivery-hours).
// Поменялись часы — правьте здесь (to — не больше 24) и пометки в index.html: test-client.mjs сверяет их с label
export const hours = { from: 12, to: 24, start: '12:00', label: 'с 12:00 до 00:00' };

const BISHKEK = 6 * 3_600_000; // Бишкек — UTC+6 круглый год, без летнего времени
const DAY = 86_400_000;
const sinceMidnight = (ms) => (((ms + BISHKEK) % DAY) + DAY) % DAY;

/** Минуты от полуночи по Бишкеку: 15:30 → 930 */
export const bishkekMinutes = (ms) => Math.floor(sinceMidnight(ms) / 60_000);

/** Доставка в этот момент работает: 12:00–23:59 по Бишкеку */
export function deliveryOpen(ms) {
  const m = bishkekMinutes(ms);
  return m >= hours.from * 60 && m < hours.to * 60;
}

// Час пик (владелец, 11.11.2026): с 18:00 до 21:00 по Бишкеку покупатель видит, что ожидание может составить 2–2,5 часа;
// в остальные часы доставки — обычное время точки из панели
export const peak = { from: 18, to: 21, label: '2–2,5 часа', note: 'Сейчас час пик — ожидание может составить 2–2,5 часа.' };
/** Час пик в этот момент: 18:00–20:59 по Бишкеку */
export function peakNow(ms) {
  const m = bishkekMinutes(ms);
  return m >= peak.from * 60 && m < peak.to * 60;
}

/** С какого момента везём заказ, оплаченный в ms: в часы доставки — сразу, ночью и утром — с ближайших 12:00 */
export function deliveryStart(ms) {
  if (deliveryOpen(ms)) return ms;
  const start = ms - sinceMidnight(ms) + hours.from * 3_600_000;
  return bishkekMinutes(ms) < hours.from * 60 ? start : start + DAY;
}

/** «Ко времени»: «18:30» — в часы доставки? 00:00 — конец доставки, тоже можно */
export function timeInHours(hhmm) {
  const [, h, m] = /^(\d{1,2}):(\d{2})/.exec(String(hhmm)) || [];
  if (h === undefined) return false;
  const t = Number(h) * 60 + Number(m);
  return (t >= hours.from * 60 && t < hours.to * 60) || t === (hours.to * 60) % 1440;
}

// Всё, что говорит покупателю, куда и как платить, — здесь, а не в базе: с паролем менеджера
// это не подменить. Меняется только с ноутбука выкладкой сайта (README → «Сменить QR и тексты»).
// Новый QR: заменить файл assets/img/payment-qr.jpg. ?v= — первые 8 знаков SHA-1 файла: картинки
// браузер хранит неделю (_headers), новая версия в адресе заставляет скачать новый QR сразу;
// scripts/deploy.mjs сверяет её с файлом.
export const payment = {
  qrImage: 'assets/img/payment-qr.jpg?v=f4732673',
  // Кому приходят деньги по этому QR — с ним сверяются чеки покупателей (сменили QR — поменяйте и это)
  // qrTxnId — постоянный номер, зашитый в этот QR (поле 32.11): одинаков у всех оплат, поэтому повтором не считается
  recipient: { label: 'Карен А., +996 703 266 323 (О!Деньги)', names: ['КАРЕН', 'KAREN'], phone: '703266323', qrTxnId: '457946203457' },
  // Подсказка под QR на шаге оплаты
  note: 'Отсканируйте QR-код в приложении банка и оплатите точную сумму. Затем прикрепите чек — скриншот или фото.',
  // Текст над формой, когда приём заказов выключен в панели
  closedMessage: 'Сейчас мы не принимаем заказы. Загляните позже!',
  // Две точки (specs/013) — плашки над кнопкой заказа; {name} — название точки («Кок-Жар»).
  // В текстах плашек «напишите нам» становится ссылкой на WhatsApp KOKORO (brand.phone), «отметьте дом на карте» — кнопкой,
  // которая открывает карту точки доставки. Переписали фразу — ссылки и кнопки не будет, текст останется
  // Адрес на стороне точки, которая остановила приём, а другая работает:
  branchClosedMessage: 'Точка «{name}» (ваш адрес на её стороне города) сейчас не принимает заказы. Попробуйте чуть позже или напишите нам.',
  // …дописываем, если сторону города сайт определил по найденному адресу, без точки на карте (адрес мог найтись неверно)
  branchClosedApprox: 'Если адрес определился неверно — отметьте дом на карте.',
  // Точка не определилась (точки на карте нет, адрес не нашли или сервис адресов не ответил), а принимает только одна:
  // заказ не отправляем — он мог бы уйти точке, которая по этому адресу не возит
  branchUnknownMessage: 'Отметьте дом на карте — так мы поймём, какая точка привезёт заказ. Сейчас принимает только «{name}».',
  // Сообщение клиенту по кнопке «О заказе» в панели. Подстановки: {number}, {name}, {qty}, {total}, {address}, {time}, {payment},
  // {delivery} — сумма доставки, которую посчитал сайт («210 сом», «около 210 сом»), нет её — «по расстоянию до вас» (расценки покупателю не называем),
  // {link} — личная ссылка на статус заказа (kokoro.com.kg/?z=…): статус и курьер в любом браузере. Нет кода ссылки — строка с {link} выпадает
  whatsappTemplate: 'Здравствуйте, {name}! Это KOKORO. Ваш заказ №{number} оплачен и принят: комбо × {qty}, {total} сом.\nДоставка — {delivery}, оплата курьеру при получении.\nАдрес: {address}\nПодтвердите, пожалуйста, адрес и время доставки.\nГде ваш заказ сейчас: {link}',
  // Время доставки: {wait} — то, что менеджер выбрал в панели («1,5 часа»); {at} — час оплаты плюс это время («19:30»);
  // {time} — время, которое указал покупатель
  formWait: 'Сейчас привозим примерно за {wait}.', // под кнопкой заказа
  doneTime: 'Вы получите заказ примерно к {at}.', // экран «Заказ принят» после отправки чека
  doneTimeExact: 'Вы просили привезти заказ к {time}.', // то же, если заказали «Ко времени»
  doneContact: 'Менеджер свяжется с вами в течение 20 минут — напишет в WhatsApp на номер',
  // Ночью и утром, вне часов доставки (hours): под кнопкой — вместо formWait; у заказа, оплаченного в это время, на «Заказ
  // принят» — вместо doneTime и doneContact («в течение 20 минут» ночью не обещаем); «Ко времени» вне часов — ошибка у поля
  formWaitLater: `Доставка начнётся в ${hours.start} — заказ можно оформить уже сейчас.`,
  payLater: `Доставка начнётся в ${hours.start} — заказ привезём после этого времени.`, // шаг оплаты, над QR

  doneTimeLater: `Вы получите заказ после ${hours.start}.`,
  doneContactLater: 'Менеджер напишет вам в WhatsApp на номер',
  // Самовывоз (specs/018): те же места, своими словами — заказ не везём, а готовим к выдаче на кухне точки
  pickupWait: 'Приготовим примерно за {wait}.', // под кнопкой
  pickupFormWaitLater: `Выдаём заказы с ${hours.start} — заказ можно оформить уже сейчас.`,
  pickupPayLater: `Выдаём заказы с ${hours.start} — приготовим после этого времени.`, // шаг оплаты, над QR
  pickupDoneTime: 'Заказ будет готов примерно к {at}.',
  pickupDoneTimeExact: 'Вы просили приготовить заказ к {time}.',
  pickupDoneTimeLater: `Заказ будет готов после ${hours.start}.`,
  pickupDoneReach: ', чтобы подтвердить время.', // хвост строки «Менеджер свяжется…» вместо «подтвердить адрес и время доставки»
  pickupDoneWhere: 'Заберите заказ на {address}.', // вместо «Доставку оплатите курьеру…»
  timeOutside: `Доставляем ${hours.label} — выберите время в этом промежутке`,
};

// Доставка по тарифу KOKORO (карточка от 01.11.2026). Оплачивается курьеру при получении и в сумму
// по QR не входит: в панели «Доставка, сом» держите 0. Поменялся тариф — правьте здесь и выкладывайте сайт.
// Сумму сайт считает сам: по дорогам от кухни точки покупателя (specs/007-delivery-price, specs/013 — точка по Советской;
// точка не определилась — от ближайшей кухни)
export const delivery = {
  // [до скольких км, сом]: 0–2 км — 120 сом, 2–3 км — 140 сом … 12–15 км — 380 сом
  zones: [[2, 120], [3, 140], [4, 160], [5, 180], [6, 200], [7, 220], [8, 240], [10, 280], [12, 320], [15, 380]],
  pickup: 50, // «Подача» — прибавляется к каждой доставке (владелец, 03.11.2026)
  urgent: 100, // «Срочная доставка» — заказ выполняют в первую очередь
  rain: 100, // «Идёт дождь» — менеджер включает в панели у своей точки (supabase/rain.sql, 11.11.2026)
  // Откуда возим — точки из 2GIS владельца (03.11.2026). С 09.11.2026 доставку считаем от кухни своей точки (specs/013)
  kitchens: [
    { label: 'ул. Кок-Жайык, 120а', lat: 42.841170, lon: 74.648957, branch: 'kokzhar' },
    { label: 'ул. Кулиева, 40', lat: 42.879575, lon: 74.568402, branch: 'kulieva' },
  ],
};

// Две точки (specs/013, с 09.11.2026): город делится по бывшей Советской (ул. Абдрахманова). Запад — Кулиева, восток — Кок-Жар.
// У каждой точки свои заказы, вход в панель, «Принимаем заказы» и время доставки; цена комбо и тариф — общие
export const BRANCHES = ['kulieva', 'kokzhar'];
export const branchInfo = {
  // Телефон точки (владелец, 11.11.2026): покупатель звонит и пишет туда, откуда заказал (экран заказа, отмена, чек)
  kulieva: { name: 'Кулиева', kitchen: 'ул. Кулиева, 40', phone: '996501383101', phoneLabel: '+996 501 383 101' },
  kokzhar: { name: 'Кок-Жар', kitchen: 'ул. Кок-Жайык, 120а', phone: '996707331103', phoneLabel: '+996 707 331 103' },
};
export const branchName = (b) => branchInfo[b]?.name || '';
/** Телефон точки заказа { phone: '996…', phoneLabel: '+996 …' }; точка неизвестна — общий номер KOKORO */
export const branchPhone = (b) => (branchInfo[b]?.phone ? { phone: branchInfo[b].phone, phoneLabel: branchInfo[b].phoneLabel }
  : { phone: brand.phone, phoneLabel: brand.phoneLabel });

// Линия раздела: ул. Абдрахманова (бывшая Советская) из OpenStreetMap, с севера на юг, упрощена до 12 м; за концами улицы —
// прямо на север (до 43.2) и на юг (до 42.5). Та же линия — в supabase/two-points.sql (kokoro_branch_at), сверяет check-sql
export const SOVETSKAYA = [
  [43.2, 74.60899], [42.94914, 74.60899], [42.94509, 74.60968], [42.94401, 74.60956], [42.94196, 74.60881], [42.93843, 74.6086],
  [42.93584, 74.60979], [42.93509, 74.60969], [42.93279, 74.61032], [42.93147, 74.60962], [42.93006, 74.61065], [42.92592, 74.6119],
  [42.91809, 74.61196], [42.91553, 74.61249], [42.90698, 74.61254], [42.89545, 74.61143], [42.88062, 74.61175], [42.86289, 74.61094],
  [42.82388, 74.60673], [42.82305, 74.60644], [42.82254, 74.60599], [42.82193, 74.60489], [42.82163, 74.60154], [42.82103, 74.59877],
  [42.8205, 74.59812], [42.81452, 74.59469], [42.80818, 74.59151], [42.80359, 74.58834], [42.5, 74.58834],
];

/** Точка по координатам: запад линии — 'kulieva', восток — 'kokzhar'; за пределами линии по широте или без координат — null */
export function branchAt(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (let i = 1; i < SOVETSKAYA.length; i++) {
    const [a, b] = [SOVETSKAYA[i - 1], SOVETSKAYA[i]];
    if (lat <= a[0] && lat >= b[0]) {
      const border = a[1] + (b[1] - a[1]) * (lat - a[0]) / (b[0] - a[0]);
      return lon < border ? 'kulieva' : 'kokzhar';
    }
  }
  return null;
}

/** Кухня точки: { label, lat, lon, branch } */
export const branchKitchen = (b) => delivery.kitchens.find((k) => k.branch === b) || null;

/** Дальше этого (15 км) тарифа нет — сумму называет менеджер. Не метод at: его нет в Safari до iOS 15.4 */
export const maxKm = delivery.zones[delivery.zones.length - 1][0];

/** Подпись зоны тарифа: 0 → «0–2 км», 1 → «2–3 км» */
export const zoneLabel = (i) => `${i ? delivery.zones[i - 1][0] : 0}–${delivery.zones[i][0]} км`;

/**
 * Доставка за km по дорогам (уже округлено до 0,1): цена зоны плюс подача. Граница входит в зону: 2 км — 120 + 50.
 * Дальше последней зоны (15 км) — null: сумму называет менеджер
 */
export function deliveryPrice(km) {
  const zone = Number.isFinite(km) && km >= 0 ? delivery.zones.find(([upTo]) => km <= upTo) : null;
  return zone ? zone[1] + delivery.pickup : null;
}

/** Расстояние для людей: 4 → «4,0 км» */
export const kmLabel = (km) => `${Number(km).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} км`;

// Время ожидания доставки ставит менеджер в панели (supabase/wait-time.sql, от 15 минут до 8 часов); с 09.11.2026 — у каждой
// точки своё (branch_settings, specs/013). Здесь — запасное значение, пока база не ответила, и варианты в списке панели
export const wait = {
  minutes: 90,
  options: [30, 45, 60, 90, 120, 150, 180, 240],
};

const plural = (n, one, few, many) => {
  const t = n % 100, u = n % 10;
  return t > 10 && t < 20 ? many : u === 1 ? one : u >= 2 && u <= 4 ? few : many;
};
/** Заказы словами: 1 → «1 заказ», 2 → «2 заказа», 5 → «5 заказов» (specs/014: «курьер везёт ещё …») */
export const ordersLabel = (n) => `${n} ${plural(Number(n), 'заказ', 'заказа', 'заказов')}`;
/** Минуты словами, после «через» и «за»: 90 → «1,5 часа», 60 → «1 час», 45 → «45 минут», 100 → «1 час 40 минут» */
export function waitLabel(minutes) {
  const m = Math.round(Number(minutes));
  if (m < 60) return `${m} ${plural(m, 'минуту', 'минуты', 'минут')}`;
  const h = Math.floor(m / 60), rest = m % 60;
  const hours = `${h} ${plural(h, 'час', 'часа', 'часов')}`;
  if (rest === 0) return hours;
  if (rest === 30) return `${h},5 часа`;
  return `${hours} ${rest} ${plural(rest, 'минуту', 'минуты', 'минут')}`;
}

// Статусы, которые не считаются оплатой. Выручка кассы — заказы в остальных статусах и с приложенным
// чеком, по дню оплаты (cashbox.js). Это оплаты по чекам покупателей — с банком сверяет владелец.
export const UNPAID_STATUSES = ['awaiting_payment', 'canceled'];

export const STATUSES = {
  awaiting_payment: 'Ждёт оплаты',
  new: 'Оплачен — новый',
  confirmed: 'Подтверждён',
  cooking: 'Готовится',
  delivering: 'В пути',
  done: 'Доставлен',
  canceled: 'Отменён',
};

// Шкала для покупателя после оплаты: те же статусы, что менеджер ставит в панели, — своими словами.
// later — подсказка заказу, оплаченному ночью или утром, пока не наступили 12:00 («скоро» ночью не обещаем)
export const TRACK = [
  { status: 'new', label: 'Чек получен', hint: 'Менеджер проверяет оплату и скоро напишет вам',
    later: `Менеджер проверит оплату и напишет вам. Доставку начинаем в ${hours.start}` },
  { status: 'confirmed', label: 'Обработан', hint: 'Заказ подтверждён — скоро начнём готовить',
    later: `Заказ подтверждён — привезём после ${hours.start}` },
  { status: 'cooking', label: 'Готовится', hint: 'Готовим ваш заказ' },
  { status: 'delivering', label: 'Едем', hint: 'Курьер уже едет к вам' },
  { status: 'done', label: 'Доставлен', hint: 'Приятного аппетита! Спасибо, что выбрали KOKORO' },
];

export const PAYMENTS = { qr: 'По QR', cash: 'Наличными курьеру', transfer: 'Переводом' };

export const money = (n) => `${Number(n).toLocaleString('ru-RU')} сом`;

// Меню (владелец, 11.11.2026): пока одно «Комбо KOKORO». Новая позиция — новая строка в extras (блок «Добавить к заказу»
// появится сам). ВАЖНО: сумму по QR считает база (place_order знает только комбо) — платные добавки потребуют строки в базе,
// без неё в extras ничего не добавлять. Фото — профессиональные пришлёт владелец (пока — с сайта)
export const menu = [
  { id: 'combo', name: combo.name, photo: 'assets/img/hero-poster.jpg', photoWidth: 540, photoHeight: 810,
    alt: 'Хрустящие крылья KOKORO в фирменном ведре', items: combo.items, halal: true },
];
export const extras = [];

// «До двери» (владелец, анкета 10.11): +50 сом курьеру, только квартирам (указана квартира). То же число — в базе,
// supabase/mini-app.sql → kokoro_door_fee() (сверяет scripts/check-sql.mjs)
export const door = { fee: 50 };

// Время ожидания у заказа, которое менеджер выбирает в карточке (анкета: 60 или 90 минут)
export const waitChoices = [60, 90];

// Юридические тексты (оферта, политика, доставка и возврат) — черновики в legal/. Без названия ИП, ИНН и юридического
// адреса НЕ публикуем: пока ready = false, на сайте нет ни галочки согласия, ни ссылок. Данные пришли и юрист посмотрел —
// страницы в site/, ready = true, выкладка
export const legal = { ready: false, offer: '/offer', privacy: '/privacy', delivery: '/delivery' };

// Шкала для самовывоза: те же статусы базы, своими словами («Готов» — отметка кухни ready_at, не статус)
export const TRACK_PICKUP = [
  { status: 'new', label: 'Чек получен', hint: 'Менеджер проверяет оплату и скоро напишет вам',
    later: `Менеджер проверит оплату и напишет вам. Выдаём заказы с ${hours.start}` },
  { status: 'confirmed', label: 'Принят', hint: 'Заказ подтверждён — скоро начнём готовить',
    later: `Заказ подтверждён — приготовим после ${hours.start}` },
  { status: 'cooking', label: 'Готовим', hint: 'Готовим ваш заказ' },
  { status: 'ready', label: 'Готов — заберите', hint: 'Заказ готов — можно забирать' },
  { status: 'done', label: 'Выдан', hint: 'Приятного аппетита! Спасибо, что выбрали KOKORO' },
];
// Шаг «Готов» для доставки (между «Готовится» и «Едем»), когда кухня отметила готовность
export const READY_STEP = { status: 'ready', label: 'Готов', hint: 'Заказ готов — курьер уже забирает' };

/**
 * Назначенный час заказа «ко времени» (specs/018) — так же, как kokoro_delivery_at в supabase/mini-app.sql (сверяет
 * test-client.mjs): «Ко времени: 18:30, 12.11» — 18:30 двенадцатого ноября по Бишкеку («00:00, 12.11» — полночь в конце 12.11;
 * месяц на полгода раньше месяца оплаты — следующий год); без даты (заказы до 018) — этот час в день оплаты, а если он раньше
 * оплаты больше чем на час — завтра. «Как можно скорее» — null. paidMs — время оплаты в мс (нет — сейчас)
 */
export function deliveryAt(paidMs, deliveryTime) {
  const m = /Ко времени:\s*(\d{1,2}):(\d{2})(?:,\s*(\d{1,2})\.(\d{1,2}))?/.exec(String(deliveryTime || ''));
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const paid = Number.isFinite(paidMs) ? paidMs : null;
  const base = paid ?? Date.now();
  if (m[3] !== undefined) {
    const day = Number(m[3]), month = Number(m[4]);
    const local = new Date(base + BISHKEK); // поля UTC = местное время Бишкека
    const dateOf = (year) => {
      const d = new Date(Date.UTC(year, month - 1, day));
      return d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d.getTime() : null;
    };
    let date = dateOf(local.getUTCFullYear());
    if (date === null) return null;
    // Через Новый год в обе стороны: «13:00, 01.01», оплаченный 31.12, — следующий год; «00:00, 31.12», оплаченный 01.01, — прошлый
    const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    if (date < today - 180 * DAY) date = dateOf(local.getUTCFullYear() + 1);
    else if (date > today + 180 * DAY) date = dateOf(local.getUTCFullYear() - 1);
    if (date === null) return null;
    let at = date + (h * 60 + min) * 60_000 - BISHKEK;
    if (h === 0 && min === 0) at += DAY;
    return at;
  }
  let at = base - sinceMidnight(base) + (h * 60 + min) * 60_000;
  if (paid !== null && at < paid - 3_600_000) at += DAY;
  return at;
}
