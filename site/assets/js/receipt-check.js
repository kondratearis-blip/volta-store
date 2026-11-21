// Сверка чека с заказом по тексту, распознанному со скриншота оплаты. Чистые функции — без DOM и сети,
// их проверяет scripts/test-receipt-check.mjs. Это проверка картинки, а не денег: подделанный скриншот
// её пройдёт, поэтому итог — подсказка менеджеру, а спорные оплаты сверяют в приложении банка.
// Правило: «✓ сходится» — только когда всё найдено и однозначно; при любом сомнении — «⚠ сверьте вручную».
import { money } from './data.js';

const BISHKEK_MS = 6 * 3600_000;
const WINDOW_MS = 15 * 60_000; // запас на расхождение часов телефона и сервера
// Номера квитанций, зашитые в известные генераторы поддельных чеков (найдено 31.10.2026: «копия чека MBank»)
const FAKE_TXN_IDS = ['P0812322343636'];

// Латинские буквы, которые OCR путает с кириллицей
const LOOKALIKE = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' };
const MONTHS = { янв: 1, фев: 2, мар: 3, апр: 4, май: 5, мая: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12 };

// \b в JavaScript не видит границ кириллических слов — поэтому границы через (?<![а-яё]) и (?![а-яё])
const LABEL_AMOUNT = /сумм|итог|к оплате|списан|оплачено|переведено|к зачислени|amount|total|(?<![a-z])sum(?![a-z])/i;
const CURRENCY = /(?<![а-яё])сом(?:а|ов)?(?![а-яё])|kgs|kgz|⃀|\d\s*с\.?(?![а-яёa-z0-9])/i;
const NOT_PAYMENT = /баланс|остаток|доступн|balance|кэшб|кешб|cashback|бонус|лимит|комисс|fee/i;
const LABEL_RECIPIENT = /получат|кому|куда|recipient|на сч[её]т|на кошел|beneficiary|(?<![a-z])to(?![a-z])/i;
const LABEL_SENDER = /отправит|от кого|откуда|со сч[её]т|с карты|плательщик|sender|(?<![a-z])from(?![a-z])/i;
const LABEL_DATE = /дата|время|date|time|выполнен|исполнен|проведен/i;
const NOT_PAYMENT_DATE = /сформирован|печат|выписк|распечат|создан[ао]? документ/i;
// Статус: сначала отрицания и ошибки (они перекрывают «успех»), отдельно — «в обработке»
const FAILURE = /(?<![а-яё])не\s*(?:выполн|провед|оплач|зачисл|успешн|исполн|прош)|неуспешн|unsuccess|not\s+(?:completed|approved|successful|paid)|ошибк|отклон|отменен|отменён|failed|declined|rejected|ийгиликсиз|(?<![а-яё])ката(?![а-яё])/i;
const PENDING = /в обработке|обрабатыва|ожида|pending|processing|в процессе/i;
const SUCCESS = /успешн|выполнен|проведен|проведён|исполнен|оплачено|(?<![а-яё]к\s)зачислено|success|completed|approved|ийгиликтүү|аткарылды/i;
// Строки интерфейса, где слово «ошибка» — не про платёж
const UI_NOISE = /сообщить|поддержк|пожаловат|помощь|вопрос/i;

/** Текст после OCR: неразрывные пробелы → обычные, длинные тире → «-», строки без пустых */
export function normalizeText(text) {
  return String(text || '')
    .replace(/[   ]/g, ' ')
    .replace(/[‒-―−]/g, '-')
    .split(/\r?\n/).map((l) => fixDigits(l.replace(/[ \t]+/g, ' ').trim())).filter(Boolean);
}

/** OCR путает О/O/о с нулём и З с тройкой внутри чисел: «1 4OO» → «1 400», «З00» → «300» */
function fixDigits(line) {
  let prev;
  do {
    prev = line;
    line = line.replace(/(\d[\s.,]?)[OОоo](?=[\s.,]?[\dOОоo]|[\s.,]|$)/g, '$10').replace(/(\d)[З](?=\d)/g, '$13').replace(/[OОо](?=\d)/g, (c, i, s) => (/\d/.test(s[i - 1] || '') ? '0' : c));
  } while (line !== prev);
  return line;
}

