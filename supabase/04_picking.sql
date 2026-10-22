-- =====================================================================
-- Picking: historial del Rpt_OrdenesPreparacion para el análisis de ubicaciones (slotting).
-- Proyecto cd-nejapa-reportes. No toca las tablas del Radar ni de Productividad.
-- Se puede correr más de una vez: lo que ya existe se salta (sin "drop").
-- Se guarda por día de creación del pedido, código y ubicación. Cada día se llena con un solo archivo
-- (el de corte más reciente), así que cargar dos veces el mismo mes no duplica.
-- =====================================================================
create table if not exists public.picking_dia (
  dia          date    not null,               -- fecha de creación del pedido (hora de El Salvador)
  sku          text    not null,
  ubicacion    text    not null default '',     -- Ubicación 1 (o la 2 si la 1 viene vacía)
  lineas       integer not null default 0 check (lineas >= 0),        -- líneas pedidas (una por pedido y código)
  unidades     numeric not null default 0 check (unidades >= 0),
  lineas_prep  integer not null default 0 check (lineas_prep >= 0),   -- actualizadas con cantidad preparada > 0
  unid_prep    numeric not null default 0 check (unid_prep >= 0),
  neg_proceso  integer not null default 0 check (neg_proceso >= 0),   -- negadas con stock en sistema
  neg_sinstock integer not null default 0 check (neg_sinstock >= 0),  -- negadas con disponible 0
  neg_negativo integer not null default 0 check (neg_negativo >= 0),  -- negadas con inventario negativo
  pendientes   integer not null default 0 check (pendientes >= 0),    -- aún sin actualizar en ese archivo
  pedidos      integer not null default 0 check (pedidos >= 0),       -- pedidos distintos (cada pedido+código cae en una sola fila)
  sucursales   integer not null default 0 check (sucursales >= 0),
  primary key (dia, sku, ubicacion)
);
create index if not exists picking_dia_sku on public.picking_dia (sku);

-- Un registro por día: con qué archivo se llenó, su hora de corte y totales (para el calendario de días cargados)
create table if not exists public.picking_cortes (
  dia      date primary key,
  corte    bigint not null,                    -- milisegundos: la fecha más reciente del archivo
  archivo  text,
  lineas   integer not null default 0,
  codigos  integer not null default 0,
  cargado  timestamptz not null default now()
);

create table if not exists public.picking_codigos (
  sku         text primary key,
  descripcion text,
  um          text,
  categoria   text,                             -- columna Categoría del reporte
  actualizado timestamptz not null default now()
);

-- "actualizado" del catálogo cambia solo (reutiliza la función de Productividad; se crea si no existe)
create or replace function public.prod_tocar() returns trigger language plpgsql set search_path = '' as $$
begin new.actualizado := now(); return new; end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'picking_codigos_tocar' and tgrelid = 'public.picking_codigos'::regclass) then
    create trigger picking_codigos_tocar before update on public.picking_codigos for each row execute function public.prod_tocar();
  end if;
end $$;

-- Resumen por código en un rango (lo calcula la base; la página solo recibe el resultado).
-- Ubicación principal = la que más líneas tuvo en el rango (sin contar la vacía; en empate, la primera en orden).
create or replace function public.picking_resumen(desde date, hasta date)
returns table (sku text, ubicacion text, ubicaciones bigint, lineas bigint, unidades numeric, lineas_prep bigint, unid_prep numeric,
               neg_proceso bigint, neg_sinstock bigint, neg_negativo bigint, dias bigint, pedidos bigint)
language sql stable security invoker set search_path = public as $$
  with u as (
    select d.sku, d.ubicacion, sum(d.lineas) l from public.picking_dia d
    where d.dia between desde and hasta group by d.sku, d.ubicacion
  ), p as (
    select u.sku, (array_agg(u.ubicacion order by (u.ubicacion = ''), u.l desc, u.ubicacion))[1] ubicacion,
           count(*) filter (where u.ubicacion <> '') ubicaciones
    from u group by u.sku
  )
  select d.sku, p.ubicacion, p.ubicaciones,
         sum(d.lineas), sum(d.unidades), sum(d.lineas_prep), sum(d.unid_prep),
         sum(d.neg_proceso), sum(d.neg_sinstock), sum(d.neg_negativo),
         count(distinct d.dia), sum(d.pedidos)
  from public.picking_dia d join p on p.sku = d.sku
  where d.dia between desde and hasta
  group by d.sku, p.ubicacion, p.ubicaciones
$$;
revoke execute on function public.picking_resumen(date, date) from public, anon;
grant execute on function public.picking_resumen(date, date) to authenticated;

-- Seguridad: solo los correos de app_usuarios
alter table public.picking_dia     enable row level security;
alter table public.picking_cortes  enable row level security;
alter table public.picking_codigos enable row level security;
do $$
declare t text;
begin
  foreach t in array array['picking_dia', 'picking_cortes', 'picking_codigos'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'permitidos') then
      execute format('create policy "permitidos" on public.%I for all to authenticated using ((select public.es_usuario_permitido())) with check ((select public.es_usuario_permitido()))', t);
    end if;
  end loop;
end $$;
