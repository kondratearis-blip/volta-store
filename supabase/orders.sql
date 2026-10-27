-- KOKORO: заказы с сайта и оплата по QR с чеком.
-- Выполнить: Supabase → SQL Editor → вставить файл целиком → Run.
-- Повторный запуск безопасен (и поверх прошлой версии файла): заказы и настройки сохраняются.
-- Опирается на функцию public.is_admin() из основной схемы сайта (таблица admins).
--
-- Как идёт заказ:
--   1. place_order создаёт заказ со статусом awaiting_payment и возвращает номер, сумму и секретный pay_token;
--   2. клиент платит по QR и загружает чек в хранилище receipts в папку <pay_token>/;
--   3. attach_receipt по pay_token привязывает чек, заказ становится new («Оплачен — новый»).

create extension if not exists pgcrypto;

/* ---------- Настройки: одна строка, правится из панели ---------- */

create table if not exists public.order_settings (
  id int primary key default 1 check (id = 1),
  accepting_orders boolean not null default true,
  closed_message text not null default 'Сейчас мы не принимаем заказы. Загляните позже!',
  combo_price int not null default 1400 check (combo_price > 0),
  delivery_fee int not null default 0 check (delivery_fee >= 0),
  whatsapp_template text not null default
    'Здравствуйте, {name}! Это KOKORO. Ваш заказ №{number} оплачен и принят: комбо × {qty}, {total} сом.' || chr(10) ||
    'Адрес: {address}' || chr(10) ||
    'Подтвердите, пожалуйста, адрес и время доставки.',
  updated_at timestamptz not null default now()
);
alter table public.order_settings add column if not exists qr_url text not null default '';
alter table public.order_settings add column if not exists payment_note text not null default
  'Отсканируйте QR-код в приложении банка и оплатите точную сумму. Затем прикрепите чек — скриншот или фото.';
insert into public.order_settings (id) values (1) on conflict (id) do nothing;

/* ---------- Заказы ---------- */

create table if not exists public.orders (
  id bigint generated always as identity primary key,   -- он же номер заказа для клиента
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  status text not null default 'awaiting_payment',
  qty int not null check (qty between 1 and 20),
  unit_price int not null,
  delivery_fee int not null,
  total int not null,
  name text not null,
  phone text not null,
  address text not null,
  entrance text not null default '',
  floor text not null default '',
  apartment text not null default '',
  delivery_time text not null default '',
  payment text not null default 'qr',
  comment text not null default '',
  manager_note text not null default ''
);
alter table public.orders add column if not exists pay_token uuid not null default gen_random_uuid();
alter table public.orders add column if not exists receipt_path text;
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders alter column status set default 'awaiting_payment';
alter table public.orders alter column payment set default 'qr';

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('awaiting_payment', 'new', 'confirmed', 'cooking', 'delivering', 'done', 'canceled'));
alter table public.orders drop constraint if exists orders_payment_check;
alter table public.orders add constraint orders_payment_check check (payment in ('qr', 'cash', 'transfer'));

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create unique index if not exists orders_pay_token_idx on public.orders (pay_token);

/* ---------- Доступ ---------- */
-- Читают и меняют заказы только администраторы. Клиент создаёт заказ и прикладывает чек только
-- через функции ниже, поэтому сумму всегда считает база, а чужой заказ не тронуть.

alter table public.order_settings enable row level security;
alter table public.orders enable row level security;

drop policy if exists order_settings_read on public.order_settings;
create policy order_settings_read on public.order_settings for select using (true);
drop policy if exists order_settings_admin_update on public.order_settings;
create policy order_settings_admin_update on public.order_settings for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists orders_admin_read on public.orders;
create policy orders_admin_read on public.orders for select using (public.is_admin());
drop policy if exists orders_admin_update on public.orders;
create policy orders_admin_update on public.orders for update
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.orders from anon;
grant select, update on public.orders to authenticated;
revoke all on public.order_settings from anon;
grant select on public.order_settings to anon;
grant select, update on public.order_settings to authenticated;

/* ---------- Создание заказа ---------- */

drop function if exists public.place_order(int, text, text, text, text, text, text, text, text, text);

create or replace function public.place_order(
  p_qty int,
  p_name text,
  p_phone text,
  p_address text,
  p_entrance text default '',
  p_floor text default '',
  p_apartment text default '',
  p_delivery_time text default '',
  p_comment text default ''
) returns json
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.place_order(int, text, text, text, text, text, text, text, text) from public;
grant execute on function public.place_order(int, text, text, text, text, text, text, text, text) to anon, authenticated;

/* ---------- Чек об оплате ---------- */

-- Можно ли загрузить чек в папку с таким именем: это pay_token заказа, который ждёт оплаты
create or replace function public.receipt_folder_allowed(p_folder text) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.orders
    where pay_token::text = p_folder
      and status = 'awaiting_payment'
      and created_at > now() - interval '2 days'
  );
$$;
revoke all on function public.receipt_folder_allowed(text) from public;
grant execute on function public.receipt_folder_allowed(text) to anon, authenticated;

create or replace function public.attach_receipt(p_token uuid, p_path text) returns json
language plpgsql
security definer
set search_path = public
as $$
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
  return json_build_object('number', o.id, 'total', o.total);
end;
$$;
revoke all on function public.attach_receipt(uuid, text) from public;
grant execute on function public.attach_receipt(uuid, text) to anon, authenticated;

-- Клиент передумал до оплаты: отменить можно только свой неоплаченный заказ
create or replace function public.cancel_unpaid_order(p_token uuid) returns void
language sql
security definer
set search_path = public
as $$
  update public.orders set status = 'canceled', updated_at = now()
   where pay_token = p_token and status = 'awaiting_payment';
$$;
revoke all on function public.cancel_unpaid_order(uuid) from public;
grant execute on function public.cancel_unpaid_order(uuid) to anon, authenticated;

/* ---------- Хранилище ---------- */
-- receipts — чеки клиентов (закрытое: смотрят только администраторы)
-- payment — QR-код для оплаты (открытое: показывается на сайте, загружают администраторы)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment', 'payment', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists kokoro_receipts_upload on storage.objects;
create policy kokoro_receipts_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'receipts' and public.receipt_folder_allowed((storage.foldername(name))[1]));
drop policy if exists kokoro_receipts_admin_read on storage.objects;
create policy kokoro_receipts_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_admin());

drop policy if exists kokoro_payment_admin_insert on storage.objects;
create policy kokoro_payment_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment' and public.is_admin());
drop policy if exists kokoro_payment_admin_delete on storage.objects;
create policy kokoro_payment_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'payment' and public.is_admin());
