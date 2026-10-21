import './radar.css';
import './estilos.css';
import { RadarNegados } from '../core/negados/radar';
import { PedidosCD } from '../core/pedidos/cd';
import { CONFIG } from '../nube/config';
import { BaseSupabase } from '../nube/base';
import { Almacen } from '../nube/almacen';
import { crearCliente, iniciarSesion, cargando, quitarPantalla } from './sesion';
import { Resumen } from './resumen';
import { TopNegados } from './top';
import { PedidosVista } from './pedidos';
import { $ } from './ui/formato';

/** Estado de la aplicación: los mismos módulos que ya están probados contra el tablero original. */
export interface App { radar: RadarNegados; pedidos: PedidosCD; almacen: Almacen; usuario: string; resumen: Resumen; top: TopNegados; ped: PedidosVista }

const PESTANAS = ['resumen', 'top', 'pedidos'] as const;
type Pestana = typeof PESTANAS[number];

function ponerPestana(app: App, t: string) {
  const p: Pestana = (PESTANAS as readonly string[]).includes(t) ? t as Pestana : 'resumen';
  document.querySelectorAll<HTMLElement>('#vxNav a').forEach((a) => a.classList.toggle('on', a.dataset.tab === p));
  PESTANAS.forEach((x) => { $('tab-' + x).hidden = x !== p; });
  const radar = p !== 'pedidos';
  document.querySelectorAll<HTMLElement>('[data-show="radar"]').forEach((e) => { e.hidden = !radar; });
  document.querySelectorAll<HTMLElement>('[data-show="pedidos"]').forEach((e) => { e.hidden = radar; });
  try { if (location.hash !== '#' + p) history.replaceState(null, '', '#' + p); } catch { /* sin historial */ }
  if (p === 'resumen' && app.resumen.vm) app.resumen.renderMotivo(app.resumen.vm);
  if (p === 'pedidos') app.ped.render();
}

/** Las pestañas comparten el día o rango elegido. */
function conectarPestanas(app: App) {
  app.resumen.alCambiar = (vm) => app.top.render(vm);
  $('pedXlsBtn').addEventListener('click', () => app.ped.excel());
}

/** Solo en desarrollo (npm run dev, ?prueba=1): abre la página con los datos locales de prueba, sin iniciar sesión. */
async function arrancarPrueba(): Promise<boolean> {
  if (!import.meta.env.DEV || !new URLSearchParams(location.search).get('prueba')) return false;
  const r = await fetch(import.meta.env.BASE_URL + 'tests/fixtures/radar-2026-10-19.local.json.gz');
  const buf = new Uint8Array(await r.arrayBuffer()); // el servidor de desarrollo a veces ya lo entrega descomprimido
  const txt = buf[0] === 0x1f && buf[1] === 0x8b ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(buf);
  const E = JSON.parse(txt);
  const radar = new RadarNegados(E.history, E.store);
  const app = { radar, pedidos: new PedidosCD(E.pedidos), almacen: null as unknown as Almacen, usuario: 'prueba', resumen: new Resumen(radar), top: new TopNegados(radar), ped: null as unknown as PedidosVista };
  app.ped = new PedidosVista(app.pedidos);
  (window as unknown as { __APP: App }).__APP = app;
  document.querySelectorAll<HTMLAnchorElement>('#vxNav a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); ponerPestana(app, a.dataset.tab || ''); }));
  quitarPantalla();
  ponerPestana(app, (location.hash || '').slice(1));
  conectarPestanas(app);
  app.resumen.iniciar();
  return true;
}

async function arrancar() {
  if (await arrancarPrueba()) return;
  const sb = crearCliente();
  await iniciarSesion(sb, async (s) => {
    const almacen = new Almacen(new BaseSupabase(sb));
    const todo = !!new URLSearchParams(location.search).get('todo');
    const datos = await almacen.leer({ diasRadar: CONFIG.DIAS_RADAR, diasPedidos: CONFIG.DIAS_PEDIDOS, todo }, (e, p) => cargando(e + '… ' + p + '%'));
    cargando('Armando el tablero…');
    const radar = new RadarNegados(datos.history, datos.store);
    const app: App = { radar, pedidos: new PedidosCD(datos.pedidos), almacen, usuario: s.user?.email || '', resumen: new Resumen(radar), top: new TopNegados(radar), ped: null as unknown as PedidosVista };
    app.ped = new PedidosVista(app.pedidos);
  (window as unknown as { __APP: App }).__APP = app;

    $('usuario').textContent = app.usuario;
    $('salir').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
    document.querySelectorAll<HTMLAnchorElement>('#vxNav a').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault(); ponerPestana(app, a.dataset.tab || ''); window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
    quitarPantalla();
    ponerPestana(app, (location.hash || '').slice(1));
    conectarPestanas(app);
    app.resumen.iniciar();
  });
}

arrancar();
