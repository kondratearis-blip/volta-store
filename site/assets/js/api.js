// Слой данных заказов поверх Supabase (таблицы, функции и хранилище — supabase/orders.sql).
import { config } from './config.js';
import { createClient } from './supabase-lite.js';

const db = createClient(config.supabaseUrl, config.supabaseKey);

const SETTINGS_FIELDS = 'accepting_orders,closed_message,combo_price,delivery_fee,whatsapp_template,qr_url,payment_note';

function fileId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };

export const api = {
  async settings() {
    const [row] = await db.select('order_settings', `select=${SETTINGS_FIELDS}&id=eq.1`);
    return row || null;
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
  /** Загружает чек в папку заказа и отмечает заказ оплаченным */
  async sendReceipt(token, blob) {
    const ext = EXT[blob.type];
    if (!ext) throw new Error('Прикрепите фото, скриншот или PDF');
    const path = `${token}/${fileId()}.${ext}`;
    await db.storage.upload('receipts', path, blob);
    return db.rpc('attach_receipt', { p_token: token, p_path: path });
  },
  cancelUnpaid(token) {
    return db.rpc('cancel_unpaid_order', { p_token: token });
  },

  auth: {
    user: () => db.auth.user(),
    signIn: (email, password) => db.auth.signIn(email, password),
    signOut: () => db.auth.signOut(),
    async isAdmin() {
      if (!db.session) return false;
      try { return (await db.rpc('is_admin')) === true; } catch { return false; }
    },
  },

  admin: {
    /** Заказы за сутки по Бишкеку (UTC+6); day — 'YYYY-MM-DD' */
    listOrders(day) {
      const from = new Date(`${day}T00:00:00+06:00`);
      const to = new Date(from.getTime() + 24 * 3600_000);
      return db.select('orders', `select=*&created_at=gte.${encodeURIComponent(from.toISOString())}&created_at=lt.${encodeURIComponent(to.toISOString())}&order=created_at.desc&limit=1000`);
    },
    async updateOrder(id, patch) {
      const [row] = await db.update('orders', `id=eq.${Number(id)}`, { ...patch, updated_at: new Date().toISOString() });
      return row;
    },
    async saveSettings(patch) {
      const [row] = await db.update('order_settings', 'id=eq.1', { ...patch, updated_at: new Date().toISOString() });
      if (!row) throw new Error('Нет прав на изменение настроек');
      return row;
    },
    /** Чек из закрытого хранилища — ссылка на blob для просмотра в браузере */
    async receiptUrl(path) {
      return URL.createObjectURL(await db.storage.download('receipts', path));
    },
    /** Загружает новый QR-код и возвращает его публичную ссылку */
    async uploadQr(blob) {
      const path = `qr-${fileId()}.${EXT[blob.type] || 'png'}`;
      await db.storage.upload('payment', path, blob);
      return db.storage.publicUrl('payment', path);
    },
  },
};
