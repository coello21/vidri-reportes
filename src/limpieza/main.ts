/**
 * Página de limpieza del Rpt_OrdenesPreparacion. Todo pasa en el navegador: el archivo no se sube a ningún lado.
 * Crudo (Excel del ERP) → limpio (Excel con hoja "Datos" para el Radar y hoja "Calidad").
 */
import * as XLSX from 'xlsx';
import { limpiarRpt, type Calidad } from '../core/limpieza/rpt';
import { excelLimpio } from '../core/limpieza/excel';
import { fmtInt, fmtPct } from '../core/comun/texto';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const fch = (d: Date) => d.getDate() + ' ' + MES[d.getMonth()] + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const ymd = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const mb = (n: number) => (n / 1048576).toFixed(n < 1048576 ? 2 : 1).replace('.', ',') + ' MB';
const nombrePrep = (p: string) => p.replace(/^\s*\S+\s*-\s*/, '');

/** Filas de la hoja "Calidad" (y de la tabla en pantalla). */
function filasCalidad(Q: Calidad): [string, string | number, string?][] {
  const pct = (a: number, b: number) => (b ? fmtPct((a / b) * 100) : '—');
  const F: [string, string | number, string?][] = [
    ['Filas leídas', Q.leidas],
    ['Filas en el Excel limpio', Q.limpias],
    ['Quitadas: sin código (totales o en blanco)', Q.sinCodigo],
    ['Quitadas: repetidas idénticas', Q.repetidasIdenticas],
    ['Pedido + código que vienen más de una vez (el Radar decide)', Q.pedidoCodigoRepetido],
    ...Object.keys(Q.estados).sort().map((e) => ['Filas en estado ' + e, Q.estados[e]] as [string, number]),
    ['Líneas negadas (estado A, preparado en 0)', Q.negadas],
  ];
  if (Q.conColumnaMotivo) F.push(['Negadas sin motivo registrado', Q.negadasSinMotivo, pct(Q.negadasSinMotivo, Q.negadas)]);
  else F.push(['Columna «Motivo de negado»', 'no viene en el archivo']);
  F.push(['Estado A sin Fecha Actualizado', Q.aSinFechaAct], ['Cantidades que no son número', Q.cantidadNoNumerica], ['Fechas que no se pudieron leer', Q.fechaNoValida]);
  return F;
}
const AVISO = new Set(['Negadas sin motivo registrado', 'Estado A sin Fecha Actualizado', 'Cantidades que no son número', 'Fechas que no se pudieron leer']);

