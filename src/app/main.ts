import './radar.css';
import './estilos.css';
import { RadarNegados } from '../core/negados/radar';
import { PedidosCD } from '../core/pedidos/cd';
import type { Almacen } from '../nube/almacen';
import { Resumen } from './resumen';
import { TopNegados } from './top';
import { PedidosVista } from './pedidos';
import { $ } from './ui/formato';
import { cargarNegados, cargarPedidos, type Contexto } from './carga';
import { aviso } from './ui/avisos';
import { clavePedido, esViejo } from '../core/pedidos/catalogos';
import { descargarHtml, plantillaEnLinea, plantillaPropia, guardarPropia, leerB64, textoCopia, type DatosCopia } from './compartir';

/** true en el HTML que se comparte (se arma con `vite build --mode copia`): sin base de datos ni inicio de sesión. */
const COPIA = import.meta.env.MODE === 'copia';

/** Estado de la aplicación: los mismos módulos que ya están probados contra el tablero original. */
export interface App {
  radar: RadarNegados; pedidos: PedidosCD; almacen: Almacen | null; usuario: string; resumen: Resumen; top: TopNegados; ped: PedidosVista;
  /** Se cumple cuando ya se leyeron también los días anteriores (true) o si falló (false). */
  listo: Promise<boolean>;
  /** Vuelve a dibujar las pantallas sin cambiar el día elegido. */
  redibujar: () => void;
}

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
  // Cargar Excel
  const ctx: Contexto = {
    radar: app.radar, pedidos: app.pedidos, almacen: app.almacen, listo: () => app.listo,
    redibujar: (dia) => {
      const r = app.resumen;
      if (dia) r.elegir(dia, dia); else if (r.desde && r.hasta) r.elegir(r.desde, r.hasta); else r.iniciar();
      app.ped.render();
    },
  };
  const archivo = (btn: string, inp: string, fn: (c: Contexto, f: File[]) => Promise<void>) => {
    const i = $(inp) as HTMLInputElement;
    $(btn).addEventListener('click', () => i.click());
    i.addEventListener('change', () => { const fs = Array.from(i.files || []); i.value = ''; if (fs.length) fn(ctx, fs); });
  };
  archivo('selectBtn', 'fileInput', cargarNegados);
  archivo('pedSelectBtn', 'pedFile', cargarPedidos);
}

