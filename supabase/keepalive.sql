-- Ejecutar en el proyecto Supabase de Cualitec.
-- La fila es pública y no contiene datos del negocio. Solo admite lectura.
create table if not exists public.keepalive (
  id integer primary key check (id = 1)
);

insert into public.keepalive (id) values (1)
on conflict (id) do nothing;

alter table public.keepalive enable row level security;
revoke all on public.keepalive from anon, authenticated;
grant select on public.keepalive to anon;

drop policy if exists "read keepalive" on public.keepalive;
create policy "read keepalive" on public.keepalive
for select to anon using (true);
