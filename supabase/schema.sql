-- Хранилище кабинета: аккаунты, сессии, счётчики попыток и опубликованный
-- каталог. Только для серверной функции (service_role); анонимный ключ к
-- таблице и функциям доступа не имеет.
create table if not exists public.mgg_kv (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz
);
alter table public.mgg_kv enable row level security;
revoke all on table public.mgg_kv from public, anon, authenticated;

create or replace function public.mgg_get(p_key text) returns jsonb
language sql security definer set search_path = public as $$
  select value from mgg_kv
  where key = p_key and (expires_at is null or expires_at > now());
$$;

-- p_only_new: записать, только если ключа нет (или он истёк).
create or replace function public.mgg_set(
  p_key text, p_value jsonb, p_ttl integer default null, p_only_new boolean default false
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  expiry timestamptz := case when p_ttl is null then null else now() + make_interval(secs => p_ttl) end;
begin
  if random() < 0.02 then
    delete from mgg_kv where expires_at < now() - interval '1 day';
  end if;
  delete from mgg_kv where key = p_key and expires_at is not null and expires_at <= now();
  if p_only_new then
    insert into mgg_kv (key, value, expires_at) values (p_key, p_value, expiry)
    on conflict (key) do nothing;
    return found;
  end if;
  insert into mgg_kv (key, value, expires_at) values (p_key, p_value, expiry)
  on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at;
  return true;
end $$;

-- p_if_value: удалить, только если значение совпадает (снятие своей блокировки).
create or replace function public.mgg_del(p_key text, p_if_value jsonb default null) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_if_value is null then
    delete from mgg_kv where key = p_key;
  else
    delete from mgg_kv where key = p_key and value = p_if_value;
  end if;
  return found;
end $$;

-- Счётчик в окне p_ttl секунд (ограничение попыток входа).
create or replace function public.mgg_incr(p_key text, p_ttl integer) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into mgg_kv as kv (key, value, expires_at)
  values (p_key, '1'::jsonb, now() + make_interval(secs => p_ttl))
  on conflict (key) do update set
    value = case when kv.expires_at <= now() then '1'::jsonb
                 else to_jsonb((kv.value #>> '{}')::integer + 1) end,
    expires_at = case when kv.expires_at <= now() then now() + make_interval(secs => p_ttl)
                      else kv.expires_at end
  returning (value #>> '{}')::integer into n;
  return n;
end $$;

create or replace function public.mgg_list(p_prefix text) returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(value order by key), '[]'::jsonb) from mgg_kv
  where starts_with(key, p_prefix) and (expires_at is null or expires_at > now());
$$;

revoke execute on function
  public.mgg_get(text),
  public.mgg_set(text, jsonb, integer, boolean),
  public.mgg_del(text, jsonb),
  public.mgg_incr(text, integer),
  public.mgg_list(text)
from public, anon, authenticated;
grant execute on function
  public.mgg_get(text),
  public.mgg_set(text, jsonb, integer, boolean),
  public.mgg_del(text, jsonb),
  public.mgg_incr(text, integer),
  public.mgg_list(text)
to service_role;

-- Публичные файлы: data/site.json (каталог) и uploads/*.webp (фото).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site', 'site', true, 1048576, array['application/json', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
