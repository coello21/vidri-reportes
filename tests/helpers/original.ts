/** Carga las funciones del tablero original en un "navegador" aislado de Node, para comparar resultados. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as XLSX from 'xlsx';

const dir = fileURLToPath(new URL('../original/', import.meta.url));

function cargar(archivo: string): any {
  const code = readFileSync(dir + archivo, 'utf8');
  const ctx: Record<string, unknown> = { XLSX, console, Date, Math, JSON, Intl, Map, Set, Number, String, Object, Array, isFinite, isNaN };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: archivo });
  return vm.runInContext('__exp', ctx);
}

export const negadosOriginal = () => cargar('negados-original.js');
export const pedidosOriginal = () => cargar('pedidos-original.js');
