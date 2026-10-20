import './estilos.css';
import { RadarNegados } from '../core/negados/radar';
import { PedidosCD } from '../core/pedidos/cd';
import { DIAS_LARGO, MESES_CORTO, diaDeMin } from '../core/comun/fechas';
import { CONFIG } from '../nube/config';
import { BaseSupabase } from '../nube/base';
import { Almacen } from '../nube/almacen';
import { crearCliente, iniciarSesion, cargando, quitarPantalla, esc } from './sesion';

const fmt = (v: number) => new Intl.NumberFormat('es-SV').format(Math.round(v || 0));
const pct = (a: number, b: number) => (b ? (a / b * 100).toFixed(1).replace('.', ',') + '%' : '–');
const fecha = (d: string | null) => d ? DIAS_LARGO[new Date(d + 'T00:00:00Z').getUTCDay()] + ' ' + (+d.slice(8)) + ' ' + MESES_CORTO[+d.slice(5, 7) - 1] : '–';
const hora = (min: number) => { const x = new Date(min * 60000); let h = x.getUTCHours(); const ap = h < 12 ? 'a. m.' : 'p. m.'; h = h % 12 || 12; return h + ':' + String(x.getUTCMinutes()).padStart(2, '0') + ' ' + ap; };

/** Estado de la aplicación: los mismos módulos que ya están probados contra el tablero original. */
export interface App { radar: RadarNegados; pedidos: PedidosCD; almacen: Almacen; usuario: string }

function tarjeta(l: string, v: string, s: string) {
  return '<div class="k"><div class="l">' + esc(l) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>';
}

function verificacion(app: App) {
  const { radar, pedidos } = app;
  const dias = radar.dias(), ult = dias[dias.length - 1] || null, vd = ult ? radar.vistaDia(ult) : null, m = vd?.meta || {};
  const lc = pedidos.ultimoCorte(), bal = pedidos.balance(), hoy = bal[bal.length - 1];
  const sinAsig = pedidos.pendientes(['R']).ok.length;
  document.getElementById('contenido')!.innerHTML =
    '<div class="eb">Versión nueva · en construcción</div>' +
    '<h1>Datos leídos de la base con los módulos en TypeScript</h1>' +
    '<p class="lead">Esta página todavía no tiene las pantallas del Radar: sirve para comprobar que la versión nueva lee lo mismo. ' +
    'Compara estos números con el <a href="../radar/">Radar actual</a>; si coinciden, el siguiente paso son las pantallas. ' +
    'Sigue cargando los Excel en el Radar actual.</p>' +
    '<div class="kpis">' +
    tarjeta('Días de negados cargados', fmt(dias.length), dias.length ? 'del ' + fecha(dias[0]) + ' al ' + fecha(ult) : 'sin datos') +
    tarjeta('Negados · ' + fecha(ult), vd ? pct(m.totalNegados, m.totalFinal) : '–', vd ? fmt(m.totalNegados) + ' de ' + fmt(m.totalFinal) + ' líneas' + (ult && radar.isPartialDay(ult) ? ' · día parcial' : '') : '') +
    tarjeta('Pedidos cargados', fmt(pedidos.rows.size), lc ? 'último corte: ' + fecha(diaDeMin(lc)) + ', ' + hora(lc) : 'sin cortes') +
    tarjeta('Sin terminar al corte', hoy ? fmt(hoy.fin) : '–', hoy ? 'empezó en ' + fmt(hoy.ini) + ' · +' + fmt(hoy.ent) + ' · −' + fmt(hoy.ter) + ' · ' + fmt(sinAsig) + ' sin asignar' : '') +
    '</div>';
}

async function arrancar() {
  const sb = crearCliente();
  await iniciarSesion(sb, async (s) => {
    const almacen = new Almacen(new BaseSupabase(sb));
    const todo = !!new URLSearchParams(location.search).get('todo');
    const datos = await almacen.leer({ diasRadar: CONFIG.DIAS_RADAR, diasPedidos: CONFIG.DIAS_PEDIDOS, todo }, (e, p) => cargando(e + '… ' + p + '%'));
    const app: App = { radar: new RadarNegados(datos.history, datos.store), pedidos: new PedidosCD(datos.pedidos), almacen, usuario: s.user?.email || '' };
    (window as unknown as { __APP: App }).__APP = app;
    document.getElementById('usuario')!.textContent = app.usuario;
    document.getElementById('salir')!.addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
    verificacion(app);
    quitarPantalla();
  });
}

arrancar();
