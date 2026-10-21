/* =====================================================================
   Diseño "semáforo" + modo oscuro. Lo usan el Radar actual (/radar/) y
   la versión nueva (/app/). Solo cambia cómo se ve: no toca los datos.
   - Botón Oscuro / Claro (se recuerda en este navegador).
   - Color de meta en las tarjetas que tienen meta. Las metas se definen en METAS (null = sin meta).
   ===================================================================== */
(function () {
  'use strict';

  /** Metas del semáforo. verde: valor que cumple; mayor = true si "más es mejor". null = sin meta (tarjeta neutra). */
  var METAS = {
    negados: null,                                   // % de líneas negadas (pendiente de definir)
    exactitud: { verde: 99.5, mayor: true },         // exactitud de picking (meta del tablero)
    b2b: null,                                       // fill rate B2B (pendiente de definir)
  };

  var CLAVE = 'vidri-tema';
  function leerTema() { try { return localStorage.getItem(CLAVE) === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; } }
  function ponerTema(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(CLAVE, t); } catch (e) { /* sin almacenamiento */ }
    document.querySelectorAll('.tema-btn span').forEach(function (s) { s.textContent = t === 'dark' ? 'Claro' : 'Oscuro'; });
  }
  ponerTema(leerTema());

  function botones() {
    document.querySelectorAll('.vxh .acts').forEach(function (g) {
      if (g.querySelector('.tema-btn')) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'lnk tema-btn'; b.title = 'Cambia entre modo claro y oscuro';
      b.innerHTML = '<i></i><span></span>';
      b.addEventListener('click', function () { ponerTema(leerTema() === 'dark' ? 'light' : 'dark'); });
      g.insertBefore(b, g.firstChild);
    });
    ponerTema(leerTema());
  }

  /* ---------------- semáforo ---------------- */
  function num(t) {
    var s = String(t || '').replace(/[^0-9,.\-]/g, '');
    if (!s || s === '-') return null;
    s = s.replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
    var v = parseFloat(s); return isNaN(v) ? null : v;
  }
  function estado(v, m) {
    if (v == null || !m) return null;
    var ok = m.mayor ? v >= m.verde : v <= m.verde;
    if (ok) return 'v';
    if (m.amarillo != null) { var cerca = m.mayor ? v >= m.amarillo : v <= m.amarillo; if (cerca) return 'a'; }
    return 'r';
  }
  var ETQ = { v: 'EN META', a: 'CERCA', r: 'FUERA' };
  function marcar(idValor, est) {
    var el = document.getElementById(idValor), k = el && el.closest('.kpi');
    if (!k) return;
    var actual = ['v', 'a', 'r'].filter(function (c) { return k.classList.contains('sem-' + c); })[0] || null;
    if (actual === est && (!est || k.querySelector('.sem-t'))) return; // sin cambios: no tocar (evita repintar sin fin)
    k.classList.remove('sem', 'sem-v', 'sem-a', 'sem-r');
    var t = k.querySelector('.sem-t'); if (t) t.remove();
    if (!est) return;
    k.classList.add('sem', 'sem-' + est);
    t = document.createElement('span'); t.className = 'sem-t'; t.textContent = ETQ[est]; k.appendChild(t);
  }
  function txt(id) { var e = document.getElementById(id); return e ? e.textContent.trim() : '—'; }
  function metaTxt(m, unidad) { return m ? 'meta ' + (m.mayor ? '≥ ' : '≤ ') + String(m.verde).replace('.', ',') + unidad : 'sin meta definida'; }

  var dibujando = false;
  function semaforo() {
    var k = document.querySelector('#tab-resumen > .kpis');
    if (!k || dibujando) return;
    dibujando = true;
    try {
      var pct = num(txt('kpiPct')), ex = num(txt('kpiExact')), b2 = num(txt('kpiB2B'));
      var eN = estado(pct, METAS.negados), eE = estado(ex, METAS.exactitud), eB = estado(b2, METAS.b2b);
      marcar('kpiNegados', eN); marcar('kpiExact', eE); marcar('kpiB2B', eB);
      var st = document.getElementById('semStrip'); if (st) st.remove(); // la franja de números clave se quitó (21 oct): solo las 6 tarjetas
    } finally { dibujando = false; }
  }

  // Se vuelve a pintar cada vez que cambian las tarjetas (al elegir otro día o cargar un Excel).
  var pend = null;
  function programar() { if (pend) return; pend = setTimeout(function () { pend = null; semaforo(); botones(); }, 30); }
  function observar() {
    var k = document.querySelector('#tab-resumen > .kpis');
    if (!k) return false;
    new MutationObserver(programar).observe(k, { subtree: true, characterData: true, childList: true });
    programar();
    return true;
  }
  // En el HTML que se comparte (copia con los datos adentro) solo quedan Cargar Excel y Descargar HTML.
  function marcarCopia() {
    var e = document.getElementById('emb');
    if (e && e.textContent.trim() && e.textContent.trim() !== '[EMB]') document.documentElement.classList.add('copia');
  }
  function iniciar() {
    marcarCopia();
    botones();
    if (!observar()) { var n = 0, t = setInterval(function () { if (observar() || ++n > 100) clearInterval(t); }, 200); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  window.VidriTema = { ponerTema: ponerTema, METAS: METAS, refrescar: programar };
})();
