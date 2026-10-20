-- =====================================================================
-- Vidri reportes · Radar de Negados
-- Pegar completo en Supabase > SQL Editor > New query > Run.
-- Se puede volver a correr: no borra datos.
-- =====================================================================

-- 1) Usuarios con acceso (solo los correos de esta tabla pueden leer y guardar)
create table if not exists public.app_usuarios (
  email      text primary key,
  creado     timestamptz not null default now()
);

create or replace function public.es_usuario_permitido()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_usuarios
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 2) Radar de negados: un registro por día (resumen del día tal como lo usa la página)
create table if not exists public.radar_dias (
  fecha       date primary key,
  data        jsonb not null,
  actualizado timestamptz not null default now()
);

-- Catálogo de códigos y ajustes del Radar (un solo registro, id = 1)
create table if not exists public.radar_store (
  id          smallint primary key default 1 check (id = 1),
  data        jsonb not null,
  actualizado timestamptz not null default now()
);

-- 3) Pedidos CD (reporte de transferencias): un registro por pedido
--    Los tiempos van en minutos desde 1970 con la hora local de El Salvador
--    (así los guarda la página). La vista pedidos_v los muestra como fecha y hora.
create table if not exists public.pedidos (
  numero          text     not null,
  origen          text     not null,
  fecha_min       integer  not null,
  estado          text     not null,   -- A actualizado · P procesando · R recibido · E enviar
  skus            integer  not null default 0,
  motivo          text,                -- exi · b2b · rot · otr
  actualizado_min integer  not null default 0,
  recibido_min    integer  not null default 0,
  corte_min       integer  not null default 0,
  bodega          text,                -- N Nejapa · B Bazinni · M Mobu
  asignado_min    integer,             -- hora en que se creó la orden de preparación
  actualizado     timestamptz not null default now(),
  primary key (numero, origen)
);
create index if not exists pedidos_fecha_idx  on public.pedidos (fecha_min);
create index if not exists pedidos_estado_idx on public.pedidos (estado);

-- Cortes cargados y horas de asignación que esperan su pedido (un registro, id = 1)
create table if not exists public.pedidos_meta (
  id          smallint primary key default 1 check (id = 1),
  cortes      jsonb not null default '[]'::jsonb,
  asg_pend    jsonb not null default '{}'::jsonb,
  actualizado timestamptz not null default now()
);

-- 4) Bitácora de cargas (qué se guardó y cuándo)
create table if not exists public.cargas (
  id       bigserial primary key,
  cuando   timestamptz not null default now(),
  usuario  text default (auth.jwt() ->> 'email'),
  origen   text not null,        -- excel · importacion
  detalle  jsonb
);

-- 5) Vista de pedidos con fechas legibles (para consultas SQL)
create or replace view public.pedidos_v
with (security_invoker = true) as
select
  numero, origen, estado, skus, motivo, bodega,
  timestamp '1970-01-01' + fecha_min       * interval '1 minute' as fecha,
  case when actualizado_min > 0 then timestamp '1970-01-01' + actualizado_min * interval '1 minute' end as actualizado_el,
  case when recibido_min    > 0 then timestamp '1970-01-01' + recibido_min    * interval '1 minute' end as recibido_el,
  case when asignado_min    > 0 then timestamp '1970-01-01' + asignado_min    * interval '1 minute' end as asignado_el,
  timestamp '1970-01-01' + corte_min * interval '1 minute' as ultimo_corte
from public.pedidos;

-- Vista de negados por día (para consultas SQL y comparaciones contra el año anterior)
create or replace view public.radar_dias_v
with (security_invoker = true) as
select
  fecha,
  (data -> 'meta' ->> 'totalFinal')::int                         as lineas,
  (data -> 'meta' ->> 'totalNegados')::int                       as negados,
  round(100.0 * (data -> 'meta' ->> 'totalNegados')::numeric
        / nullif((data -> 'meta' ->> 'totalFinal')::numeric, 0), 1) as pct_negados,
  (data -> 'bucket' ->> 'positivo')::int                         as error_proceso,
  (data -> 'bucket' ->> 'cero')::int                             as existencia_cero,
  (data -> 'bucket' ->> 'negativo')::int                         as existencia_negativa,
  (data -> 'meta' ->> 'exactas')::int                            as lineas_completas
from public.radar_dias;

-- 6) Fecha de actualización automática
create or replace function public.tocar_actualizado()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.actualizado := now();
  return new;
end $$;

drop trigger if exists t_radar_dias   on public.radar_dias;
drop trigger if exists t_radar_store  on public.radar_store;
drop trigger if exists t_pedidos      on public.pedidos;
drop trigger if exists t_pedidos_meta on public.pedidos_meta;
create trigger t_radar_dias   before update on public.radar_dias   for each row execute function public.tocar_actualizado();
create trigger t_radar_store  before update on public.radar_store  for each row execute function public.tocar_actualizado();
create trigger t_pedidos      before update on public.pedidos      for each row execute function public.tocar_actualizado();
create trigger t_pedidos_meta before update on public.pedidos_meta for each row execute function public.tocar_actualizado();

-- 7) Seguridad: nadie sin sesión ve nada; con sesión, solo los correos de app_usuarios
alter table public.app_usuarios enable row level security;
alter table public.radar_dias   enable row level security;
alter table public.radar_store  enable row level security;
alter table public.pedidos      enable row level security;
alter table public.pedidos_meta enable row level security;
alter table public.cargas       enable row level security;

drop policy if exists "ver mi usuario" on public.app_usuarios;
create policy "ver mi usuario" on public.app_usuarios
  for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "permitidos" on public.radar_dias;
create policy "permitidos" on public.radar_dias   for all to authenticated
  using (public.es_usuario_permitido()) with check (public.es_usuario_permitido());
drop policy if exists "permitidos" on public.radar_store;
create policy "permitidos" on public.radar_store  for all to authenticated
  using (public.es_usuario_permitido()) with check (public.es_usuario_permitido());
drop policy if exists "permitidos" on public.pedidos;
create policy "permitidos" on public.pedidos      for all to authenticated
  using (public.es_usuario_permitido()) with check (public.es_usuario_permitido());
drop policy if exists "permitidos" on public.pedidos_meta;
create policy "permitidos" on public.pedidos_meta for all to authenticated
  using (public.es_usuario_permitido()) with check (public.es_usuario_permitido());
drop policy if exists "permitidos" on public.cargas;
create policy "permitidos" on public.cargas       for all to authenticated
  using (public.es_usuario_permitido()) with check (public.es_usuario_permitido());

revoke all on public.radar_dias, public.radar_store, public.pedidos, public.pedidos_meta, public.cargas, public.app_usuarios from anon;
revoke all on public.pedidos_v, public.radar_dias_v from anon;
revoke execute on function public.es_usuario_permitido() from anon;
grant select, insert, update, delete on public.radar_dias, public.radar_store, public.pedidos, public.pedidos_meta, public.cargas to authenticated;
grant select on public.app_usuarios, public.pedidos_v, public.radar_dias_v to authenticated;
grant usage, select on sequence public.cargas_id_seq to authenticated;