async function procesar(file: File) {
  const box = document.createElement('section');
  box.className = 'arch';
  box.innerHTML = '<h2>' + esc(file.name) + '</h2><div class="sub">Leyendo…</div>';
  $('out').prepend(box);
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    // sin cellDates: las fechas quedan como el número de Excel original, para escribirlas igual
    const wb = XLSX.read(buf, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    const { filas, calidad: Q } = limpiarRpt(rows);
    const FQ = filasCalidad(Q);
    const hojaQ: (string | number)[][] = [['Control de calidad', 'Cantidad', '%'], ...FQ.map((f) => [f[0], f[1], f[2] || ''])];
    if (Q.conColumnaMotivo && Object.keys(Q.motivos).length) hojaQ.push([], ['Negadas por motivo', 'Líneas', '%'], ...Object.keys(Q.motivos).sort((a, b) => Q.motivos[b] - Q.motivos[a]).map((k) => [k, Q.motivos[k], fmtPct((Q.motivos[k] / Q.negadas) * 100)]));
    if (Q.sinMotivoPorPreparador.length) hojaQ.push([], ['Preparador (negadas sin motivo)', 'Negadas', 'Sin motivo', '%'], ...Q.sinMotivoPorPreparador.map(([p, n, s]) => [nombrePrep(p), n, s, fmtPct((s / n) * 100)]));
    if (Object.keys(Q.motivosDesconocidos).length) hojaQ.push([], ['Motivos nuevos (no están en la lista del ERP)', 'Líneas'], ...Object.entries(Q.motivosDesconocidos));
    if (Object.keys(Q.porDia).length) hojaQ.push([], ['Líneas cerradas por día (Fecha Actualizado)', 'Líneas'], ...Object.keys(Q.porDia).sort().map((d) => [d, Q.porDia[d]]));
    const out = excelLimpio(filas, Q.conColumnaMotivo, hojaQ);
    const dias = Object.keys(Q.porDia).sort();
    const tag = dias.length ? (dias[0] === dias[dias.length - 1] ? dias[0] : dias[0] + '_a_' + dias[dias.length - 1]) : Q.creacion ? ymd(Q.creacion[0]) : 'sin_fecha';
    const nombre = 'Rpt_OrdenesPreparacion_limpio_' + tag + '.xlsx';
    const avisos = FQ.filter((f) => AVISO.has(f[0]) && typeof f[1] === 'number' && f[1] > 0).length + (Object.keys(Q.motivosDesconocidos).length ? 1 : 0);

    box.innerHTML = '<h2>' + esc(file.name) + '</h2>' +
      '<div class="sub">' + (Q.creacion ? 'Creación: ' + fch(Q.creacion[0]) + ' a ' + fch(Q.creacion[1]) : '') + (Q.actualizado ? ' · Actualizado: ' + fch(Q.actualizado[0]) + ' a ' + fch(Q.actualizado[1]) : '') +
      ' · ' + mb(file.size) + ' → ' + mb(out.byteLength) + '</div>' +
      '<div class="row"><button class="dl" type="button">Descargar limpio</button><span class="chip ' + (avisos ? 'w' : 'ok') + '">' + (avisos ? avisos + (avisos === 1 ? ' cosa' : ' cosas') + ' por revisar' : 'Sin problemas') + '</span>' +
      '<span class="chip ok">' + fmtInt(Q.limpias) + ' filas limpias de ' + fmtInt(Q.leidas) + '</span></div>' +
      '<div class="grid"><div><h3>Control de calidad</h3><table class="t"><tbody>' +
      FQ.map((f) => '<tr' + (AVISO.has(f[0]) && typeof f[1] === 'number' && f[1] > 0 ? ' class="w"' : '') + '><td>' + esc(f[0]) + '</td><td class="r">' + (typeof f[1] === 'number' ? fmtInt(f[1]) : esc(f[1])) + (f[2] ? ' · ' + esc(f[2]) : '') + '</td></tr>').join('') +
      '</tbody></table></div>' +
      (Q.sinMotivoPorPreparador.length ? '<div><h3>Negadas sin motivo por preparador</h3><table class="t"><thead><tr><th>Preparador</th><th class="r">Negadas</th><th class="r">Sin motivo</th><th class="r">%</th></tr></thead><tbody>' +
        Q.sinMotivoPorPreparador.slice(0, 12).map(([p, n, s]) => '<tr><td>' + esc(nombrePrep(p)) + '</td><td class="r">' + fmtInt(n) + '</td><td class="r">' + fmtInt(s) + '</td><td class="r">' + fmtPct((s / n) * 100) + '</td></tr>').join('') +
        '</tbody></table>' + (Q.sinMotivoPorPreparador.length > 12 ? '<p class="sub">y ' + (Q.sinMotivoPorPreparador.length - 12) + ' más en la hoja «Calidad»</p>' : '') + '</div>' : '') +
      (Object.keys(Q.motivosDesconocidos).length ? '<div><h3>Motivos nuevos</h3><table class="t"><tbody>' + Object.entries(Q.motivosDesconocidos).map(([m, c]) => '<tr class="w"><td>' + esc(m) + '</td><td class="r">' + fmtInt(c) + '</td></tr>').join('') + '</tbody></table></div>' : '') +
      '</div>';
    box.querySelector('button.dl')!.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([out as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
  } catch (e) {
    console.error(e);
    box.innerHTML = '<h2>' + esc(file.name) + '</h2><div class="sub err">No se pudo limpiar: ' + esc((e as Error)?.message || e) + '</div>';
  }
}

async function tomar(list: FileList | null) {
  for (const f of Array.from(list || [])) await procesar(f);
}
const drop = $('drop'), inp = $('files') as HTMLInputElement;
inp.addEventListener('change', () => { tomar(inp.files); inp.value = ''; });
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('on'); });
drop.addEventListener('dragleave', () => drop.classList.remove('on'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('on'); tomar(e.dataTransfer?.files || null); });
