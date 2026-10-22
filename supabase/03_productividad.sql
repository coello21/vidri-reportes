-- =====================================================================
-- Productividad de preparación (rpt_ListaPreparacionAuditoria)
-- Una fila por orden de preparación, con todas las columnas del reporte.
-- Fechas y horas: segundos desde 1970 (instante real; la página las muestra en hora local).
-- =====================================================================

create table if not exists public.prod_ordenes (
  id               bigint primary key,          -- ID de la orden de preparación
  preparador       text   not null,             -- nombre como viene en el reporte (sin "Preparador:")
  items            integer not null default 0,  -- TOTAL ITEM (SKUs / líneas)
  horas            numeric(10,4),               -- del 1er al último código preparado, en horas
  tipo             text,                        -- TIPO DE PEDIDO
  dia              date   not null,             -- día de la FECHA DE ASIGNACIÓN (hora local)
  zona             text,                        -- ZONA DE PEDIDO (una o varias, separadas por coma)
  t1               bigint,                      -- 1° código preparado
  t2               bigint,                      -- último código preparado
  -- resto de columnas del reporte (para el análisis de picking y tiempos)
  revisador        text,
  unidades         numeric,
  fecha_pedido     bigint,
  asignado         bigint,
  rev1             bigint,                      -- 1° código revisado
  rev2             bigint,                      -- último código revisado
  estado           text,
  min_asignacion   integer,                     -- TIEMPO ASIGNACIÓN (minutos)
  min_preparacion  integer,
  min_espera       integer,                     -- TIEMPO DE ESPERA (REVISIÓN)
  min_total        integer,
  min_revision     integer,
  actualizado      timestamptz not null default now()
);
create index if not exists prod_ordenes_dia on public.prod_ordenes (dia);

-- Personas agregadas al listado desde la página (el listado base va en el código)
create table if not exists public.prod_personal (
  clave      text primary key,                  -- nombre normalizado (palabras ordenadas)
  codigo     integer,
  nombre     text not null,
  tipo       text not null,                     -- Retail, B2B, Apoyo, Maestro de Olas
  estado     text not null default 'Activo',
  agregado   timestamptz not null default now()
);

alter table public.prod_ordenes  enable row level security;
alter table public.prod_personal enable row level security;
drop policy if exists "permitidos" on public.prod_ordenes;
create policy "permitidos" on public.prod_ordenes for all to authenticated
  using (public.es_usuario_permitido()) with check (public.es_usuario_permitido());
drop policy if exists "permitidos" on public.prod_personal;
create policy "permitidos" on public.prod_personal for all to authenticated
  using (public.es_usuario_permitido()) with check (public.es_usuario_permitido());
