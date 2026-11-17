-- «Мой день»: пользователи, пара, синхронизация задач, напоминания и подписки на уведомления.

-- Профиль: имя и пара, в которой состоит пользователь
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  couple_id uuid,
  created_at timestamptz not null default now()
);

-- Пара: двое людей с общими домашними делами. Вступить можно по коду приглашения.
create table public.couples (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  created_at timestamptz not null default now()
);
alter table public.profiles add constraint profiles_couple_fk foreign key (couple_id) references public.couples on delete set null;

-- Личные данные приложения (задачи, расписание, отметки) одним документом на пользователя.
-- Документ — набор записей {ключ: {u: время изменения в мс, v: значение или null, если удалено}}.
-- Две копии сливаются по каждой записи: побеждает более свежая.
create table public.user_state (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Общие дела пары одним документом на пару
create table public.shared_state (
  couple_id uuid primary key references public.couples on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Подписки на push-уведомления (по одной на устройство)
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Напоминания «Вы сделали…?» на ближайшие дни; сервер рассылает их по времени
create table public.reminders (
  user_id uuid not null references auth.users on delete cascade,
  key text not null,
  day date not null,
  due_at timestamptz not null,
  title text not null,
  body text not null,
  sent_at timestamptz,
  primary key (user_id, key, day)
);
create index reminders_due on public.reminders (due_at) where sent_at is null;

-- Служебные значения сервера (ключи уведомлений, секрет планировщика). Доступны только серверу.
create table public.app_secrets (
  name text primary key,
  value text not null
);
insert into public.app_secrets (name, value)
values ('cron_secret', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text));

-- ---------- доступ ----------
alter table public.profiles enable row level security;
alter table public.couples enable row level security;
alter table public.user_state enable row level security;
alter table public.shared_state enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminders enable row level security;
alter table public.app_secrets enable row level security; -- без правил: только сервер

create or replace function public.my_couple() returns uuid
language sql stable security definer set search_path = public as
$$ select couple_id from public.profiles where id = auth.uid() $$;

create policy "профиль: свой и партнёра" on public.profiles for select
  using (id = auth.uid() or (couple_id is not null and couple_id = public.my_couple()));
create policy "профиль: создать свой" on public.profiles for insert with check (id = auth.uid());
create policy "профиль: менять свой" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and couple_id is not distinct from public.my_couple());

create policy "пара: своя" on public.couples for select using (id = public.my_couple());

create policy "данные: свои" on public.user_state for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "общие дела: своей пары" on public.shared_state for all
  using (couple_id = public.my_couple()) with check (couple_id = public.my_couple());

create policy "подписки: свои" on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "напоминания: свои" on public.reminders for select using (user_id = auth.uid());

-- ---------- пара ----------
-- Создать пару и получить код приглашения
create or replace function public.create_couple() returns text
language plpgsql security definer set search_path = public as $$
declare c uuid; code text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select couple_id into c from profiles where id = auth.uid();
  if c is not null then
    select invite_code into code from couples where id = c;
    return code;
  end if;
  loop
    code := upper(substr(md5(random()::text), 1, 6));
    exit when not exists (select 1 from couples where invite_code = code);
  end loop;
  insert into couples (invite_code) values (code) returning id into c;
  insert into profiles (id, couple_id) values (auth.uid(), c)
    on conflict (id) do update set couple_id = excluded.couple_id;
  insert into shared_state (couple_id) values (c);
  return code;
end $$;

-- Вступить в пару по коду. В паре не больше двух человек.
create or replace function public.join_couple(code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into c from couples where invite_code = upper(trim(code));
  if c is null then return false; end if;
  if (select count(*) from profiles where couple_id = c and id <> auth.uid()) >= 2 then return false; end if; -- уже двое
  insert into profiles (id, couple_id) values (auth.uid(), c)
    on conflict (id) do update set couple_id = excluded.couple_id;
  return true;
end $$;

create or replace function public.leave_couple() returns void
language sql security definer set search_path = public as
$$ update profiles set couple_id = null where id = auth.uid() $$;

-- Заменить будущие напоминания пользователя новым списком (приложение присылает план на неделю)
create or replace function public.set_reminders(items jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from reminders where user_id = auth.uid() and sent_at is null;
  insert into reminders (user_id, key, day, due_at, title, body)
  select auth.uid(), x->>'key', (x->>'day')::date, (x->>'due_at')::timestamptz, x->>'title', x->>'body'
  from jsonb_array_elements(items) as x
  where (x->>'due_at')::timestamptz > now() - interval '5 minutes'
  on conflict (user_id, key, day) do nothing;
  get diagnostics n = row_count;
  -- отправленные старше двух дней больше не нужны
  delete from reminders where user_id = auth.uid() and sent_at < now() - interval '2 days';
  return n;
end $$;

-- ---------- синхронизация ----------
create or replace function public.merge_entries(a jsonb, b jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
    select distinct on (k) k, v from (
      select key as k, value as v from jsonb_each(coalesce(a, '{}'::jsonb))
      union all
      select key, value from jsonb_each(coalesce(b, '{}'::jsonb))
    ) s order by k, (v->>'u')::bigint desc, v::text desc
  ) t $$;

-- удалённые записи старше 45 дней и отметки старше трёх дней больше не нужны
create or replace function public.prune_entries(e jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(e)
  where not (value->'v' = 'null'::jsonb and (value->>'u')::bigint < (extract(epoch from now()) * 1000)::bigint - 45::bigint * 86400000)
    and not (key like 'mark:%' and substr(key, 6, 10) < to_char(current_date - 3, 'YYYY-MM-DD')) $$;

-- Слить свои записи с сохранёнными на сервере и вернуть итог
create or replace function public.sync_mine(entries jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur jsonb; res jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into user_state (user_id) values (auth.uid()) on conflict do nothing;
  select data into cur from user_state where user_id = auth.uid() for update;
  res := prune_entries(merge_entries(cur, entries));
  update user_state set data = res, updated_at = now() where user_id = auth.uid();
  return res;
end $$;

-- То же для общих дел пары. Без пары возвращает null.
create or replace function public.sync_ours(entries jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid; cur jsonb; res jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  c := my_couple();
  if c is null then return null; end if;
  insert into shared_state (couple_id) values (c) on conflict do nothing;
  select data into cur from shared_state where couple_id = c for update;
  res := prune_entries(merge_entries(cur, entries));
  update shared_state set data = res, updated_at = now() where couple_id = c;
  return res;
end $$;

-- Забрать напоминания, время которых пришло (вызывает только сервер рассылки)
create or replace function public.claim_due_reminders() returns setof public.reminders
language sql security definer set search_path = public as $$
  update reminders set sent_at = now() where sent_at is null and due_at <= now() returning * $$;
revoke all on function public.claim_due_reminders() from public, anon, authenticated;

-- Имя при регистрации
create or replace function public.set_my_name(n text) returns void
language sql security definer set search_path = public as $$
  insert into profiles (id, name) values (auth.uid(), left(trim(n), 60))
  on conflict (id) do update set name = excluded.name $$;

revoke all on function public.sync_mine(jsonb) from anon;
revoke all on function public.sync_ours(jsonb) from anon;
revoke all on function public.set_my_name(text) from anon;
revoke all on function public.create_couple() from anon;
revoke all on function public.join_couple(text) from anon;
revoke all on function public.leave_couple() from anon;
revoke all on function public.set_reminders(jsonb) from anon;
