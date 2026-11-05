/** Escribe el Excel limpio: hoja "Datos" (la que lee el Radar) y hoja "Calidad". */
import * as XLSX from 'xlsx';
import { unzipSync, zipSync } from 'fflate';
import { filasAMatriz, type Fila } from './rpt';

export function excelLimpio(filas: Fila[], conMotivo: boolean, calidad: (string | number)[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  // fechas como número de Excel con formato de fecha (más liviano y como las trae el ERP)
  const M = filasAMatriz(filas, conMotivo);
  const ws = XLSX.utils.aoa_to_sheet(M, { dateNF: 'yyyy-mm-dd hh:mm:ss' });
  // las fechas van con el mismo número de Excel que traía el ERP; solo se les pone formato de fecha
  const colF = M[0].map((h, i) => (/^Fecha /.test(String(h)) ? i : -1)).filter((i) => i >= 0);
  for (let r = 1; r < M.length; r++) for (const c of colF) { const cel = ws[XLSX.utils.encode_cell({ r, c })]; if (cel && cel.t === 'n') cel.z = 'yyyy-mm-dd hh:mm:ss'; }
  ws['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 9 }, { wch: 10 }, { wch: 6 }, { wch: 10 },
    ...(conMotivo ? [{ wch: 30 }] : []), { wch: 22 }, { wch: 45 }, { wch: 10 }, { wch: 7 }, { wch: 30 }, { wch: 19 }, { wch: 19 }, { wch: 19 }];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: (conMotivo ? 19 : 18) - 1 } }) };
  XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  const q = XLSX.utils.aoa_to_sheet(calidad);
  q['!cols'] = [{ wch: 48 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, q, 'Calidad');
  // SheetJS comprime poco: se escribe sin comprimir y se vuelve a comprimir con fflate (queda más liviano que el del ERP)
  const crudo = XLSX.write(wb, { type: 'array', bookType: 'xlsx', bookSST: true }) as ArrayBuffer;
  return zipSync(unzipSync(new Uint8Array(crudo)), { level: 6 });
}