function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/* ---------- Дата и время ---------- */

const DATE_NUM = /(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})(?!\d)/;
const DATE_ISO = /(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)/;
const DATE_WORD = /(?<!\d)(\d{1,2})\s+(янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)[а-я]*\.?,?\s*(\d{4})?/i;
const TIME = /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?!\d)(?:\s*(AM|PM|ДП|ПП))?/i;

function findDate(line) {
  let m = DATE_ISO.exec(line);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3], raw: m[0] };
  m = DATE_NUM.exec(line);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return { y: m[3].length === 2 ? 2000 + +m[3] : +m[3], mo: +m[2], d: +m[1], raw: m[0] };
  m = DATE_WORD.exec(line);
  if (m) return { y: m[3] ? +m[3] : null, mo: MONTHS[m[2].toLowerCase().slice(0, 3)] || MONTHS[m[2].toLowerCase()], d: +m[1], raw: m[0] };
  return null;
}

/** «7:35 PM» → [19, 35]; без AM/PM — как есть */
function hoursMinutes(t) {
  let h = +t[1];
  const ampm = (t[4] || '').toUpperCase();
  if (ampm === 'PM' || ampm === 'ПП') h = h % 12 + 12;
  if (ampm === 'AM' || ampm === 'ДП') h %= 12;
  return [h, +t[2], t[3] ? +t[3] : 0];
}

/**
 * Дата и время оплаты из чека (по Бишкеку): { at, hasDate, hasTime, text, several }.
 * Сначала строки с подписью «дата/время операции», строки «сформировано/печать» пропускаем.
 * Время берём из той же строки или из соседней, где кроме времени ничего нет; первую строку OCR
 * (часы в статус-баре телефона) не берём никогда.
 */
