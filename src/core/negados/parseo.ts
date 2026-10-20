import * as XLSX from 'xlsx';
import { normKey, toNum, cleanText } from '../comun/texto';
import { toDate } from '../comun/fechas';
import type { Registro } from './tipos';

/** Encabezado normalizado del Excel -> campo interno */
const FIELD_MAP: Record<string, string> = {
  sucursal: 'Sucursal', ordendepreparacion: 'Orden', pedido: 'Pedido', sku: 'SKU',
  ubicacion1: 'Ubic1', ubicacion2: 'Ubic2', cantidad: 'Cantidad', cantidadpreparada: 'CantPrep',
  um: 'UM', disponible: 'Disponible', razondepedido: 'Razon', descripcion: 'Desc',
  categoria: 'Categoria', estado: 'Estado', preparador: 'Preparador', revisador: 'Revisador',
  fechacreacion: 'Fecha', fechaenviadorevision: 'FechaRevision', fechaactualizado: 'FechaAct',
};

const NEED_LABEL: Record<string, string> = {
  SKU: 'SKU', Pedido: 'Pedido', Orden: 'Orden de Preparación', CantPrep: 'Cantidad Preparada', Cantidad: 'Cantidad',
  Disponible: 'Disponible', Desc: 'Descripción', Sucursal: 'Sucursal', Estado: 'Estado', Fecha: 'Fecha Creación', FechaAct: 'Fecha Actualizado',
};

/** Convierte las filas de la hoja (matriz) en registros. Lanza error si faltan columnas. */
export function filasARegistros(rows: unknown[][]): Registro[] {
  let headerIdx = -1;
  let headerMap: Record<string, number> = {};
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = rows[i];
    if (!r) continue;
    const keys = r.map((c) => (c == null ? '' : normKey(c)));
    if (keys.includes('sku') && keys.includes('sucursal')) {
      headerIdx = i;
      headerMap = {};
      r.forEach((cell, ci) => {
        const nk = cell == null ? '' : normKey(cell);
        if (FIELD_MAP[nk] && !(FIELD_MAP[nk] in headerMap)) headerMap[FIELD_MAP[nk]] = ci;
      });
      break;
    }
  }
  if (headerIdx === -1) throw new Error('No se encontró la fila de encabezados (se busca "Sucursal" y "SKU").');
  for (const k of Object.keys(NEED_LABEL)) {
    if (!(k in headerMap)) throw new Error('Falta la columna requerida: ' + NEED_LABEL[k]);
  }

  const out: Registro[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const sku = r[headerMap.SKU];
    if (sku == null || String(sku).trim() === '') continue;
    const raw: Record<string, unknown> = {};
    for (const k in headerMap) raw[k] = r[headerMap[k]];
    const rec: Registro = {
      ...raw,
      SKU: String(raw.SKU).trim(),
      Pedido: cleanText(raw.Pedido, ''),
      Orden: cleanText(raw.Orden, ''),
      Cantidad: toNum(raw.Cantidad),
      CantPrep: toNum(raw.CantPrep),
      Disponible: toNum(raw.Disponible),
      Sucursal: cleanText(raw.Sucursal, '(Sin sucursal)'),
      Estado: cleanText(raw.Estado, '').toUpperCase(),
      Desc: cleanText(raw.Desc, ''),
      Categoria: cleanText(raw.Categoria, '(Sin categoría)'),
      Preparador: cleanText(raw.Preparador, '(Sin preparador)'),
      Fecha: toDate(raw.Fecha),
      FechaAct: toDate(raw.FechaAct),
      FechaRevision: toDate(raw.FechaRevision),
    };
    out.push(rec);
  }
  return out;
}

/** Lee el Excel Rpt_OrdenesPreparacion (primera hoja). */
export function leerExcelNegados(data: ArrayBuffer | Uint8Array): Registro[] {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  return filasARegistros(rows);
}
