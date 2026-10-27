-- KOKORO: заказы с сайта.
-- Выполнить один раз: Supabase → SQL Editor → вставить файл целиком → Run.
-- Повторный запуск безопасен: существующие заказы и настройки не трогаются.
-- Опирается на функцию public.is_admin() из основной схемы сайта (таблица admins).

-- Настройки приёма заказов: одна строка, правится из панели
create table if not exists public.order_settings (
  id int primary key default 1 check (id = 1),
  accepting_orders boolean not null default true,
  closed_message text not null default 'Сейчас мы не принимаем заказы. Загляните позже!',
  combo_price int not null default 1400 check (combo_price > 0),
  delivery_fee int not null default 0 check (delivery_fee >= 0),
  whatsapp_template text not null default
    'Здравствуйте, {name}! Это KOKORO. Ваш заказ №{number} принят: комбо × {qty}, к оплате {total} сом.' || chr(10) ||
    'Адрес: {address}' || chr(10) ||
    'Подтвердите, пожалуйста, адрес и время доставки.',
  updated_at timestamptz not null default now()
);
insert into public.order_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.orders (
  id bigint generated always as identity primary key,   -- он же номер заказа для клиента
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  status text not null default 'new'
    check (status in ('new', 'confirmed', 'cooking', 'delivering', 'done', 'canceled')),
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
  payment text not null default 'cash' check (payment in ('cash', 'transfer')),
  comment text not null default '',
  manager_note text not null default ''
);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- Доступ: читают и меняют только администраторы. Создать заказ можно только через place_order,
-- поэтому цену и сумму всегда считает база, а не браузер.
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

create or replace function public.place_order(
  p_qty int,
  p_name text,
  p_phone text,
  p_address text,
  p_entrance text default '',
  p_floor text default '',
  p_apartment text default '',
  p_delivery_time text default '',
  p_payment text default 'cash',
  p_comment text default ''
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.order_settings;
  o public.orders;
  v_phone text := left(btrim(coalesce(p_phone, '')), 30);
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
  if coalesce(p_payment, 'cash') not in ('cash', 'transfer') then
    raise exception 'Неизвестный способ оплаты' using errcode = 'P0001';
  end if;
  -- Защита от спама: не больше 3 заказов с одного номера за 10 минут
  if (select count(*) from public.orders
      where created_at > now() - interval '10 minutes'
        and regexp_replace(phone, '\D', '', 'g') = v_digits) >= 3 then
    raise exception 'Слишком много заказов подряд. Мы уже получили ваш заказ — менеджер скоро напишет.' using errcode = 'P0001';
  end if;

  insert into public.orders (qty, unit_price, delivery_fee, total, name, phone, address,
                             entrance, floor, apartment, delivery_time, payment, comment)
  values (p_qty, s.combo_price, s.delivery_fee, p_qty * s.combo_price + s.delivery_fee,
          left(btrim(p_name), 60), v_phone, left(btrim(p_address), 200),
          left(btrim(coalesce(p_entrance, '')), 20), left(btrim(coalesce(p_floor, '')), 20),
          left(btrim(coalesce(p_apartment, '')), 20), left(btrim(coalesce(p_delivery_time, '')), 40),
          coalesce(p_payment, 'cash'), left(btrim(coalesce(p_comment, '')), 500))
  returning * into o;

  return json_build_object('number', o.id, 'total', o.total);
end;
$$;

revoke all on function public.place_order(int, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.place_order(int, text, text, text, text, text, text, text, text, text) to anon, authenticated;
