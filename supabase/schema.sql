-- Ejecutar únicamente en el proyecto NUEVO de Cualitec.
create table if not exists public.owner_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.owner_data enable row level security;
revoke all on public.owner_data from anon, authenticated;
grant select, insert, update on public.owner_data to authenticated;

create policy "read own data" on public.owner_data for select to authenticated
using ((select auth.uid()) = user_id);
create policy "insert own data" on public.owner_data for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "update own data" on public.owner_data for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function public.save_owner_data(p_expected_revision bigint, p_data jsonb)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare next_revision bigint;
begin
  if (select auth.uid()) is null then raise exception 'Autenticación requerida'; end if;
  if p_expected_revision = 0 then
    insert into public.owner_data(user_id, data, revision, updated_at)
    values ((select auth.uid()), p_data, 1, now())
    on conflict (user_id) do nothing returning revision into next_revision;
  else
    update public.owner_data set data = p_data, revision = revision + 1, updated_at = now()
    where user_id = (select auth.uid()) and revision = p_expected_revision
    returning revision into next_revision;
  end if;
  if next_revision is null then raise exception 'VERSION_CONFLICT'; end if;
  return next_revision;
end;
$$;
revoke all on function public.save_owner_data(bigint, jsonb) from public;
grant execute on function public.save_owner_data(bigint, jsonb) to authenticated;