export function parseDateTime(lines, fallbackYear) {
  const found = [];
  lines.forEach((line, i) => {
    if (NOT_PAYMENT_DATE.test(line)) return;
    const date = findDate(line);
    if (!date) return;
    let t = TIME.exec(line.replace(date.raw, ''));
    if (!t) {
      for (const j of [i + 1, i - 1]) {
        if (j <= 0 || j >= lines.length) continue;
        const m = TIME.exec(lines[j]);
        if (m && lines[j].replace(m[0], '').replace(/[\s,.;:|-]/g, '') === '') { t = m; break; }
      }
    }
    const y = date.y || fallbackYear;
    const [h, mi, s] = t ? hoursMinutes(t) : [12, 0, 0];
    found.push({
      at: Date.UTC(y, date.mo - 1, date.d, h, mi, s) - BISHKEK_MS,
      hasDate: true, hasTime: Boolean(t),
      labeled: LABEL_DATE.test(line) || LABEL_DATE.test(lines[i - 1] || ''),
      text: `${String(date.d).padStart(2, '0')}.${String(date.mo).padStart(2, '0')}.${y}${t ? ` ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : ''}`,
    });
  });
  if (found.length) {
    const best = found.find((f) => f.labeled && f.hasTime) || found.find((f) => f.hasTime) || found[0];
    const several = found.some((f) => Math.abs(f.at - best.at) > 5 * 60_000 && f.hasTime === best.hasTime);
    return { ...best, several };
  }
  const t = lines.slice(1).map((l) => TIME.exec(l)).find(Boolean);
  if (!t) return null;
  const [h, mi] = hoursMinutes(t);
  return { at: null, hasDate: false, hasTime: true, text: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` };
}

/* ---------- Сумма ---------- */

/** «1 400,00» → 1400; «1,400.00» → 1400; «1400» → 1400; не сумма → null */
export function parseMoney(token) {
  const t = token.replace(/^[-+]/, '').trim();
  let m = /^(\d{1,3}(?:[ .,]\d{3})+)(?:[.,](\d{1,2}))?$/.exec(t);
  if (m) return Number(m[1].replace(/[ .,]/g, '')) + (m[2] ? Number(`0.${m[2]}`) : 0);
  m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(t);
  return m ? Number(m[1]) + (m[2] ? Number(`0.${m[2]}`) : 0) : null;
}

const MONEY_TOKEN = /[-+]?\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d{1,2})?(?!\d)|[-+]?\d+(?:[.,]\d{1,2})?(?!\d)/g;

/**
 * Кандидаты в суммы: { value, labeled, currency, joined } — без дат, времени, телефонов, номеров операций,
 * без остатка/баланса/комиссии (и значения строкой ниже такой подписи) и без входящих «+1 400».
 */
export function parseAmounts(lines) {
  const out = [];
  // Подписи столбиком, а значения ниже отдельным столбиком (так OCR читает таблицы) — какое число к какой
  // подписи относится, не понять: такие числа помечаем ambiguous, «✓» по ним не ставим
  const labelOnly = (l) => l && !/\d/.test(l) && (LABEL_AMOUNT.test(l) || NOT_PAYMENT.test(l));
  const stacked = lines.some((l, i) => labelOnly(l) && labelOnly(lines[i + 1]));
  lines.forEach((line, i) => {
    const prev = lines[i - 1] || '';
    const prevIsLabelOnly = !/\d/.test(prev);
    if (stacked && CURRENCY.test(line) && !LABEL_AMOUNT.test(line) && !NOT_PAYMENT.test(line)) {
      for (const token of line.match(MONEY_TOKEN) || []) {
        const value = parseMoney(token);
        if (value && value >= 1 && !token.trim().startsWith('+')) out.push({ value, currency: true, ambiguous: true });
      }
      return;
    }
    if (NOT_PAYMENT.test(line) || (prevIsLabelOnly && NOT_PAYMENT.test(prev))) return;
    const clean = line
      .replace(DATE_ISO, ' ').replace(DATE_NUM, ' ').replace(DATE_WORD, ' ')
      .replace(new RegExp(TIME.source, 'gi'), ' ')
      .replace(/\+?\d[\d ()*•\-]{8,}\d/g, (s) => (s.replace(/\D/g, '').length >= 9 ? ' ' : s)) // телефоны, длинные номера
      .replace(/(?:№|#)\s*\S+/g, ' ');
    const labeled = LABEL_AMOUNT.test(line) || (prevIsLabelOnly && LABEL_AMOUNT.test(prev));
    const currency = CURRENCY.test(line);
    const tokens = clean.match(MONEY_TOKEN) || [];
    for (const token of tokens) {
      if (token.trim().startsWith('+')) continue; // входящая сумма — не оплата
      const value = parseMoney(token);
      if (value && value >= 1 && value < 10_000_000) out.push({ value, labeled, currency });
    }
    // «1 4 00 с» — OCR разорвал число: склеиваем цифры строки как запасной вариант
    if ((labeled || currency) && tokens.length > 1) {
      const joined = Number(clean.replace(/[.,]\d{2}(?!\d)/, '').replace(/\D/g, ''));
      if (joined) out.push({ value: joined, labeled, currency, joined: true });
    }
  });
  return out;
}

/** { state: 'ok' | 'bad' | 'check' | 'missing', value, values } */
export function checkAmount(amounts, total) {
  const equal = (a) => Math.abs(a.value - total) < 0.01;
  const ambiguous = amounts.filter((a) => a.ambiguous);
  if (ambiguous.length) {
    if (!ambiguous.some(equal)) return { state: 'bad', value: ambiguous[0].value };
    const differ = [...new Set(ambiguous.filter((a) => !equal(a)).map((a) => a.value))];
    return differ.length ? { state: 'check', value: total, values: differ } : { state: 'ok', value: total };
  }
  const plain = amounts.filter((a) => !a.joined);
  const labeled = plain.filter((a) => a.labeled);
  const strong = plain.filter((a) => a.labeled || a.currency);
  const joinedOk = amounts.some((a) => a.joined && equal(a));
  const pick = labeled.length ? labeled : strong;
  if (pick.length) {
    const differ = [...new Set(pick.filter((a) => !equal(a)).map((a) => a.value))];
    if (pick.some(equal) && !differ.length) return { state: 'ok', value: total };
    if (pick.some(equal) || joinedOk) return { state: 'check', value: total, values: differ };
    const value = (labeled[0] || strong[0]).value;
    // «сумма 1 сом» при заказе на 1 400 — скорее OCR потерял цифры, чем недоплата
    if (value < 10 && total >= 100) return { state: 'check', value, values: [value] };
    return { state: 'bad', value };
  }
  if (joinedOk) return { state: 'check', value: total, values: [] };
  // Числа без подписи и без валюты — не доказательство: только «сверьте вручную»
  return plain.some(equal) ? { state: 'check', value: total, values: [] } : { state: 'missing' };
}

/* ---------- Получатель ---------- */

/** Телефоны в тексте, в том числе со звёздочками: «+996 703 *** 323» → '703***323' */
export function parsePhones(lines) {
  const out = [];
  lines.forEach((line, i) => {
    const prev = lines[i - 1] || '';
    for (const m of line.matchAll(/\+?[0-9*•xX×][0-9*•xX× ()\-]{6,20}[0-9*•xX×]/g)) {
      let s = m[0].replace(/[^0-9*•xX×]/g, '').replace(/[•xX×]/g, '*');
      if (s.startsWith('996') && s.length === 12) s = s.slice(3);
      else if (s.startsWith('996') && s.length >= 8 && s.length < 12) {
        // «+996 703 *** 323», где OCR потерял звёздочки: видны начало и конец номера, середина — маска
        const rest = s.slice(3);
        s = `${rest.slice(0, 3)}***${rest.slice(-3)}`;
      } else if (s.length === 10 && s.startsWith('0')) s = s.slice(1);
      if (s.length !== 9 || !/\d/.test(s)) continue;
      // Подпись «Получатель» / «Отправитель» — в той же строке или строкой выше
      const sender = LABEL_SENDER.test(line) || (!/\d/.test(prev) && LABEL_SENDER.test(prev));
      const recipientLine = !sender && (LABEL_RECIPIENT.test(line) || (!/\d/.test(prev) && LABEL_RECIPIENT.test(prev)));
      out.push({ phone: s, recipientLine, sender });
    }
  });
  return out;
}

/** Маска засчитывается, только если видно не меньше 3 цифр после кода оператора и все видимые совпадают */
const phoneMatches = (found, expected) => {
  const visibleAfterPrefix = [...found.slice(3)].filter((c) => c !== '*').length;
  return visibleAfterPrefix >= 3 && [...found].every((c, i) => c === '*' || c === expected[i]);
};
const digitDiff = (a, b) => [...a].filter((c, i) => c !== b[i]).length;

function nameMatches(lines, names) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Имя в строке «Отправитель / Откуда / С карты» — не получатель
    if (LABEL_SENDER.test(line) || (LABEL_SENDER.test(lines[i - 1] || '') && !/\d/.test(lines[i - 1] || ''))) continue;
    for (const word of line.toUpperCase().match(/[A-ZА-ЯЁ]{4,}/g) || []) {
      const cyr = [...word].map((c) => LOOKALIKE[c] || c).join('');
      if (names.some((n) => levenshtein(cyr, n) <= 1 || levenshtein(word, n) <= 1)) return word;
    }
  }
  return null;
}

/** { state: 'ok' | 'other' | 'check' | 'missing', how, other } */
export function checkRecipient(lines, recipient) {
  const phones = parsePhones(lines).filter((p) => !p.sender);
  const phone = phones.find((p) => phoneMatches(p.phone, recipient.phone));
  const name = nameMatches(lines, recipient.names);
  const fmt = (p) => `+996 ${p.replace(/^(.{3})(.{3})(.{3})$/, '$1 $2 $3')}`;
  // Полный номер в строке получателя, отличный от нашего, перебивает совпавшее имя
  const foreign = phones.filter((p) => p.recipientLine && /^\d{9}$/.test(p.phone) && p.phone !== recipient.phone);
  const clearlyOther = foreign.find((p) => digitDiff(p.phone, recipient.phone) >= 2);
  if (clearlyOther) return { state: 'other', other: fmt(clearlyOther.phone) };
  if (foreign.length) return { state: 'check', other: fmt(foreign[0].phone), how: 'номер получателя отличается на одну цифру — ошибка распознавания или чужой номер' };
  const how = [phone && `тел. ${phone.phone.replace(/^(\d{3})(.{3})(.{3})$/, '$1 $2 $3')}`, name].filter(Boolean).join(', ');
  // Номер, где видно меньше 6 цифр, без имени — слабое доказательство: «сверьте вручную»
  const visible = phone ? [...phone.phone].filter((c) => c !== '*').length : 0;
  if (name || visible >= 6) return { state: 'ok', how };
  if (phone) return { state: 'check', other: fmt(phone.phone), how: 'видна только часть номера, имени нет' };
  return { state: 'missing' };
}

/* ---------- Номер операции и статус ---------- */

// «№» распознавание часто читает как «Ne», «No», «N2», «Мо» — их тоже считаем знаком номера перед цифрами
const NUMBER_SIGN = '(?:№|n°|(?<![a-zа-яё])(?:no|ne|n2|мо)\\.?(?=\\s*[a-z]?\\d))';
const TXN_LABEL = new RegExp(`(?:номер|№)\\s*(?:операци|квитанци|транзакци|чека|платеж|платёж|перевод|документ)|(?:квитанци[яи]|чек|операци[яи]|транзакци[яи])\\s*${NUMBER_SIGN}|^\\s*${NUMBER_SIGN}|(?<![a-z])(?:id|rrn|reference|ref)(?![a-z])|^(?:номер\\s+)?(?:операци[яи]|квитанци[яи]|транзакци[яи])\\s*:?\\s*$`, 'i');
const TXN_SKIP = /телефон|карт|сч[её]т|кошел|получат|отправит|дата|время|тип |статус|по номеру/i;

export function parseTxnId(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (!TXN_LABEL.test(lines[i]) || TXN_SKIP.test(lines[i])) continue;
    const label = TXN_LABEL.exec(lines[i]);
    // Подпись отдельной строкой («Квитанция»), номер — строкой ниже, возможно со своим «№»
    const sameLine = lines[i].slice(label.index + label[0].length);
    if (!/\d/.test(sameLine) && lines[i + 1]) lines = [...lines.slice(0, i + 1), lines[i + 1].replace(new RegExp(`^\\s*${NUMBER_SIGN}`, 'i'), ''), ...lines.slice(i + 2)];
    for (const source of [sameLine, /\d/.test(sameLine) ? '' : lines[i + 1] || '']) {
      for (const m of source.matchAll(/(?<![A-Za-z0-9])([A-Za-z0-9][A-Za-z0-9-]{5,40})(?![A-Za-z0-9])(?!\s*[*•])/g)) {
        const id = m[1].replace(/-/g, '').toUpperCase();
        if ((id.match(/\d/g) || []).length < 5) continue;
        if (/^(19|20)\d{6}$/.test(id) || DATE_ISO.test(m[1])) continue; // дата, а не номер
        return id;
      }
    }
  }
  return null;
}