/** Arma la aplicación con los datos ya leídos y la muestra. */
function montar(E: { history?: DatosCopia['history']; store?: ConstructorParameters<typeof RadarNegados>[1]; pedidos?: unknown }, almacen: Almacen | null, usuario: string): App {
  const radar = new RadarNegados(E.history || {}, E.store || null);
  const pedidos = new PedidosCD(E.pedidos as ConstructorParameters<typeof PedidosCD>[0]);
  const app: App = {
    radar, pedidos, almacen, usuario, resumen: new Resumen(radar), top: new TopNegados(radar), ped: new PedidosVista(pedidos), listo: Promise.resolve(true),
    redibujar: () => { const r = app.resumen; if (r.desde && r.hasta) r.elegir(r.desde, r.hasta); else r.iniciar(); app.ped.render(); },
  };
  (window as unknown as { __APP: App }).__APP = app;
  document.querySelectorAll<HTMLAnchorElement>('#vxNav a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault(); ponerPestana(app, a.dataset.tab || ''); window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  document.getElementById('acceso')?.remove();
  ponerPestana(app, (location.hash || '').slice(1));
  conectarPestanas(app);
  app.resumen.iniciar();
  // Descargar HTML (en la página y en la copia)
  const plantilla = COPIA ? plantillaPropia : plantillaEnLinea;
  document.querySelectorAll<HTMLButtonElement>('#shareBtn, #pedShareBtn').forEach((b) => b.addEventListener('click', async () => {
    if (!(await esperarTodo(app))) return;
    descargarHtml(b, app.radar, app.pedidos, plantilla);
  }));
  // Reporte ejecutivo (solo en la página)
  const R = (window as unknown as { VidriReporte?: { usarFuente: (f: () => unknown, a: (t: string) => void) => void; ponerBotones: () => void } }).VidriReporte;
  if (R && !COPIA) {
    // el reporte espera a que estén los días anteriores (compara contra la semana pasada y el promedio)
    (window as unknown as { pedEnsure: () => Promise<void> }).pedEnsure = async () => { if (!(await app.listo)) throw new Error('faltan los días anteriores; recarga la página'); };
    R.usarFuente(() => ({ rows: app.pedidos.rows, lc: app.pedidos.ultimoCorte(), H: app.radar.history, S: app.radar.store }), (t) => aviso('err', t, 15000));
    R.ponerBotones();
  }
  return app;
}

/** Espera a que se lean los días anteriores (avisa mientras tanto). Devuelve false si no se pudieron leer. */
export async function esperarTodo(app: App): Promise<boolean> {
  let listo = false;
  void app.listo.then(() => { listo = true; });
  await Promise.resolve();
  if (!listo) aviso('ok', 'Terminando de cargar los días anteriores…', 120000);
  const ok = await app.listo;
  if (!ok) aviso('err', 'No se pudieron cargar los días anteriores. Recarga la página.', 30000);
  return ok;
}

/** Abre rápido y después lee en segundo plano los días anteriores; al terminar vuelve a dibujar. */
function completarDespues(app: App) {
  const A = app.almacen;
  if (!A || !A.incompleto) return;
  const barra = document.getElementById('modo');
  const txt = barra ? barra.innerHTML : '';
  if (barra) barra.innerHTML = txt + ' · <span id="cargandoMas">cargando días anteriores…</span>';
  app.listo = A.completar().then((r) => {
    Object.assign(app.radar.history, r.history);
    r.rows.forEach((x) => { if (!esViejo(x)) app.pedidos.rows.set(clavePedido(x), x); });
    app.redibujar();
    return true;
  }).catch((e) => {
    console.error(e);
    aviso('err', 'No se pudieron cargar los días anteriores: ' + ((e as Error)?.message || 'error') + '. Recarga la página antes de cargar un Excel.', 30000);
    return false;
  }).finally(() => { document.getElementById('cargandoMas')?.remove(); if (barra) barra.innerHTML = txt; });
}

/** HTML que se comparte: los datos vienen adentro del archivo. */
async function arrancarCopia() {
  guardarPropia(); // antes de dibujar: es la plantilla para volver a descargar
  const el = document.getElementById('emb'), b64 = el ? (el.textContent || '').trim() : '';
  if (!b64) { document.body.insertAdjacentHTML('beforeend', '<div id="acceso"><div class="caja"><h1>Sin datos</h1><p>Este archivo no trae datos. Descárgalo otra vez desde la página.</p></div></div>'); return; }
  const E = await leerB64(b64);
  const dias = Object.keys(E.history || {}).sort();
  const modo = document.getElementById('modo');
  if (modo && dias.length) modo.textContent = textoCopia(dias[0], dias[dias.length - 1]);
  montar(E, null, '');
}

/** Solo en desarrollo (npm run dev, ?prueba=1): abre la página con los datos locales de prueba, sin iniciar sesión. */
async function arrancarPrueba(): Promise<boolean> {
  if (!import.meta.env.DEV || !new URLSearchParams(location.search).get('prueba')) return false;
  const r = await fetch(import.meta.env.BASE_URL + 'tests/fixtures/radar-2026-10-19.local.json.gz');
  const buf = new Uint8Array(await r.arrayBuffer()); // el servidor de desarrollo a veces ya lo entrega descomprimido
  const txt = buf[0] === 0x1f && buf[1] === 0x8b ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(buf);
  const E = JSON.parse(txt);
  if (!new URLSearchParams(location.search).get('lento')) { montar(E, null, 'prueba'); return true; }
  // ?lento=1: igual que en la página, abre con 8 días y lee el resto 4 segundos después (para probar la apertura rápida)
  const ds = Object.keys(E.history).sort(), corte = ds[ds.length - 8], resto: Record<string, unknown> = {};
  ds.filter((d) => d < corte).forEach((d) => { resto[d] = E.history[d]; delete E.history[d]; });
  const falso = {
    incompleto: true,
    completar: async () => { await new Promise((r) => setTimeout(r, 4000)); falso.incompleto = false; return { history: resto, rows: [] }; },
    guardar: async () => ({ dias: 0, diasQuitados: 0, pedidos: 0, catalogo: false, cortes: false }),
  };
  const app = montar(E, falso as unknown as Almacen, 'prueba');
  completarDespues(app);
  return true;
}

async function arrancar() {
  if (COPIA) { await arrancarCopia(); return; }
  if (await arrancarPrueba()) return;
  // solo en la página: inicio de sesión y base de datos (no van dentro de la copia)
  const [{ crearCliente, iniciarSesion, cargando }, { CONFIG }, { BaseSupabase }, { Almacen }] =
    await Promise.all([import('./sesion'), import('../nube/config'), import('../nube/base'), import('../nube/almacen')]);
  const sb = crearCliente();
  await iniciarSesion(sb, async (s) => {
    const almacen = new Almacen(new BaseSupabase(sb));
    const todo = !!new URLSearchParams(location.search).get('todo');
    // Abre con la última semana (8 días: hoy y el mismo día de la semana pasada) y los pedidos de la pestaña;
    // el resto se lee en segundo plano.
    const datos = await almacen.leer({ diasRadar: CONFIG.DIAS_RADAR, diasPedidos: CONFIG.DIAS_PEDIDOS, todo, rapido: { dias: 8, pedidos: 16 } }, (e, p) => cargando(e + '… ' + p + '%'));
    cargando('Armando el tablero…');
    const app = montar(datos, almacen, s.user?.email || '');
    $('usuario').textContent = app.usuario; $('nbUser').textContent = app.usuario;
    $('salir').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
    if (todo) $('todoBtn').hidden = true;
    else $('todoBtn').addEventListener('click', () => { const u = new URL(location.href); u.searchParams.set('todo', '1'); location.href = u.toString(); });
    completarDespues(app);
  });
}

arrancar().catch((e) => { console.error(e); aviso('err', 'No se pudo abrir: ' + ((e as Error)?.message || 'error'), 30000); });
