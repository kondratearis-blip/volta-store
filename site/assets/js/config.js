// Подключение к базе. Пусто — сайт работает в демо-режиме (данные хранятся в браузере).
// Заполняется страницей http://localhost:5180/setup (scripts/serve.mjs) или вручную.
// Оба значения публичные по природе: доступ ограничивают правила RLS в supabase/schema.sql.
// Секретный ключ (service_role / sb_secret_…) сюда класть нельзя.
export const config = {
  supabaseUrl: 'https://sbqkzfytezlunhukfdzz.supabase.co',
  supabaseKey: 'sb_publishable_aVLj-7ImA2HpFrMMMQWYPA_9A7xqTw0',
};
