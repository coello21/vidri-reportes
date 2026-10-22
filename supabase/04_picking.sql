-- =====================================================================
-- Picking: historial del Rpt_OrdenesPreparacion para el análisis de ubicaciones (slotting).
-- Correr UNA vez en el SQL Editor del proyecto cd-nejapa-reportes. No toca las tablas del Radar.
-- Se guarda por día de creación del pedido, código y ubicación (no línea por línea: sería demasiado grande).
-- Cada carga reemplaza los días que trae el archivo, así que cargar dos veces el mismo mes no duplica.
-- =====================================================================
create table if not exists public.picking_dia (
  dia          date    not null,               -- fecha de creación (hora de El Salvador)
  sku          text    not null,
  ubicacion    text    not null default '',     -- Ubicación 1 (o la 2 si la 1 viene vacía)
  lineas       integer not null default 0,      -- líneas pedidas (demanda)
  unidades     numeric not null default 0,      -- cantidad pedida
  lineas_prep  integer not null default 0,      -- líneas actualizadas con cantidad preparada > 0
  unid_prep    numeric not null default 0,
  neg_proceso  integer not null default 0,      -- negadas con stock en sistema (error en el proceso)
  neg_sinstock integer not null default 0,      -- negadas con disponible 0
  neg_negativo integer not null default 0,      -- negadas con inventario negativo
  pendientes   integer not null default 0,      -- líneas aún no actualizadas en ese archivo
  pedidos      integer not null default 0,      -- pedidos distintos
  sucursales   integer not null default 0,      -- sucursales distintas
  primary key (dia, sku, ubicacion)
);
create index if not exists picking_dia_sku on public.picking_dia (sku);

-- Hora de corte del archivo que llenó cada día: un archivo más viejo no reemplaza uno más nuevo
create table if not exists public.picking_cortes (
  dia date primary key, corte bigint not null, archivo text, cargado timestamptz not null default now());

create table if not exists public.picking_codigos (
  sku         text primary key,
  descripcion text,
  um          text,
  categoria   text,                             -- columna Categoría del reporte
  actualizado timestamptz not null default now()
);

-- Resumen por código en un rango de días (lo hace la base: la página solo recibe el resultado)
create or replace function public.picking_resumen(desde date, hasta date)
returns table (sku text, ubicacion text, ubicaciones bigint, lineas bigint, unidades numeric, lineas_prep bigint,
               neg_proceso bigint, neg_sinstock bigint, neg_negativo bigint, dias bigint, pedidos bigint)
language sql stable security invoker set search_path = public as $$
  select d.sku,
         (array_agg(d.ubicacion order by d.lineas desc))[1],
         count(distinct d.ubicacion),
         sum(d.lineas), sum(d.unidades), sum(d.lineas_prep),
         sum(d.neg_proceso), sum(d.neg_sinstock), sum(d.neg_negativo),
         count(distinct d.dia), sum(d.pedidos)
  from public.picking_dia d
  where d.dia between desde and hasta
  group by d.sku
$$;

-- Días cargados (para ver qué falta)
create or replace function public.picking_cobertura()
returns table (dia date, lineas bigint, codigos bigint)
language sql stable security invoker set search_path = public as $$
  select d.dia, sum(d.lineas), count(distinct d.sku) from public.picking_dia d group by d.dia order by d.dia
$$;

alter table public.picking_dia     enable row level security;
alter table public.picking_codigos enable row level security;
alter table public.picking_cortes  enable row level security;
create policy "permitidos" on public.picking_cortes for all to authenticated
  using ((select public.es_usuario_permitido())) with check ((select public.es_usuario_permitido()));
create policy "permitidos" on public.picking_dia for all to authenticated
  using ((select public.es_usuario_permitido())) with check ((select public.es_usuario_permitido()));
create policy "permitidos" on public.picking_codigos for all to authenticated
  using ((select public.es_usuario_permitido())) with check ((select public.es_usuario_permitido()));
