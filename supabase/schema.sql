-- KOKORO — полный снимок схемы базы Supabase (проект sbqkzfytezlunhukfdzz) на 2026-11-21.
-- Снят с рабочей базы: таблицы, ограничения, индексы, все функции (RPC), триггеры, правила доступа (RLS),
-- права, хранилища файлов (buckets) и их правила. ДАННЫХ (заказов, курьеров, админов, переписки) здесь нет.
--
-- Для чего: восстановить базу в НОВОМ, пустом проекте Supabase (SQL Editor → вставить файл целиком → Run),
-- затем поменять адрес и ключ в site/assets/js/config.js.
-- НЕ запускать на рабочей базе: там всё это уже есть.
--
-- Изменить одну функцию на рабочей базе: найти её здесь (create or replace function public.<имя>),
-- поправить и выполнить только этот блок в SQL Editor.
-- Postgres 17.11.

set check_function_bodies = off;

-- ============ Расширения ============
create extension if not exists pg_stat_statements with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists "uuid-ossp" with schema extensions;

-- ============ Таблицы ============
create table if not exists public.admins (
  user_id uuid not null,
  created_at timestamp with time zone default now() not null,
  branch text default 'kulieva'::text
);
do $c$ begin alter table public.admins add constraint admins_pkey PRIMARY KEY (user_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.admins add constraint admins_branch_check CHECK ((branch = ANY (ARRAY['kulieva'::text, 'kokzhar'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.branch_settings (
  branch text not null,
  accepting_orders boolean default true not null,
  wait_minutes integer default 90 not null,
  updated_at timestamp with time zone default now() not null,
  courier_limit integer default 3 not null,
  rain boolean default false not null,
  rain_by text,
  rain_set_at timestamp with time zone,
  weather jsonb,
  dispatch text default 'manual'::text not null
);
do $c$ begin alter table public.branch_settings add constraint branch_settings_pkey PRIMARY KEY (branch); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.branch_settings add constraint branch_settings_branch_check CHECK ((branch = ANY (ARRAY['kulieva'::text, 'kokzhar'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.branch_settings add constraint branch_settings_courier_limit_check CHECK (((courier_limit >= 1) AND (courier_limit <= 6))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.branch_settings add constraint branch_settings_dispatch_check CHECK ((dispatch = ANY (ARRAY['manual'::text, 'auto'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.branch_settings add constraint branch_settings_rain_by_check CHECK (((rain_by IS NULL) OR (rain_by = ANY (ARRAY['auto'::text, 'manager'::text])))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.branch_settings add constraint branch_settings_wait_minutes_check CHECK (((wait_minutes >= 15) AND (wait_minutes <= 480))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.courier_declines (
  order_id bigint not null,
  courier_id bigint not null,
  at timestamp with time zone not null
);
do $c$ begin alter table public.courier_declines add constraint courier_declines_pkey PRIMARY KEY (order_id, courier_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.courier_locations (
  courier_id bigint not null,
  lat double precision not null,
  lon double precision not null,
  accuracy real,
  live_until timestamp with time zone,
  at timestamp with time zone not null
);
do $c$ begin alter table public.courier_locations add constraint courier_locations_pkey PRIMARY KEY (courier_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.courier_locations add constraint courier_locations_lat_check CHECK (((lat >= ('-90'::integer)::double precision) AND (lat <= (90)::double precision))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.courier_locations add constraint courier_locations_lon_check CHECK (((lon >= ('-180'::integer)::double precision) AND (lon <= (180)::double precision))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.courier_login_tries (
  ip text not null,
  at timestamp with time zone default now() not null,
  ok boolean not null
);

create table if not exists public.courier_messages (
  id bigint generated always as identity not null,
  courier_id bigint not null,
  author text not null,
  admin_branch text,
  admin_id uuid,
  body text not null,
  created_at timestamp with time zone default now() not null
);
do $c$ begin alter table public.courier_messages add constraint courier_messages_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.courier_messages add constraint courier_messages_author_check CHECK ((author = ANY (ARRAY['courier'::text, 'manager'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.courier_messages add constraint courier_messages_body_check CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 500))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.couriers (
  id bigint generated always as identity not null,
  name text not null,
  key_hash text not null,
  active boolean default true not null,
  tg_chat_id bigint,
  tg_link_code text,
  tg_link_until timestamp with time zone,
  shift_off_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  branch text,
  seen_at timestamp with time zone,
  shift_on_at timestamp with time zone,
  last_assigned_at timestamp with time zone,
  pin_hash text,
  pin_until timestamp with time zone,
  deleted_at timestamp with time zone,
  branch_set_at timestamp with time zone,
  phone text,
  phone_at timestamp with time zone
);
do $c$ begin alter table public.couriers add constraint couriers_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.couriers add constraint couriers_key_hash_key UNIQUE (key_hash); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.couriers add constraint couriers_tg_chat_id_key UNIQUE (tg_chat_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.couriers add constraint couriers_tg_link_code_key UNIQUE (tg_link_code); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.couriers add constraint couriers_branch_check CHECK ((branch = ANY (ARRAY['kulieva'::text, 'kokzhar'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.couriers add constraint couriers_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 40))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.couriers add constraint couriers_phone_check CHECK (((phone IS NULL) OR (phone ~ '^\+[1-9][0-9]{9,14}$'::text))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.draws (
  id uuid default gen_random_uuid() not null,
  contest text default 'challenge'::text not null,
  created_at timestamp with time zone default now() not null,
  pool_size integer not null,
  pool_hash text default ''::text not null,
  winners jsonb not null
);
do $c$ begin alter table public.draws add constraint draws_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.draws add constraint draws_pool_size_check CHECK ((pool_size >= 0)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.gallery (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  author_name text not null,
  instagram text,
  caption text,
  image_bucket text default 'gallery-inbox'::text not null,
  image_path text not null,
  width integer,
  height integer,
  status text default 'pending'::text not null,
  winner_week text
);
do $c$ begin alter table public.gallery add constraint gallery_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.gallery add constraint gallery_author_name_check CHECK (((char_length(author_name) >= 1) AND (char_length(author_name) <= 40))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.gallery add constraint gallery_caption_check CHECK (((caption IS NULL) OR (char_length(caption) <= 120))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.gallery add constraint gallery_height_check CHECK (((height >= 1) AND (height <= 4000))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.gallery add constraint gallery_image_bucket_check CHECK ((image_bucket = ANY (ARRAY['gallery-inbox'::text, 'gallery'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.gallery add constraint gallery_image_path_check CHECK ((image_path ~ '^[0-9a-f-]{36}\.jpg$'::text)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.gallery add constraint gallery_instagram_check CHECK (((instagram IS NULL) OR (instagram ~ '^[A-Za-z0-9._]{0,30}$'::text))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.gallery add constraint gallery_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'hidden'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.gallery add constraint gallery_width_check CHECK (((width >= 1) AND (width <= 4000))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.kitchen_keys (
  id bigint generated always as identity not null,
  name text not null,
  key_hash text not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null
);
do $c$ begin alter table public.kitchen_keys add constraint kitchen_keys_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.kitchen_keys add constraint kitchen_keys_key_hash_key UNIQUE (key_hash); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.kitchen_keys add constraint kitchen_keys_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 40))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.kitchen_products (
  id bigint generated always as identity not null,
  category text not null,
  name text not null,
  pack text default ''::text not null,
  price numeric(12,2),
  note text default ''::text not null,
  sort integer default 0 not null,
  archived_at timestamp with time zone,
  price_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
do $c$ begin alter table public.kitchen_products add constraint kitchen_products_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.kitchen_products add constraint kitchen_products_category_check CHECK (((length(btrim(category)) >= 1) AND (length(btrim(category)) <= 40))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.kitchen_products add constraint kitchen_products_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 80))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.kitchen_products add constraint kitchen_products_note_check CHECK ((length(note) <= 200)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.kitchen_products add constraint kitchen_products_pack_check CHECK ((length(pack) <= 40)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.kitchen_products add constraint kitchen_products_price_check CHECK (((price >= (0)::numeric) AND (price < (100000000)::numeric))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.kokoro_branch_day_counter (
  day date not null,
  branch text not null,
  last integer not null
);
do $c$ begin alter table public.kokoro_branch_day_counter add constraint kokoro_branch_day_counter_pkey PRIMARY KEY (day, branch); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.kokoro_day_counter (
  day date not null,
  last integer not null
);
do $c$ begin alter table public.kokoro_day_counter add constraint kokoro_day_counter_pkey PRIMARY KEY (day); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.kokoro_dispatch_state (
  id integer default 1 not null,
  ran_at timestamp with time zone
);
do $c$ begin alter table public.kokoro_dispatch_state add constraint kokoro_dispatch_state_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.kokoro_dispatch_state add constraint kokoro_dispatch_state_id_check CHECK ((id = 1)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.kokoro_private (
  key text not null,
  value text not null
);
do $c$ begin alter table public.kokoro_private add constraint kokoro_private_pkey PRIMARY KEY (key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.kokoro_rate (
  ip text not null,
  at timestamp with time zone default now() not null
);

create table if not exists public.order_messages (
  id bigint generated always as identity not null,
  order_id bigint not null,
  author text not null,
  courier_id bigint,
  body text not null,
  created_at timestamp with time zone default now() not null
);
do $c$ begin alter table public.order_messages add constraint order_messages_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.order_messages add constraint order_messages_author_check CHECK ((author = ANY (ARRAY['client'::text, 'courier'::text, 'manager'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.order_messages add constraint order_messages_body_check CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 500))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.order_settings (
  id integer default 1 not null,
  accepting_orders boolean default true not null,
  closed_message text default 'Сейчас мы не принимаем заказы. Загляните позже!'::text not null,
  combo_price integer default 1400 not null,
  delivery_fee integer default 0 not null,
  whatsapp_template text default (((('Здравствуйте, {name}! Это KOKORO. Ваш заказ №{number} оплачен и принят: комбо × {qty}, {total} сом.'::text || chr(10)) || 'Адрес: {address}'::text) || chr(10)) || 'Подтвердите, пожалуйста, адрес и время доставки.'::text) not null,
  updated_at timestamp with time zone default now() not null,
  qr_url text default ''::text not null,
  payment_note text default 'Отсканируйте QR-код в приложении банка и оплатите точную сумму. Затем прикрепите чек — скриншот или фото.'::text not null,
  wait_minutes integer default 90 not null
);
do $c$ begin alter table public.order_settings add constraint order_settings_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.order_settings add constraint order_settings_combo_price_check CHECK ((combo_price > 0)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.order_settings add constraint order_settings_delivery_fee_check CHECK ((delivery_fee >= 0)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.order_settings add constraint order_settings_id_check CHECK ((id = 1)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.order_settings add constraint order_settings_wait_minutes_check CHECK (((wait_minutes >= 15) AND (wait_minutes <= 480))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.orders (
  id bigint generated always as identity not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone,
  status text default 'awaiting_payment'::text not null,
  qty integer not null,
  unit_price integer not null,
  delivery_fee integer not null,
  total integer not null,
  name text not null,
  phone text not null,
  address text not null,
  entrance text default ''::text not null,
  floor text default ''::text not null,
  apartment text default ''::text not null,
  delivery_time text default ''::text not null,
  payment text default 'qr'::text not null,
  comment text default ''::text not null,
  manager_note text default ''::text not null,
  pay_token uuid default gen_random_uuid() not null,
  receipt_path text,
  paid_at timestamp with time zone,
  day_number integer,
  courier_id bigint,
  track_code text,
  lat double precision,
  lon double precision,
  delivery_quote jsonb,
  branch text,
  branch_guessed boolean default false not null,
  delivering_at timestamp with time zone,
  dispatched_at timestamp with time zone,
  fulfillment text default 'delivery'::text not null,
  door boolean default false not null,
  wait_minutes integer,
  ready_at timestamp with time zone,
  done_at timestamp with time zone,
  rating smallint,
  courier_rating smallint,
  rating_comment text,
  rated_at timestamp with time zone,
  consent_at timestamp with time zone
);
do $c$ begin alter table public.orders add constraint orders_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.orders add constraint orders_track_code_key UNIQUE (track_code); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.orders add constraint orders_branch_check CHECK ((branch = ANY (ARRAY['kulieva'::text, 'kokzhar'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.orders add constraint orders_fulfillment_check CHECK ((fulfillment = ANY (ARRAY['delivery'::text, 'pickup'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.orders add constraint orders_payment_check CHECK ((payment = ANY (ARRAY['qr'::text, 'cash'::text, 'transfer'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.orders add constraint orders_qty_check CHECK (((qty >= 1) AND (qty <= 20))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.orders add constraint orders_rating_check CHECK ((((rating >= 1) AND (rating <= 5)) AND ((courier_rating IS NULL) OR ((courier_rating >= 1) AND (courier_rating <= 5))) AND ((rating_comment IS NULL) OR (char_length(rating_comment) <= 500)))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.orders add constraint orders_status_check CHECK ((status = ANY (ARRAY['awaiting_payment'::text, 'new'::text, 'confirmed'::text, 'cooking'::text, 'delivering'::text, 'done'::text, 'canceled'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.orders add constraint orders_wait_minutes_check CHECK (((wait_minutes >= 15) AND (wait_minutes <= 480))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.participants (
  id uuid default gen_random_uuid() not null,
  contest text default 'challenge'::text not null,
  ig_comment_id text not null,
  username text not null,
  text text default ''::text not null,
  mention text,
  commented_at timestamp with time zone default now() not null,
  source text default 'instagram'::text not null,
  excluded boolean default false not null,
  created_at timestamp with time zone default now() not null
);
do $c$ begin alter table public.participants add constraint participants_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.participants add constraint participants_ig_comment_id_key UNIQUE (ig_comment_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.participants add constraint participants_text_check CHECK ((char_length(text) <= 2200)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.participants add constraint participants_username_check CHECK (((char_length(username) >= 1) AND (char_length(username) <= 30))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

create table if not exists public.scores (
  id bigint generated always as identity not null,
  created_at timestamp with time zone default now() not null,
  name text not null,
  score integer not null
);
do $c$ begin alter table public.scores add constraint scores_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.scores add constraint scores_name_check CHECK (((char_length(name) >= 2) AND (char_length(name) <= 16))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.scores add constraint scores_score_check CHECK (((score >= 0) AND (score <= 1000000))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;


-- ============ Связи между таблицами ============
do $c$ begin alter table public.admins add constraint admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.courier_declines add constraint courier_declines_courier_id_fkey FOREIGN KEY (courier_id) REFERENCES couriers(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.courier_declines add constraint courier_declines_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.courier_locations add constraint courier_locations_courier_id_fkey FOREIGN KEY (courier_id) REFERENCES couriers(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.courier_messages add constraint courier_messages_courier_id_fkey FOREIGN KEY (courier_id) REFERENCES couriers(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.order_messages add constraint order_messages_courier_id_fkey FOREIGN KEY (courier_id) REFERENCES couriers(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.order_messages add constraint order_messages_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;
do $c$ begin alter table public.orders add constraint orders_courier_id_fkey FOREIGN KEY (courier_id) REFERENCES couriers(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $c$;

-- ============ Индексы ============
CREATE INDEX IF NOT EXISTS courier_login_tries_fail_idx ON public.courier_login_tries USING btree (at) WHERE (NOT ok);
CREATE INDEX IF NOT EXISTS courier_login_tries_ip_idx ON public.courier_login_tries USING btree (ip, at);
CREATE INDEX IF NOT EXISTS courier_messages_courier_idx ON public.courier_messages USING btree (courier_id, id);
CREATE INDEX IF NOT EXISTS courier_messages_created_idx ON public.courier_messages USING btree (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS couriers_pin_hash_uniq ON public.couriers USING btree (pin_hash) WHERE (pin_hash IS NOT NULL);
CREATE INDEX IF NOT EXISTS kokoro_rate_ip_at ON public.kokoro_rate USING btree (ip, at);
CREATE INDEX IF NOT EXISTS order_messages_courier_idx ON public.order_messages USING btree (courier_id);
CREATE INDEX IF NOT EXISTS order_messages_created_idx ON public.order_messages USING btree (created_at);
CREATE INDEX IF NOT EXISTS order_messages_order_idx ON public.order_messages USING btree (order_id, id);
CREATE INDEX IF NOT EXISTS orders_branch_created_idx ON public.orders USING btree (branch, created_at);
CREATE INDEX IF NOT EXISTS orders_courier_id_idx ON public.orders USING btree (courier_id) WHERE (courier_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS orders_courier_open_idx ON public.orders USING btree (courier_id) WHERE (status = ANY (ARRAY['new'::text, 'confirmed'::text, 'cooking'::text, 'delivering'::text]));
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON public.orders USING btree (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS orders_day_number_branch_uniq ON public.orders USING btree ((((created_at AT TIME ZONE 'Asia/Bishkek'::text))::date), COALESCE(branch, ''::text), day_number) WHERE (day_number IS NOT NULL);
CREATE INDEX IF NOT EXISTS orders_dispatched_open_idx ON public.orders USING btree (courier_id) WHERE ((dispatched_at IS NOT NULL) AND (status = ANY (ARRAY['confirmed'::text, 'cooking'::text])));
CREATE INDEX IF NOT EXISTS orders_free_idx ON public.orders USING btree (branch) WHERE ((courier_id IS NULL) AND (status = ANY (ARRAY['confirmed'::text, 'cooking'::text])));
CREATE INDEX IF NOT EXISTS orders_paid_at_idx ON public.orders USING btree (paid_at);
CREATE UNIQUE INDEX IF NOT EXISTS orders_pay_token_idx ON public.orders USING btree (pay_token);
CREATE INDEX IF NOT EXISTS orders_pay_token_text_idx ON public.orders USING btree (((pay_token)::text));
CREATE INDEX IF NOT EXISTS scores_week_idx ON public.scores USING btree (created_at, score DESC);

-- ============ Функции ============
-- admin_chat(p_order_id bigint, p_after bigint)
CREATE OR REPLACE FUNCTION public.admin_chat(p_order_id bigint, p_after bigint DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.orders;
begin
  perform public.kokoro_need_admin();
  select * into o from public.orders x where x.id = p_order_id;
  if not found or not public.kokoro_can_see_order(o.branch) then raise exception 'Заказ не найден или передан другой точке'; end if;
  return json_build_object('open', true, 'can_write', true, 'messages', public.kokoro_chat_messages(o.id, p_after, true));
end $function$;

-- admin_chat_send(p_order_id bigint, p_body text)
CREATE OR REPLACE FUNCTION public.admin_chat_send(p_order_id bigint, p_body text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_branch text;
begin
  perform public.kokoro_need_admin();
  select x.branch into v_branch from public.orders x where x.id = p_order_id;
  if not found or not public.kokoro_can_see_order(v_branch) then raise exception 'Заказ не найден или передан другой точке'; end if;
  return public.kokoro_chat_add(p_order_id, 'manager', null, p_body, 60);
end $function$;

-- admin_chat_summary(p_since timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_chat_summary(p_since timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.kokoro_need_admin();
  return public.kokoro_chat_summary(array(select distinct m.order_id from public.order_messages m join public.orders o on o.id = m.order_id
    where m.created_at > greatest(coalesce(p_since, now() - interval '2 days'), now() - interval '2 days') and public.kokoro_can_see_order(o.branch)));
end $function$;

-- admin_courier_add(p_name text)
CREATE OR REPLACE FUNCTION public.admin_courier_add(p_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text := public.kokoro_code(12);
  v_branch text;
  v_id bigint;
begin
  perform public.kokoro_need_admin();
  if length(btrim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'Имя курьера — от 1 до 40 знаков'; end if;
  v_branch := public.kokoro_admin_branch();
  insert into public.couriers (name, key_hash, branch) values (btrim(p_name), public.kokoro_key_hash(v_code), v_branch) returning id into v_id;
  return json_build_object('id', v_id, 'name', btrim(p_name), 'code', public.kokoro_code_label(v_code), 'branch', v_branch);
end $function$;

-- admin_courier_chat(p_id bigint, p_after bigint)
CREATE OR REPLACE FUNCTION public.admin_courier_chat(p_id bigint, p_after bigint DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.kokoro_need_courier_access(p_id);
  if exists (select 1 from public.couriers c where c.id = p_id and c.deleted_at is not null) then raise exception 'Курьер удалён'; end if;
  return json_build_object('open', true, 'can_write', true, 'messages', public.kokoro_staff_messages(p_id, p_after, auth.uid()));
end $function$;

-- admin_courier_chat_send(p_id bigint, p_body text)
CREATE OR REPLACE FUNCTION public.admin_courier_chat_send(p_id bigint, p_body text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.kokoro_need_courier_access(p_id);
  if exists (select 1 from public.couriers c where c.id = p_id and c.deleted_at is not null) then raise exception 'Курьер удалён'; end if;
  return public.kokoro_staff_add(p_id, 'manager', p_body, 60);
end $function$;

-- admin_courier_contacts()
CREATE OR REPLACE FUNCTION public.admin_courier_contacts()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_mine text;
begin
  perform public.kokoro_need_admin();
  v_mine := public.kokoro_admin_branch();
  return coalesce((select json_agg(json_build_object('id', c.id, 'phone', c.phone, 'chat', public.kokoro_staff_summary(c.id)) order by c.id)
    from public.couriers c where c.deleted_at is null and (v_mine is null or c.branch is null or c.branch = v_mine)), '[]'::json);
end $function$;

-- admin_courier_delete(p_id bigint)
CREATE OR REPLACE FUNCTION public.admin_courier_delete(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_found bigint;
begin
  perform public.kokoro_need_courier_access(p_id);
  update public.couriers set deleted_at = coalesce(deleted_at, now()), active = false, pin_hash = null, pin_until = null,
    key_hash = public.kokoro_key_hash(public.kokoro_code(12)), tg_chat_id = null, tg_link_code = null, tg_link_until = null
  where id = p_id returning id into v_found;
  if v_found is null then raise exception 'Курьер не найден'; end if;
  delete from public.courier_locations where courier_id = p_id;
  update public.orders set courier_id = null, status = case when status = 'delivering' then 'cooking' else status end
  where courier_id = p_id and status in ('new', 'confirmed', 'cooking', 'delivering');
  return json_build_object('id', p_id);
end $function$;

-- admin_courier_pin(p_id bigint)
CREATE OR REPLACE FUNCTION public.admin_courier_pin(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pin text;
  v_name text;
  v_bytes bytea;
  v_try integer := 0;
begin
  perform public.kokoro_need_courier_access(p_id);
  if exists (select 1 from public.couriers c where c.id = p_id and c.deleted_at is not null) then raise exception 'Курьер удалён'; end if;
  loop
    v_try := v_try + 1;
    v_bytes := extensions.gen_random_bytes(4);
    v_pin := lpad((((get_byte(v_bytes, 0)::bigint << 24) | (get_byte(v_bytes, 1) << 16) | (get_byte(v_bytes, 2) << 8)
                    | get_byte(v_bytes, 3)) % 1000000)::text, 6, '0');
    exit when not exists (select 1 from public.couriers c where c.pin_hash = public.kokoro_key_hash('PIN' || v_pin) and c.id <> p_id);
    if v_try >= 30 then raise exception 'Не получилось придумать код — попробуйте ещё раз'; end if;
  end loop;
  update public.couriers set pin_hash = public.kokoro_key_hash('PIN' || v_pin), pin_until = now() + interval '72 hours'
  where id = p_id returning name into v_name;
  return json_build_object('id', p_id, 'name', v_name, 'pin', v_pin);
end $function$;

-- admin_courier_reset(p_id bigint)
CREATE OR REPLACE FUNCTION public.admin_courier_reset(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text := public.kokoro_code(12);
  v_name text;
begin
  perform public.kokoro_need_courier_access(p_id);
  update public.couriers set key_hash = public.kokoro_key_hash(v_code), tg_chat_id = null, tg_link_code = null, tg_link_until = null
  where id = p_id returning name into v_name;
  if v_name is null then raise exception 'Курьер не найден'; end if;
  delete from public.courier_locations where courier_id = p_id;
  return json_build_object('id', p_id, 'name', v_name, 'code', public.kokoro_code_label(v_code));
end $function$;

-- admin_courier_set_branch(p_id bigint, p_branch text)
CREATE OR REPLACE FUNCTION public.admin_courier_set_branch(p_id bigint, p_branch text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_found bigint;
begin
  perform public.kokoro_need_admin();
  if not public.kokoro_is_owner() then raise exception 'Точку курьера меняет только владелец' using errcode = '42501'; end if;
  if p_branch is not null and p_branch not in ('kulieva', 'kokzhar') then raise exception 'Нет такой точки'; end if;
  update public.couriers set branch = p_branch where id = p_id returning id into v_found;
  if v_found is null then raise exception 'Курьер не найден'; end if;
  return json_build_object('id', p_id, 'branch', p_branch);
end $function$;

-- admin_courier_update(p_id bigint, p_name text, p_active boolean)
CREATE OR REPLACE FUNCTION public.admin_courier_update(p_id bigint, p_name text DEFAULT NULL::text, p_active boolean DEFAULT NULL::boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_found bigint;
begin
  perform public.kokoro_need_courier_access(p_id);
  if p_name is not null and length(btrim(p_name)) not between 1 and 40 then raise exception 'Имя курьера — от 1 до 40 знаков'; end if;
  update public.couriers set name = coalesce(btrim(p_name), name), active = coalesce(p_active, active)
  where id = p_id and deleted_at is null returning id into v_found;
  if v_found is null then raise exception 'Курьер не найден или удалён'; end if;
  if p_active is false then
    delete from public.courier_locations where courier_id = p_id;
    update public.orders set courier_id = null, status = case when status = 'delivering' then 'cooking' else status end
    where courier_id = p_id and status in ('new', 'confirmed', 'cooking', 'delivering');
  end if;
  return json_build_object('id', p_id);
end $function$;

-- admin_couriers()
CREATE OR REPLACE FUNCTION public.admin_couriers()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_mine text;
begin
  perform public.kokoro_need_admin();
  v_mine := public.kokoro_admin_branch();
  return coalesce((select json_agg(json_build_object(
      'id', c.id, 'name', c.name, 'active', c.active, 'tg_linked', c.tg_chat_id is not null, 'branch', c.branch,
      'on_shift', public.kokoro_courier_on_shift(c), 'seen_at', c.seen_at, 'has_pin', c.pin_hash is not null and c.pin_until > now(),
      'location', (select json_build_object('lat', l.lat, 'lon', l.lon, 'accuracy', l.accuracy, 'at', l.at, 'live_until', l.live_until)
                   from public.courier_locations l where l.courier_id = c.id),
      'orders', (select count(*) from public.orders o where o.courier_id = c.id and o.status in ('new', 'confirmed', 'cooking', 'delivering')),
      'road', (select count(*) from public.orders o where o.courier_id = c.id and o.status = 'delivering'),
      'today', (select count(*) from public.orders o where o.courier_id = c.id and o.status = 'done'
                and o.done_at >= public.kokoro_workday_start()))
    order by c.active desc, c.name)
    from public.couriers c where c.deleted_at is null and (v_mine is null or c.branch is null or c.branch = v_mine)), '[]'::json);
end $function$;

-- admin_me()
CREATE OR REPLACE FUNCTION public.admin_me()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select json_build_object('branch', a.branch, 'owner', a.branch is null, 'email', u.email)
  from public.admins a join auth.users u on u.id = a.user_id
  where a.user_id = auth.uid()
$function$;

-- admin_order_ready(p_id bigint, p_ready boolean)
CREATE OR REPLACE FUNCTION public.admin_order_ready(p_id bigint, p_ready boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.orders;
begin
  perform public.kokoro_need_admin();
  select * into o from public.orders x where x.id = p_id for update;
  if not found or not public.kokoro_can_see_order(o.branch) then raise exception 'Заказ не найден или передан другой точке'; end if;
  if o.status not in ('confirmed', 'cooking') then raise exception 'Заказ уже уехал или закрыт — список обновлён'; end if;
  update public.orders set ready_at = case when p_ready then coalesce(o.ready_at, public.kokoro_now()) end,
    status = case when p_ready and o.status = 'confirmed' then 'cooking' else o.status end
  where id = p_id returning * into o;
  return json_build_object('id', o.id, 'status', o.status, 'ready_at', o.ready_at);
end $function$;

-- admin_report(p_from date, p_to date)
CREATE OR REPLACE FUNCTION public.admin_report(p_from date, p_to date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mine text;
  v_from timestamptz;
  v_to timestamptz;
begin
  perform public.kokoro_need_admin();
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Выберите период'; end if;
  if p_to - p_from > 62 then raise exception 'Период — не больше двух месяцев'; end if;
  v_mine := public.kokoro_admin_branch();
  v_from := (p_from::timestamp - interval '6 hours') at time zone 'UTC';
  v_to := ((p_to + 1)::timestamp - interval '6 hours') at time zone 'UTC';
  return (
    with base as (
      select o.id, o.day_number, o.branch, o.status, o.total, o.fulfillment, o.courier_id, o.rating, o.courier_rating,
             (o.status not in ('awaiting_payment', 'canceled') and o.receipt_path is not null) as counted,
             case when o.status = 'done' then coalesce(o.done_at, o.updated_at) end as fin,
             public.kokoro_promise_at(o) as promise,
             public.kokoro_order_due(o.paid_at, o.delivery_time, o.branch) as start_at,
             public.kokoro_delivery_at(o.paid_at, o.delivery_time) is not null as timed,
             public.kokoro_courier_fee(o) as fee
      from public.orders o
      where o.paid_at >= v_from and o.paid_at < v_to and (v_mine is null or o.branch = v_mine)
    ), m as (
      select b.*, b.fin is not null and b.fulfillment = 'delivery' and b.fin > b.promise + interval '10 minutes' as late,
             case when b.fin is not null and b.fulfillment = 'delivery' and not b.timed
                  then extract(epoch from (b.fin - b.start_at)) / 60 end as minutes
      from base b
    )
    select json_build_object('from', p_from, 'to', p_to,
      'branches', coalesce((select json_agg(json_build_object('branch', g.branch, 'paid', g.paid, 'revenue', g.revenue,
          'delivery_sum', g.delivery_sum, 'pickup', g.pickup, 'delivered', g.delivered, 'avg_minutes', g.avg_minutes, 'late', g.late,
          'rating_avg', g.rating_avg, 'rating_count', g.rating_count) order by g.branch nulls last)
        from (select m.branch, count(*) filter (where m.counted) as paid, coalesce(sum(m.total) filter (where m.counted), 0) as revenue,
                coalesce(sum(m.fee) filter (where m.status = 'done' and m.fulfillment = 'delivery'), 0) as delivery_sum,
                count(*) filter (where m.counted and m.fulfillment = 'pickup') as pickup, count(*) filter (where m.status = 'done' and m.fulfillment = 'delivery') as delivered,
                round(avg(m.minutes))::integer as avg_minutes, count(*) filter (where m.late) as late,
                round(avg(m.rating)::numeric, 1) as rating_avg, count(m.rating) as rating_count
              from m group by m.branch) g), '[]'::json),
      'couriers', coalesce((select json_agg(json_build_object('id', g.courier_id, 'name', c.name, 'deleted', c.deleted_at is not null,
          'delivered', g.delivered, 'delivery_sum', g.delivery_sum, 'avg_minutes', g.avg_minutes, 'late', g.late, 'rating_avg', g.rating_avg)
          order by g.delivered desc, c.name)
        from (select m.courier_id, count(*) as delivered, coalesce(sum(m.fee), 0) as delivery_sum, round(avg(m.minutes))::integer as avg_minutes,
                count(*) filter (where m.late) as late, round(avg(m.courier_rating)::numeric, 1) as rating_avg
              from m where m.courier_id is not null and m.status = 'done' and m.fulfillment = 'delivery' group by m.courier_id) g
        join public.couriers c on c.id = g.courier_id), '[]'::json),
      'late', coalesce((select json_agg(json_build_object('id', l.id, 'day_number', l.day_number, 'branch', l.branch,
          'promise_at', l.promise, 'done_at', l.fin, 'minutes', round(extract(epoch from (l.fin - l.promise)) / 60)::integer)
          order by l.fin - l.promise desc)
        from (select * from m where m.late order by m.fin - m.promise desc limit 100) l), '[]'::json))
    from (select 1) one);
end $function$;

-- admin_set_delivery_quote(p_id bigint, p_quote jsonb)
CREATE OR REPLACE FUNCTION public.admin_set_delivery_quote(p_id bigint, p_quote jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o public.orders;
  v_from text;
  v_km numeric;
  v_price numeric;
  v_rain integer := 0;
  v_on boolean := false;
  v_quote jsonb;
begin
  perform public.kokoro_need_admin();
  select * into o from public.orders x where x.id = p_id for update;
  if not found or not public.kokoro_can_see_order(o.branch) then raise exception 'Заказ не найден или передан другой точке'; end if;
  if o.branch is null or coalesce(o.fulfillment, 'delivery') <> 'delivery' or coalesce(o.delivery_fee, 0) > 0
     or o.status in ('awaiting_payment', 'canceled') or o.created_at < now() - interval '3 days' then
    raise exception 'Сумму доставки этого заказа не пересчитать';
  end if;
  v_from := public.kokoro_kitchen_label(o.branch);
  if o.delivery_quote ->> 'from' = v_from and (jsonb_typeof(o.delivery_quote -> 'price') = 'number'
       or (jsonb_typeof(o.delivery_quote -> 'km') = 'number' and (o.delivery_quote ->> 'km')::numeric > 15)) then
    return json_build_object('id', o.id, 'delivery_quote', o.delivery_quote, 'changed', false);
  end if;
  if p_quote is null or jsonb_typeof(p_quote) <> 'object' or coalesce(jsonb_typeof(p_quote -> 'km'), '') <> 'number'
     or coalesce(jsonb_typeof(p_quote -> 'price'), 'null') not in ('number', 'null') or p_quote ->> 'from' is distinct from v_from then
    raise exception 'Сумма доставки: неверный вид или не от кухни точки заказа';
  end if;
  v_km := round((p_quote ->> 'km')::numeric, 1);
  v_price := (p_quote ->> 'price')::numeric;
  if v_km not between 0 and 200 then raise exception 'Сумма доставки вне границ'; end if;
  if v_price is distinct from public.kokoro_delivery_tariff(v_km) then
    raise exception 'Сумма доставки не по тарифу';
  end if;
  if v_price is not null then
    if coalesce((o.delivery_quote ->> 'rain')::numeric, 0) > 0
       and not (coalesce(o.delivery_quote -> 'rain_on' = 'true'::jsonb, false)
                and not coalesce((select b.rain from public.branch_settings b where b.branch = o.branch), false)) then
      v_rain := (o.delivery_quote ->> 'rain')::int;
      v_on := coalesce(o.delivery_quote -> 'rain_on' = 'true'::jsonb, false);
    elsif coalesce((select b.rain from public.branch_settings b where b.branch = o.branch), false)
          and o.status in ('new', 'confirmed', 'cooking', 'delivering')
          and greatest(o.created_at, coalesce(public.kokoro_delivery_at(coalesce(o.paid_at, o.created_at), o.delivery_time), o.created_at))
              >= ((date_trunc('day', (now() at time zone 'UTC') + interval '6 hours') - interval '6 hours') at time zone 'UTC') then
      v_rain := public.kokoro_rain_fee();
      v_on := true;
    end if;
  end if;
  v_quote := jsonb_build_object('km', v_km, 'price', case when v_price is null then null else v_price::int + v_rain end, 'from', v_from,
    'approx', coalesce(p_quote -> 'approx' = 'true'::jsonb, false), 'at', now(), 'by', 'panel');
  if v_rain > 0 then v_quote := v_quote || jsonb_build_object('rain', v_rain) || case when v_on then '{"rain_on": true}'::jsonb else '{}'::jsonb end; end if;
  update public.orders set delivery_quote = v_quote where id = o.id;
  return json_build_object('id', o.id, 'delivery_quote', v_quote, 'changed', true);
end $function$;

-- admin_status()
CREATE OR REPLACE FUNCTION public.admin_status()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select case
when not exists (select 1 from public.admins where user_id = auth.uid()) then 'none'
when public.is_admin() then 'ok'
else 'needs_mfa'
end
$function$;

-- admin_transfer_order(p_id bigint, p_branch text, p_from text)
CREATE OR REPLACE FUNCTION public.admin_transfer_order(p_id bigint, p_branch text, p_from text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old text;
  v_status text;
  v_row public.orders;
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  if p_branch is null or p_branch not in ('kulieva', 'kokzhar') then raise exception 'Нет такой точки'; end if;
  select o.branch, o.status into v_old, v_status from public.orders o where o.id = p_id for update;
  if not found then raise exception 'Заказ не найден'; end if;
  if p_from is not null and v_old is distinct from nullif(p_from, 'none') then
    raise exception 'Заказ уже передан: сейчас он у точки «%». Обновите список',
      case v_old when 'kulieva' then 'Кулиева' when 'kokzhar' then 'Кок-Жар' else 'без точки' end;
  end if;
  if not (public.kokoro_is_owner() or v_old is null or v_old = public.kokoro_admin_branch()) then raise exception 'Это заказ другой точки'; end if;
  if v_old = p_branch then
    -- «Адрес наш»: точка, поставленная по умолчанию, верна — снимаем пометку «проверьте адрес»; номер и курьер те же
    update public.orders set branch_guessed = false, updated_at = now() where id = p_id returning * into v_row;
    return json_build_object('id', v_row.id, 'branch', v_row.branch, 'day_number', v_row.day_number, 'confirmed', true);
  end if;
  -- Заказ «В пути» везёт курьер: передача сняла бы его с заказа, а еда уже у него (карточка в панели могла устареть —
  -- курьер сам нажал «Забрал — еду», specs/014). Сначала снять курьера — заказ вернётся в «Готовится»
  if v_status = 'delivering' then raise exception 'Заказ уже в пути — его везёт курьер. Обновите список'; end if;
  update public.orders set branch = p_branch, branch_guessed = false, courier_id = null, updated_at = now()
  where id = p_id returning * into v_row;
  return json_build_object('id', v_row.id, 'branch', v_row.branch, 'day_number', v_row.day_number);
end $function$;

-- attach_receipt(p_token uuid, p_path text)
CREATE OR REPLACE FUNCTION public.attach_receipt(p_token uuid, p_path text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o public.orders;
begin
  if p_path is null or split_part(p_path, '/', 1) <> p_token::text or p_path like '%..%' then
    raise exception 'Неверный файл чека' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'receipts' and name = p_path) then
    raise exception 'Чек не загрузился — попробуйте ещё раз' using errcode = 'P0001';
  end if;
  update public.orders
     set receipt_path = p_path,
         status = case when status = 'awaiting_payment' then 'new' else status end,
         paid_at = coalesce(paid_at, now()),
         updated_at = now()
   where pay_token = p_token
  returning * into o;
  if not found then
    raise exception 'Заказ не найден' using errcode = 'P0001';
  end if;
  return json_build_object('number', o.id, 'total', o.total, 'day_number', o.day_number);
end;
$function$;

-- cancel_unpaid_order(p_token uuid)
CREATE OR REPLACE FUNCTION public.cancel_unpaid_order(p_token uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.orders set status = 'canceled', updated_at = now()
   where pay_token = p_token and status = 'awaiting_payment';
$function$;

-- courier_board(p_key text)
CREATE OR REPLACE FUNCTION public.courier_board(p_key text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint := public.kokoro_courier_id(p_key);
  v_c public.couriers;
  v_branch text;
begin
  if v_id is null then return null; end if;
  update public.couriers c set seen_at = public.kokoro_now(),
    shift_on_at = case when not public.kokoro_courier_on_shift(c)
                            and coalesce(c.shift_off_at, '-infinity'::timestamptz) < public.kokoro_workday_start()
                       then public.kokoro_now() else c.shift_on_at end
  where c.id = v_id
  returning c.* into v_c;
  perform public.kokoro_dispatch();
  v_branch := v_c.branch;
  return json_build_object(
    'branch', v_branch,
    'dispatch', case when v_branch is not null then public.kokoro_branch_dispatch(v_branch)
                     when exists (select 1 from public.branch_settings b where b.dispatch = 'auto') then 'auto' else 'manual' end,
    'limit', public.kokoro_courier_limit(v_branch),
    'mine', (select count(*) from public.orders o where o.courier_id = v_id and o.status in ('new', 'confirmed', 'cooking', 'delivering')),
    'on_shift', public.kokoro_courier_on_shift(v_c),
    'assigned', coalesce((select json_agg(o.id order by o.id) from public.orders o
                          where o.courier_id = v_id and o.status in ('confirmed', 'cooking') and o.dispatched_at is not null), '[]'::json),
    'points', coalesce((select json_object_agg(o.id, o.branch order by o.id) from public.orders o
                        where o.courier_id = v_id and o.status in ('new', 'confirmed', 'cooking', 'delivering') and o.branch is not null), '{}'::json),
    'free', coalesce((select json_agg(json_build_object(
        'id', f.id, 'day_number', f.day_number, 'branch', f.branch, 'status', f.status, 'paid', f.receipt_path is not null,
        'waiting_since', f.waiting_since, 'address', f.address, 'lat', f.lat, 'lon', f.lon, 'delivery_time', f.delivery_time,
        'qty', f.qty, 'delivery_quote', f.delivery_quote, 'first', f.n = 1) order by f.waiting_since, f.id)
      from (select o.*, d.due as waiting_since, row_number() over (partition by o.branch order by d.due, o.id) as n
            from public.kokoro_courier_free(v_branch) o
            cross join lateral (select public.kokoro_order_due(coalesce(o.paid_at, o.created_at), o.delivery_time, o.branch) as due) d) f),
      '[]'::json));
end $function$;

-- courier_chat(p_key text, p_order_id bigint, p_after bigint)
CREATE OR REPLACE FUNCTION public.courier_chat(p_key text, p_order_id bigint, p_after bigint DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint := public.kokoro_courier_id(p_key);
  o public.orders;
begin
  if v_id is null then return null; end if;
  select * into o from public.orders x where x.id = p_order_id and x.courier_id = v_id and x.status in ('new', 'confirmed', 'cooking', 'delivering');
  if not found then return null; end if;
  return json_build_object('open', true, 'can_write', true, 'messages', public.kokoro_chat_messages(o.id, p_after, false));
end $function$;

-- courier_chat_send(p_key text, p_order_id bigint, p_body text)
CREATE OR REPLACE FUNCTION public.courier_chat_send(p_key text, p_order_id bigint, p_body text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id bigint := public.kokoro_courier_id(p_key);
begin
  if v_id is null then raise exception 'Код курьера не подошёл — войдите заново'; end if;
  if not exists (select 1 from public.orders x where x.id = p_order_id and x.courier_id = v_id and x.status in ('new', 'confirmed', 'cooking', 'delivering')) then
    raise exception 'Заказ уже не ваш или закрыт — список обновлён';
  end if;
  return public.kokoro_chat_add(p_order_id, 'courier', v_id, p_body, 60);
end $function$;

-- courier_chat_summary(p_key text)
CREATE OR REPLACE FUNCTION public.courier_chat_summary(p_key text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id bigint := public.kokoro_courier_id(p_key);
begin
  if v_id is null then return null; end if;
  return public.kokoro_chat_summary(array(select o.id from public.orders o
    where o.courier_id = v_id and o.status in ('new', 'confirmed', 'cooking', 'delivering')));
end $function$;

-- courier_choose_point(p_key text, p_branch text)
CREATE OR REPLACE FUNCTION public.courier_choose_point(p_key text, p_branch text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint := public.kokoro_courier_id(p_key);
  v_set timestamptz;
begin
  if v_id is null then raise exception 'Код курьера не подошёл — войдите заново'; end if;
  if p_branch is null or p_branch not in ('kulieva', 'kokzhar') then raise exception 'Выберите точку: Кулиева или Кок-Жар'; end if;
  select c.branch_set_at into v_set from public.couriers c where c.id = v_id for update;
  if v_set is not null then raise exception 'Точка уже выбрана — сменить её может менеджер'; end if;
  update public.couriers set branch = p_branch, branch_set_at = now() where id = v_id;
  return json_build_object('branch', p_branch);
end $function$;

-- courier_contact(p_key text)
CREATE OR REPLACE FUNCTION public.courier_contact(p_key text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id bigint := public.kokoro_courier_id(p_key);
begin
  if v_id is null then return null; end if;
  return json_build_object('phone', (select c.phone from public.couriers c where c.id = v_id),
                           'chat', public.kokoro_staff_summary(v_id));
end $function$;

-- courier_decline(p_key text, p_order_id bigint)
CREATE OR REPLACE FUNCTION public.courier_decline(p_key text, p_order_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint := public.kokoro_courier_id(p_key);
  v_courier bigint;
  v_status text;
  v_dispatched timestamptz;
begin
  if v_id is null then raise exception 'Код курьера не подошёл — войдите заново'; end if;
  -- Строка курьера, потом заказ — тот же порядок замков, что в courier_take и в назначении
  perform 1 from public.couriers c where c.id = v_id and c.active for no key update;
  if not found then raise exception 'Код курьера не подошёл — войдите заново'; end if;
  select o.courier_id, o.status, o.dispatched_at into v_courier, v_status, v_dispatched
  from public.orders o where o.id = p_order_id for no key update;
  if v_courier is distinct from v_id then
    -- Повторное нажатие (ответ на первое потерялся по дороге) — тот же успех
    if exists (select 1 from public.courier_declines x where x.order_id = p_order_id and x.courier_id = v_id) then
      return json_build_object('id', p_order_id);
    end if;
    raise exception 'Заказ уже не ваш — список обновлён';
  end if;
  if v_status = 'delivering' then raise exception 'Заказ уже в пути'; end if;
  if v_dispatched is null and v_status in ('new', 'confirmed', 'cooking') then
    raise exception 'Этот заказ назначил менеджер — скажите ему, если не можете взять';
  end if;
  if v_status not in ('confirmed', 'cooking') then raise exception 'Заказ уже не ваш — список обновлён'; end if;
  insert into public.courier_declines (order_id, courier_id, at) values (p_order_id, v_id, public.kokoro_now())
  on conflict (order_id, courier_id) do update set at = excluded.at;
  update public.orders set courier_id = null, dispatched_at = null where id = p_order_id;
  perform public.kokoro_dispatch_run(v_id);
  return json_build_object('id', p_order_id);
end $function$;

-- courier_earnings(p_key text, p_back integer)
CREATE OR REPLACE FUNCTION public.courier_earnings(p_key text, p_back integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint := public.kokoro_courier_id(p_key);
  v_back integer := greatest(0, least(coalesce(p_back, 0), 6));
  v_since timestamptz := public.kokoro_workday_start() - make_interval(days => greatest(0, least(coalesce(p_back, 0), 6)));
  v_door integer := public.kokoro_door_fee();
begin
  if v_id is null then return null; end if;
  return (
    with d as (
      select o.id, o.day_number, coalesce(o.done_at, o.updated_at) as done_at, o.address, o.door,
             coalesce(o.delivery_fee, 0) > 0 as qr,
             case when jsonb_typeof(o.delivery_quote -> 'km') = 'number' then (o.delivery_quote ->> 'km')::numeric end as km,
             coalesce(o.delivery_quote -> 'approx' = 'true'::jsonb, false) as approx,
             o.delivery_quote ->> 'by' as quote_by,
             public.kokoro_courier_fee(o) as fee,
             case when coalesce(o.delivery_fee, 0) = 0 and jsonb_typeof(o.delivery_quote -> 'price') = 'number'
                  then (o.delivery_quote ->> 'price')::int end as price,
             case when coalesce(o.delivery_fee, 0) = 0 and jsonb_typeof(o.delivery_quote -> 'price') = 'number'
                       and jsonb_typeof(o.delivery_quote -> 'rain') = 'number'
                  then greatest(0, (o.delivery_quote ->> 'rain')::int) else 0 end as rain
      from public.orders o
      where o.courier_id = v_id and o.status = 'done' and coalesce(o.done_at, o.updated_at) >= v_since
        and coalesce(o.done_at, o.updated_at) < v_since + interval '1 day'
    )
    select json_build_object('since', v_since, 'until', v_since + interval '1 day', 'back', v_back,
      'delivered', count(*),
      'earned', coalesce(sum(fee), 0),
      'road', coalesce(sum(price - rain) filter (where fee is not null), 0),
      'rain', coalesce(sum(rain) filter (where fee is not null), 0),
      'rain_orders', count(*) filter (where fee is not null and rain > 0),
      'door', coalesce(sum(v_door) filter (where fee is not null and door), 0),
      'door_orders', count(*) filter (where fee is not null and door),
      'unknown', count(*) filter (where fee is null),
      'orders', coalesce(json_agg(json_build_object('id', id, 'day_number', day_number, 'done_at', done_at, 'address', address,
          'km', km, 'approx', approx, 'by', quote_by, 'qr', qr,
          'road', case when price is not null then price - rain end, 'rain', rain,
          'door', case when door then v_door else 0 end, 'fee', fee) order by done_at, id), '[]'::json))
    from d);
end $function$;

-- courier_extra(p_key text)
CREATE OR REPLACE FUNCTION public.courier_extra(p_key text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint := public.kokoro_courier_id(p_key);
  v_branch text;
begin
  if v_id is null then return null; end if;
  select c.branch into v_branch from public.couriers c where c.id = v_id;
  return coalesce((select json_object_agg(o.id::text, json_build_object('door', o.door,
      'door_fee', case when o.door then public.kokoro_door_fee() else 0 end, 'ready_at', o.ready_at, 'promise_at', public.kokoro_promise_at(o)))
    from public.orders o
    where (o.courier_id = v_id and o.status in ('new', 'confirmed', 'cooking', 'delivering'))
       or o.id in (select f.id from public.kokoro_courier_free(v_branch) f)), '{}'::json);
end $function$;

-- courier_fill_quote(p_key text, p_order_id bigint, p_lat double precision, p_lon double precision, p_km numeric)
CREATE OR REPLACE FUNCTION public.courier_fill_quote(p_key text, p_order_id bigint, p_lat double precision, p_lon double precision, p_km numeric DEFAULT NULL::numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint := public.kokoro_courier_id(p_key);
  o public.orders;
  v_from text;
  v_k_lat double precision;
  v_k_lon double precision;
  v_straight numeric;
  v_km numeric;
  v_approx boolean;
  v_price integer;
  v_rain integer := 0;
  v_quote jsonb;
begin
  if v_id is null then raise exception 'Код курьера не подошёл — войдите заново'; end if;
  select * into o from public.orders x where x.id = p_order_id and x.courier_id = v_id for update;
  if not found then raise exception 'Заказ уже не ваш — обновите страницу'; end if;
  if o.branch is null or coalesce(o.fulfillment, 'delivery') <> 'delivery' or coalesce(o.delivery_fee, 0) > 0
     or not (o.status = 'delivering' or (o.status = 'done' and coalesce(o.done_at, o.updated_at) > now() - interval '30 minutes')) then
    raise exception 'Сумму доставки этого заказа здесь не посчитать — уточните у менеджера';
  end if;
  v_from := public.kokoro_kitchen_label(o.branch);
  if o.delivery_quote ->> 'from' = v_from and (jsonb_typeof(o.delivery_quote -> 'price') = 'number'
       or (jsonb_typeof(o.delivery_quote -> 'km') = 'number' and (o.delivery_quote ->> 'km')::numeric > 15))
     and not (o.status = 'delivering' and o.delivery_quote ->> 'by' = 'courier') then
    return json_build_object('id', o.id, 'delivery_quote', o.delivery_quote, 'changed', false);
  end if;
  if p_lat is null or p_lon is null or p_lat not between 42.6 and 43.1 or p_lon not between 74.2 and 75.0 then
    raise exception 'Место не похоже на Бишкек — включите геопозицию и нажмите ещё раз';
  end if;
  v_k_lat := public.kokoro_kitchen_lat(o.branch);
  v_k_lon := public.kokoro_kitchen_lon(o.branch);
  v_straight := sqrt(((p_lon - v_k_lon) * cos(radians(v_k_lat)) * 111.32) ^ 2 + ((p_lat - v_k_lat) * 111.32) ^ 2)::numeric;
  if v_straight < 0.3 then
    raise exception 'Вы ещё у кухни — посчитайте доставку у двери клиента';
  end if;
  if p_km is not null and p_km >= v_straight - 0.05 and p_km <= v_straight * 2 + 1 then
    v_km := round(greatest(p_km, v_straight), 1);
    v_approx := false;
  else
    v_km := round(v_straight * 1.3, 1);
    v_approx := true;
  end if;
  v_price := public.kokoro_delivery_tariff(v_km);
  if v_price is not null and coalesce((select b.rain from public.branch_settings b where b.branch = o.branch), false) then
    v_rain := public.kokoro_rain_fee();
  end if;
  v_quote := jsonb_build_object('km', v_km, 'price', case when v_price is null then null else v_price + v_rain end, 'from', v_from,
    'approx', v_approx, 'at', now(), 'by', 'courier');
  if v_rain > 0 then v_quote := v_quote || jsonb_build_object('rain', v_rain); end if;
  update public.orders set delivery_quote = v_quote where id = o.id;
  return json_build_object('id', o.id, 'delivery_quote', v_quote, 'changed', true);
end $function$;

-- courier_login(p_pin text)
CREATE OR REPLACE FUNCTION public.courier_login(p_pin text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_headers json;
  v_ip text;
  v_pin text := regexp_replace(coalesce(p_pin, ''), '\s', '', 'g');
  c public.couriers;
  v_found boolean;
  v_key text;
begin
  if v_pin !~ '^\d{6}$' then return json_build_object('error', 'format'); end if;
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then v_headers := null;
  end;
  v_ip := left(coalesce(nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''), nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''),
               'unknown'), 64);
  -- Попытки входа считаем по очереди: иначе пачка одновременных запросов прошла бы мимо предела, пока ни одна не записана
  perform pg_advisory_xact_lock(hashtext('kokoro_courier_login'));
  if random() < 0.05 then delete from public.courier_login_tries where at < now() - interval '1 day'; end if;
  if (select count(*) from public.courier_login_tries t where t.ip = v_ip and not t.ok and t.at > now() - interval '15 minutes') >= 5 then
    return json_build_object('error', 'locked', 'minutes', 15);
  end if;
  if (select count(*) from public.courier_login_tries t where not t.ok and t.at > now() - interval '60 minutes') >= 40 then
    return json_build_object('error', 'busy', 'minutes', 60);
  end if;
  -- for update: два входа одним кодом в одну секунду — второй дождётся первого и уже не найдёт код
  select * into c from public.couriers x
  where x.pin_hash = public.kokoro_key_hash('PIN' || v_pin) and x.pin_until > now() and x.deleted_at is null for update;
  v_found := found;
  if not v_found or not c.active then
    insert into public.courier_login_tries (ip, ok) values (v_ip, false);
    return json_build_object('error', case when v_found then 'disabled' else 'wrong' end);
  end if;
  v_key := public.kokoro_code(12);
  update public.couriers set key_hash = public.kokoro_key_hash(v_key), pin_hash = null, pin_until = null where id = c.id;
  insert into public.courier_login_tries (ip, ok) values (v_ip, true);
  return json_build_object('key', v_key, 'name', c.name);
end $function$;

-- courier_me(p_key text)
CREATE OR REPLACE FUNCTION public.courier_me(p_key text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when not c.active then json_build_object('disabled', true)
    else json_build_object('id', c.id, 'name', c.name, 'tg_linked', c.tg_chat_id is not null,
      'location', (select json_build_object('lat', l.lat, 'lon', l.lon, 'at', l.at, 'live_until', l.live_until)
                   from public.courier_locations l where l.courier_id = c.id)) end
  from public.couriers c
  where length(regexp_replace(upper(coalesce(p_key, '')), '[^0-9A-Z]', '', 'g')) = 12 and c.key_hash = public.kokoro_key_hash(p_key)
$function$;

-- courier_orders(p_key text)
CREATE OR REPLACE FUNCTION public.courier_orders(p_key text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id bigint := public.kokoro_courier_id(p_key);
begin
  if v_id is null then return null; end if;
  return coalesce((select json_agg(json_build_object(
      'id', o.id, 'day_number', o.day_number, 'created_at', o.created_at, 'status', o.status,
      'qty', o.qty, 'total', o.total, 'delivery_fee', o.delivery_fee, 'paid', o.receipt_path is not null,
      'name', o.name, 'phone', o.phone, 'address', o.address, 'entrance', o.entrance, 'floor', o.floor,
      'apartment', o.apartment, 'delivery_time', o.delivery_time, 'comment', o.comment, 'lat', o.lat, 'lon', o.lon,
      'delivery_quote', o.delivery_quote, 'branch', o.branch) order by o.created_at)
    from public.orders o where o.courier_id = v_id and o.status in ('new', 'confirmed', 'cooking', 'delivering')), '[]'::json);
end $function$;

-- courier_point(p_key text)
CREATE OR REPLACE FUNCTION public.courier_point(p_key text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select json_build_object('branch', c.branch, 'chosen', c.branch_set_at is not null)
  from public.couriers c where c.id = public.kokoro_courier_id(p_key)
$function$;

-- courier_put_location(p_key text, p_lat double precision, p_lon double precision, p_accuracy real)
CREATE OR REPLACE FUNCTION public.courier_put_location(p_key text, p_lat double precision, p_lon double precision, p_accuracy real DEFAULT NULL::real)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id bigint := public.kokoro_courier_id(p_key);
begin
  if v_id is null then return null; end if;
  return public.kokoro_courier_put(v_id, p_lat, p_lon, p_accuracy);
end $function$;

-- courier_set_phone(p_key text, p_phone text)
CREATE OR REPLACE FUNCTION public.courier_set_phone(p_key text, p_phone text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint := public.kokoro_courier_id(p_key);
  v_phone text := public.kokoro_phone_norm(p_phone);
begin
  if v_id is null then raise exception 'Код курьера не подошёл — войдите заново'; end if;
  if v_phone is null then raise exception 'Не похоже на номер телефона — пример: 0555 123 456'; end if;
  update public.couriers set phone = v_phone, phone_at = now() where id = v_id;
  return json_build_object('phone', v_phone);
end $function$;

-- courier_set_status(p_key text, p_order_id bigint, p_status text)
CREATE OR REPLACE FUNCTION public.courier_set_status(p_key text, p_order_id bigint, p_status text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint := public.kokoro_courier_id(p_key);
  v_status text;
begin
  if v_id is null then raise exception 'Код курьера не подошёл — войдите заново'; end if;
  if p_status is null or p_status not in ('delivering', 'done') then raise exception 'Курьер ставит только «В пути» и «Доставлен»'; end if;
  if p_status = 'delivering' and not exists (select 1 from public.orders o where o.id = p_order_id and o.courier_id = v_id and o.status = 'delivering') then
    perform public.kokoro_courier_need_phone(v_id);
  end if;
  update public.orders o set status = p_status
  where o.id = p_order_id and o.courier_id = v_id
    and ((p_status = 'delivering' and o.status in ('new', 'confirmed', 'cooking')) or (p_status = 'done' and o.status = 'delivering'))
  returning o.status into v_status;
  if v_status is null and not exists (select 1 from public.orders o where o.id = p_order_id and o.courier_id = v_id and o.status = p_status) then
    raise exception 'Заказ уже не ваш или его статус изменили — обновите страницу';
  end if;
  return json_build_object('id', p_order_id, 'status', p_status);
end $function$;

-- courier_shift_off(p_key text)
CREATE OR REPLACE FUNCTION public.courier_shift_off(p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id bigint := public.kokoro_courier_id(p_key);
begin
  if v_id is null then raise exception 'Код курьера не подошёл — войдите заново'; end if;
  update public.couriers set shift_off_at = greatest(now(), public.kokoro_now()) where id = v_id;
  delete from public.courier_locations where courier_id = v_id;
  return true;
end $function$;

-- courier_shift_on(p_key text)
CREATE OR REPLACE FUNCTION public.courier_shift_on(p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id bigint := public.kokoro_courier_id(p_key);
begin
  if v_id is null then raise exception 'Код курьера не подошёл — войдите заново'; end if;
  perform public.kokoro_courier_need_phone(v_id);
  update public.couriers set shift_on_at = public.kokoro_now(), seen_at = public.kokoro_now() where id = v_id;
  perform public.kokoro_dispatch_run();
  return true;
end $function$;

-- courier_staff_chat(p_key text, p_after bigint)
CREATE OR REPLACE FUNCTION public.courier_staff_chat(p_key text, p_after bigint DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id bigint := public.kokoro_courier_id(p_key);
begin
  if v_id is null then return null; end if;
  return json_build_object('open', true, 'can_write', true, 'messages', public.kokoro_staff_messages(v_id, p_after, null));
end $function$;

-- courier_staff_send(p_key text, p_body text)
CREATE OR REPLACE FUNCTION public.courier_staff_send(p_key text, p_body text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id bigint := public.kokoro_courier_id(p_key);
begin
  if v_id is null then raise exception 'Код курьера не подошёл — войдите заново'; end if;
  return public.kokoro_staff_add(v_id, 'courier', p_body, 30);
end $function$;

-- courier_take(p_key text, p_order_id bigint, p_lat double precision, p_lon double precision, p_accuracy real)
CREATE OR REPLACE FUNCTION public.courier_take(p_key text, p_order_id bigint, p_lat double precision DEFAULT NULL::double precision, p_lon double precision DEFAULT NULL::double precision, p_accuracy real DEFAULT NULL::real)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint := public.kokoro_courier_id(p_key);
  v_branch text;
  v_order_branch text;
  v_mine integer;
  v_limit integer;
  v_first_id bigint;
  v_first_number text;
  v_status text;
  v_day integer;
  v_taken_by bigint;
  v_due timestamptz;
begin
  if v_id is null then raise exception 'Код курьера не подошёл — войдите заново'; end if;
  select c.branch into v_branch from public.couriers c where c.id = v_id and c.active for no key update;
  if not found then raise exception 'Код курьера не подошёл — войдите заново'; end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id and o.courier_id = v_id and o.status = 'delivering') then
    perform public.kokoro_courier_need_phone(v_id);
  end if;
  select o.branch into v_order_branch from public.orders o where o.id = p_order_id;
  if not found then raise exception 'Заказ не найден — список обновлён'; end if;
  if v_order_branch is null or (v_branch is not null and v_order_branch <> v_branch) then raise exception 'Это заказ другой точки'; end if;
  if not exists (select 1 from public.kokoro_courier_free(v_order_branch) o where o.id = p_order_id) then
    select o.courier_id, o.status, public.kokoro_order_due(coalesce(o.paid_at, o.created_at), o.delivery_time, o.branch)
      into v_taken_by, v_status, v_due from public.orders o where o.id = p_order_id;
    if v_taken_by = v_id and v_status = 'delivering' then
      return json_build_object('id', p_order_id, 'status', v_status, 'day_number', (select o.day_number from public.orders o where o.id = p_order_id),
        'branch', v_order_branch);
    end if;
    if v_taken_by = v_id then raise exception 'Этот заказ уже ваш — он в «Моих заказах»'; end if;
    if v_status in ('done', 'canceled') then raise exception 'Заказ уже закрыт или отменён — список обновлён'; end if;
    if v_taken_by is not null then raise exception 'Этот заказ уже забрал другой курьер — список обновлён'; end if;
    if v_status = 'awaiting_payment' then raise exception 'Этот заказ ещё не оплачен — список обновлён'; end if;
    if v_status = 'delivering' then raise exception 'Этот заказ уже в пути — его назначит менеджер'; end if;
    if v_status = 'new' then raise exception 'Менеджер ещё не проверил оплату этого заказа — список обновлён'; end if;
    if v_due > public.kokoro_now() then
      raise exception 'Этот заказ пока рано везти — он появится в «Свободных», когда придёт время';
    end if;
    raise exception 'Этот заказ ждёт слишком долго — его назначит менеджер';
  end if;
  select count(*) into v_mine from public.orders o where o.courier_id = v_id and o.status in ('new', 'confirmed', 'cooking', 'delivering');
  v_limit := public.kokoro_courier_limit(v_branch);
  if v_mine >= v_limit then
    raise exception 'У вас уже % % — это предел точки. Сначала доставьте', v_mine,
      case when v_mine % 10 = 1 and v_mine % 100 <> 11 then 'заказ'
           when v_mine % 10 between 2 and 4 and v_mine % 100 not between 12 and 14 then 'заказа' else 'заказов' end;
  end if;
  if v_mine = 0 then
    select o.id, coalesce(o.day_number::text, o.id::text) into v_first_id, v_first_number
    from public.kokoro_courier_free(v_order_branch) o
    order by public.kokoro_order_due(coalesce(o.paid_at, o.created_at), o.delivery_time, o.branch), o.id limit 1;
    if v_first_id is distinct from p_order_id then
      raise exception '%', format('Сначала заберите самый старый заказ — № %s%s', v_first_number,
        case when v_branch is not null then '' when v_order_branch = 'kulieva' then ' (Кулиева)' else ' (Кок-Жар)' end);
    end if;
  end if;
  update public.orders o set courier_id = v_id, status = 'delivering'
  where o.id = p_order_id and o.courier_id is null and o.status in ('new', 'confirmed', 'cooking')
  returning o.status, o.day_number into v_status, v_day;
  if not found then raise exception 'Этот заказ уже забрал другой курьер — список обновлён'; end if;
  if p_lat is not null and p_lon is not null then perform public.kokoro_courier_put(v_id, p_lat, p_lon, p_accuracy); end if;
  return json_build_object('id', p_order_id, 'status', v_status, 'day_number', v_day, 'branch', v_order_branch);
end $function$;

-- courier_tg_link(p_key text)
CREATE OR REPLACE FUNCTION public.courier_tg_link(p_key text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint := public.kokoro_courier_id(p_key);
  v_code text := public.kokoro_code(10);
begin
  if v_id is null then raise exception 'Код курьера не подошёл — войдите заново'; end if;
  update public.couriers set tg_link_code = v_code, tg_link_until = now() + interval '30 minutes' where id = v_id;
  return v_code;
end $function$;

-- courier_today(p_key text)
CREATE OR REPLACE FUNCTION public.courier_today(p_key text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint := public.kokoro_courier_id(p_key);
  v_since timestamptz := public.kokoro_workday_start();
begin
  if v_id is null then return null; end if;
  return (select json_build_object('since', v_since, 'delivered', count(*), 'earned', coalesce(sum(public.kokoro_courier_fee(o)), 0),
      'unknown', count(*) filter (where public.kokoro_courier_fee(o) is null),
      'orders', coalesce(json_agg(json_build_object('id', o.id, 'day_number', o.day_number, 'done_at', coalesce(o.done_at, o.updated_at),
                  'fee', public.kokoro_courier_fee(o), 'door', o.door) order by coalesce(o.done_at, o.updated_at)), '[]'::json))
    from public.orders o
    where o.courier_id = v_id and o.status = 'done' and coalesce(o.done_at, o.updated_at) >= v_since
      and coalesce(o.done_at, o.updated_at) < v_since + interval '1 day');
end $function$;

-- is_admin()
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.admins where user_id = auth.uid());
$function$;

-- kitchen_archive(p_key text, p_id bigint, p_archived boolean)
CREATE OR REPLACE FUNCTION public.kitchen_archive(p_key text, p_id bigint, p_archived boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                                                                                                                                                                                                                                                                                                                                                          declare v_row public.kitchen_products;
                                                                                                                                                                                                                                                                                                                                                                          begin
                                                                                                                                                                                                                                                                                                                                                                            if public.kitchen_key_id(p_key) is null then return null; end if;
                                                                                                                                                                                                                                                                                                                                                                              update public.kitchen_products
                                                                                                                                                                                                                                                                                                                                                                                set archived_at = case when p_archived then coalesce(archived_at, now()) end, updated_at = now()
                                                                                                                                                                                                                                                                                                                                                                                  where id = p_id
                                                                                                                                                                                                                                                                                                                                                                                    returning * into v_row;
                                                                                                                                                                                                                                                                                                                                                                                      if v_row.id is null then raise exception 'Продукт не найден — обновите страницу'; end if;
                                                                                                                                                                                                                                                                                                                                                                                        return public.kitchen_row(v_row);
                                                                                                                                                                                                                                                                                                                                                                                        end $function$;

-- kitchen_check(p_id bigint, p_category text, p_name text, p_pack text, p_price numeric, p_note text)
CREATE OR REPLACE FUNCTION public.kitchen_check(p_id bigint, p_category text, p_name text, p_pack text, p_price numeric, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                                                                                                                                                              begin
                                                                                                                                                                                if length(p_name) not between 1 and 80 then raise exception 'Название — от 1 до 80 знаков'; end if;
                                                                                                                                                                                  if length(p_category) not between 1 and 40 then raise exception 'Категория — от 1 до 40 знаков'; end if;
                                                                                                                                                                                    if length(p_pack) > 40 then raise exception 'Фасовка — не длиннее 40 знаков'; end if;
                                                                                                                                                                                      if length(p_note) > 200 then raise exception 'Заметка — не длиннее 200 знаков'; end if;
                                                                                                                                                                                        if p_price is not null and (p_price < 0 or p_price >= 100000000) then raise exception 'Цена — от 0 до 99 999 999 сом'; end if;
                                                                                                                                                                                          if exists (select 1 from public.kitchen_products p
                                                                                                                                                                                                       where p.archived_at is null and p.id is distinct from p_id
                                                                                                                                                                                                                      and translate(lower(p.name), 'ё', 'е') = translate(lower(p_name), 'ё', 'е')
                                                                                                                                                                                                                                     and translate(lower(p.pack), 'ё', 'е') = translate(lower(p_pack), 'ё', 'е')) then
                                                                                                                                                                                                                                         raise exception 'Такой продукт уже есть: % %', p_name, p_pack;
                                                                                                                                                                                                                                           end if;
                                                                                                                                                                                                                                           end $function$;

-- kitchen_clean(p_text text)
CREATE OR REPLACE FUNCTION public.kitchen_clean(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$ select btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')) $function$;

-- kitchen_key_id(p_key text)
CREATE OR REPLACE FUNCTION public.kitchen_key_id(p_key text)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                                                                                                                                                  select k.id from public.kitchen_keys k
                                                                                                                                                                    where length(regexp_replace(upper(coalesce(p_key, '')), '[^0-9A-Z]', '', 'g')) = 16
                                                                                                                                                                        and k.key_hash = public.kokoro_key_hash(p_key) and k.active
                                                                                                                                                                        $function$;

-- kitchen_me(p_key text)
CREATE OR REPLACE FUNCTION public.kitchen_me(p_key text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                                                                                                                                                                                                                             select json_build_object('name', k.name) from public.kitchen_keys k where k.id = public.kitchen_key_id(p_key)
                                                                                                                                                                                                                                             $function$;

-- kitchen_new_link(p_name text, p_replace boolean)
CREATE OR REPLACE FUNCTION public.kitchen_new_link(p_name text DEFAULT 'Шеф'::text, p_replace boolean DEFAULT true)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                                                                                                                                                                                                                                                                                                                                                                        declare v_code text := public.kokoro_code(16);
                                                                                                                                                                                                                                                                                                                                                                                        begin
                                                                                                                                                                                                                                                                                                                                                                                          if length(btrim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'Имя — от 1 до 40 знаков'; end if;
                                                                                                                                                                                                                                                                                                                                                                                            -- Заменяем только ссылку этого же человека: новая ссылка шефу не выкидывает повара
                                                                                                                                                                                                                                                                                                                                                                                              if p_replace then update public.kitchen_keys set active = false where active and lower(name) = lower(btrim(p_name)); end if;
                                                                                                                                                                                                                                                                                                                                                                                                insert into public.kitchen_keys (name, key_hash) values (btrim(p_name), public.kokoro_key_hash(v_code));
                                                                                                                                                                                                                                                                                                                                                                                                  return 'https://kokoro.com.kg/kitchen#' || substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-'
                                                                                                                                                                                                                                                                                                                                                                                                      || substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4);
                                                                                                                                                                                                                                                                                                                                                                                                      end $function$;

-- kitchen_products(p_key text)
CREATE OR REPLACE FUNCTION public.kitchen_products(p_key text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                                                                                                                                                                                                                             begin
                                                                                                                                                                                                                                               if public.kitchen_key_id(p_key) is null then return null; end if;
                                                                                                                                                                                                                                                 return coalesce((select json_agg(public.kitchen_row(p) order by p.sort, p.id)
                                                                                                                                                                                                                                                                    from public.kitchen_products p where p.archived_at is null), '[]'::json);
                                                                                                                                                                                                                                                                    end $function$;

-- kitchen_row(p kitchen_products)
CREATE OR REPLACE FUNCTION public.kitchen_row(p kitchen_products)
 RETURNS json
 LANGUAGE sql
 STABLE
AS $function$
                                                                                                                                                                          select json_build_object('id', p.id, 'category', p.category, 'name', p.name, 'pack', p.pack, 'price', p.price,
                                                                                                                                                                              'note', p.note, 'sort', p.sort, 'price_at', p.price_at, 'updated_at', p.updated_at, 'archived', p.archived_at is not null)
                                                                                                                                                                              $function$;

-- kitchen_save(p_key text, p_id bigint, p_category text, p_name text, p_pack text, p_price numeric, p_note text)
CREATE OR REPLACE FUNCTION public.kitchen_save(p_key text, p_id bigint, p_category text, p_name text, p_pack text, p_price numeric, p_note text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                                                                                                                                                                                                                                                    declare v_row public.kitchen_products;
                                                                                                                                                                                                                                                                    begin
                                                                                                                                                                                                                                                                      if public.kitchen_key_id(p_key) is null then return null; end if;
                                                                                                                                                                                                                                                                        p_category := public.kitchen_clean(p_category);
                                                                                                                                                                                                                                                                          p_name := public.kitchen_clean(p_name);
                                                                                                                                                                                                                                                                            p_pack := public.kitchen_clean(p_pack);
                                                                                                                                                                                                                                                                              p_note := public.kitchen_clean(p_note);
                                                                                                                                                                                                                                                                                p_price := round(p_price, 2);
                                                                                                                                                                                                                                                                                  perform public.kitchen_check(p_id, p_category, p_name, p_pack, p_price, p_note);
                                                                                                                                                                                                                                                                                    if p_id is null then
                                                                                                                                                                                                                                                                                        insert into public.kitchen_products (category, name, pack, price, note, sort, price_at)
                                                                                                                                                                                                                                                                                            values (p_category, p_name, p_pack, p_price, p_note,
                                                                                                                                                                                                                                                                                                        coalesce((select max(sort) from public.kitchen_products), 0) + 10, case when p_price is not null then now() end)
                                                                                                                                                                                                                                                                                                            returning * into v_row;
                                                                                                                                                                                                                                                                                                              else
                                                                                                                                                                                                                                                                                                                  -- В SET все выражения видят старую строку: price_at меняется, только если цена правда другая
                                                                                                                                                                                                                                                                                                                      update public.kitchen_products
                                                                                                                                                                                                                                                                                                                          set category = p_category, name = p_name, pack = p_pack, note = p_note, price = p_price, updated_at = now(),
                                                                                                                                                                                                                                                                                                                                  price_at = case when price is distinct from p_price then case when p_price is null then null else now() end else price_at end
                                                                                                                                                                                                                                                                                                                                      where id = p_id and archived_at is null
                                                                                                                                                                                                                                                                                                                                          returning * into v_row;
                                                                                                                                                                                                                                                                                                                                              if v_row.id is null then raise exception 'Продукт не найден — его убрали с другого телефона. Обновите страницу'; end if;
                                                                                                                                                                                                                                                                                                                                                end if;
                                                                                                                                                                                                                                                                                                                                                  return public.kitchen_row(v_row);
                                                                                                                                                                                                                                                                                                                                                  end $function$;

-- kitchen_set_price(p_key text, p_id bigint, p_price numeric)
CREATE OR REPLACE FUNCTION public.kitchen_set_price(p_key text, p_id bigint, p_price numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                                                                                                                                                                                                                                                                                                                                  declare v_row public.kitchen_products;
                                                                                                                                                                                                                                                                                                                                                  begin
                                                                                                                                                                                                                                                                                                                                                    if public.kitchen_key_id(p_key) is null then return null; end if;
                                                                                                                                                                                                                                                                                                                                                      p_price := round(p_price, 2);
                                                                                                                                                                                                                                                                                                                                                        if p_price is not null and (p_price < 0 or p_price >= 100000000) then raise exception 'Цена — от 0 до 99 999 999 сом'; end if;
                                                                                                                                                                                                                                                                                                                                                          update public.kitchen_products
                                                                                                                                                                                                                                                                                                                                                            set price = p_price, updated_at = now(),
                                                                                                                                                                                                                                                                                                                                                                  price_at = case when price is distinct from p_price then case when p_price is null then null else now() end else price_at end
                                                                                                                                                                                                                                                                                                                                                                    where id = p_id and archived_at is null
                                                                                                                                                                                                                                                                                                                                                                      returning * into v_row;
                                                                                                                                                                                                                                                                                                                                                                        if v_row.id is null then raise exception 'Продукт не найден — его убрали с другого телефона. Обновите страницу'; end if;
                                                                                                                                                                                                                                                                                                                                                                          return public.kitchen_row(v_row);
                                                                                                                                                                                                                                                                                                                                                                          end $function$;

-- kokoro_admin_branch()
CREATE OR REPLACE FUNCTION public.kokoro_admin_branch()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select branch from public.admins where user_id = auth.uid()
$function$;

-- kokoro_branch_at(p_lat double precision, p_lon double precision)
CREATE OR REPLACE FUNCTION public.kokoro_branch_at(p_lat double precision, p_lon double precision)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_line constant double precision[] := array[
    [43.2, 74.60899], [42.94914, 74.60899], [42.94509, 74.60968], [42.94401, 74.60956], [42.94196, 74.60881], [42.93843, 74.6086],
    [42.93584, 74.60979], [42.93509, 74.60969], [42.93279, 74.61032], [42.93147, 74.60962], [42.93006, 74.61065], [42.92592, 74.6119],
    [42.91809, 74.61196], [42.91553, 74.61249], [42.90698, 74.61254], [42.89545, 74.61143], [42.88062, 74.61175], [42.86289, 74.61094],
    [42.82388, 74.60673], [42.82305, 74.60644], [42.82254, 74.60599], [42.82193, 74.60489], [42.82163, 74.60154], [42.82103, 74.59877],
    [42.8205, 74.59812], [42.81452, 74.59469], [42.80818, 74.59151], [42.80359, 74.58834], [42.5, 74.58834]];
  v_border double precision;
begin
  if p_lat is null or p_lon is null then return null; end if;
  for i in 2 .. array_length(v_line, 1) loop
    if p_lat <= v_line[i - 1][1] and p_lat >= v_line[i][1] then
      v_border := v_line[i - 1][2] + (v_line[i][2] - v_line[i - 1][2]) * (p_lat - v_line[i - 1][1]) / (v_line[i][1] - v_line[i - 1][1]);
      return case when p_lon < v_border then 'kulieva' else 'kokzhar' end;
    end if;
  end loop;
  return null;
end $function$;

-- kokoro_branch_dispatch(p_branch text)
CREATE OR REPLACE FUNCTION public.kokoro_branch_dispatch(p_branch text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select b.dispatch from public.branch_settings b where b.branch = p_branch), 'manual')
$function$;

-- kokoro_branch_rain_by()
CREATE OR REPLACE FUNCTION public.kokoro_branch_rain_by()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.rain is distinct from old.rain and auth.uid() is not null then
    new.rain_by := 'manager';
    new.rain_set_at := now();
  end if;
  return new;
end $function$;

-- kokoro_branch_rain_orders()
CREATE OR REPLACE FUNCTION public.kokoro_branch_rain_orders()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.rain is distinct from old.rain then perform public.kokoro_rain_apply(new.branch, new.rain); end if;
  return new;
end $function$;

-- kokoro_can_see_order(p_branch text)
CREATE OR REPLACE FUNCTION public.kokoro_can_see_order(p_branch text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_branch is null or public.kokoro_is_owner() or p_branch = public.kokoro_admin_branch()
$function$;

-- kokoro_chat_add(p_order bigint, p_author text, p_courier bigint, p_body text, p_limit integer)
CREATE OR REPLACE FUNCTION public.kokoro_chat_add(p_order bigint, p_author text, p_courier bigint, p_body text, p_limit integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_body text := regexp_replace(coalesce(p_body, ''), '^\s+|\s+$', '', 'g');
  v_id bigint;
  v_at timestamptz;
begin
  if char_length(v_body) = 0 then raise exception 'Напишите сообщение'; end if;
  if char_length(v_body) > 500 then raise exception 'Сообщение длиннее 500 знаков — сократите его'; end if;
  if (select count(*) from public.order_messages m where m.order_id = p_order and m.author = p_author
        and m.created_at > now() - interval '10 minutes') >= p_limit then
    raise exception 'Слишком много сообщений — подождите пару минут';
  end if;
  insert into public.order_messages (order_id, author, courier_id, body) values (p_order, p_author, p_courier, v_body)
  returning id, created_at into v_id, v_at;
  return json_build_object('id', v_id, 'at', v_at);
end $function$;

-- kokoro_chat_messages(p_order bigint, p_after bigint, p_names boolean)
CREATE OR REPLACE FUNCTION public.kokoro_chat_messages(p_order bigint, p_after bigint, p_names boolean)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(json_agg(json_build_object('id', m.id, 'author', m.author, 'body', m.body, 'at', m.created_at,
           'courier', case when p_names and m.author = 'courier' then c.name end) order by m.id), '[]'::json)
  from (select * from public.order_messages x where x.order_id = p_order and x.id > coalesce(p_after, 0) order by x.id limit 100) m
  left join public.couriers c on c.id = m.courier_id
$function$;

-- kokoro_chat_open(o orders)
CREATE OR REPLACE FUNCTION public.kokoro_chat_open(o orders)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select o.status <> 'awaiting_payment' and (o.status not in ('done', 'canceled')
    or (case when o.status = 'done' then coalesce(o.done_at, o.updated_at) else o.updated_at end) > now() - interval '2 hours')
$function$;

-- kokoro_chat_summary(p_orders bigint[])
CREATE OR REPLACE FUNCTION public.kokoro_chat_summary(p_orders bigint[])
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(json_agg(json_build_object('order_id', s.order_id, 'last_id', s.last_id, 'last_author', s.last_author, 'count', s.n)
           order by s.order_id), '[]'::json)
  from (select m.order_id, max(m.id) as last_id, count(*) as n,
               (select x.author from public.order_messages x where x.order_id = m.order_id order by x.id desc limit 1) as last_author
        from public.order_messages m where m.order_id = any(p_orders) group by m.order_id) s
$function$;

-- kokoro_chat_writable(o orders)
CREATE OR REPLACE FUNCTION public.kokoro_chat_writable(o orders)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ select o.status not in ('awaiting_payment', 'done', 'canceled') $function$;

-- kokoro_code(p_len integer)
CREATE OR REPLACE FUNCTION public.kokoro_code(p_len integer)
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + get_byte(r.b, i) % 31, 1), '' order by i)
  from (select extensions.gen_random_bytes(p_len) as b) r, generate_series(0, p_len - 1) i
$function$;

-- kokoro_code_label(p_code text)
CREATE OR REPLACE FUNCTION public.kokoro_code_label(p_code text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$ select substr(p_code, 1, 4) || '-' || substr(p_code, 5, 4) || '-' || substr(p_code, 9, 4) $function$;

-- kokoro_courier_fee(o orders)
CREATE OR REPLACE FUNCTION public.kokoro_courier_fee(o orders)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case when coalesce(o.delivery_fee, 0) > 0 then (case when o.door then public.kokoro_door_fee() else 0 end)
              when o.delivery_quote ->> 'price' is null then null
              else (o.delivery_quote ->> 'price')::integer + case when o.door then public.kokoro_door_fee() else 0 end end
$function$;

-- kokoro_courier_fits(c couriers, p_order_id bigint, p_branch text)
CREATE OR REPLACE FUNCTION public.kokoro_courier_fits(c couriers, p_order_id bigint, p_branch text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select c.phone is not null and public.kokoro_courier_ready(c) and (c.branch is null or c.branch = p_branch)
    and (select count(*) from public.orders h where h.courier_id = c.id and h.status in ('new', 'confirmed', 'cooking', 'delivering'))
        < public.kokoro_courier_limit(c.branch)
    and not exists (select 1 from public.orders d where d.courier_id = c.id and d.status = 'delivering')
    and not exists (select 1 from public.courier_declines x where x.order_id = p_order_id and x.courier_id = c.id)
    and (c.branch is not null or not exists (select 1 from public.orders h where h.courier_id = c.id
           and h.status in ('new', 'confirmed', 'cooking', 'delivering') and h.branch <> p_branch))
    and public.kokoro_courier_on_the_way(c.id, p_order_id)
$function$;

-- kokoro_courier_free(p_branch text)
CREATE OR REPLACE FUNCTION public.kokoro_courier_free(p_branch text)
 RETURNS SETOF orders
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select o.* from public.orders o
  cross join lateral (select public.kokoro_order_due(coalesce(o.paid_at, o.created_at), o.delivery_time, o.branch) as due) d
  where o.courier_id is null and o.branch is not null and (p_branch is null or o.branch = p_branch)
    and o.status in ('confirmed', 'cooking') and o.fulfillment = 'delivery'
    and public.kokoro_branch_dispatch(o.branch) = 'auto'
    and d.due <= public.kokoro_now() and d.due > public.kokoro_now() - interval '4 hours'
$function$;

-- kokoro_courier_id(p_key text)
CREATE OR REPLACE FUNCTION public.kokoro_courier_id(p_key text)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id from public.couriers c
  where length(regexp_replace(upper(coalesce(p_key, '')), '[^0-9A-Z]', '', 'g')) = 12
    and c.key_hash = public.kokoro_key_hash(p_key) and c.active
$function$;

-- kokoro_courier_limit(p_branch text)
CREATE OR REPLACE FUNCTION public.kokoro_courier_limit(p_branch text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(max(b.courier_limit), 3) from public.branch_settings b where p_branch is null or b.branch = p_branch
$function$;

-- kokoro_courier_need_phone(p_id bigint)
CREATE OR REPLACE FUNCTION public.kokoro_courier_need_phone(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from public.couriers c where c.id = p_id and c.phone is null) then
    raise exception 'Сначала впишите свой номер телефона вверху страницы — без него заказы не берутся';
  end if;
end $function$;

-- kokoro_courier_on_shift(c couriers)
CREATE OR REPLACE FUNCTION public.kokoro_courier_on_shift(c couriers)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select c.active and coalesce(c.shift_on_at > coalesce(c.shift_off_at, '-infinity'::timestamptz), false)
     and coalesce(c.seen_at >= public.kokoro_workday_start(), false)
$function$;

-- kokoro_courier_on_the_way(p_courier bigint, p_order_id bigint)
CREATE OR REPLACE FUNCTION public.kokoro_courier_on_the_way(p_courier bigint, p_order_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select public.kokoro_promise_at(o) < public.kokoro_now() + interval '30 minutes'
                     or coalesce(o.ready_at < public.kokoro_now() - interval '15 minutes', false)
                     or not exists (select 1 from public.orders h
                                    where h.courier_id = p_courier and h.id <> o.id and h.status in ('new', 'confirmed', 'cooking')
                                      and not coalesce(public.kokoro_points_on_the_way(o.branch, o.lat, o.lon, h.lat, h.lon),
                                                       public.kokoro_order_near_kitchen(o) or public.kokoro_order_near_kitchen(h)))
                   from public.orders o where o.id = p_order_id), true)
$function$;

-- kokoro_courier_put(p_id bigint, p_lat double precision, p_lon double precision, p_accuracy real)
CREATE OR REPLACE FUNCTION public.kokoro_courier_put(p_id bigint, p_lat double precision, p_lon double precision, p_accuracy real)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_lat is null or p_lon is null or p_lat not between 42.55 and 43.25 or p_lon not between 74.05 and 75.15 then return false; end if;
  if not exists (select 1 from public.orders o join public.couriers c on c.id = o.courier_id
                 where o.courier_id = p_id and o.status = 'delivering'
                   and coalesce(o.delivering_at, o.updated_at) > coalesce(c.shift_off_at, '-infinity'::timestamptz)) then
    return false;
  end if;
  insert into public.courier_locations as l (courier_id, lat, lon, accuracy, live_until, at)
  values (p_id, p_lat, p_lon, case when p_accuracy between 0 and 100000 then p_accuracy end, null, now())
  on conflict (courier_id) do update set lat = excluded.lat, lon = excluded.lon, accuracy = excluded.accuracy, at = excluded.at,
    live_until = case when l.live_until > now() then l.live_until end
    where l.at < now() - interval '15 seconds';
  return found;
end $function$;

-- kokoro_courier_ready(c couriers)
CREATE OR REPLACE FUNCTION public.kokoro_courier_ready(c couriers)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.kokoro_courier_on_shift(c) and coalesce(c.seen_at > public.kokoro_now() - interval '60 minutes', false)
$function$;

-- kokoro_couriers_branch_set()
CREATE OR REPLACE FUNCTION public.kokoro_couriers_branch_set()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.branch is not null then new.branch_set_at := coalesce(new.branch_set_at, now()); end if;
  elsif auth.uid() is not null then
    new.branch_set_at := now();
  end if;
  return new;
end $function$;

-- kokoro_delivery_at(p_paid timestamp with time zone, p_delivery_time text)
CREATE OR REPLACE FUNCTION public.kokoro_delivery_at(p_paid timestamp with time zone, p_delivery_time text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_m text[] := regexp_match(coalesce(p_delivery_time, ''), 'Ко времени:\s*(\d{1,2}):(\d{2})(?:,\s*(\d{1,2})\.(\d{1,2}))?');
  v_local timestamp;
  v_day date;
  v_at timestamptz;
begin
  if v_m is null or v_m[1]::integer > 23 or v_m[2]::integer > 59 then return null; end if;
  v_local := (coalesce(p_paid, public.kokoro_now()) at time zone 'UTC') + interval '6 hours';
  if v_m[3] is not null then
    -- Год — год оплаты; день на полгода раньше — следующий год (оплатили 31.12 заказ на 01.01), на полгода позже — прошлый
    -- (заказ «00:00, 31.12» оплатили уже 01.01). Несуществующий день (31.02; 29.02 не в високосный год) — null
    begin
      v_day := make_date(extract(year from v_local)::integer, v_m[4]::integer, v_m[3]::integer);
      if v_day < v_local::date - 180 then v_day := make_date(extract(year from v_local)::integer + 1, v_m[4]::integer, v_m[3]::integer);
      elsif v_day > v_local::date + 180 then v_day := make_date(extract(year from v_local)::integer - 1, v_m[4]::integer, v_m[3]::integer);
      end if;
    exception when others then return null;
    end;
    v_at := ((v_day + make_interval(hours => v_m[1]::integer, mins => v_m[2]::integer)) - interval '6 hours') at time zone 'UTC';
    if v_m[1]::integer = 0 and v_m[2]::integer = 0 then v_at := v_at + interval '24 hours'; end if;
    -- Сайт пишет только сегодня или завтра. День дальше чем через 3 суток после оплаты или раньше чем за сутки до неё —
    -- подпись не с сайта: null, как «Как можно скорее» (иначе «Ко времени: 12:00, 01.01» в ноябре спрятал бы заказ от курьеров)
    if v_at > coalesce(p_paid, public.kokoro_now()) + interval '3 days' or v_at < coalesce(p_paid, public.kokoro_now()) - interval '1 day' then
      return null;
    end if;
    return v_at;
  end if;
  v_at := ((date_trunc('day', v_local) - interval '6 hours') at time zone 'UTC') + make_interval(hours => v_m[1]::integer, mins => v_m[2]::integer);
  if p_paid is not null and v_at < p_paid - interval '1 hour' then v_at := v_at + interval '24 hours'; end if;
  return v_at;
end $function$;

-- kokoro_delivery_tariff(p_km numeric)
CREATE OR REPLACE FUNCTION public.kokoro_delivery_tariff(p_km numeric)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when p_km is null or p_km < 0 then null
              when p_km <= 2 then 120 when p_km <= 3 then 140 when p_km <= 4 then 160 when p_km <= 5 then 180
              when p_km <= 6 then 200 when p_km <= 7 then 220 when p_km <= 8 then 240 when p_km <= 10 then 280
              when p_km <= 12 then 320 when p_km <= 15 then 380 end + 50
$function$;

-- kokoro_dispatch()
CREATE OR REPLACE FUNCTION public.kokoro_dispatch()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not pg_try_advisory_xact_lock(15015) then return 0; end if;
  insert into public.kokoro_dispatch_state as s (id, ran_at) values (1, public.kokoro_now())
  on conflict (id) do update set ran_at = excluded.ran_at
    where s.ran_at is null or s.ran_at <= excluded.ran_at - interval '5 seconds';
  if not found then return 0; end if;
  return public.kokoro_dispatch_run();
end $function$;

-- kokoro_dispatch_run()
CREATE OR REPLACE FUNCTION public.kokoro_dispatch_run()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.kokoro_dispatch_run(null::bigint)
$function$;

-- kokoro_dispatch_run(p_skip bigint)
CREATE OR REPLACE FUNCTION public.kokoro_dispatch_run(p_skip bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := public.kokoro_now();
  v_order record;
  v_cand record;
  v_courier bigint;
  v_done integer := 0;
begin
  -- 1. Вернуть в общий список назначенные базой и не взятые заказы: курьер ушёл со смены, час не открывал страницу или уже
  --    5 минут везёт другие заказы — уехал без этого пакета. Отказом это не считается: заказ может вернуться к нему же.
  --    Время «В пути» ставит триггер courier-pickup.sql по настоящим часам — и сравниваем с настоящими
  update public.orders o set courier_id = null, dispatched_at = null
  where o.id in (
    select x.id from public.orders x
    join public.couriers c on c.id = x.courier_id
    where x.dispatched_at is not null and x.status in ('confirmed', 'cooking')
      and (not public.kokoro_courier_ready(c)
           or exists (select 1 from public.orders d where d.courier_id = x.courier_id and d.status = 'delivering'
                      and d.delivering_at < now() - interval '5 minutes'))
    for no key update of x skip locked);

  -- 2. Назначить свободные заказы — от самого старого «пора везти». Курьер — kokoro_courier_fits: на смене, своей точки или
  --    обеих (с заказами на руках — той же кухни), у кухни (заказов «В пути» нет), заказов на руках меньше предела своей
  --    точки, от этого заказа не отказывался. Первым — у кого меньше заказов на руках, затем кто дольше не получал нового.
  --    Счётчики — заново на каждом заказе
  for v_order in
    select o.id, o.branch from public.kokoro_courier_free(null) o
    order by public.kokoro_order_due(coalesce(o.paid_at, o.created_at), o.delivery_time, o.branch), o.id
  loop
    v_courier := null;
    for v_cand in
      select c.id from public.couriers c
      cross join lateral (select count(*) as n from public.orders h
                          where h.courier_id = c.id and h.status in ('new', 'confirmed', 'cooking', 'delivering')) m
      where c.id is distinct from p_skip and public.kokoro_courier_fits(c, v_order.id, v_order.branch)
      order by m.n, c.last_assigned_at nulls first, c.id
    loop
      -- Сначала строка курьера, потом заказ — тот же порядок замков, что в courier_take. Курьер как раз нажимает
      -- «Забрал — еду» — следующий кандидат
      perform 1 from public.couriers c where c.id = v_cand.id for no key update skip locked;
      continue when not found;
      -- Под замком — ещё раз те же условия: пока выбирали, курьер мог сам забрать заказ (в том числе заказ другой кухни)
      continue when not exists (
        select 1 from public.couriers c where c.id = v_cand.id and public.kokoro_courier_fits(c, v_order.id, v_order.branch));
      v_courier := v_cand.id;
      exit;
    end loop;
    -- Некому — заказ остаётся в «Свободных», его возьмёт курьер сам или назначим на следующем ходу
    continue when v_courier is null;
    perform 1 from public.orders o where o.id = v_order.id and o.courier_id is null and o.status in ('confirmed', 'cooking')
      for no key update skip locked;
    continue when not found;
    update public.orders o set courier_id = v_courier, dispatched_at = v_now
    where o.id = v_order.id and o.courier_id is null and o.status in ('confirmed', 'cooking');
    continue when not found;
    update public.couriers set last_assigned_at = v_now where id = v_courier;
    v_done := v_done + 1;
  end loop;
  return v_done;
end $function$;

-- kokoro_door_fee()
CREATE OR REPLACE FUNCTION public.kokoro_door_fee()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$ select 50 $function$;

-- kokoro_is_owner()
CREATE OR REPLACE FUNCTION public.kokoro_is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.admins where user_id = auth.uid() and branch is null)
$function$;

-- kokoro_key_hash(p_key text)
CREATE OR REPLACE FUNCTION public.kokoro_key_hash(p_key text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select encode(extensions.digest(regexp_replace(upper(coalesce(p_key, '')), '[^0-9A-Z]', '', 'g'), 'sha256'), 'hex')
$function$;

-- kokoro_kitchen_label(p_branch text)
CREATE OR REPLACE FUNCTION public.kokoro_kitchen_label(p_branch text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_branch when 'kulieva' then 'ул. Кулиева, 40' when 'kokzhar' then 'ул. Кок-Жайык, 120а' end
$function$;

-- kokoro_kitchen_lat(p_branch text)
CREATE OR REPLACE FUNCTION public.kokoro_kitchen_lat(p_branch text)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_branch when 'kulieva' then 42.879575 when 'kokzhar' then 42.841170 end
$function$;

-- kokoro_kitchen_lon(p_branch text)
CREATE OR REPLACE FUNCTION public.kokoro_kitchen_lon(p_branch text)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_branch when 'kulieva' then 74.568402 when 'kokzhar' then 74.648957 end
$function$;

-- kokoro_mfa_required()
CREATE OR REPLACE FUNCTION public.kokoro_mfa_required()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ select false $function$;

-- kokoro_need_admin()
CREATE OR REPLACE FUNCTION public.kokoro_need_admin()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Нет доступа' using errcode = '42501'; end if;
end $function$;

-- kokoro_need_courier_access(p_id bigint)
CREATE OR REPLACE FUNCTION public.kokoro_need_courier_access(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mine text;
  v_branch text;
begin
  perform public.kokoro_need_admin();
  v_mine := public.kokoro_admin_branch();
  select c.branch into v_branch from public.couriers c where c.id = p_id;
  if not found then raise exception 'Курьер не найден'; end if;
  if v_mine is not null and v_branch is not null and v_branch <> v_mine then raise exception 'Это курьер другой точки'; end if;
end $function$;

-- kokoro_now()
CREATE OR REPLACE FUNCTION public.kokoro_now()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(nullif(current_setting('kokoro.now', true), '')::timestamptz, now())
$function$;

-- kokoro_order_by_token(p_token text)
CREATE OR REPLACE FUNCTION public.kokoro_order_by_token(p_token text)
 RETURNS SETOF orders
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select o.* from public.orders o
  where p_token is not null and (o.pay_token::text = p_token or o.track_code = upper(btrim(p_token))) limit 1
$function$;

-- kokoro_order_due(p_paid timestamp with time zone, p_delivery_time text, p_branch text)
CREATE OR REPLACE FUNCTION public.kokoro_order_due(p_paid timestamp with time zone, p_delivery_time text, p_branch text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_local timestamp := (p_paid at time zone 'UTC') + interval '6 hours';
  v_midnight timestamptz := (date_trunc('day', v_local) - interval '6 hours') at time zone 'UTC';
  v_start timestamptz := case when extract(hour from v_local) >= 12 then p_paid else v_midnight + interval '12 hours' end;
  v_at timestamptz;
  v_go timestamp;
begin
  if p_paid is null then return v_start; end if;
  v_at := public.kokoro_delivery_at(p_paid, p_delivery_time);
  if v_at is null then return v_start; end if;
  v_go := ((v_at - make_interval(mins => coalesce((select b.wait_minutes from public.branch_settings b where b.branch = p_branch), 90))) at time zone 'UTC')
          + interval '6 hours';
  if extract(hour from v_go) < 12 then v_go := date_trunc('day', v_go) + interval '12 hours'; end if;
  return greatest(v_start, (v_go - interval '6 hours') at time zone 'UTC');
end $function$;

-- kokoro_order_near_kitchen(o orders)
CREATE OR REPLACE FUNCTION public.kokoro_order_near_kitchen(o orders)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(jsonb_typeof(o.delivery_quote -> 'km') = 'number' and (o.delivery_quote ->> 'km')::numeric <= 1.5
                  and o.delivery_quote ->> 'from' = public.kokoro_kitchen_label(o.branch), false)
$function$;

-- kokoro_order_pickup()
CREATE OR REPLACE FUNCTION public.kokoro_order_pickup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.fulfillment = 'pickup' then
    new.lat := null;
    new.lon := null;
    new.delivery_quote := null;
    new.door := false;
    if tg_op = 'UPDATE' and old.fulfillment = 'pickup' and new.branch is distinct from old.branch and new.status = 'awaiting_payment'
       and auth.uid() is null and coalesce(current_setting('kokoro.pickup_branch', true), '') <> 'on' then
      new.branch := old.branch;
    end if;
    if tg_op = 'UPDATE' and new.branch is distinct from old.branch and public.kokoro_kitchen_label(new.branch) is not null then
      new.address := 'Самовывоз — ' || public.kokoro_kitchen_label(new.branch);
    end if;
  end if;
  return new;
end $function$;

-- kokoro_orders_branch()
CREATE OR REPLACE FUNCTION public.kokoro_orders_branch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_at text;
  v_mine text;
begin
  if new.lat is not null and new.lon is not null and new.status = 'awaiting_payment'
     and (tg_op = 'INSERT' or new.lat is distinct from old.lat or new.lon is distinct from old.lon) then
    v_at := public.kokoro_branch_at(new.lat, new.lon);
    if v_at is not null then new.branch := v_at; new.branch_guessed := false; end if;
  end if;
  -- Точки нет, а заказ оплатили, взяли в работу, вернули из «Отменён» или сменили ему статус (ночной заказ до запуска)
  if new.branch is null and (new.status not in ('awaiting_payment', 'canceled') or new.paid_at is not null)
     and (tg_op = 'INSERT' or new.status is distinct from old.status or (old.paid_at is null and new.paid_at is not null)) then
    v_at := public.kokoro_branch_at(new.lat, new.lon);
    v_mine := public.kokoro_admin_branch();
    if v_mine is not null then
      -- Меняет менеджер точки — заказ его точки (иначе свою же правку он не сохранил бы: чужую точку ему не видно).
      -- Точка на карте с другой стороны Советской — пометка «проверьте адрес»
      new.branch := v_mine;
      new.branch_guessed := v_at is not null and v_at <> v_mine;
    else
      -- Покупатель (чек), курьер или владелец: по точке на карте, иначе первая принимающая (сначала Кулиева) с пометкой
      new.branch := coalesce(v_at, (select b.branch from public.branch_settings b where b.accepting_orders
                                    order by b.branch = 'kulieva' desc limit 1), 'kulieva');
      new.branch_guessed := v_at is null;
    end if;
  end if;
  return new;
end $function$;

-- kokoro_orders_day_number()
CREATE OR REPLACE FUNCTION public.kokoro_orders_day_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_day date;
  v_start integer;
begin
  -- Номер выдаёт только база: из панели или запроса его не поменять. Сменилась точка — номер выдаётся заново
  if tg_op = 'UPDATE' then
    new.day_number := old.day_number;
    if new.branch is distinct from old.branch then
      new.day_number := null;
      -- Заказ без точки (ночной, до запуска) взяла точка — номер прежний, покупатель его уже знает. Если у точки за этот день
      -- такой номер уже есть — новый
      if old.branch is null and old.day_number is not null and new.branch is not null and not exists (
        select 1 from public.orders o
        where o.id <> new.id and o.branch = new.branch and o.day_number = old.day_number
          and (o.created_at at time zone 'Asia/Bishkek')::date = (new.created_at at time zone 'Asia/Bishkek')::date) then
        new.day_number := old.day_number;
      end if;
    end if;
  else
    new.day_number := null;
  end if;
  -- В работе или оплачен (чек мог прийти к уже отменённому заказу) — как в day-numbers.sql
  if new.day_number is null and (new.status not in ('awaiting_payment', 'canceled') or new.paid_at is not null) then
    v_day := (coalesce(new.created_at, now()) at time zone 'Asia/Bishkek')::date;
    if new.branch is null then
      insert into public.kokoro_day_counter as c (day, last) values (v_day, 1)
      on conflict (day) do update set last = c.last + 1
      returning c.last into new.day_number;
    else
      -- Следующий после всех номеров дня этой точки и заказов без точки (ночных, в том числе уже взятых точкой со своим номером):
      -- счётчик не выдаст номер, который уже есть, даже если его сдвинули руками или файл запускали повторно
      select coalesce(max(o.day_number), 0) into v_start from public.orders o
      where (o.branch is null or o.branch = new.branch) and o.day_number is not null
        and (o.created_at at time zone 'Asia/Bishkek')::date = v_day;
      insert into public.kokoro_branch_day_counter as c (day, branch, last) values (v_day, new.branch, v_start + 1)
      on conflict (day, branch) do update set last = greatest(c.last, v_start) + 1
      returning c.last into new.day_number;
    end if;
  end if;
  return new;
end $function$;

-- kokoro_orders_delivering_at()
CREATE OR REPLACE FUNCTION public.kokoro_orders_delivering_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'delivering' and (tg_op = 'INSERT' or old.status is distinct from 'delivering') then
    new.delivering_at := now();
  elsif tg_op = 'INSERT' then
    new.delivering_at := null;
  else
    new.delivering_at := old.delivering_at;
  end if;
  return new;
end $function$;

-- kokoro_orders_dispatched_at()
CREATE OR REPLACE FUNCTION public.kokoro_orders_dispatched_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    new.dispatched_at := null;
  elsif new.courier_id is distinct from old.courier_id and new.dispatched_at is not distinct from old.dispatched_at then
    new.dispatched_at := null;
  end if;
  return new;
end $function$;

-- kokoro_orders_done_at()
CREATE OR REPLACE FUNCTION public.kokoro_orders_done_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    new.done_at := case when new.status = 'done' then now() end;
  elsif new.status = 'done' and old.status is distinct from 'done' then
    new.done_at := now();
  elsif new.status <> 'done' then
    new.done_at := null;
  else
    new.done_at := old.done_at;
  end if;
  return new;
end $function$;

-- kokoro_orders_shift_on()
CREATE OR REPLACE FUNCTION public.kokoro_orders_shift_on()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'delivering' and new.courier_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'delivering' or old.courier_id is distinct from new.courier_id) then
    update public.couriers c set shift_on_at = public.kokoro_now()
    where c.id = new.courier_id and c.active and not public.kokoro_courier_on_shift(c);
  end if;
  return null;
end $function$;

-- kokoro_orders_throttle()
CREATE OR REPLACE FUNCTION public.kokoro_orders_throttle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
perform public.kokoro_throttle_check(new.phone);
return new;
end $function$;

-- kokoro_orders_wait()
CREATE OR REPLACE FUNCTION public.kokoro_orders_wait()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.wait_minutes is null and new.status not in ('awaiting_payment', 'canceled')
     and (tg_op = 'INSERT' or old.status = 'awaiting_payment' or (old.paid_at is null and new.paid_at is not null)) then
    new.wait_minutes := least(greatest(coalesce((select b.wait_minutes from public.branch_settings b where b.branch = new.branch),
                                                (select s.wait_minutes from public.order_settings s where s.id = 1), 90), 15), 480);
  end if;
  return new;
end $function$;

-- kokoro_phone_norm(p_phone text)
CREATE OR REPLACE FUNCTION public.kokoro_phone_norm(p_phone text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare d text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if d ~ '^996[0-9]{9}$' then return '+' || d; end if;
  if d ~ '^0[0-9]{9}$' then return '+996' || substr(d, 2); end if;
  if d ~ '^[1-9][0-9]{8}$' then return '+996' || d; end if;
  if btrim(coalesce(p_phone, '')) like '+%' and d ~ '^[1-9][0-9]{9,14}$' and d !~ '^996' then return '+' || d; end if;
  return null;
end $function$;

-- kokoro_points_on_the_way(p_branch text, a_lat double precision, a_lon double precision, b_lat double precision, b_lon double precision)
CREATE OR REPLACE FUNCTION public.kokoro_points_on_the_way(p_branch text, a_lat double precision, a_lon double precision, b_lat double precision, b_lon double precision)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  k_lat double precision := public.kokoro_kitchen_lat(p_branch);
  k_lon double precision := public.kokoro_kitchen_lon(p_branch);
  c double precision;
  ax double precision; ay double precision; bx double precision; by_ double precision;
  v_a double precision; v_b double precision; v_ab double precision; v_far double precision; v_detour double precision;
begin
  if a_lat is null or a_lon is null or b_lat is null or b_lon is null or k_lat is null then return null; end if;
  c := cos(radians(k_lat));
  ax := (a_lon - k_lon) * c * 111.32; ay := (a_lat - k_lat) * 111.32;
  bx := (b_lon - k_lon) * c * 111.32; by_ := (b_lat - k_lat) * 111.32;
  v_a := sqrt(ax * ax + ay * ay);
  v_b := sqrt(bx * bx + by_ * by_);
  v_ab := sqrt((ax - bx) ^ 2 + (ay - by_) ^ 2);
  if v_ab <= 1.5 then return true; end if;
  v_far := greatest(v_a, v_b);
  v_detour := least(v_a, v_b) + v_ab - v_far;
  return v_detour <= 1.0 or (v_detour <= 1.5 and v_detour <= 0.3 * v_far);
end $function$;

-- kokoro_promise_at(o orders)
CREATE OR REPLACE FUNCTION public.kokoro_promise_at(o orders)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(public.kokoro_delivery_at(coalesce(o.paid_at, o.created_at), o.delivery_time),
    public.kokoro_order_due(coalesce(o.paid_at, o.created_at), o.delivery_time, o.branch)
      + make_interval(mins => coalesce(o.wait_minutes, (select b.wait_minutes from public.branch_settings b where b.branch = o.branch), 90)))
$function$;

-- kokoro_rain_apply(p_branch text, p_on boolean)
CREATE OR REPLACE FUNCTION public.kokoro_rain_apply(p_branch text, p_on boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fee integer := public.kokoro_rain_fee();
  v_n integer;
begin
  if p_on then
    update public.orders o
    set delivery_quote = case
          when (o.delivery_quote ->> 'price')::int = public.kokoro_delivery_tariff((o.delivery_quote ->> 'km')::numeric) + v_fee
            then o.delivery_quote || jsonb_build_object('rain', v_fee)
          else o.delivery_quote || jsonb_build_object('price', (o.delivery_quote ->> 'price')::int + v_fee, 'rain', v_fee, 'rain_on', true) end
    where o.branch = p_branch and o.status in ('awaiting_payment', 'new', 'confirmed', 'cooking', 'delivering')
      and coalesce(o.fulfillment, 'delivery') = 'delivery' and coalesce(o.delivery_fee, 0) = 0
      and jsonb_typeof(o.delivery_quote -> 'price') = 'number' and jsonb_typeof(o.delivery_quote -> 'km') = 'number'
      and coalesce((o.delivery_quote ->> 'rain')::numeric, 0) = 0
      and greatest(o.created_at, coalesce(public.kokoro_delivery_at(coalesce(o.paid_at, o.created_at), o.delivery_time), o.created_at))
          >= ((date_trunc('day', (now() at time zone 'UTC') + interval '6 hours') - interval '6 hours') at time zone 'UTC');
  else
    update public.orders o
    set delivery_quote = (o.delivery_quote - 'rain' - 'rain_on')
      || jsonb_build_object('price', greatest(0, (o.delivery_quote ->> 'price')::int - coalesce((o.delivery_quote ->> 'rain')::int, 0)))
    where o.branch = p_branch and o.status in ('awaiting_payment', 'new', 'confirmed', 'cooking')
      and o.delivery_quote -> 'rain_on' = 'true'::jsonb and jsonb_typeof(o.delivery_quote -> 'price') = 'number';
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

-- kokoro_rain_fee()
CREATE OR REPLACE FUNCTION public.kokoro_rain_fee()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$ select 100 $function$;

-- kokoro_receipt_upload_ok(object_name text)
CREATE OR REPLACE FUNCTION public.kokoro_receipt_upload_ok(object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
select exists (select 1 from public.orders o
where o.pay_token::text = split_part(object_name, '/', 1) and o.status = 'awaiting_payment')
and (select count(*) from storage.objects where bucket_id = 'receipts' and split_part(name, '/', 1) = split_part(object_name, '/', 1)) < 3
$function$;

-- kokoro_receipt_visible(object_name text)
CREATE OR REPLACE FUNCTION public.kokoro_receipt_visible(object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.kokoro_is_owner() or exists (
    select 1 from public.orders o
    where o.pay_token::text = split_part(object_name, '/', 1) and (o.branch is null or o.branch = public.kokoro_admin_branch()))
$function$;

-- kokoro_staff_add(p_courier bigint, p_author text, p_body text, p_limit integer)
CREATE OR REPLACE FUNCTION public.kokoro_staff_add(p_courier bigint, p_author text, p_body text, p_limit integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_body text := regexp_replace(coalesce(p_body, ''), '^\s+|\s+$', '', 'g');
  v_id bigint;
  v_at timestamptz;
begin
  if char_length(v_body) = 0 then raise exception 'Напишите сообщение'; end if;
  if char_length(v_body) > 500 then raise exception 'Сообщение длиннее 500 знаков — сократите его'; end if;
  if (select count(*) from public.courier_messages m where m.courier_id = p_courier and m.author = p_author
        and m.created_at > now() - interval '10 minutes') >= p_limit then
    raise exception 'Слишком много сообщений — подождите пару минут';
  end if;
  insert into public.courier_messages (courier_id, author, admin_branch, admin_id, body)
  values (p_courier, p_author, case when p_author = 'manager' then public.kokoro_admin_branch() end,
          case when p_author = 'manager' then auth.uid() end, v_body)
  returning id, created_at into v_id, v_at;
  return json_build_object('id', v_id, 'at', v_at);
end $function$;

-- kokoro_staff_messages(p_courier bigint, p_after bigint, p_viewer uuid)
CREATE OR REPLACE FUNCTION public.kokoro_staff_messages(p_courier bigint, p_after bigint, p_viewer uuid)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(json_agg(json_build_object('id', m.id, 'author', m.author, 'body', m.body, 'at', m.created_at,
           'label', case when m.author = 'manager' then case m.admin_branch when 'kulieva' then 'Менеджер Кулиева'
                         when 'kokzhar' then 'Менеджер Кок-Жар' else 'Владелец' end end,
           'own', case when p_viewer is not null then m.author = 'manager' and m.admin_id is not distinct from p_viewer end)
         order by m.id), '[]'::json)
  from (
    (select * from public.courier_messages x where x.courier_id = p_courier and coalesce(p_after, 0) > 0 and x.id > p_after
     order by x.id limit 100)
    union all
    (select * from public.courier_messages x where x.courier_id = p_courier and coalesce(p_after, 0) <= 0
     order by x.id desc limit 50)
  ) m
$function$;

-- kokoro_staff_summary(p_courier bigint)
CREATE OR REPLACE FUNCTION public.kokoro_staff_summary(p_courier bigint)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select json_build_object('last_id', m.id, 'last_author', m.author)
  from public.courier_messages m where m.courier_id = p_courier order by m.id desc limit 1
$function$;

-- kokoro_tg_handle(p_update jsonb)
CREATE OR REPLACE FUNCTION public.kokoro_tg_handle(p_update jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_edited boolean := p_update ? 'edited_message';
  v_msg jsonb := coalesce(p_update -> 'message', p_update -> 'edited_message');
  v_chat bigint;
  v_text text;
  v_loc jsonb;
  v_courier public.couriers%rowtype;
  v_target public.couriers%rowtype;
  v_code text;
  v_period bigint;
  v_until timestamptz;
  v_how text := 'В начале смены: нажмите 📎 → «Геопозиция» → «Транслировать геопозицию» → «Пока не выключу». В конце смены — «Остановить трансляцию».';
begin
  if v_msg is null or v_msg -> 'chat' ->> 'type' is distinct from 'private' then return '{}'; end if;
  v_chat := (v_msg -> 'chat' ->> 'id')::bigint;
  v_text := v_msg ->> 'text';
  v_loc := v_msg -> 'location';
  select * into v_courier from public.couriers where tg_chat_id = v_chat;

  if not v_edited and v_text ~ '^/start(\s|$)' then
    v_code := upper(btrim(substr(v_text, 7)));
    if v_code = '' then
      if v_courier.id is not null and not v_courier.active then
        return public.kokoro_tg_reply(v_chat, 'Ваш доступ курьера KOKORO отключён — обратитесь к менеджеру.');
      end if;
      if v_courier.id is not null then return public.kokoro_tg_reply(v_chat, 'Вы подключены как ' || v_courier.name || '. ' || v_how); end if;
      return public.kokoro_tg_reply(v_chat, 'Это бот курьеров KOKORO. Откройте страницу курьера и нажмите «Подключить Telegram».');
    end if;
    select * into v_target from public.couriers where tg_link_code = v_code and tg_link_until > now() and active;
    if v_target.id is null then
      return public.kokoro_tg_reply(v_chat, 'Ссылка не подошла или устарела. Откройте страницу курьера и нажмите «Подключить Telegram» ещё раз.');
    end if;
    update public.couriers set tg_chat_id = null where tg_chat_id = v_chat and id <> v_target.id;
    update public.couriers set tg_chat_id = v_chat, tg_link_code = null, tg_link_until = null where id = v_target.id;
    return public.kokoro_tg_reply(v_chat, 'Готово, ' || v_target.name || '! Telegram подключён. ' || v_how);
  end if;

  -- Курьера отключил менеджер: место не принимаем и говорим прямо, а не «подключите Telegram»
  if v_courier.id is not null and not v_courier.active then
    if v_edited then return '{}'; end if;
    return public.kokoro_tg_reply(v_chat, 'Ваш доступ курьера KOKORO отключён — обратитесь к менеджеру.');
  end if;

  if v_loc is not null then
    if v_courier.id is null then
      if v_edited then return '{}'; end if;
      return public.kokoro_tg_reply(v_chat, 'Сначала подключите Telegram: откройте страницу курьера и нажмите «Подключить Telegram».');
    end if;
    -- Трансляция начата до «Закончить смену» (её забыли остановить) — не записываем; новая, начатая после, — да
    if to_timestamp((v_msg ->> 'date')::bigint) <= coalesce(v_courier.shift_off_at, '-infinity'::timestamptz) then
      if v_edited then return '{}'; end if;
      return public.kokoro_tg_reply(v_chat, 'Смена закончена — это место не показываем. Начинаете смену — включите трансляцию заново.');
    end if;
    v_period := (v_loc ->> 'live_period')::bigint;
    v_until := case when v_period is null then null
                    when v_period >= 2147483647 then 'infinity'::timestamptz
                    else to_timestamp((v_msg ->> 'date')::bigint) + make_interval(secs => v_period) end;
    insert into public.courier_locations as l (courier_id, lat, lon, accuracy, live_until, at)
    values (v_courier.id, (v_loc ->> 'latitude')::double precision, (v_loc ->> 'longitude')::double precision,
            (v_loc ->> 'horizontal_accuracy')::real, v_until,
            to_timestamp(coalesce((v_msg ->> 'edit_date')::bigint, (v_msg ->> 'date')::bigint)))
    on conflict (courier_id) do update
      set lat = excluded.lat, lon = excluded.lon, accuracy = excluded.accuracy, live_until = excluded.live_until, at = excluded.at
      where l.at <= excluded.at;   -- запоздавшее старое обновление не перетирает свежее
    if v_edited then return '{}'; end if;
    if v_period is null then
      return public.kokoro_tg_reply(v_chat, 'Это разовая точка — через несколько минут она устареет. Чтобы вас было видно всю смену: ' || v_how);
    end if;
    return public.kokoro_tg_reply(v_chat, 'Вижу вас ✓ Пока идёт трансляция, менеджер и покупатель видят, где вы. В конце смены нажмите «Остановить трансляцию».');
  end if;

  if v_edited then return '{}'; end if;
  if v_courier.id is not null then return public.kokoro_tg_reply(v_chat, v_courier.name || ', ' || v_how); end if;
  return public.kokoro_tg_reply(v_chat, 'Это бот курьеров KOKORO. Откройте страницу курьера и нажмите «Подключить Telegram».');
end $function$;

-- kokoro_tg_reply(p_chat bigint, p_text text)
CREATE OR REPLACE FUNCTION public.kokoro_tg_reply(p_chat bigint, p_text text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$ select jsonb_build_object('method', 'sendMessage', 'chat_id', p_chat, 'text', p_text) $function$;

-- kokoro_tg_update(p_secret text, p_update jsonb)
CREATE OR REPLACE FUNCTION public.kokoro_tg_update(p_secret text, p_update jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')
              = (select value from public.kokoro_private where key = 'tg_webhook_sha256'), false) is not true then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.kokoro_tg_handle(p_update);
end $function$;

-- kokoro_throttle_check(p_phone text)
CREATE OR REPLACE FUNCTION public.kokoro_throttle_check(p_phone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
v_headers json := nullif(current_setting('request.headers', true), '')::json;
v_ip text := coalesce(v_headers ->> 'cf-connecting-ip', split_part(v_headers ->> 'x-forwarded-for', ',', 1), '');
v_digits text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
begin
if v_ip <> '' then
if (select count(*) from public.kokoro_rate r where r.ip = v_ip and r.at > now() - interval '10 minutes') >= 15 then
raise exception 'С этого адреса сети уже оформлено много заказов — подождите 10 минут или напишите нам в WhatsApp';
end if;
insert into public.kokoro_rate (ip) values (v_ip);
delete from public.kokoro_rate where at < now() - interval '1 day' and random() < 0.05;
end if;
if v_digits <> '' and (select count(*) from public.orders o
where o.status = 'awaiting_payment' and o.created_at > now() - interval '1 hour'
and right(regexp_replace(coalesce(o.phone, ''), '\D', '', 'g'), 9) = v_digits) >= 5 then
raise exception 'У вас уже есть неоплаченные заказы — оплатите или отмените их';
end if;
if (select count(*) from public.orders o where o.status = 'awaiting_payment' and o.created_at > now() - interval '10 minutes') >= 300 then
raise exception 'Сейчас очень много заказов — попробуйте через несколько минут или напишите нам в WhatsApp';
end if;
end $function$;

-- kokoro_touch_updated_at()
CREATE OR REPLACE FUNCTION public.kokoro_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ begin new.updated_at = now(); return new; end $function$;

-- kokoro_usage()
CREATE OR REPLACE FUNCTION public.kokoro_usage()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
select case when public.is_admin() then json_build_object(
'db_bytes', pg_database_size(current_database()),
'receipts_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'receipts'),
'receipts_count', (select count(*) from storage.objects where bucket_id = 'receipts')
) end
$function$;

-- kokoro_weather_update(p_secret text, p_report jsonb)
CREATE OR REPLACE FUNCTION public.kokoro_weather_update(p_secret text, p_report jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b public.branch_settings;
  r jsonb;
  v_wet boolean;
  v_last timestamptz;
  v_out jsonb := '{}'::jsonb;
begin
  if coalesce(encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')
              = (select value from public.kokoro_private where key = 'weather_sha256'), false) is not true then
    raise exception 'Нет доступа' using errcode = '42501';
  end if;
  for b in select * from public.branch_settings order by branch for update loop
    r := p_report -> b.branch;
    continue when r is null or jsonb_typeof(r) <> 'object' or jsonb_typeof(r -> 'wet') <> 'boolean';
    v_wet := (r ->> 'wet')::boolean;
    v_last := case when v_wet then now() else (b.weather ->> 'last_wet_at')::timestamptz end;
    update public.branch_settings set weather = jsonb_build_object('wet', v_wet,
        'mm', case when jsonb_typeof(r -> 'mm') = 'number' then r -> 'mm' else 'null'::jsonb end,
        'symbol', left(coalesce(r ->> 'symbol', ''), 40), 'at', now(), 'last_wet_at', v_last, 'source', 'MET Norway')
      where branch = b.branch;
    if v_wet and not b.rain and not coalesce(b.rain_by = 'manager' and b.rain_set_at > now() - interval '60 minutes', false) then
      update public.branch_settings set rain = true, rain_by = 'auto', rain_set_at = now() where branch = b.branch;
      v_out := v_out || jsonb_build_object(b.branch, 'on');
    elsif not v_wet and b.rain and coalesce(v_last < now() - interval '30 minutes', true)
          and (b.rain_by = 'auto' or (b.rain_set_at < now() - interval '3 hours' and coalesce(v_last < now() - interval '3 hours', true))) then
      update public.branch_settings set rain = false, rain_by = 'auto', rain_set_at = now() where branch = b.branch;
      v_out := v_out || jsonb_build_object(b.branch, 'off');
    end if;
  end loop;
  return v_out;
end $function$;

-- kokoro_workday_start()
CREATE OR REPLACE FUNCTION public.kokoro_workday_start()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select date_trunc('day', public.kokoro_now() at time zone 'UTC') at time zone 'UTC'
$function$;

-- order_chat(p_token text, p_after bigint)
CREATE OR REPLACE FUNCTION public.order_chat(p_token text, p_after bigint DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.orders;
begin
  select * into o from public.kokoro_order_by_token(p_token);
  if not found then return null; end if;
  return json_build_object('open', public.kokoro_chat_open(o), 'can_write', public.kokoro_chat_writable(o),
    'messages', case when public.kokoro_chat_open(o) then public.kokoro_chat_messages(o.id, p_after, false) else '[]'::json end);
end $function$;

-- order_chat_send(p_token text, p_body text)
CREATE OR REPLACE FUNCTION public.order_chat_send(p_token text, p_body text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.orders;
begin
  select * into o from public.kokoro_order_by_token(p_token);
  if not found then raise exception 'Заказ не найден'; end if;
  if not public.kokoro_chat_writable(o) then raise exception 'Чат по этому заказу закрыт'; end if;
  return public.kokoro_chat_add(o.id, 'client', null, p_body, 20);
end $function$;

-- order_delivery(p_token text)
CREATE OR REPLACE FUNCTION public.order_delivery(p_token text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.orders;
begin
  select * into o from public.kokoro_order_by_token(p_token);
  if not found or coalesce(o.fulfillment, 'delivery') <> 'delivery' or coalesce(o.delivery_fee, 0) > 0
     or jsonb_typeof(o.delivery_quote -> 'km') is distinct from 'number' then
    return null;
  end if;
  return json_build_object('km', o.delivery_quote -> 'km', 'price', o.delivery_quote -> 'price',
    'approx', coalesce(o.delivery_quote -> 'approx' = 'true'::jsonb, false), 'from', o.delivery_quote ->> 'from',
    'rain', case when jsonb_typeof(o.delivery_quote -> 'rain') = 'number' then o.delivery_quote -> 'rain' end);
end $function$;

-- order_extra(p_token text)
CREATE OR REPLACE FUNCTION public.order_extra(p_token text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o public.orders;
  v_last record;
begin
  select * into o from public.kokoro_order_by_token(p_token);
  if not found then return null; end if;
  select max(m.id) as last_id, count(*) as n,
         (select x.author from public.order_messages x where x.order_id = o.id order by x.id desc limit 1) as last_author
  into v_last from public.order_messages m where m.order_id = o.id;
  return json_build_object(
    'fulfillment', o.fulfillment, 'door', o.door, 'door_fee', case when o.door then public.kokoro_door_fee() else 0 end,
    'wait_minutes', o.wait_minutes, 'ready_at', o.ready_at, 'done_at', o.done_at,
    'delivery_at', public.kokoro_delivery_at(coalesce(o.paid_at, o.created_at), o.delivery_time),
    'promise_at', case when o.status <> 'awaiting_payment' then public.kokoro_promise_at(o) end,
    'rating', o.rating, 'courier_rating', o.courier_rating, 'rated_at', o.rated_at,
    'can_rate', o.status = 'done' and o.rated_at is null and coalesce(o.done_at, o.updated_at) > now() - interval '3 days',
    'has_courier', o.courier_id is not null,
    'chat', json_build_object('open', public.kokoro_chat_open(o), 'can_write', public.kokoro_chat_writable(o),
                              'count', coalesce(v_last.n, 0), 'last_id', v_last.last_id, 'last_author', v_last.last_author));
end $function$;

-- order_rate(p_token text, p_rating integer, p_courier_rating integer, p_comment text)
CREATE OR REPLACE FUNCTION public.order_rate(p_token text, p_rating integer, p_courier_rating integer DEFAULT NULL::integer, p_comment text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o public.orders;
  v_at timestamptz := now();
begin
  select * into o from public.kokoro_order_by_token(p_token);
  if not found then raise exception 'Заказ не найден'; end if;
  if o.status <> 'done' then raise exception 'Оценить можно после доставки'; end if;
  if o.rated_at is not null then raise exception 'Вы уже оценили этот заказ'; end if;
  if coalesce(o.done_at, o.updated_at) < now() - interval '3 days' then raise exception 'Оценить можно в течение трёх дней после доставки'; end if;
  if p_rating is null or p_rating not between 1 and 5 or (p_courier_rating is not null and p_courier_rating not between 1 and 5) then
    raise exception 'Поставьте от 1 до 5 звёзд';
  end if;
  update public.orders set rating = p_rating, courier_rating = case when o.courier_id is not null then p_courier_rating end,
    rating_comment = nullif(left(btrim(coalesce(p_comment, '')), 500), ''), rated_at = v_at
  where id = o.id and rated_at is null; -- два нажатия подряд: второе не перепишет первое
  if not found then raise exception 'Вы уже оценили этот заказ'; end if;
  return json_build_object('rated_at', v_at);
end $function$;

-- order_status(p_token text)
CREATE OR REPLACE FUNCTION public.order_status(p_token text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select json_build_object('number', o.id, 'status', o.status, 'updated_at', o.updated_at, 'day_number', o.day_number,
    'total', o.total, 'paid_at', o.paid_at, 'delivery_time', o.delivery_time, 'branch', o.branch,
    'point', case when o.pay_token::text = p_token and o.lat is not null then json_build_object('lat', o.lat, 'lon', o.lon) end,
    'courier', case when o.status = 'delivering' and o.courier_id is not null
                     and o.updated_at > now() - interval '12 hours' then json_build_object('location',
      (select json_build_object('lat', l.lat, 'lon', l.lon, 'accuracy', l.accuracy, 'at', l.at)
       from public.courier_locations l join public.couriers c on c.id = l.courier_id
       where l.courier_id = o.courier_id and c.active and l.at > now() - interval '15 minutes'),
      'others', (select count(*) from public.orders x
                 where x.courier_id = o.courier_id and x.id <> o.id and x.status = 'delivering'
                   and x.updated_at > now() - interval '12 hours'),
      'name', (select c.name from public.couriers c where c.id = o.courier_id),
      'phone', (select c.phone from public.couriers c where c.id = o.courier_id)) end)
  from public.orders o
  where p_token is not null and (o.pay_token::text = p_token or o.track_code = upper(btrim(p_token)))
$function$;

-- place_order(p_qty integer, p_name text, p_phone text, p_address text, p_entrance text, p_floor text, p_apartment text, p_delivery_time text, p_comment text)
CREATE OR REPLACE FUNCTION public.place_order(p_qty integer, p_name text, p_phone text, p_address text, p_entrance text DEFAULT ''::text, p_floor text DEFAULT ''::text, p_apartment text DEFAULT ''::text, p_delivery_time text DEFAULT ''::text, p_comment text DEFAULT ''::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.order_settings;
  o public.orders;
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  select * into s from public.order_settings where id = 1;
  if not found or not s.accepting_orders then
    raise exception '%', coalesce(s.closed_message, 'Сейчас мы не принимаем заказы') using errcode = 'P0001';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 20 then
    raise exception 'Количество — от 1 до 20 комбо' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 1 then
    raise exception 'Укажите имя' using errcode = 'P0001';
  end if;
  if length(v_digits) < 9 or length(v_digits) > 15 then
    raise exception 'Укажите корректный номер телефона' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_address, ''))) < 3 then
    raise exception 'Укажите адрес доставки' using errcode = 'P0001';
  end if;
  -- Защита от спама: не больше 3 заказов с одного номера за 10 минут
  if (select count(*) from public.orders
      where created_at > now() - interval '10 minutes'
        and regexp_replace(phone, '\D', '', 'g') = v_digits) >= 3 then
    raise exception 'Слишком много заказов подряд. Подождите несколько минут или напишите нам в WhatsApp.' using errcode = 'P0001';
  end if;

  insert into public.orders (status, qty, unit_price, delivery_fee, total, name, phone, address,
                             entrance, floor, apartment, delivery_time, payment, comment)
  values ('awaiting_payment', p_qty, s.combo_price, s.delivery_fee, p_qty * s.combo_price + s.delivery_fee,
          left(btrim(p_name), 60), left(btrim(p_phone), 30), left(btrim(p_address), 200),
          left(btrim(coalesce(p_entrance, '')), 20), left(btrim(coalesce(p_floor, '')), 20),
          left(btrim(coalesce(p_apartment, '')), 20), left(btrim(coalesce(p_delivery_time, '')), 40),
          'qr', left(btrim(coalesce(p_comment, '')), 500))
  returning * into o;

  return json_build_object('number', o.id, 'total', o.total, 'token', o.pay_token);
end;
$function$;

-- receipt_folder_allowed(p_folder text)
CREATE OR REPLACE FUNCTION public.receipt_folder_allowed(p_folder text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.orders
    where pay_token::text = p_folder
      and status = 'awaiting_payment'
      and created_at > now() - interval '2 days'
  );
$function$;

-- set_order_branch(p_token text, p_branch text)
CREATE OR REPLACE FUNCTION public.set_order_branch(p_token text, p_branch text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_branch is not null and p_branch not in ('kulieva', 'kokzhar') then raise exception 'Нет такой точки'; end if;
  update public.orders o set branch = p_branch, branch_guessed = false
  where p_token is not null and o.pay_token::text = p_token and o.status = 'awaiting_payment' and o.receipt_path is null
    and (o.lat is null or o.lon is null);
  return found;
end $function$;

-- set_order_delivery(p_token text, p_quote jsonb)
CREATE OR REPLACE FUNCTION public.set_order_delivery(p_token text, p_quote jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_km numeric;
  v_price numeric;
  v_rain numeric;
  v_quote jsonb;
begin
  if p_quote is not null and jsonb_typeof(p_quote) <> 'null' then
    if jsonb_typeof(p_quote) <> 'object' or coalesce(jsonb_typeof(p_quote -> 'km'), '') <> 'number'
       or coalesce(jsonb_typeof(p_quote -> 'price'), 'null') not in ('number', 'null')
       or coalesce(jsonb_typeof(p_quote -> 'from'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(p_quote -> 'rain'), 'null') not in ('number', 'null') then
      raise exception 'Сумма доставки: неверный вид';
    end if;
    v_km := round((p_quote ->> 'km')::numeric, 1);
    v_price := (p_quote ->> 'price')::numeric;
    v_rain := coalesce((p_quote ->> 'rain')::numeric, 0);
    if v_km not between 0 and 200 or (v_price is not null and (v_price not between 0 and 5000 or v_price <> round(v_price)))
       or v_rain not between 0 and 500 or v_rain <> round(v_rain) or (v_rain > 0 and (v_price is null or v_rain > v_price)) then
      raise exception 'Сумма доставки вне границ';
    end if;
    v_quote := jsonb_build_object('km', v_km, 'price', v_price::int, 'from', nullif(left(btrim(coalesce(p_quote ->> 'from', '')), 80), ''),
      'approx', coalesce(p_quote -> 'approx' = 'true'::jsonb, false), 'at', now());
    if v_rain > 0 then v_quote := v_quote || jsonb_build_object('rain', v_rain::int); end if;
  end if;
  update public.orders o set delivery_quote = v_quote
  where p_token is not null and o.pay_token::text = p_token and o.status = 'awaiting_payment' and o.receipt_path is null;
  return found;
end $function$;

-- set_order_options(p_token text, p_options jsonb)
CREATE OR REPLACE FUNCTION public.set_order_options(p_token text, p_options jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o public.orders;
  v_mode text;
  v_branch text;
  v_door boolean;
  v_at timestamptz;
  v_local timestamp;
  v_day date;
  v_today date := ((public.kokoro_now() at time zone 'UTC') + interval '6 hours')::date;
  v_mins integer;
begin
  if p_token is null or p_options is null or jsonb_typeof(p_options) <> 'object' then return null; end if;
  select * into o from public.orders x
  where x.pay_token::text = p_token and x.status = 'awaiting_payment' and x.receipt_path is null for update;
  if not found then return null; end if;

  v_mode := coalesce(p_options ->> 'fulfillment', o.fulfillment);
  if v_mode not in ('delivery', 'pickup') then raise exception 'Нет такого способа получения'; end if;
  -- Заказ уже стал самовывозом (адрес — кухня, квартира стёрта) — обратно в доставку не переключаем: только новый заказ
  if v_mode = 'delivery' and o.fulfillment = 'pickup' then raise exception 'Способ получения уже выбран — оформите заказ заново'; end if;
  if v_mode = 'pickup' then
    -- Кухня — из параметров; у самовывоза без неё в параметрах (меняют, например, только время) — прежняя
    v_branch := coalesce(p_options ->> 'branch', case when o.fulfillment = 'pickup' then o.branch end);
    if v_branch is null or v_branch not in ('kulieva', 'kokzhar') then raise exception 'Выберите, откуда заберёте заказ'; end if;
    -- Кухню самовывоза до оплаты меняет только эта функция (триггер kokoro_order_pickup)
    perform set_config('kokoro.pickup_branch', 'on', true);
    -- Доставку самовывоз не платит: если в настройках включат платную доставку (в сумме по QR), её вычитаем из суммы
    -- (справа в set — прежние значения строки, повторный вызов второй раз не вычтет)
    update public.orders set fulfillment = 'pickup', branch = v_branch, branch_guessed = false, lat = null, lon = null,
      delivery_quote = null, door = false, entrance = '', floor = '', apartment = '', -- в живой базе эти колонки not null default ''
      address = 'Самовывоз — ' || public.kokoro_kitchen_label(v_branch),
      total = total - coalesce(delivery_fee, 0), delivery_fee = 0
    where id = o.id;
    perform set_config('kokoro.pickup_branch', '', true);
  else
    v_door := coalesce((p_options ->> 'door')::boolean, o.door);
    if v_door and coalesce(btrim(o.apartment), '') = '' then raise exception 'До двери — только для квартир: укажите квартиру'; end if;
    update public.orders set fulfillment = 'delivery', door = v_door where id = o.id;
  end if;

  if p_options ? 'deliver_at' then
    if jsonb_typeof(p_options -> 'deliver_at') = 'null' then
      update public.orders set delivery_time = 'Как можно скорее' where id = o.id;
    else
      begin
        v_at := (p_options ->> 'deliver_at')::timestamptz;
      exception when others then raise exception 'Не получилось прочитать время — выберите его ещё раз';
      end;
      v_local := (v_at at time zone 'UTC') + interval '6 hours';
      v_mins := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
      if extract(second from v_local) <> 0 or v_mins % 5 <> 0 then raise exception 'Выберите время с шагом 5 минут'; end if;
      if v_mins <> 0 and v_mins < 12 * 60 then raise exception 'Выберите время с 12:00 до 00:00'; end if;
      v_day := case when v_mins = 0 then v_local::date - 1 else v_local::date end;
      if v_day not in (v_today, v_today + 1) then raise exception 'Можно заказать на сегодня или завтра'; end if;
      if v_at < public.kokoro_now() + interval '30 minutes' then raise exception 'Это время уже близко — выберите позже или «Побыстрее»'; end if;
      update public.orders set delivery_time = 'Ко времени: ' || to_char(v_local, 'HH24:MI') || ', ' || to_char(v_day, 'DD.MM')
      where id = o.id;
    end if;
  end if;

  if (p_options ->> 'consent') = 'true' then update public.orders set consent_at = now() where id = o.id; end if;

  select * into o from public.orders where id = o.id;
  return json_build_object('fulfillment', o.fulfillment, 'door', o.door, 'branch', o.branch, 'delivery_time', o.delivery_time,
                           'address', o.address, 'total', o.total);
end $function$;

-- set_order_point(p_token text, p_lat double precision, p_lon double precision)
CREATE OR REPLACE FUNCTION public.set_order_point(p_token text, p_lat double precision, p_lon double precision)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_lat is not null and (p_lat not between 42.55 and 43.25 or p_lon is null or p_lon not between 74.05 and 75.15) then
    raise exception 'Точка за пределами зоны доставки — отметьте место в Бишкеке';
  end if;
  update public.orders o set lat = p_lat, lon = case when p_lat is null then null else p_lon end
  where p_token is not null and o.pay_token::text = p_token and o.status = 'awaiting_payment' and o.receipt_path is null;
  return found;
end $function$;

-- ============ Значения по умолчанию и проверки, которые вызывают функции выше ============
alter table public.orders alter column track_code set default kokoro_code(12);

-- ============ Триггеры ============
drop trigger if exists kokoro_branch_rain_by on public.branch_settings;
CREATE TRIGGER kokoro_branch_rain_by BEFORE UPDATE OF rain ON public.branch_settings FOR EACH ROW EXECUTE FUNCTION kokoro_branch_rain_by();
drop trigger if exists kokoro_branch_rain_orders on public.branch_settings;
CREATE TRIGGER kokoro_branch_rain_orders AFTER UPDATE OF rain ON public.branch_settings FOR EACH ROW EXECUTE FUNCTION kokoro_branch_rain_orders();
drop trigger if exists kokoro_couriers_branch_set on public.couriers;
CREATE TRIGGER kokoro_couriers_branch_set BEFORE INSERT OR UPDATE OF branch ON public.couriers FOR EACH ROW EXECUTE FUNCTION kokoro_couriers_branch_set();
drop trigger if exists kokoro_order_pickup on public.orders;
CREATE TRIGGER kokoro_order_pickup BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION kokoro_order_pickup();
drop trigger if exists kokoro_orders_branch on public.orders;
CREATE TRIGGER kokoro_orders_branch BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION kokoro_orders_branch();
drop trigger if exists kokoro_orders_day_number on public.orders;
CREATE TRIGGER kokoro_orders_day_number BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION kokoro_orders_day_number();
drop trigger if exists kokoro_orders_delivering_at on public.orders;
CREATE TRIGGER kokoro_orders_delivering_at BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION kokoro_orders_delivering_at();
drop trigger if exists kokoro_orders_dispatched_at on public.orders;
CREATE TRIGGER kokoro_orders_dispatched_at BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION kokoro_orders_dispatched_at();
drop trigger if exists kokoro_orders_done_at on public.orders;
CREATE TRIGGER kokoro_orders_done_at BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION kokoro_orders_done_at();
drop trigger if exists kokoro_orders_shift_on on public.orders;
CREATE TRIGGER kokoro_orders_shift_on AFTER INSERT OR UPDATE OF status, courier_id ON public.orders FOR EACH ROW EXECUTE FUNCTION kokoro_orders_shift_on();
drop trigger if exists kokoro_orders_throttle on public.orders;
CREATE TRIGGER kokoro_orders_throttle BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION kokoro_orders_throttle();
drop trigger if exists kokoro_orders_wait on public.orders;
CREATE TRIGGER kokoro_orders_wait BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION kokoro_orders_wait();
drop trigger if exists kokoro_touch_updated_at on public.orders;
CREATE TRIGGER kokoro_touch_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION kokoro_touch_updated_at();

-- ============ Хранилища файлов ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('gallery', 'gallery', true, 5242880, array['image/jpeg']::text[]) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('gallery-inbox', 'gallery-inbox', false, 5242880, array['image/jpeg']::text[]) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('payment', 'payment', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']::text[]) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']::text[]) on conflict (id) do nothing;

-- ============ Правила доступа (RLS) ============
alter table public.admins enable row level security;
alter table public.branch_settings enable row level security;
alter table public.courier_declines enable row level security;
alter table public.courier_locations enable row level security;
alter table public.courier_login_tries enable row level security;
alter table public.courier_messages enable row level security;
alter table public.couriers enable row level security;
alter table public.draws enable row level security;
alter table public.gallery enable row level security;
alter table public.kitchen_keys enable row level security;
alter table public.kitchen_products enable row level security;
alter table public.kokoro_branch_day_counter enable row level security;
alter table public.kokoro_day_counter enable row level security;
alter table public.kokoro_dispatch_state enable row level security;
alter table public.kokoro_private enable row level security;
alter table public.kokoro_rate enable row level security;
alter table public.order_messages enable row level security;
alter table public.order_settings enable row level security;
alter table public.orders enable row level security;
alter table public.participants enable row level security;
alter table public.scores enable row level security;

drop policy if exists branch_settings_read on public.branch_settings;
create policy branch_settings_read on public.branch_settings as permissive for select to anon, authenticated
  using (true);
drop policy if exists branch_settings_update on public.branch_settings;
create policy branch_settings_update on public.branch_settings as permissive for update to authenticated
  using ((is_admin() AND (( SELECT kokoro_is_owner() AS kokoro_is_owner) OR (branch = ( SELECT kokoro_admin_branch() AS kokoro_admin_branch)))))
  with check ((is_admin() AND (( SELECT kokoro_is_owner() AS kokoro_is_owner) OR (branch = ( SELECT kokoro_admin_branch() AS kokoro_admin_branch)))));
drop policy if exists draws_admin on public.draws;
create policy draws_admin on public.draws as permissive for all to authenticated
  using (is_admin())
  with check (is_admin());
drop policy if exists draws_read on public.draws;
create policy draws_read on public.draws as permissive for select to public
  using (true);
drop policy if exists gallery_admin_delete on public.gallery;
create policy gallery_admin_delete on public.gallery as permissive for delete to authenticated
  using (is_admin());
drop policy if exists gallery_admin_update on public.gallery;
create policy gallery_admin_update on public.gallery as permissive for update to authenticated
  using (is_admin())
  with check (is_admin());
drop policy if exists gallery_read on public.gallery;
create policy gallery_read on public.gallery as permissive for select to public
  using (((status = 'approved'::text) OR is_admin()));
drop policy if exists gallery_submit on public.gallery;
create policy gallery_submit on public.gallery as permissive for insert to anon, authenticated
  with check (((status = 'pending'::text) AND (image_bucket = 'gallery-inbox'::text) AND (winner_week IS NULL)));
drop policy if exists kokoro_owner_settings_update on public.order_settings;
create policy kokoro_owner_settings_update on public.order_settings as restrictive for update to authenticated
  using (( SELECT kokoro_is_owner() AS kokoro_is_owner))
  with check (( SELECT kokoro_is_owner() AS kokoro_is_owner));
drop policy if exists order_settings_admin_update on public.order_settings;
create policy order_settings_admin_update on public.order_settings as permissive for update to public
  using (is_admin())
  with check (is_admin());
drop policy if exists order_settings_read on public.order_settings;
create policy order_settings_read on public.order_settings as permissive for select to public
  using (true);
drop policy if exists kokoro_branch_orders_select on public.orders;
create policy kokoro_branch_orders_select on public.orders as restrictive for select to authenticated
  using (((branch IS NULL) OR ( SELECT kokoro_is_owner() AS kokoro_is_owner) OR (branch = ( SELECT kokoro_admin_branch() AS kokoro_admin_branch))));
drop policy if exists kokoro_branch_orders_update on public.orders;
create policy kokoro_branch_orders_update on public.orders as restrictive for update to authenticated
  using (((branch IS NULL) OR ( SELECT kokoro_is_owner() AS kokoro_is_owner) OR (branch = ( SELECT kokoro_admin_branch() AS kokoro_admin_branch))))
  with check (((branch IS NULL) OR ( SELECT kokoro_is_owner() AS kokoro_is_owner) OR (branch = ( SELECT kokoro_admin_branch() AS kokoro_admin_branch))));
drop policy if exists orders_admin_read on public.orders;
create policy orders_admin_read on public.orders as permissive for select to public
  using (is_admin());
drop policy if exists orders_admin_update on public.orders;
create policy orders_admin_update on public.orders as permissive for update to public
  using (is_admin())
  with check (is_admin());
drop policy if exists participants_admin on public.participants;
create policy participants_admin on public.participants as permissive for all to authenticated
  using (is_admin())
  with check (is_admin());
drop policy if exists participants_read on public.participants;
create policy participants_read on public.participants as permissive for select to public
  using (((excluded = false) OR is_admin()));
drop policy if exists scores_admin_delete on public.scores;
create policy scores_admin_delete on public.scores as permissive for delete to authenticated
  using (is_admin());
drop policy if exists scores_read on public.scores;
create policy scores_read on public.scores as permissive for select to public
  using (true);
drop policy if exists scores_submit on public.scores;
create policy scores_submit on public.scores as permissive for insert to anon, authenticated
  with check (true);
drop policy if exists kokoro_admin_delete on storage.objects;
create policy kokoro_admin_delete on storage.objects as permissive for delete to authenticated
  using (((bucket_id = ANY (ARRAY['gallery-inbox'::text, 'gallery'::text])) AND is_admin()));
drop policy if exists kokoro_admin_read on storage.objects;
create policy kokoro_admin_read on storage.objects as permissive for select to authenticated
  using (((bucket_id = ANY (ARRAY['gallery-inbox'::text, 'gallery'::text])) AND is_admin()));
drop policy if exists kokoro_admin_write on storage.objects;
create policy kokoro_admin_write on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'gallery'::text) AND is_admin()));
drop policy if exists kokoro_inbox_upload on storage.objects;
create policy kokoro_inbox_upload on storage.objects as permissive for insert to anon, authenticated
  with check (((bucket_id = 'gallery-inbox'::text) AND (name ~ '^[0-9a-f-]{36}\.jpg$'::text)));
drop policy if exists kokoro_payment_admin_delete on storage.objects;
create policy kokoro_payment_admin_delete on storage.objects as permissive for delete to authenticated
  using (((bucket_id = 'payment'::text) AND is_admin()));
drop policy if exists kokoro_payment_admin_insert on storage.objects;
create policy kokoro_payment_admin_insert on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'payment'::text) AND is_admin()));
drop policy if exists kokoro_payment_no_insert on storage.objects;
create policy kokoro_payment_no_insert on storage.objects as restrictive for insert to anon, authenticated
  with check ((bucket_id <> 'payment'::text));
drop policy if exists kokoro_payment_no_update on storage.objects;
create policy kokoro_payment_no_update on storage.objects as restrictive for update to anon, authenticated
  using ((bucket_id <> 'payment'::text))
  with check ((bucket_id <> 'payment'::text));
drop policy if exists kokoro_receipts_admin_read on storage.objects;
create policy kokoro_receipts_admin_read on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'receipts'::text) AND is_admin()));
drop policy if exists kokoro_receipts_branch on storage.objects;
create policy kokoro_receipts_branch on storage.objects as restrictive for select to authenticated
  using (((bucket_id <> 'receipts'::text) OR kokoro_receipt_visible(name)));
drop policy if exists kokoro_receipts_upload on storage.objects;
create policy kokoro_receipts_upload on storage.objects as permissive for insert to anon, authenticated
  with check (((bucket_id = 'receipts'::text) AND receipt_folder_allowed((storage.foldername(name))[1])));
drop policy if exists kokoro_receipts_upload_guard on storage.objects;
create policy kokoro_receipts_upload_guard on storage.objects as restrictive for insert to anon
  with check (((bucket_id <> 'receipts'::text) OR kokoro_receipt_upload_ok(name)));

-- ============ Права ============
revoke all on table public.admins from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.admins to anon;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.admins to authenticated;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.admins to service_role;
revoke all on table public.branch_settings from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.branch_settings to service_role;
revoke all on table public.courier_declines from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.courier_declines to service_role;
revoke all on table public.courier_locations from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.courier_locations to service_role;
revoke all on table public.courier_login_tries from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.courier_login_tries to service_role;
revoke all on table public.courier_messages from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.courier_messages to service_role;
revoke all on table public.couriers from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.couriers to service_role;
revoke all on table public.draws from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.draws to anon;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.draws to authenticated;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.draws to service_role;
revoke all on table public.gallery from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.gallery to anon;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.gallery to authenticated;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.gallery to service_role;
revoke all on table public.kitchen_keys from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.kitchen_keys to service_role;
revoke all on table public.kitchen_products from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.kitchen_products to service_role;
revoke all on table public.kokoro_branch_day_counter from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.kokoro_branch_day_counter to service_role;
revoke all on table public.kokoro_day_counter from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.kokoro_day_counter to service_role;
revoke all on table public.kokoro_dispatch_state from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.kokoro_dispatch_state to service_role;
revoke all on table public.kokoro_private from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.kokoro_private to service_role;
revoke all on table public.kokoro_rate from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.kokoro_rate to service_role;
revoke all on table public.order_messages from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.order_messages to service_role;
revoke all on table public.order_settings from public, anon, authenticated, service_role;
grant SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.order_settings to authenticated;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.order_settings to service_role;
grant SELECT on table public.order_settings to anon;
revoke all on table public.orders from public, anon, authenticated, service_role;
grant TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.orders to authenticated;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.orders to service_role;
revoke all on table public.participants from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.participants to anon;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.participants to authenticated;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.participants to service_role;
revoke all on table public.scores from public, anon, authenticated, service_role;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.scores to anon;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.scores to authenticated;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on table public.scores to service_role;
revoke all on sequence public.courier_messages_id_seq from public, anon, authenticated, service_role;
grant SELECT, UPDATE, USAGE on sequence public.courier_messages_id_seq to anon;
grant SELECT, UPDATE, USAGE on sequence public.courier_messages_id_seq to authenticated;
grant SELECT, UPDATE, USAGE on sequence public.courier_messages_id_seq to service_role;
revoke all on sequence public.couriers_id_seq from public, anon, authenticated, service_role;
grant SELECT, UPDATE, USAGE on sequence public.couriers_id_seq to anon;
grant SELECT, UPDATE, USAGE on sequence public.couriers_id_seq to authenticated;
grant SELECT, UPDATE, USAGE on sequence public.couriers_id_seq to service_role;
revoke all on sequence public.kitchen_keys_id_seq from public, anon, authenticated, service_role;
grant SELECT, UPDATE, USAGE on sequence public.kitchen_keys_id_seq to anon;
grant SELECT, UPDATE, USAGE on sequence public.kitchen_keys_id_seq to authenticated;
grant SELECT, UPDATE, USAGE on sequence public.kitchen_keys_id_seq to service_role;
revoke all on sequence public.kitchen_products_id_seq from public, anon, authenticated, service_role;
grant SELECT, UPDATE, USAGE on sequence public.kitchen_products_id_seq to anon;
grant SELECT, UPDATE, USAGE on sequence public.kitchen_products_id_seq to authenticated;
grant SELECT, UPDATE, USAGE on sequence public.kitchen_products_id_seq to service_role;
revoke all on sequence public.order_messages_id_seq from public, anon, authenticated, service_role;
grant SELECT, UPDATE, USAGE on sequence public.order_messages_id_seq to anon;
grant SELECT, UPDATE, USAGE on sequence public.order_messages_id_seq to authenticated;
grant SELECT, UPDATE, USAGE on sequence public.order_messages_id_seq to service_role;
revoke all on sequence public.orders_id_seq from public, anon, authenticated, service_role;
grant SELECT, UPDATE, USAGE on sequence public.orders_id_seq to anon;
grant SELECT, UPDATE, USAGE on sequence public.orders_id_seq to authenticated;
grant SELECT, UPDATE, USAGE on sequence public.orders_id_seq to service_role;
revoke all on sequence public.scores_id_seq from public, anon, authenticated, service_role;
grant SELECT, UPDATE, USAGE on sequence public.scores_id_seq to anon;
grant SELECT, UPDATE, USAGE on sequence public.scores_id_seq to authenticated;
grant SELECT, UPDATE, USAGE on sequence public.scores_id_seq to service_role;
revoke all on function public.admin_chat(p_order_id bigint, p_after bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_chat(p_order_id bigint, p_after bigint) to authenticated;
grant execute on function public.admin_chat(p_order_id bigint, p_after bigint) to service_role;
revoke all on function public.admin_chat_send(p_order_id bigint, p_body text) from public, anon, authenticated, service_role;
grant execute on function public.admin_chat_send(p_order_id bigint, p_body text) to authenticated;
grant execute on function public.admin_chat_send(p_order_id bigint, p_body text) to service_role;
revoke all on function public.admin_chat_summary(p_since timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function public.admin_chat_summary(p_since timestamp with time zone) to authenticated;
grant execute on function public.admin_chat_summary(p_since timestamp with time zone) to service_role;
revoke all on function public.admin_courier_add(p_name text) from public, anon, authenticated, service_role;
grant execute on function public.admin_courier_add(p_name text) to authenticated;
grant execute on function public.admin_courier_add(p_name text) to service_role;
revoke all on function public.admin_courier_chat(p_id bigint, p_after bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_courier_chat(p_id bigint, p_after bigint) to authenticated;
grant execute on function public.admin_courier_chat(p_id bigint, p_after bigint) to service_role;
revoke all on function public.admin_courier_chat_send(p_id bigint, p_body text) from public, anon, authenticated, service_role;
grant execute on function public.admin_courier_chat_send(p_id bigint, p_body text) to authenticated;
grant execute on function public.admin_courier_chat_send(p_id bigint, p_body text) to service_role;
revoke all on function public.admin_courier_contacts() from public, anon, authenticated, service_role;
grant execute on function public.admin_courier_contacts() to authenticated;
grant execute on function public.admin_courier_contacts() to service_role;
revoke all on function public.admin_courier_delete(p_id bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_courier_delete(p_id bigint) to authenticated;
grant execute on function public.admin_courier_delete(p_id bigint) to service_role;
revoke all on function public.admin_courier_pin(p_id bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_courier_pin(p_id bigint) to authenticated;
grant execute on function public.admin_courier_pin(p_id bigint) to service_role;
revoke all on function public.admin_courier_reset(p_id bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_courier_reset(p_id bigint) to authenticated;
grant execute on function public.admin_courier_reset(p_id bigint) to service_role;
revoke all on function public.admin_courier_set_branch(p_id bigint, p_branch text) from public, anon, authenticated, service_role;
grant execute on function public.admin_courier_set_branch(p_id bigint, p_branch text) to authenticated;
grant execute on function public.admin_courier_set_branch(p_id bigint, p_branch text) to service_role;
revoke all on function public.admin_courier_update(p_id bigint, p_name text, p_active boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_courier_update(p_id bigint, p_name text, p_active boolean) to authenticated;
grant execute on function public.admin_courier_update(p_id bigint, p_name text, p_active boolean) to service_role;
revoke all on function public.admin_couriers() from public, anon, authenticated, service_role;
grant execute on function public.admin_couriers() to authenticated;
grant execute on function public.admin_couriers() to service_role;
revoke all on function public.admin_me() from public, anon, authenticated, service_role;
grant execute on function public.admin_me() to authenticated;
grant execute on function public.admin_me() to service_role;
revoke all on function public.admin_order_ready(p_id bigint, p_ready boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_order_ready(p_id bigint, p_ready boolean) to authenticated;
grant execute on function public.admin_order_ready(p_id bigint, p_ready boolean) to service_role;
revoke all on function public.admin_report(p_from date, p_to date) from public, anon, authenticated, service_role;
grant execute on function public.admin_report(p_from date, p_to date) to authenticated;
grant execute on function public.admin_report(p_from date, p_to date) to service_role;
revoke all on function public.admin_set_delivery_quote(p_id bigint, p_quote jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_delivery_quote(p_id bigint, p_quote jsonb) to authenticated;
grant execute on function public.admin_set_delivery_quote(p_id bigint, p_quote jsonb) to service_role;
revoke all on function public.admin_status() from public, anon, authenticated, service_role;
grant execute on function public.admin_status() to authenticated;
grant execute on function public.admin_status() to service_role;
revoke all on function public.admin_transfer_order(p_id bigint, p_branch text, p_from text) from public, anon, authenticated, service_role;
grant execute on function public.admin_transfer_order(p_id bigint, p_branch text, p_from text) to authenticated;
grant execute on function public.admin_transfer_order(p_id bigint, p_branch text, p_from text) to service_role;
revoke all on function public.attach_receipt(p_token uuid, p_path text) from public, anon, authenticated, service_role;
grant execute on function public.attach_receipt(p_token uuid, p_path text) to anon;
grant execute on function public.attach_receipt(p_token uuid, p_path text) to authenticated;
grant execute on function public.attach_receipt(p_token uuid, p_path text) to service_role;
revoke all on function public.cancel_unpaid_order(p_token uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_unpaid_order(p_token uuid) to anon;
grant execute on function public.cancel_unpaid_order(p_token uuid) to authenticated;
grant execute on function public.cancel_unpaid_order(p_token uuid) to service_role;
revoke all on function public.courier_board(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.courier_board(p_key text) to anon;
grant execute on function public.courier_board(p_key text) to authenticated;
grant execute on function public.courier_board(p_key text) to service_role;
revoke all on function public.courier_chat(p_key text, p_order_id bigint, p_after bigint) from public, anon, authenticated, service_role;
grant execute on function public.courier_chat(p_key text, p_order_id bigint, p_after bigint) to anon;
grant execute on function public.courier_chat(p_key text, p_order_id bigint, p_after bigint) to authenticated;
grant execute on function public.courier_chat(p_key text, p_order_id bigint, p_after bigint) to service_role;
revoke all on function public.courier_chat_send(p_key text, p_order_id bigint, p_body text) from public, anon, authenticated, service_role;
grant execute on function public.courier_chat_send(p_key text, p_order_id bigint, p_body text) to anon;
grant execute on function public.courier_chat_send(p_key text, p_order_id bigint, p_body text) to authenticated;
grant execute on function public.courier_chat_send(p_key text, p_order_id bigint, p_body text) to service_role;
revoke all on function public.courier_chat_summary(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.courier_chat_summary(p_key text) to anon;
grant execute on function public.courier_chat_summary(p_key text) to authenticated;
grant execute on function public.courier_chat_summary(p_key text) to service_role;
revoke all on function public.courier_choose_point(p_key text, p_branch text) from public, anon, authenticated, service_role;
grant execute on function public.courier_choose_point(p_key text, p_branch text) to anon;
grant execute on function public.courier_choose_point(p_key text, p_branch text) to authenticated;
grant execute on function public.courier_choose_point(p_key text, p_branch text) to service_role;
revoke all on function public.courier_contact(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.courier_contact(p_key text) to anon;
grant execute on function public.courier_contact(p_key text) to authenticated;
grant execute on function public.courier_contact(p_key text) to service_role;
revoke all on function public.courier_decline(p_key text, p_order_id bigint) from public, anon, authenticated, service_role;
grant execute on function public.courier_decline(p_key text, p_order_id bigint) to anon;
grant execute on function public.courier_decline(p_key text, p_order_id bigint) to authenticated;
grant execute on function public.courier_decline(p_key text, p_order_id bigint) to service_role;
revoke all on function public.courier_earnings(p_key text, p_back integer) from public, anon, authenticated, service_role;
grant execute on function public.courier_earnings(p_key text, p_back integer) to anon;
grant execute on function public.courier_earnings(p_key text, p_back integer) to authenticated;
grant execute on function public.courier_earnings(p_key text, p_back integer) to service_role;
revoke all on function public.courier_extra(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.courier_extra(p_key text) to anon;
grant execute on function public.courier_extra(p_key text) to authenticated;
grant execute on function public.courier_extra(p_key text) to service_role;
revoke all on function public.courier_fill_quote(p_key text, p_order_id bigint, p_lat double precision, p_lon double precision, p_km numeric) from public, anon, authenticated, service_role;
grant execute on function public.courier_fill_quote(p_key text, p_order_id bigint, p_lat double precision, p_lon double precision, p_km numeric) to anon;
grant execute on function public.courier_fill_quote(p_key text, p_order_id bigint, p_lat double precision, p_lon double precision, p_km numeric) to authenticated;
grant execute on function public.courier_fill_quote(p_key text, p_order_id bigint, p_lat double precision, p_lon double precision, p_km numeric) to service_role;
revoke all on function public.courier_login(p_pin text) from public, anon, authenticated, service_role;
grant execute on function public.courier_login(p_pin text) to anon;
grant execute on function public.courier_login(p_pin text) to authenticated;
grant execute on function public.courier_login(p_pin text) to service_role;
revoke all on function public.courier_me(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.courier_me(p_key text) to anon;
grant execute on function public.courier_me(p_key text) to authenticated;
grant execute on function public.courier_me(p_key text) to service_role;
revoke all on function public.courier_orders(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.courier_orders(p_key text) to anon;
grant execute on function public.courier_orders(p_key text) to authenticated;
grant execute on function public.courier_orders(p_key text) to service_role;
revoke all on function public.courier_point(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.courier_point(p_key text) to anon;
grant execute on function public.courier_point(p_key text) to authenticated;
grant execute on function public.courier_point(p_key text) to service_role;
revoke all on function public.courier_put_location(p_key text, p_lat double precision, p_lon double precision, p_accuracy real) from public, anon, authenticated, service_role;
grant execute on function public.courier_put_location(p_key text, p_lat double precision, p_lon double precision, p_accuracy real) to anon;
grant execute on function public.courier_put_location(p_key text, p_lat double precision, p_lon double precision, p_accuracy real) to authenticated;
grant execute on function public.courier_put_location(p_key text, p_lat double precision, p_lon double precision, p_accuracy real) to service_role;
revoke all on function public.courier_set_phone(p_key text, p_phone text) from public, anon, authenticated, service_role;
grant execute on function public.courier_set_phone(p_key text, p_phone text) to anon;
grant execute on function public.courier_set_phone(p_key text, p_phone text) to authenticated;
grant execute on function public.courier_set_phone(p_key text, p_phone text) to service_role;
revoke all on function public.courier_set_status(p_key text, p_order_id bigint, p_status text) from public, anon, authenticated, service_role;
grant execute on function public.courier_set_status(p_key text, p_order_id bigint, p_status text) to anon;
grant execute on function public.courier_set_status(p_key text, p_order_id bigint, p_status text) to authenticated;
grant execute on function public.courier_set_status(p_key text, p_order_id bigint, p_status text) to service_role;
revoke all on function public.courier_shift_off(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.courier_shift_off(p_key text) to anon;
grant execute on function public.courier_shift_off(p_key text) to authenticated;
grant execute on function public.courier_shift_off(p_key text) to service_role;
revoke all on function public.courier_shift_on(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.courier_shift_on(p_key text) to anon;
grant execute on function public.courier_shift_on(p_key text) to authenticated;
grant execute on function public.courier_shift_on(p_key text) to service_role;
revoke all on function public.courier_staff_chat(p_key text, p_after bigint) from public, anon, authenticated, service_role;
grant execute on function public.courier_staff_chat(p_key text, p_after bigint) to anon;
grant execute on function public.courier_staff_chat(p_key text, p_after bigint) to authenticated;
grant execute on function public.courier_staff_chat(p_key text, p_after bigint) to service_role;
revoke all on function public.courier_staff_send(p_key text, p_body text) from public, anon, authenticated, service_role;
grant execute on function public.courier_staff_send(p_key text, p_body text) to anon;
grant execute on function public.courier_staff_send(p_key text, p_body text) to authenticated;
grant execute on function public.courier_staff_send(p_key text, p_body text) to service_role;
revoke all on function public.courier_take(p_key text, p_order_id bigint, p_lat double precision, p_lon double precision, p_accuracy real) from public, anon, authenticated, service_role;
grant execute on function public.courier_take(p_key text, p_order_id bigint, p_lat double precision, p_lon double precision, p_accuracy real) to anon;
grant execute on function public.courier_take(p_key text, p_order_id bigint, p_lat double precision, p_lon double precision, p_accuracy real) to authenticated;
grant execute on function public.courier_take(p_key text, p_order_id bigint, p_lat double precision, p_lon double precision, p_accuracy real) to service_role;
revoke all on function public.courier_tg_link(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.courier_tg_link(p_key text) to anon;
grant execute on function public.courier_tg_link(p_key text) to authenticated;
grant execute on function public.courier_tg_link(p_key text) to service_role;
revoke all on function public.courier_today(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.courier_today(p_key text) to anon;
grant execute on function public.courier_today(p_key text) to authenticated;
grant execute on function public.courier_today(p_key text) to service_role;
revoke all on function public.is_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_admin() to public;
grant execute on function public.is_admin() to anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_admin() to service_role;
revoke all on function public.kitchen_archive(p_key text, p_id bigint, p_archived boolean) from public, anon, authenticated, service_role;
grant execute on function public.kitchen_archive(p_key text, p_id bigint, p_archived boolean) to anon;
grant execute on function public.kitchen_archive(p_key text, p_id bigint, p_archived boolean) to authenticated;
grant execute on function public.kitchen_archive(p_key text, p_id bigint, p_archived boolean) to service_role;
revoke all on function public.kitchen_check(p_id bigint, p_category text, p_name text, p_pack text, p_price numeric, p_note text) from public, anon, authenticated, service_role;
grant execute on function public.kitchen_check(p_id bigint, p_category text, p_name text, p_pack text, p_price numeric, p_note text) to service_role;
revoke all on function public.kitchen_clean(p_text text) from public, anon, authenticated, service_role;
grant execute on function public.kitchen_clean(p_text text) to service_role;
revoke all on function public.kitchen_key_id(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.kitchen_key_id(p_key text) to service_role;
revoke all on function public.kitchen_me(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.kitchen_me(p_key text) to anon;
grant execute on function public.kitchen_me(p_key text) to authenticated;
grant execute on function public.kitchen_me(p_key text) to service_role;
revoke all on function public.kitchen_new_link(p_name text, p_replace boolean) from public, anon, authenticated, service_role;
grant execute on function public.kitchen_new_link(p_name text, p_replace boolean) to service_role;
revoke all on function public.kitchen_products(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.kitchen_products(p_key text) to anon;
grant execute on function public.kitchen_products(p_key text) to authenticated;
grant execute on function public.kitchen_products(p_key text) to service_role;
revoke all on function public.kitchen_row(p kitchen_products) from public, anon, authenticated, service_role;
grant execute on function public.kitchen_row(p kitchen_products) to service_role;
revoke all on function public.kitchen_save(p_key text, p_id bigint, p_category text, p_name text, p_pack text, p_price numeric, p_note text) from public, anon, authenticated, service_role;
grant execute on function public.kitchen_save(p_key text, p_id bigint, p_category text, p_name text, p_pack text, p_price numeric, p_note text) to anon;
grant execute on function public.kitchen_save(p_key text, p_id bigint, p_category text, p_name text, p_pack text, p_price numeric, p_note text) to authenticated;
grant execute on function public.kitchen_save(p_key text, p_id bigint, p_category text, p_name text, p_pack text, p_price numeric, p_note text) to service_role;
revoke all on function public.kitchen_set_price(p_key text, p_id bigint, p_price numeric) from public, anon, authenticated, service_role;
grant execute on function public.kitchen_set_price(p_key text, p_id bigint, p_price numeric) to anon;
grant execute on function public.kitchen_set_price(p_key text, p_id bigint, p_price numeric) to authenticated;
grant execute on function public.kitchen_set_price(p_key text, p_id bigint, p_price numeric) to service_role;
revoke all on function public.kokoro_admin_branch() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_admin_branch() to authenticated;
grant execute on function public.kokoro_admin_branch() to service_role;
revoke all on function public.kokoro_branch_at(p_lat double precision, p_lon double precision) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_branch_at(p_lat double precision, p_lon double precision) to public;
grant execute on function public.kokoro_branch_at(p_lat double precision, p_lon double precision) to anon;
grant execute on function public.kokoro_branch_at(p_lat double precision, p_lon double precision) to authenticated;
grant execute on function public.kokoro_branch_at(p_lat double precision, p_lon double precision) to service_role;
revoke all on function public.kokoro_branch_dispatch(p_branch text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_branch_dispatch(p_branch text) to service_role;
revoke all on function public.kokoro_branch_rain_by() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_branch_rain_by() to service_role;
revoke all on function public.kokoro_branch_rain_orders() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_branch_rain_orders() to service_role;
revoke all on function public.kokoro_can_see_order(p_branch text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_can_see_order(p_branch text) to service_role;
revoke all on function public.kokoro_chat_add(p_order bigint, p_author text, p_courier bigint, p_body text, p_limit integer) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_chat_add(p_order bigint, p_author text, p_courier bigint, p_body text, p_limit integer) to service_role;
revoke all on function public.kokoro_chat_messages(p_order bigint, p_after bigint, p_names boolean) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_chat_messages(p_order bigint, p_after bigint, p_names boolean) to service_role;
revoke all on function public.kokoro_chat_open(o orders) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_chat_open(o orders) to service_role;
revoke all on function public.kokoro_chat_summary(p_orders bigint[]) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_chat_summary(p_orders bigint[]) to service_role;
revoke all on function public.kokoro_chat_writable(o orders) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_chat_writable(o orders) to service_role;
revoke all on function public.kokoro_code(p_len integer) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_code(p_len integer) to service_role;
revoke all on function public.kokoro_code_label(p_code text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_code_label(p_code text) to service_role;
revoke all on function public.kokoro_courier_fee(o orders) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_courier_fee(o orders) to service_role;
revoke all on function public.kokoro_courier_fits(c couriers, p_order_id bigint, p_branch text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_courier_fits(c couriers, p_order_id bigint, p_branch text) to service_role;
revoke all on function public.kokoro_courier_free(p_branch text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_courier_free(p_branch text) to service_role;
revoke all on function public.kokoro_courier_id(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_courier_id(p_key text) to service_role;
revoke all on function public.kokoro_courier_limit(p_branch text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_courier_limit(p_branch text) to service_role;
revoke all on function public.kokoro_courier_need_phone(p_id bigint) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_courier_need_phone(p_id bigint) to service_role;
revoke all on function public.kokoro_courier_on_shift(c couriers) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_courier_on_shift(c couriers) to service_role;
revoke all on function public.kokoro_courier_on_the_way(p_courier bigint, p_order_id bigint) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_courier_on_the_way(p_courier bigint, p_order_id bigint) to service_role;
revoke all on function public.kokoro_courier_put(p_id bigint, p_lat double precision, p_lon double precision, p_accuracy real) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_courier_put(p_id bigint, p_lat double precision, p_lon double precision, p_accuracy real) to service_role;
revoke all on function public.kokoro_courier_ready(c couriers) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_courier_ready(c couriers) to service_role;
revoke all on function public.kokoro_couriers_branch_set() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_couriers_branch_set() to service_role;
revoke all on function public.kokoro_delivery_at(p_paid timestamp with time zone, p_delivery_time text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_delivery_at(p_paid timestamp with time zone, p_delivery_time text) to service_role;
revoke all on function public.kokoro_delivery_tariff(p_km numeric) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_delivery_tariff(p_km numeric) to service_role;
revoke all on function public.kokoro_dispatch() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_dispatch() to anon;
grant execute on function public.kokoro_dispatch() to authenticated;
grant execute on function public.kokoro_dispatch() to service_role;
revoke all on function public.kokoro_dispatch_run() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_dispatch_run() to service_role;
revoke all on function public.kokoro_dispatch_run(p_skip bigint) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_dispatch_run(p_skip bigint) to service_role;
revoke all on function public.kokoro_door_fee() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_door_fee() to service_role;
revoke all on function public.kokoro_is_owner() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_is_owner() to authenticated;
grant execute on function public.kokoro_is_owner() to service_role;
revoke all on function public.kokoro_key_hash(p_key text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_key_hash(p_key text) to service_role;
revoke all on function public.kokoro_kitchen_label(p_branch text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_kitchen_label(p_branch text) to service_role;
revoke all on function public.kokoro_kitchen_lat(p_branch text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_kitchen_lat(p_branch text) to service_role;
revoke all on function public.kokoro_kitchen_lon(p_branch text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_kitchen_lon(p_branch text) to service_role;
revoke all on function public.kokoro_mfa_required() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_mfa_required() to authenticated;
grant execute on function public.kokoro_mfa_required() to service_role;
revoke all on function public.kokoro_need_admin() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_need_admin() to service_role;
revoke all on function public.kokoro_need_courier_access(p_id bigint) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_need_courier_access(p_id bigint) to service_role;
revoke all on function public.kokoro_now() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_now() to service_role;
revoke all on function public.kokoro_order_by_token(p_token text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_order_by_token(p_token text) to service_role;
revoke all on function public.kokoro_order_due(p_paid timestamp with time zone, p_delivery_time text, p_branch text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_order_due(p_paid timestamp with time zone, p_delivery_time text, p_branch text) to service_role;
revoke all on function public.kokoro_order_near_kitchen(o orders) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_order_near_kitchen(o orders) to service_role;
revoke all on function public.kokoro_order_pickup() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_order_pickup() to service_role;
revoke all on function public.kokoro_orders_branch() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_orders_branch() to service_role;
revoke all on function public.kokoro_orders_day_number() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_orders_day_number() to service_role;
revoke all on function public.kokoro_orders_delivering_at() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_orders_delivering_at() to service_role;
revoke all on function public.kokoro_orders_dispatched_at() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_orders_dispatched_at() to service_role;
revoke all on function public.kokoro_orders_done_at() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_orders_done_at() to service_role;
revoke all on function public.kokoro_orders_shift_on() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_orders_shift_on() to service_role;
revoke all on function public.kokoro_orders_throttle() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_orders_throttle() to public;
grant execute on function public.kokoro_orders_throttle() to anon;
grant execute on function public.kokoro_orders_throttle() to authenticated;
grant execute on function public.kokoro_orders_throttle() to service_role;
revoke all on function public.kokoro_orders_wait() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_orders_wait() to service_role;
revoke all on function public.kokoro_phone_norm(p_phone text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_phone_norm(p_phone text) to service_role;
revoke all on function public.kokoro_points_on_the_way(p_branch text, a_lat double precision, a_lon double precision, b_lat double precision, b_lon double precision) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_points_on_the_way(p_branch text, a_lat double precision, a_lon double precision, b_lat double precision, b_lon double precision) to service_role;
revoke all on function public.kokoro_promise_at(o orders) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_promise_at(o orders) to service_role;
revoke all on function public.kokoro_rain_apply(p_branch text, p_on boolean) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_rain_apply(p_branch text, p_on boolean) to service_role;
revoke all on function public.kokoro_rain_fee() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_rain_fee() to service_role;
revoke all on function public.kokoro_receipt_upload_ok(object_name text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_receipt_upload_ok(object_name text) to anon;
grant execute on function public.kokoro_receipt_upload_ok(object_name text) to authenticated;
grant execute on function public.kokoro_receipt_upload_ok(object_name text) to service_role;
revoke all on function public.kokoro_receipt_visible(object_name text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_receipt_visible(object_name text) to authenticated;
grant execute on function public.kokoro_receipt_visible(object_name text) to service_role;
revoke all on function public.kokoro_staff_add(p_courier bigint, p_author text, p_body text, p_limit integer) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_staff_add(p_courier bigint, p_author text, p_body text, p_limit integer) to service_role;
revoke all on function public.kokoro_staff_messages(p_courier bigint, p_after bigint, p_viewer uuid) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_staff_messages(p_courier bigint, p_after bigint, p_viewer uuid) to service_role;
revoke all on function public.kokoro_staff_summary(p_courier bigint) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_staff_summary(p_courier bigint) to service_role;
revoke all on function public.kokoro_tg_handle(p_update jsonb) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_tg_handle(p_update jsonb) to service_role;
revoke all on function public.kokoro_tg_reply(p_chat bigint, p_text text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_tg_reply(p_chat bigint, p_text text) to service_role;
revoke all on function public.kokoro_tg_update(p_secret text, p_update jsonb) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_tg_update(p_secret text, p_update jsonb) to anon;
grant execute on function public.kokoro_tg_update(p_secret text, p_update jsonb) to authenticated;
grant execute on function public.kokoro_tg_update(p_secret text, p_update jsonb) to service_role;
revoke all on function public.kokoro_throttle_check(p_phone text) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_throttle_check(p_phone text) to service_role;
revoke all on function public.kokoro_touch_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_touch_updated_at() to public;
grant execute on function public.kokoro_touch_updated_at() to anon;
grant execute on function public.kokoro_touch_updated_at() to authenticated;
grant execute on function public.kokoro_touch_updated_at() to service_role;
revoke all on function public.kokoro_usage() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_usage() to authenticated;
grant execute on function public.kokoro_usage() to service_role;
revoke all on function public.kokoro_weather_update(p_secret text, p_report jsonb) from public, anon, authenticated, service_role;
grant execute on function public.kokoro_weather_update(p_secret text, p_report jsonb) to anon;
grant execute on function public.kokoro_weather_update(p_secret text, p_report jsonb) to authenticated;
grant execute on function public.kokoro_weather_update(p_secret text, p_report jsonb) to service_role;
revoke all on function public.kokoro_workday_start() from public, anon, authenticated, service_role;
grant execute on function public.kokoro_workday_start() to service_role;
revoke all on function public.order_chat(p_token text, p_after bigint) from public, anon, authenticated, service_role;
grant execute on function public.order_chat(p_token text, p_after bigint) to anon;
grant execute on function public.order_chat(p_token text, p_after bigint) to authenticated;
grant execute on function public.order_chat(p_token text, p_after bigint) to service_role;
revoke all on function public.order_chat_send(p_token text, p_body text) from public, anon, authenticated, service_role;
grant execute on function public.order_chat_send(p_token text, p_body text) to anon;
grant execute on function public.order_chat_send(p_token text, p_body text) to authenticated;
grant execute on function public.order_chat_send(p_token text, p_body text) to service_role;
revoke all on function public.order_delivery(p_token text) from public, anon, authenticated, service_role;
grant execute on function public.order_delivery(p_token text) to anon;
grant execute on function public.order_delivery(p_token text) to authenticated;
grant execute on function public.order_delivery(p_token text) to service_role;
revoke all on function public.order_extra(p_token text) from public, anon, authenticated, service_role;
grant execute on function public.order_extra(p_token text) to anon;
grant execute on function public.order_extra(p_token text) to authenticated;
grant execute on function public.order_extra(p_token text) to service_role;
revoke all on function public.order_rate(p_token text, p_rating integer, p_courier_rating integer, p_comment text) from public, anon, authenticated, service_role;
grant execute on function public.order_rate(p_token text, p_rating integer, p_courier_rating integer, p_comment text) to anon;
grant execute on function public.order_rate(p_token text, p_rating integer, p_courier_rating integer, p_comment text) to authenticated;
grant execute on function public.order_rate(p_token text, p_rating integer, p_courier_rating integer, p_comment text) to service_role;
revoke all on function public.order_status(p_token text) from public, anon, authenticated, service_role;
grant execute on function public.order_status(p_token text) to anon;
grant execute on function public.order_status(p_token text) to authenticated;
grant execute on function public.order_status(p_token text) to service_role;
revoke all on function public.place_order(p_qty integer, p_name text, p_phone text, p_address text, p_entrance text, p_floor text, p_apartment text, p_delivery_time text, p_comment text) from public, anon, authenticated, service_role;
grant execute on function public.place_order(p_qty integer, p_name text, p_phone text, p_address text, p_entrance text, p_floor text, p_apartment text, p_delivery_time text, p_comment text) to anon;
grant execute on function public.place_order(p_qty integer, p_name text, p_phone text, p_address text, p_entrance text, p_floor text, p_apartment text, p_delivery_time text, p_comment text) to authenticated;
grant execute on function public.place_order(p_qty integer, p_name text, p_phone text, p_address text, p_entrance text, p_floor text, p_apartment text, p_delivery_time text, p_comment text) to service_role;
revoke all on function public.receipt_folder_allowed(p_folder text) from public, anon, authenticated, service_role;
grant execute on function public.receipt_folder_allowed(p_folder text) to anon;
grant execute on function public.receipt_folder_allowed(p_folder text) to authenticated;
grant execute on function public.receipt_folder_allowed(p_folder text) to service_role;
revoke all on function public.set_order_branch(p_token text, p_branch text) from public, anon, authenticated, service_role;
grant execute on function public.set_order_branch(p_token text, p_branch text) to anon;
grant execute on function public.set_order_branch(p_token text, p_branch text) to authenticated;
grant execute on function public.set_order_branch(p_token text, p_branch text) to service_role;
revoke all on function public.set_order_delivery(p_token text, p_quote jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_order_delivery(p_token text, p_quote jsonb) to anon;
grant execute on function public.set_order_delivery(p_token text, p_quote jsonb) to authenticated;
grant execute on function public.set_order_delivery(p_token text, p_quote jsonb) to service_role;
revoke all on function public.set_order_options(p_token text, p_options jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_order_options(p_token text, p_options jsonb) to anon;
grant execute on function public.set_order_options(p_token text, p_options jsonb) to authenticated;
grant execute on function public.set_order_options(p_token text, p_options jsonb) to service_role;
revoke all on function public.set_order_point(p_token text, p_lat double precision, p_lon double precision) from public, anon, authenticated, service_role;
grant execute on function public.set_order_point(p_token text, p_lat double precision, p_lon double precision) to anon;
grant execute on function public.set_order_point(p_token text, p_lat double precision, p_lon double precision) to authenticated;
grant execute on function public.set_order_point(p_token text, p_lat double precision, p_lon double precision) to service_role;

notify pgrst, 'reload schema';
