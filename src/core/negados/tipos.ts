/** Tipos del Radar de Negados (reporte Rpt_OrdenesPreparacion). */

export type Bucket = 'positivo' | 'cero' | 'negativo';
export const BUCKETS: Bucket[] = ['positivo', 'cero', 'negativo'];
/** positivo = error en el proceso (había stock) · cero = sin existencia · negativo = inventario negativo */
export const BIDX: Record<Bucket, number> = { positivo: 0, cero: 1, negativo: 2 };

/** Una línea del Excel ya limpia. */
export interface Registro {
  Sucursal: string;
  Orden: string;
  Pedido: string;
  SKU: string;
  Cantidad: number | null;
  CantPrep: number | null;
  Disponible: number | null;
  UM?: unknown;
  Razon?: unknown;
  Desc: string;
  Categoria: string;
  Estado: string;
  Preparador: string;
  Fecha: Date | null;
  FechaAct: Date | null;
  FechaRevision: Date | null;
  /** Momento en que la línea quedó lista (Fecha Actualizado o, si falta, Fecha Enviado Revisión) */
  Fin?: Date;
  [k: string]: unknown;
}

/** Resumen de un día con las reglas actuales (v: 2). */
export interface DiaResumen {
  v: 2;
  date: string;
  meta: {
    totalFinal: number; totalNegados: number; totalPreparados: number; exactas: number;
    b2bTot?: number; b2bOk?: number;
    [k: string]: unknown;
  };
  bucket: Record<Bucket, number>;
  /** sku -> [error en proceso, sin existencia, negativo] */
  codes: Record<string, [number, number, number]>;
  /** sucursal -> [líneas, negadas] */
  stores: Record<string, [number, number]>;
  /** negados por hora (0–23) */
  hours: number[];
  /** preparador -> [negados, preparados] */
  preps: Record<string, [number, number]>;
  /** preparador -> sku -> veces negado */
  pairs: Record<string, Record<string, number>>;
  /** preparador -> sku -> veces preparado */
  prepSkus: Record<string, Record<string, number>>;
  /** sku -> unidades negadas */
  qty?: Record<string, number>;
}

/** Día guardado con la versión anterior del tablero (se muestra tal cual). */
export interface DiaLegacy {
  v?: 1;
  date?: string;
  meta: Record<string, number | string>;
  bucketCounts?: Partial<Record<Bucket, number>>;
  codes: Record<string, number[]>;
  byStore?: [string, number][];
  hours?: number[];
  preps: Record<string, [number, number]>;
  pairs: Record<string, Record<string, number>>;
  prepSkus: Record<string, Record<string, number>>;
  cats?: [string, number, [string, number][]][];
  [k: string]: unknown;
}

export type Dia = DiaResumen | DiaLegacy;
export type Historial = Record<string, Dia>;

export interface StoreRadar {
  /** sku -> [descripción, categoría, unidad de medida] */
  skus: Record<string, [string, string?, string?]>;
  /** día de creación -> llaves "pedido|sku" ya contadas (separadas por coma) */
  seen: Record<string, string>;
  /** "pedido|sku" -> [estado, sucursal, preparador, sku, día de creación] */
  pending: Record<string, [string, string, string, string, string]>;
  /** días de creación ya completos (se cargó un reporte posterior) */
  covered: string[];
  /** pedido corporativo -> [último día, líneas, 1 si todas completas] */
  b2b: Record<string, [string, number, number]>;
  backlog: Record<string, unknown>;
  legacyCutoff?: string | null;
  updatedAt?: string;
  [k: string]: unknown;
}

export interface ResultadoIntegracion {
  added: number;
  addedByDay: Record<string, number>;
  already: number;
  legacyIgnored: number;
  sinDato: number;
  otherEstado: number;
  pendingNow: number;
  resolved: number;
  dedupPedidoSku: number;
  dedupOrdenSku: number;
  totalRows: number;
  fechaRespaldo?: number;
  /** días quitados por tener más de un año */
  recortados?: string[];
}
