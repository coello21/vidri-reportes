/**
 * Limpieza del Rpt_OrdenesPreparacion (capa "limpia"): del Excel crudo del ERP a un Excel solo con lo que usa el Radar.
 *
 * Qué hace (limpieza, no reglas del negocio):
 * - Busca la fila de encabezados y se queda con las columnas que usa el Radar, con su nombre de siempre.
 * - Recorta espacios a los lados, pasa cantidades a número, Estado en mayúsculas y el motivo con su nombre exacto.
 *   Las fechas se dejan tal cual vienen (mismo valor de Excel, hasta los milisegundos): el Radar las usa para reconocer
 *   las líneas ya contadas, así que no se tocan. Los espacios de en medio tampoco (el nombre del preparador debe quedar igual).
 * - Quita filas sin código (totales, filas en blanco) y filas repetidas idénticas en todo.
 * - Cuenta lo que hay que revisar (control de calidad), sin cambiar los datos.
 *
 * Qué NO hace: no quita los Pedido + Código repetidos que no son idénticos (por ejemplo, misma línea con distinta
 * Razón de Pedido o reasignada a otro preparador). Esa regla la aplica el Radar al cargar, porque decide qué fila vale.
 */
import { normKey, toNum } from '../comun/texto';
import { toDate } from '../comun/fechas';
import { motClean } from '../negados/motivos';

/** Columnas de salida: [campo, encabezado tal como lo trae el ERP (así el Radar lo reconoce), claves aceptadas] */
export const COLUMNAS: [string, string, string[]][] = [
  ['Sucursal', 'Sucursal', ['sucursal']],
  ['Orden', 'Orden de Preparación', ['ordendepreparacion']],
  ['Pedido', 'Pedido', ['pedido']],
  ['SKU', 'SKU', ['sku']],
  ['Ubic1', 'Ubicación 1', ['ubicacion1']],
  ['Ubic2', 'Ubicación 2', ['ubicacion2']],
  ['Cantidad', 'Cantidad', ['cantidad']],
  ['CantPrep', 'Cantidad Preparada', ['cantidadpreparada']],
  ['UM', 'UM', ['um']],
  ['Disponible', 'Disponible', ['disponible']],
  ['Motivo', 'Motivo de negado', ['motivodenegado', 'motivonegado']],
  ['Razon', 'Razon de Pedido', ['razondepedido']],
  ['Desc', 'Descripción', ['descripcion']],
  ['Categoria', 'Categoría', ['categoria']],
  ['Estado', 'Estado', ['estado']],
  ['Preparador', 'Preparador', ['preparador']],
  ['Fecha', 'Fecha Creación', ['fechacreacion']],
  ['FechaRevision', 'Fecha Enviado Revisión', ['fechaenviadorevision']],
  ['FechaAct', 'Fecha Actualizado', ['fechaactualizado']],
];
const OBLIGATORIAS = ['Sucursal', 'Orden', 'Pedido', 'SKU', 'Cantidad', 'CantPrep', 'Disponible', 'Desc', 'Estado', 'Fecha', 'FechaAct'];
const NUMEROS = new Set(['Cantidad', 'CantPrep', 'Disponible']);
const FECHAS = new Set(['Fecha', 'FechaRevision', 'FechaAct']);

/** Motivos que trae el ERP (para escribirlos siempre igual y avisar si aparece uno nuevo). */
export const MOTIVOS_ERP = ['Existencia a cero', 'Físico no se encuentra', 'Pasillo bloqueado', 'Producto incompleto o averiado', 'Sin existencia ubicación picking'];
const MOT_POR_CLAVE = new Map(MOTIVOS_ERP.map((m) => [normKey(m), m]));

export type Fila = Record<string, string | number | Date | null>;

export interface Calidad {
  leidas: number;
  limpias: number;
  sinCodigo: number;
  repetidasIdenticas: number;
  /** Pedido + Código que vienen más de una vez con algo distinto (el Radar decide cuál vale) */
  pedidoCodigoRepetido: number;
  estados: Record<string, number>;
  /** negadas = estado A y cantidad preparada 0 o menos */
  negadas: number;
  negadasSinMotivo: number;
  sinMotivoPorPreparador: [string, number, number][];
  motivos: Record<string, number>;
  motivosDesconocidos: Record<string, number>;
  /** estado A sin Fecha Actualizado (el Radar no puede ubicarlas en un día) */
  aSinFechaAct: number;
  cantidadNoNumerica: number;
  fechaNoValida: number;
  conColumnaMotivo: boolean;
  creacion: [Date, Date] | null;
  actualizado: [Date, Date] | null;
  /** líneas cerradas (A) por día de Fecha Actualizado */
  porDia: Record<string, number>;
  columnasIgnoradas: string[];
}

const ymd = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const texto = (v: unknown) => (v == null ? '' : String(v).trim());

