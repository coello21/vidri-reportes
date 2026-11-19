/** Carga las funciones del tablero original en un "navegador" aislado de Node, para comparar resultados. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as XLSX from 'xlsx';

const dir = fileURLToPath(new URL('../original/', import.meta.url));

function cargar(archivo: string, ajustar: (c: string) => string = (c) => c): any {
  const code = ajustar(readFileSync(dir + archivo, 'utf8'));
  const ctx: Record<string, unknown> = { XLSX, console, Date, Math, JSON, Intl, Map, Set, Number, String, Object, Array, isFinite, isNaN };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: archivo });
  return vm.runInContext('__exp', ctx);
}

/** Reglas vigentes desde el 19-nov-2026 aplicadas al código original, para seguir comparando lo demás:
 *  sin el paso 2 de duplicados (Orden + SKU) y sin las ubicaciones que no son de Nejapa. */
const reglasNejapa = (c: string) => {
  const a = c.replace("  const drop = new Set();\n  for(const g of groups.values()){", "  const drop = new Set();\n  for(const g of (false ? groups.values() : [])){");
  const b = a.replace("    const rec = {};\n    for(const k in headerMap){ rec[k] = r[headerMap[k]]; }",
    "    const rec = {};\n    for(const k in headerMap){ rec[k] = r[headerMap[k]]; }\n    { const u = rec.Ubic1 == null ? '' : String(rec.Ubic1).trim().toUpperCase(); if (u.startsWith('HC') || u.startsWith('PV') || u.startsWith('CL') || ['ROTOTEC CONSTRU','TRANSITO-BAZINNI','TRANSITO-MATCO','TRASLADO MOBU-NNEO'].includes(u)) continue; }");
  if (a === c || b === a) throw new Error('No se pudo ajustar el código original a las reglas de Nejapa');
  return b;
};
export const negadosOriginal = () => cargar('negados-original.js', reglasNejapa);
export const pedidosOriginal = () => cargar('pedidos-original.js');
