import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { CONFIG } from '../nube/config';

const $ = <T extends HTMLElement>(sel: string, raiz: ParentNode = document) => raiz.querySelector(sel) as T;
export const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function crearCliente(): SupabaseClient {
  return createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

/** Pantalla que tapa todo (acceso, cargando, error). */
export function pantalla(html: string): HTMLElement {
  let o = document.getElementById('acceso');
  if (!o) { o = document.createElement('div'); o.id = 'acceso'; document.body.appendChild(o); }
  o.innerHTML = '<div class="caja">' + html + '</div>';
  return o;
}
export function quitarPantalla() { document.getElementById('acceso')?.remove(); }

export function cargando(txt: string) {
  const o = document.getElementById('acceso');
  const l = o?.querySelector('.carga');
  if (l) { l.textContent = txt; return; }
  pantalla('<h1>Cargando datos</h1><p class="carga">' + esc(txt) + '</p><div class="barra"><i></i></div>');
}

function pantallaAcceso(sb: SupabaseClient, msg = '', tipo = '') {
  let guardado = '';
  try { guardado = localStorage.getItem('nube-correo') || ''; } catch { /* sin almacenamiento */ }
  const o = pantalla(
    '<h1>Entrar</h1><p>Escribe tu correo. Te llega un enlace para entrar; ábrelo en este mismo navegador.</p>' +
    '<form id="f-acceso"><input id="correo" type="email" required autocomplete="email" placeholder="tu@correo.com" value="' + esc(guardado) + '">' +
    '<button type="submit">Enviar enlace</button></form><p class="msg ' + tipo + '" id="msg">' + msg + '</p>');
  $<HTMLFormElement>('#f-acceso', o).addEventListener('submit', async (e) => {
    e.preventDefault();
    const correo = $<HTMLInputElement>('#correo', o).value.trim(), m = $('#msg', o);
    if (!correo) return;
    try { localStorage.setItem('nube-correo', correo); } catch { /* sin almacenamiento */ }
    m.className = 'msg'; m.textContent = 'Enviando…';
    const r = await sb.auth.signInWithOtp({ email: correo, options: { emailRedirectTo: location.origin + location.pathname } });
    if (r.error) { m.className = 'msg err'; m.textContent = 'No se pudo enviar: ' + r.error.message; return; }
    m.className = 'msg ok'; m.textContent = 'Listo. Revisa tu correo (' + correo + ') y abre el enlace. Si no llega en 1–2 minutos, revisa spam.';
  });
}

/**
 * Pide iniciar sesión si hace falta y revisa que el correo esté en app_usuarios.
 * Llama a `alEntrar` una sola vez con la sesión lista.
 */
export async function iniciarSesion(sb: SupabaseClient, alEntrar: (s: Session) => Promise<void>) {
  let arrancado = false;
  const entrar = async (s: Session) => {
    if (arrancado) return;
    arrancado = true;
    cargando('Revisando acceso…');
    const acc = await sb.from('app_usuarios').select('email').limit(1);
    if (acc.error || !acc.data || !acc.data.length) {
      arrancado = false;
      await sb.auth.signOut();
      pantallaAcceso(sb, 'El correo ' + esc(s.user?.email) + ' no tiene acceso.', 'err');
      return;
    }
    try { await alEntrar(s); }
    catch (e) {
      console.error(e);
      arrancado = false;
      pantalla('<h1>No se pudieron cargar los datos</h1><p class="msg err">' + esc((e as Error)?.message || e) + '</p><button type="button" onclick="location.reload()">Reintentar</button>');
    }
  };
  sb.auth.onAuthStateChange((ev, s) => {
    if (s && (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION')) setTimeout(() => entrar(s), 0);
  });
  const r = await sb.auth.getSession();
  if (r.data.session) { entrar(r.data.session); return; }
  const h = location.hash || '';
  if (/error_description=/.test(h)) {
    const p = new URLSearchParams(h.slice(1));
    pantallaAcceso(sb, 'El enlace no sirvió: ' + esc(p.get('error_description')) + '. Pide uno nuevo.', 'err');
  } else if (!/access_token=|code=/.test(h + location.search)) pantallaAcceso(sb);
  else cargando('Entrando…');
}