/** Номер операции, если он уникален для платежа: постоянный номер из нашего QR и наш телефон не в счёт */
export function uniqueTxnId(lines, recipient) {
  const txn = parseTxnId(lines);
  if (!txn || txn === recipient?.qrTxnId || (recipient?.phone && txn.includes(recipient.phone))) return null;
  return txn;
}

export function parseStatus(lines) {
  const meaningful = lines.filter((l) => !UI_NOISE.test(l));
  const failed = meaningful.find((l) => FAILURE.test(l));
  if (failed) return { state: 'fail', word: failed.slice(0, 40) };
  const pending = meaningful.find((l) => PENDING.test(l));
  if (pending) return { state: 'pending', word: pending.slice(0, 40) };
  return { state: meaningful.some((l) => SUCCESS.test(l)) ? 'ok' : 'missing' };
}

/* ---------- Итог ---------- */

const fmtAt = (ms) => new Date(ms + BISHKEK_MS).toISOString().replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}).*$/, '$3.$2.$1 $4:$5');

/**
 * Сверяет текст чека с заказом.
 * @param {string} text — распознанный текст
 * @param {{ id, total, created_at, paid_at }} order
 * @param {{ recipient, duplicateOf?: string | true | null, txnDuplicateOf?: string | true | null, now?: number }} ctx —
 *   повтор: подпись другого заказа («№ 5 от 31.10») или true, если подписи нет
 * @returns {{ level: 'ok'|'check'|'bad', summary: string, problems: string[], notes: string[], fields: object }}
 */
