// Касса: чеки и выручка. Чистые функции без DOM и сети — их же проверяет scripts/check-admin.mjs.
import { UNPAID_STATUSES, branchName } from './data.js';

export const bishkekDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek' }).format(new Date(iso));
const paidTime = (o) => Date.parse(o.paid_at || o.created_at);

// Путь, который пишет сайт: <токен заказа>/<id файла>.<расширение>. Иное (../, чужие расширения) не открываем
export const RECEIPT_PATH = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(jpe?g|png|webp|heic|pdf)$/i;

/** Статус после оплаты: всё, кроме «Ждёт оплаты» и «Отменён» */
export const isPaidStatus = (o) => !UNPAID_STATUSES.includes(o.status);
/** В выручку — оплаченный по статусу заказ с приложенным чеком (с нормальным путём файла) */
export const inRevenue = (o) => isPaidStatus(o) && Boolean(o.receipt_path) && RECEIPT_PATH.test(o.receipt_path);
/** День кассы — день оплаты, как в выписке банка; у неоплаченных — день заказа */
export const cashDay = (o) => bishkekDay(o.paid_at || o.created_at);

/** Настоящий тип чека — по первым байтам файла, а не по имени и не по заголовку, который задал покупатель */
export function sniffReceipt(bytes) {
  const at = (i, text) => [...text].every((c, k) => bytes[i + k] === c.charCodeAt(0));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (bytes[0] === 0x89 && at(1, 'PNG')) return { ext: 'png', type: 'image/png' };
  if (at(0, '%PDF')) return { ext: 'pdf', type: 'application/pdf' };
  if (at(0, 'RIFF') && at(8, 'WEBP')) return { ext: 'webp', type: 'image/webp' };
  if (at(4, 'ftyp') && ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].some((brand) => at(8, brand))) return { ext: 'heic', type: 'image/heic' };
  return null;
}

// Номер заказа на день (supabase/day-numbers.sql): даёт база, когда заказ оплачен или взят в работу.
// У неоплаченного номера нет; внутренний id покупателю и менеджеру не показываем
const shortDate = (day) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

// С 09.11.2026 номера за день у каждой точки свои (specs/013): у владельца заказы двух точек смешаны, и «№ 5» есть
// у обеих — тогда к номеру дописываем точку. Менеджер точки видит только свои номера, ему точка в номере не нужна
let pointInNumbers = false;
/** Панель владельца: «№ 5 · Кулиева» вместо «№ 5» — в кассе, именах файлов, плашке ожидания и подписях повторов чеков */
export const showBranchInNumbers = (on) => { pointInNumbers = Boolean(on); };
const pointTag = (o, on) => (on && o.branch ? ` · ${branchName(o.branch)}` : '');

/** «№ 5»; заказ оформлен не в день `day` (касса считает по дню оплаты) — «№ 38 от 31.10»; withPoint: false — без точки */
export function orderNo(o, day = bishkekDay(o.created_at), withPoint = true) {
  if (!o.day_number) return 'без №';
  const created = bishkekDay(o.created_at);
  return (created === day ? `№ ${o.day_number}` : `№ ${o.day_number} от ${shortDate(created)}`) + pointTag(o, withPoint && pointInNumbers);
}
/** «№ 5 от 31.10» — всегда с датой: для сообщений о повторах чеков из других дней */
export const orderNoDated = (o) => (o.day_number ? `№ ${o.day_number} от ${shortDate(bishkekDay(o.created_at))}${pointTag(o, pointInNumbers)}` : null);

/**
 * «2026-10-31_чек-01_заказ-2.jpg» (номер на день, из другого дня — «заказ-38-от-31.10», у владельца — «заказ-2-Кулиева»);
 * чеки вне выручки помечены в имени
 */
export function receiptFileName(r, ext) {
  const mark = r.inRevenue ? '' : r.status === 'canceled' ? '_отменён' : isPaidStatus(r) ? '' : '_не-оплачен';
  const num = orderNo(r, r.day).replace('без №', 'без-номера').replace('№ ', '').replace(' от ', '-от-').replace(' · ', '-');
  return `${r.day}_чек-${String(r.n).padStart(2, '0')}_заказ-${num}${mark}.${ext}`;
}

/**
 * Дни кассы, начинающиеся с prefix ('2026-10' — месяц, '2026-10-31' — день), новые сверху.
 * У дня: выручка (и доставка в ней), чеки по порядку оплаты, оплаченные без чека.
 */
export function cashDays(orders, prefix) {
  const days = new Map();
  for (const o of orders) {
    const day = cashDay(o);
    if (!day.startsWith(prefix)) continue;
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(o);
  }
  return [...days].sort(([a], [b]) => b.localeCompare(a)).map(([day, list]) => {
    const counted = list.filter(inRevenue);
    return {
      day,
      revenue: counted.reduce((sum, o) => sum + (o.total || 0), 0),
      delivery: counted.reduce((sum, o) => sum + (o.delivery_fee || 0), 0),
      counted: counted.length,
      receipts: list.filter((o) => o.receipt_path)
        .sort((a, b) => paidTime(a) - paidTime(b) || a.id - b.id)
        .map((o, i) => ({ ...o, day, n: i + 1, inRevenue: inRevenue(o), safePath: RECEIPT_PATH.test(o.receipt_path) })),
      noReceipt: list.filter((o) => isPaidStatus(o) && !o.receipt_path),
    };
  });
}

/** Итог по дням: { revenue, delivery, counted, receipts } */
export function cashTotal(days) {
  return days.reduce((t, d) => ({
    revenue: t.revenue + d.revenue,
    delivery: t.delivery + d.delivery,
    counted: t.counted + d.counted,
    receipts: t.receipts + d.receipts.length,
    noReceipt: t.noReceipt + d.noReceipt.length,
  }), { revenue: 0, delivery: 0, counted: 0, receipts: 0, noReceipt: 0 });
}

/** Таблица для архива: открывается в Excel (UTF-8 с BOM, разделитель «;»); withPoint — колонка «Точка» после «Заказ» */
export function receiptsCsv(rows, withPoint = false) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // не даём Excel принять имя за формулу
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Дата', 'Чек', 'Заказ', ...(withPoint ? ['Точка'] : []), 'Имя', 'Сумма, сом', 'Статус', 'В выручке', 'Файл'];
  return '﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}
