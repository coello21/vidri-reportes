-- =====================================================================
-- Productividad de preparación (rpt_ListaPreparacionAuditoria). Correr UNA vez en el SQL Editor.
-- Una fila por orden de preparación, con todas las columnas del reporte.
-- Fechas y horas: segundos desde 1970 (instante real). "dia" lo calcula la página en hora de El Salvador.
-- =====================================================================
create table if not exists public.prod_ordenes (
  id bigint primary key, preparador text not null, items integer not null default 0, horas numeric(10,4), tipo text,
  dia date not null, zona text, t1 bigint, t2 bigint, revisador text, unidades numeric, fecha_pedido bigint, asignado bigint,
  rev1 bigint, rev2 bigint, estado text, min_asignacion integer, min_preparacion integer, min_espera integer, min_total integer,
  min_revision integer, actualizado timestamptz not null default now());
create index if not exists prod_ordenes_dia on public.prod_ordenes (dia);
-- Personas agregadas al listado desde la página (el listado base va en el código)
create table if not exists public.prod_personal (
  clave text primary key, codigo integer, nombre text not null, tipo text not null, estado text not null default 'Activo',
  agregado timestamptz not null default now());

-- "actualizado" cambia solo en cada actualización
create or replace function public.prod_tocar() returns trigger language plpgsql as $$
begin new.actualizado := now(); return new; end $$;
create trigger prod_ordenes_tocar before update on public.prod_ordenes
  for each row execute function public.prod_tocar();

-- Seguridad: solo los correos de app_usuarios. Las órdenes no se pueden borrar desde la página.
alter table public.prod_ordenes enable row level security;
alter table public.prod_personal enable row level security;
create policy "ver" on public.prod_ordenes for select to authenticated using ((select public.es_usuario_permitido()));
create policy "agregar" on public.prod_ordenes for insert to authenticated with check ((select public.es_usuario_permitido()));
create policy "actualizar" on public.prod_ordenes for update to authenticated
  using ((select public.es_usuario_permitido())) with check ((select public.es_usuario_permitido()));
create policy "permitidos" on public.prod_personal for all to authenticated
  using ((select public.es_usuario_permitido())) with check ((select public.es_usuario_permitido()));