export function checkReceiptText(text, order, ctx) {
  const lines = normalizeText(text);
  const created = Date.parse(order.created_at);
  const until = order.paid_at ? Date.parse(order.paid_at) : (ctx.now ?? Date.now());
  const year = new Date(created + BISHKEK_MS).getUTCFullYear();
  const problems = [];
  const notes = [];

  // Сумма
  const amount = checkAmount(parseAmounts(lines), order.total);
  if (amount.state === 'bad') problems.push(`сумма ${money(amount.value)} вместо ${money(order.total)}`);
  if (amount.state === 'check') notes.push(amount.values?.length ? `в чеке несколько сумм (${amount.values.map(money).join(', ')})` : 'сумма найдена, но без подписи');
  if (amount.state === 'missing') notes.push('не нашли сумму');

  // Получатель
  const recipient = checkRecipient(lines, ctx.recipient);
  if (recipient.state === 'other') problems.push(`получатель ${recipient.other}, а не ${ctx.recipient.label}`);
  if (recipient.state === 'check') notes.push(`получатель ${recipient.other}: ${recipient.how}`);
  if (recipient.state === 'missing') notes.push('не нашли получателя');

  // Дата и время оплаты: не раньше заказа и не позже, чем приложен чек
  const dt = parseDateTime(lines, year);
  let date;
  if (dt?.hasDate && dt.hasTime) {
    if (dt.at < created - WINDOW_MS) date = { state: 'bad', text: dt.text, why: 'раньше заказа' };
    else if (dt.at > until + WINDOW_MS) date = { state: 'bad', text: dt.text, why: order.paid_at ? 'позже, чем приложен чек' : 'в будущем' };
    else date = { state: dt.several ? 'partial' : 'ok', text: dt.text };
  } else if (dt?.hasDate) {
    const day = (ms) => Math.floor((ms + BISHKEK_MS) / 86_400_000);
    const ok = day(dt.at) >= day(created) && day(dt.at) <= day(until);
    date = ok ? { state: 'partial', text: dt.text } : { state: 'bad', text: dt.text, why: day(dt.at) < day(created) ? 'раньше заказа' : 'позже, чем приложен чек' };
  } else date = dt ? { state: 'partial', text: dt.text } : { state: 'missing' };
  if (date.state === 'bad') problems.push(`дата в чеке ${date.text} — ${date.why} (${fmtAt(date.why === 'раньше заказа' ? created : until)})`);
  if (date.state === 'partial') notes.push(dt.several ? `в чеке несколько дат — проверьте, что ${date.text} это время оплаты` : `в чеке только ${dt.hasDate ? 'дата' : 'время'} ${date.text}`);
  if (date.state === 'missing') notes.push('не нашли дату и время');

  // Статус операции и повторы
  const status = parseStatus(lines);
  if (status.state === 'fail') problems.push(`в чеке «${status.word}» — оплата не прошла`);
  if (status.state === 'pending') notes.push(`в чеке «${status.word}» — оплата ещё не завершена`);
  if (status.state === 'missing') notes.push('нет слова «успешно» или «выполнен»');
  const txn = uniqueTxnId(lines, ctx.recipient);
  if (FAKE_TXN_IDS.includes(txn)) problems.push(`номер квитанции ${txn} — из генератора поддельных чеков`);
  if (ctx.duplicateOf) problems.push(`тот же файл чека уже приложен к ${ctx.duplicateOf === true ? 'другому заказу' : `заказу ${ctx.duplicateOf}`}`);
  if (ctx.txnDuplicateOf) problems.push(`операция № ${txn} уже была в чеке ${ctx.txnDuplicateOf === true ? 'другого заказа' : `заказа ${ctx.txnDuplicateOf}`}`);
  if (!lines.length) notes.splice(0, notes.length, 'текст на картинке не распознан');

  const level = problems.length ? 'bad'
    : amount.state === 'ok' && recipient.state === 'ok' && date.state === 'ok' && status.state === 'ok' ? 'ok' : 'check';
  const summary = level === 'ok' ? `Чек сходится: ${money(order.total)}, ${ctx.recipient.label.split(',')[0]}, ${date.text}`
    : level === 'bad' ? `Не сходится: ${problems.join('; ')}`
      : `Сверьте вручную: ${notes.join(', ')}`;
  return { level, summary, problems, notes, fields: { amount, recipient, date, status, txn } };
}
