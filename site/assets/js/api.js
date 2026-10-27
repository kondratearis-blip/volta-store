// Слой данных заказов поверх Supabase (таблицы и функция — supabase/orders.sql).
import { config } from './config.js';
import { createClient } from './supabase-lite.js';

const db = createClient(config.supabaseUrl, config.supabaseKey);

const SETTINGS_FIELDS = 'accepting_orders,closed_message,combo_price,delivery_fee,whatsapp_template';

export const api = {
  async settings() {
    const [row] = await db.select('order_settings', `select=${SETTINGS_FIELDS}&id=eq.1`);
    return row || null;
  },
  /** Возвращает { number, total }. Цену и сумму считает база. */
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
      p_payment: order.payment,
      p_comment: order.comment,
    });
  },

  auth: {
    get signedIn() { return Boolean(db.session); },
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
  },
};
