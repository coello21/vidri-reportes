import * as XLSX from 'xlsx';
import { normUpper, numOTexto } from '../comun/texto';
import { aMinutos, diaDeMin } from '../comun/fechas';
import { BODEGAS, CODIGO_SUCURSAL, ESTADOS, motivoDe, type Pedido } from './catalogos';

function hoja(data: ArrayBuffer | Uint8Array | string, esTexto = false): unknown[][] {
  const wb = esTexto ? XLSX.read(data as string, { type: 'string', FS: ';', raw: true }) : XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
}

export interface LecturaPedidos { rows: Pedido[]; otras: number; sinFecha: number }

/** Reporte de transferencias de pedidos (Document.xlsx) ya convertido en matriz. */
export function filasAPedidos(A: unknown[][]): LecturaPedidos {
  let h = -1;
  for (let i = 0; i < Math.min(A.length, 30); i++) {
    const r = (A[i] || []).map(normUpper);
    if (r.includes('NUMERO PEDIDO') && r.includes('ESTADO TRANSFERENCIA')) { h = i; break; }
  }
  if (h < 0) throw new Error('No encontré las columnas "Número Pedido" y "Estado Transferencia". ¿Es el reporte de transferencias de pedidos?');
  const H = A[h].map(normUpper), c = (n: string) => H.indexOf(n);
  const ix = { num: c('NUMERO PEDIDO'), ori: c('ORIGEN'), fec: c('FECHA'), est: c('ESTADO TRANSFERENCIA'), sku: c('SKUS'), raz: c('RAZON PEDIDO'), act: c('ACTUALIZADO'), rec: c('RECIBIDO'), bod: c('BODEGA') };
  for (const k of ['num', 'ori', 'fec', 'est', 'sku'] as const) if (ix[k] < 0) throw new Error('Falta la columna ' + k.toUpperCase() + ' en el reporte.');
  const rows: Pedido[] = [];
  let otras = 0, sinFecha = 0;
  for (let i = h + 1; i < A.length; i++) {
    const r = A[i];
    if (!r || r[ix.num] == null || r[ix.num] === '') continue;
    const bod = ix.bod >= 0 ? BODEGAS[normUpper(r[ix.bod])] : 'N';
    if (!bod) { otras++; continue; }
    const f = aMinutos(r[ix.fec]);
    if (!f) { sinFecha++; continue; }
    const e = ESTADOS[normUpper(r[ix.est])] || 'O';
    rows.push([
      numOTexto(r[ix.num]), numOTexto(r[ix.ori]), f, e, Math.round(Number(r[ix.sku]) || 0),
      motivoDe(ix.raz >= 0 ? r[ix.raz] : ''), ix.act >= 0 ? aMinutos(r[ix.act]) : 0, ix.rec >= 0 ? aMinutos(r[ix.rec]) : 0, 0, bod,
    ]);
  }
  return { rows, otras, sinFecha };
}

export function leerExcelPedidos(data: ArrayBuffer | Uint8Array | string, esCsv = false): LecturaPedidos {
  return filasAPedidos(hoja(data, esCsv));
}

export interface LecturaAsignacion { M: Map<string, number>; sinSuc: number; maxDay: string | null }

/** Hora de asignación desde el Rpt_OrdenesPreparacion (Pedido + Sucursal + Fecha Creación).
 *  Devuelve null si la matriz no es ese reporte. */
export function filasAAsignacion(A: unknown[][]): LecturaAsignacion | null {
  let h = -1;
  for (let i = 0; i < Math.min(A.length, 30); i++) {
    const r = (A[i] || []).map(normUpper);
    if (r.includes('ORDEN DE PREPARACION') && r.includes('PEDIDO') && r.includes('FECHA CREACION')) { h = i; break; }
  }
  if (h < 0) return null;
  const H = A[h].map(normUpper), c = (n: string) => H.indexOf(n);
  const ix = { suc: c('SUCURSAL'), ped: c('PEDIDO'), fc: c('FECHA CREACION'), fa: c('FECHA ACTUALIZADO') };
  const M = new Map<string, number>();
  let sinSuc = 0, maxT = 0;
  for (let i = h + 1; i < A.length; i++) {
    const r = A[i];
    if (!r || r[ix.ped] == null || r[ix.ped] === '') continue;
    const code = CODIGO_SUCURSAL[normUpper(r[ix.suc])];
    if (code == null) { sinSuc++; continue; }
    const t = aMinutos(r[ix.fc]);
    if (!t) continue;
    maxT = Math.max(maxT, t, ix.fa >= 0 ? aMinutos(r[ix.fa]) : 0);
    const k = numOTexto(r[ix.ped]) + '-' + code;
    const o = M.get(k);
    if (!o || t < o) M.set(k, t);
  }
  return { M, sinSuc, maxDay: maxT ? diaDeMin(maxT) : null };
}

export function leerExcelAsignacion(data: ArrayBuffer | Uint8Array): LecturaAsignacion | null {
  return filasAAsignacion(hoja(data));
}
