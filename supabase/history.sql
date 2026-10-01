-- Ejecutar en el proyecto Supabase de Cualitec. Conserva las 50 versiones más recientes.
create table if not exists public.owner_data_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, revision)
);

alter table public.owner_data_history enable row level security;
revoke all on public.owner_data_history from anon, authenticated;
grant select, insert, delete on public.owner_data_history to authenticated;
grant usage, select on sequence public.owner_data_history_id_seq to authenticated;

drop policy if exists "read own history" on public.owner_data_history;
create policy "read own history" on public.owner_data_history for select to authenticated
using ((select auth.uid()) = user_id);
drop policy if exists "insert own history" on public.owner_data_history;
create policy "insert own history" on public.owner_data_history for insert to authenticated
with check ((select auth.uid()) = user_id);
drop policy if exists "delete own history" on public.owner_data_history;
create policy "delete own history" on public.owner_data_history for delete to authenticated
using ((select auth.uid()) = user_id);

insert into public.owner_data_history (user_id, revision, data, created_at)
select user_id, revision, data, updated_at from public.owner_data
on conflict (user_id, revision) do nothing;

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
  insert into public.owner_data_history(user_id, revision, data)
  values ((select auth.uid()), next_revision, p_data);
  delete from public.owner_data_history
  where user_id = (select auth.uid()) and id in (
    select id from public.owner_data_history
    where user_id = (select auth.uid()) order by revision desc offset 50
  );
  return next_revision;
end;
$$;
revoke all on function public.save_owner_data(bigint, jsonb) from public;
grant execute on function public.save_owner_data(bigint, jsonb) to authenticated;
