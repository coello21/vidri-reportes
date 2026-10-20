/** Generador de reportes falsos (pero con todos los casos raros) para probar los cálculos. */
import * as XLSX from 'xlsx';

/** Generador pseudoaleatorio con semilla: mismas pruebas cada vez. */
export function azar(semilla: number) {
  let s = semilla >>> 0;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  return {
    r,
    int: (a: number, b: number) => a + Math.floor(r() * (b - a + 1)),
    pick: <T>(arr: T[]): T => arr[Math.floor(r() * arr.length)],
    chance: (p: number) => r() < p,
  };
}

const SUCS = ['SOYAPANGO II', 'LOURDES', 'SAN MIGUEL II', 'CONSTITUCION', 'EJERCITO', 'MERLIOT', 'CENTRO'];
const PREPS = ['0000101 - PREPARADOR UNO', '0000102 - PREPARADOR DOS', '0000103 - PREPARADOR TRES', '0000104 - PREPARADOR CUATRO', '(sin)'];

/** Filas del Rpt_OrdenesPreparacion entre dos días (inclusive). */
export function rptOrdenes(semilla: number, desde: Date, dias: number, n: number): unknown[][] {
  const z = azar(semilla);
  const head = ['Sucursal', 'Orden de Preparación', 'Pedido', 'SKU', 'Ubicación 1', 'Cantidad', 'Cantidad Preparada', 'UM', 'Disponible', 'Razón de Pedido', 'Descripción', 'Categoría', 'Estado', 'Preparador', 'Fecha Creación', 'Fecha Enviado Revisión', 'Fecha Actualizado'];
  const rows: unknown[][] = [['Reporte de órdenes de preparación'], [], head];
  const pedidos: { ped: number; suc: string; orden: number; corp: boolean; cre: Date }[] = [];
  for (let i = 0; i < Math.max(5, Math.floor(n / 6)); i++) {
    const cre = new Date(desde.getTime() + z.int(0, dias * 24 * 60 - 1) * 60000);
    pedidos.push({ ped: 500000 + z.int(0, 99999), suc: z.pick(SUCS), orden: 900000 + i, corp: z.chance(0.15), cre });
  }
  for (let i = 0; i < n; i++) {
    const p = z.pick(pedidos);
    const sku = String(z.int(100, 160));
    const cant = z.int(1, 12);
    const est = z.pick(['A', 'A', 'A', 'A', 'P', 'R', 'X']);
    const prep = est === 'A' ? (z.chance(0.25) ? 0 : z.chance(0.7) ? cant : z.int(1, cant + 3)) : 0;
    const disp = z.pick([-3, 0, 0, 5, 20, 100]);
    const fin = new Date(p.cre.getTime() + z.int(10, 60 * 30) * 60000);
    const row = [
      p.suc, z.chance(0.1) ? p.orden + 1 : p.orden, z.chance(0.03) ? '' : p.ped, sku, 'A-01', z.chance(0.02) ? null : cant,
      prep, 'Uni', z.chance(0.02) ? null : disp, p.corp ? 'VENTA CORPORATIVA-VENTA' : 'EXISTENCIA', 'Producto ' + sku, z.pick(['FERRETERIA', 'PINTURA', null]),
      est, z.pick(PREPS), z.chance(0.01) ? null : p.cre,
      est === 'A' ? fin : null, est === 'A' && z.chance(0.92) ? fin : null,
    ];
    rows.push(row);
    if (z.chance(0.08)) rows.push(row.slice()); // duplicado exacto
  }
  return rows;
}

/** Filas del reporte de transferencias (Document.xlsx). */
export function documentoPedidos(semilla: number, desdeMin: number, dias: number, n: number, corteMin: number): unknown[][] {
  const z = azar(semilla);
  const head = ['Número Pedido', 'Origen', 'Fecha', 'Estado Transferencia', 'SKUs', 'Razón Pedido', 'Actualizado', 'Recibido', 'Bodega'];
  const rows: unknown[][] = [head];
  const serial = (min: number) => min / 1440 + 25569;
  for (let i = 0; i < n; i++) {
    const f = desdeMin + z.int(0, dias * 1440 - 1);
    const est = z.pick(['ACTUALIZADO', 'ACTUALIZADO', 'RECIBIDO', 'PROCESANDO', 'ENVIAR', 'OTRO']);
    const act = est === 'ACTUALIZADO' ? Math.min(corteMin, f + z.int(30, 3000)) : 0;
    rows.push([
      300000 + z.int(0, 4000), z.pick([64, 67, 52, 15, 73, 100, 70]), serial(f), est, z.int(1, 30),
      z.pick(['EXISTENCIA', 'VENTA CORPORATIVA-VENTA', 'ROTACION', 'TIENDA-VENTA', '']),
      act ? serial(act) : serial(0), serial(f + z.int(1, 20)), z.pick(['NEJAPA', 'NEJAPA', 'NEJAPA', 'BAZINNI', 'MOP']),
    ]);
  }
  return rows;
}

/** Matriz -> archivo .xlsx (bytes), como lo baja el ERP. */
export function aXlsx(rows: unknown[][]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