/** Limpia la hoja (matriz de celdas). Lanza error si no encuentra encabezados o faltan columnas obligatorias. */
export function limpiarRpt(rows: unknown[][]): { filas: Fila[]; calidad: Calidad } {
  let h = -1;
  const col: Record<string, number> = {};
  const ignoradas: string[] = [];
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const keys = (rows[i] || []).map((c) => (c == null ? '' : normKey(c)));
    if (!(keys.includes('sku') && keys.includes('sucursal'))) continue;
    h = i;
    keys.forEach((k, ci) => {
      const c = COLUMNAS.find((x) => x[2].includes(k));
      if (c && !(c[0] in col)) col[c[0]] = ci;
      else if (k && !c) ignoradas.push(String(rows[i][ci]).trim());
    });
    break;
  }
  if (h < 0) throw new Error('No se encontró la fila de encabezados (se busca "Sucursal" y "SKU"). ¿Es el Rpt_OrdenesPreparacion?');
  const faltan = OBLIGATORIAS.filter((k) => !(k in col)).map((k) => COLUMNAS.find((c) => c[0] === k)![1]);
  if (faltan.length) throw new Error('Faltan columnas: ' + faltan.join(', '));

  const Q: Calidad = {
    leidas: 0, limpias: 0, sinCodigo: 0, repetidasIdenticas: 0, pedidoCodigoRepetido: 0, estados: {}, negadas: 0, negadasSinMotivo: 0,
    sinMotivoPorPreparador: [], motivos: {}, motivosDesconocidos: {}, aSinFechaAct: 0, cantidadNoNumerica: 0, fechaNoValida: 0,
    conColumnaMotivo: 'Motivo' in col, creacion: null, actualizado: null, porDia: {}, columnasIgnoradas: ignoradas,
  };
  const filas: Fila[] = [], vistas = new Set<string>(), pedCod = new Map<string, number>(), prepNeg = new Map<string, [number, number]>();
  const rango = (r: [Date, Date] | null, d: Date): [Date, Date] => (!r ? [d, d] : [d < r[0] ? d : r[0], d > r[1] ? d : r[1]]);

  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => c == null || String(c).trim() === '')) continue;
    Q.leidas++;
    const f: Fila = {};
    for (const [k] of COLUMNAS) {
      if (!(k in col)) continue;
      const v = r[col[k]];
      if (NUMEROS.has(k)) {
        const n = toNum(v);
        if (n == null && v != null && String(v).trim() !== '') Q.cantidadNoNumerica++;
        f[k] = n;
      } else if (FECHAS.has(k)) {
        const vacia = v == null || String(v).trim() === '';
        if (!vacia && !toDate(v)) Q.fechaNoValida++;
        f[k] = vacia ? null : (v as number | string | Date);
      } else f[k] = texto(v);
    }
    if (!f.SKU) { Q.sinCodigo++; continue; }
    f.Estado = String(f.Estado).toUpperCase();
    if ('Motivo' in f) {
      const m = motClean(f.Motivo), conocido = MOT_POR_CLAVE.get(normKey(m));
      if (m && !conocido) Q.motivosDesconocidos[m] = (Q.motivosDesconocidos[m] || 0) + 1;
      f.Motivo = conocido || m;
    }
    const firma = COLUMNAS.map(([k]) => { const v = f[k]; return v instanceof Date ? v.getTime() : v == null ? '' : String(v); }).join('\u0001');
    if (vistas.has(firma)) { Q.repetidasIdenticas++; continue; }
    vistas.add(firma);
    filas.push(f);

    const pc = f.Pedido + '|' + f.SKU;
    pedCod.set(pc, (pedCod.get(pc) || 0) + 1);
    const est = String(f.Estado) || '(vacío)';
    Q.estados[est] = (Q.estados[est] || 0) + 1;
    const fc = toDate(f.Fecha), fa = toDate(f.FechaAct);
    if (fc) Q.creacion = rango(Q.creacion, fc);
    if (fa) Q.actualizado = rango(Q.actualizado, fa);
    if (f.Estado === 'A') {
      if (!fa) Q.aSinFechaAct++;
      else { const d = ymd(fa); Q.porDia[d] = (Q.porDia[d] || 0) + 1; }
      if (typeof f.CantPrep === 'number' && f.CantPrep <= 0) {
        Q.negadas++;
        const p = String(f.Preparador || '(Sin preparador)'), a = prepNeg.get(p) || [0, 0];
        a[0]++;
        if (Q.conColumnaMotivo) {
          const m = String(f.Motivo || '');
          Q.motivos[m || 'Sin motivo'] = (Q.motivos[m || 'Sin motivo'] || 0) + 1;
          if (!m) { Q.negadasSinMotivo++; a[1]++; }
        }
        prepNeg.set(p, a);
      }
    }
  }
  pedCod.forEach((n) => { if (n > 1) Q.pedidoCodigoRepetido++; });
  Q.limpias = filas.length;
  Q.sinMotivoPorPreparador = [...prepNeg].filter(([, a]) => a[1] > 0).map(([p, a]) => [p, a[0], a[1]] as [string, number, number]).sort((x, y) => y[2] - x[2] || y[1] - x[1]);
  return { filas, calidad: Q };
}

/** Matriz para escribir el Excel limpio: encabezados del ERP y las filas (las fechas quedan como fecha). */
export function filasAMatriz(filas: Fila[], conMotivo: boolean): (string | number | Date | null)[][] {
  const cols = COLUMNAS.filter(([k]) => k !== 'Motivo' || conMotivo);
  return [cols.map((c) => c[1]), ...filas.map((f) => cols.map(([k]) => (f[k] === undefined ? null : f[k])))];
}
