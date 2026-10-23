/* =====================================================================
   Capa "nube" del Radar de Negados
   - Pide iniciar sesión (enlace por correo de Supabase).
   - Lee los datos de Supabase y arranca la página con ellos.
   - Cuando la página "guarda" (antes lo hacía en el artefacto), aquí se
     guarda en Supabase solo lo que cambió.
   El código del tablero (pestañas, gráficas, carga de Excel, Descargar HTML)
   es el mismo de siempre; vive en <script id="app-src"> dentro de la página.
   ===================================================================== */
(function () {
  'use strict';

  var C = window.VIDRI_CLOUD || {};
  var DIAS_RADAR = C.DIAS_RADAR || 120;
  var DIAS_PEDIDOS = C.DIAS_PEDIDOS || 62;
  var sb = null;
  var usuario = '';
  var arrancado = false;

  // Fotos de lo que hay en la base, para guardar solo lo que cambió
  var snapDias = new Map();   // fecha -> JSON del día
  var snapStore = null;       // JSON del store
  var snapPed = new Map();    // "numero-origen" -> JSON de la fila
  var snapMeta = null;        // JSON de cortes + asignaciones pendientes

  /* ---------------- utilidades ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(n) { return Number(n || 0).toLocaleString('es-SV'); }
  function isoLocal(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // Minutos "hora local guardada como UTC", como los usa la página
  function minutosLocalesAhora() { var d = new Date(); return Math.round(d.getTime() / 60000) - d.getTimezoneOffset(); }
  function trozos(arr, n) { var out = []; for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
  async function enParalelo(tareas, limite) {
    var res = new Array(tareas.length), i = 0;
    async function obrero() { while (i < tareas.length) { var k = i++; res[k] = await tareas[k](); } }
    var ws = []; for (var w = 0; w < Math.min(limite, tareas.length); w++) ws.push(obrero());
    await Promise.all(ws);
    return res;
  }
  // Mensaje de error corto: si la respuesta llegó cortada, Supabase devuelve el texto crudo (datos), no un mensaje
  function msjError(e) {
    var m = String((e && (e.message || e.code)) || 'error');
    if (m.length > 200 || /^\s*[\[{"]/.test(m)) return 'la conexión con la base se cortó a medio camino (respuesta incompleta). Vuelve a cargar la página.';
    return m;
  }
  function revisar(r, que) {
    if (r && r.error) throw new Error(que + ': ' + msjError(r.error));
    return r;
  }
  function aNumeroSiAplica(v) {
    if (v == null) return v;
    var s = String(v);
    return /^-?\d+$/.test(s) && String(Number(s)) === s ? Number(s) : s;
  }

  /* ---------------- pedidos: fila de la página <-> fila de la base ---------------- */
  // La página usa: [numero, origen, fecha, estado, skus, motivo, actualizado, recibido, corte, bodega, asignado?]
  function aFilaBase(x) {
    return {
      numero: String(x[0]), origen: String(x[1]), fecha_min: x[2] | 0, estado: x[3] || 'O',
      skus: x[4] | 0, motivo: x[5] == null ? null : x[5], actualizado_min: x[6] | 0, recibido_min: x[7] | 0,
      corte_min: x[8] | 0, bodega: x[9] == null ? null : x[9], asignado_min: x[10] ? (x[10] | 0) : null,
    };
  }
  function aFilaPagina(r) {
    var x = [aNumeroSiAplica(r.numero), aNumeroSiAplica(r.origen), r.fecha_min, r.estado, r.skus, r.motivo,
      r.actualizado_min, r.recibido_min, r.corte_min, r.bodega];
    if (r.asignado_min) x.push(r.asignado_min);
    return x;
  }
  function clavePed(x) { return x[0] + '-' + x[1]; }

  /* ---------------- interfaz: acceso y barra ---------------- */
  function pantalla(html) {
    var o = $('nube-login');
    if (!o) {
      o = document.createElement('div');
      o.id = 'nube-login';
      document.body.appendChild(o);
    }
    o.innerHTML = '<div class="nl-card"><div class="nl-brand">Radar de Preparación · CD Nejapa</div>' + html + '</div>';
    o.hidden = false;
    return o;
  }
  function quitarPantalla() { var o = $('nube-login'); if (o) o.remove(); }

  function pantallaAcceso(msg, tipo) {
    var guardado = '';
    try { guardado = localStorage.getItem('nube-correo') || ''; } catch (e) {}
    var o = pantalla(
      '<h1>Entrar</h1><p>Escribe tu correo. Te llega un enlace para entrar; ábrelo en este mismo navegador.</p>' +
      '<form id="nl-form"><input id="nl-email" type="email" required autocomplete="email" placeholder="tu@correo.com" value="' + esc(guardado) + '">' +
      '<button type="submit">Enviar enlace</button></form>' +
      '<p class="nl-msg ' + (tipo || '') + '" id="nl-msg">' + (msg || '') + '</p>'
    );
    o.querySelector('#nl-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var email = $('nl-email').value.trim();
      var m = $('nl-msg');
      if (!email) return;
      try { localStorage.setItem('nube-correo', email); } catch (er) {}
      m.className = 'nl-msg'; m.textContent = 'Enviando…';
      var r = await sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname } });
      if (r.error) { m.className = 'nl-msg err'; m.textContent = 'No se pudo enviar: ' + r.error.message; return; }
      m.className = 'nl-msg ok'; m.textContent = 'Listo. Revisa tu correo (' + email + ') y abre el enlace. Si no llega en 1–2 minutos, revisa spam.';
    });
  }

  function pantallaCargando(txt) {
    var o = $('nube-login');
    if (o && o.querySelector('.nl-load')) { o.querySelector('.nl-load').textContent = txt; return; }
    pantalla('<h1>Cargando datos</h1><p class="nl-load">' + esc(txt) + '</p><div class="nl-bar"><i></i></div>');
  }

  function barra() {
    if ($('nube-barra')) return;
    var b = document.createElement('footer');
    b.id = 'nube-barra'; b.className = 'vx-respaldo';
    b.innerHTML =
      '<span class="nb-t">Respaldo y sesión</span><span class="nb-dot" title="Conectado a Supabase"></span><span class="nb-user">' + esc(usuario) + '</span>' +
      '<button type="button" id="nb-imp" title="Sube a la base un .json o un HTML descargado del tablero anterior">Importar respaldo</button>' +
      '<button type="button" id="nb-sync" title="Guarda en la base todo lo que está en pantalla (solo lo que cambió)">Guardar todo</button>' +
      '<button type="button" id="nb-hist" title="Carga todos los días guardados, no solo los últimos ' + DIAS_RADAR + '">Todo el histórico</button>' +
      '<button type="button" id="nb-out">Salir</button>' +
      '<input type="file" id="nb-file" accept=".json,.html,.htm" multiple hidden>';
    (document.querySelector('.wrap') || document.body).appendChild(b);
    $('nb-out').addEventListener('click', async function () { await sb.auth.signOut(); location.reload(); });
    $('nb-sync').addEventListener('click', function () { guardarTodo('Guardado manual'); });
    $('nb-hist').addEventListener('click', function () {
      var u = new URL(location.href); u.searchParams.set('todo', '1'); location.href = u.toString();
    });
    $('nb-imp').addEventListener('click', function () { $('nb-file').click(); });
    $('nb-file').addEventListener('change', function (e) {
      var fs = Array.from(e.target.files || []); e.target.value = '';
      if (fs.length) importarRespaldo(fs);
    });
    if (new URLSearchParams(location.search).get('todo')) $('nb-hist').hidden = true;
  }

  function aviso(tipo, txt, ms) {
    if (typeof window.showStatus === 'function') { try { window.showStatus(tipo, txt, ms || 15000); return; } catch (e) {} }
    try { if (typeof showStatus === 'function') { showStatus(tipo, txt, ms || 15000); return; } } catch (e) {}
    alert(txt);
  }

  /* ---------------- lectura de la base ---------------- */
  async function leerPaginado(hacerConsulta, tam, etiqueta, conteo) {
    var paginas = Math.max(1, Math.ceil((conteo || 0) / tam));
    var hechas = 0;
    var tareas = [];
    for (var p = 0; p < paginas; p++) {
      (function (p) {
        tareas.push(async function () {
          // Si Supabase falla un momento (errores 5xx o de red), se reintenta la misma página hasta 4 veces
          var r, intento = 0;
          for (;;) {
            try { r = revisar(await hacerConsulta().range(p * tam, p * tam + tam - 1), etiqueta); break; }
            catch (e) { if (++intento >= 4) throw e; await new Promise(function (ok) { setTimeout(ok, 1500 * Math.pow(2, intento - 1)); }); }
          }
          hechas++;
          pantallaCargando(etiqueta + '… ' + Math.round(hechas / paginas * 100) + '%');
          return r.data || [];
        });
      })(p);
    }
    var partes = await enParalelo(tareas, 4);
    return [].concat.apply([], partes);
  }

  async function leerDatos() {
    var todo = !!new URLSearchParams(location.search).get('todo');
    var hoy = new Date();
    var desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - DIAS_RADAR);
    var desdeIso = todo ? '1900-01-01' : isoLocal(desde);
    var corteMin = minutosLocalesAhora() - DIAS_PEDIDOS * 1440;

    pantallaCargando('Negados por día…');
    var cDias = revisar(await sb.from('radar_dias').select('fecha', { count: 'exact', head: true }).gte('fecha', desdeIso), 'Negados');
    var dias = await leerPaginado(function () {
      return sb.from('radar_dias').select('fecha,data').gte('fecha', desdeIso).order('fecha');
    }, 10, 'Negados por día', cDias.count);

    pantallaCargando('Catálogo de códigos…');
    var st = revisar(await sb.from('radar_store').select('data').eq('id', 1).maybeSingle(), 'Catálogo');

    pantallaCargando('Pedidos…');
    var cPed = revisar(await sb.from('pedidos').select('numero', { count: 'exact', head: true }).gte('fecha_min', corteMin), 'Pedidos');
    var ped = await leerPaginado(function () {
      return sb.from('pedidos').select('*').gte('fecha_min', corteMin).order('numero').order('origen');
    }, 1000, 'Pedidos', cPed.count);

    var meta = revisar(await sb.from('pedidos_meta').select('cortes,asg_pend').eq('id', 1).maybeSingle(), 'Cortes');

    var history = {};
    dias.forEach(function (r) { history[r.fecha] = r.data; snapDias.set(r.fecha, JSON.stringify(r.data)); });
    var store = (st.data && st.data.data) || {};
    snapStore = st.data ? JSON.stringify(store) : null;
    var rows = ped.map(aFilaPagina);
    rows.forEach(function (x) { snapPed.set(clavePed(x), JSON.stringify(x)); });
    var cortes = (meta.data && meta.data.cortes) || [];
    var asgP = (meta.data && meta.data.asg_pend) || {};
    snapMeta = meta.data ? JSON.stringify({ cortes: cortes, asg: asgP }) : null;

    return { history: history, store: store, pedidos: { cortes: cortes, rows: rows, asgP: asgP } };
  }

  /* ---------------- escritura: reemplaza el guardado del artefacto ---------------- */
  // La página llama a publish(files) con archivos por mes. Aquí se comparan contra
  // lo que hay en la base y solo se suben los días y pedidos que cambiaron.
  async function publicar(files, origen) {
    var upDias = [], delDias = [], upPed = [], nuevoStore = null, nuevaMeta = null;
    var nsDias = new Map(), nsPed = new Map();

    Object.keys(files).forEach(function (path) {
      var content = files[path];
      var m;
      if ((m = /^data\/radar_(\d{4}-\d{2})\.json$/.exec(path))) {
        var mes = m[1], obj = content ? JSON.parse(content) : {};
        Object.keys(obj).forEach(function (d) {
          var s = JSON.stringify(obj[d]);
          if (snapDias.get(d) !== s) { upDias.push({ fecha: d, data: obj[d] }); nsDias.set(d, s); }
        });
        snapDias.forEach(function (_, d) { if (d.slice(0, 7) === mes && !(d in obj)) delDias.push(d); });
      } else if (path === 'data/store.json') {
        if (content && content !== snapStore) nuevoStore = content;
      } else if ((m = /^data\/pedidos_(\d{4}-\d{2})\.json$/.exec(path))) {
        (content ? JSON.parse(content) : []).forEach(function (x) {
          var k = clavePed(x), s = JSON.stringify(x);
          if (snapPed.get(k) !== s) { upPed.push(aFilaBase(x)); nsPed.set(k, s); }
        });
        // Los pedidos viejos que la página deja de mostrar NO se borran de la base: quedan como historial.
      } else if (path === 'data/pedidos_index.json' && content) {
        var idx = JSON.parse(content);
        var sm = JSON.stringify({ cortes: idx.cortes || [], asg: idx.asg || {} });
        if (sm !== snapMeta) nuevaMeta = { cortes: idx.cortes || [], asg: idx.asg || {}, s: sm };
      }
    });

    var total = upDias.length + delDias.length + upPed.length + (nuevoStore ? 1 : 0) + (nuevaMeta ? 1 : 0);
    if (!total) return { dias: 0, pedidos: 0 };

    var tareas = [];
    trozos(upDias, 5).forEach(function (t) {
      tareas.push(async function () { revisar(await sb.from('radar_dias').upsert(t, { onConflict: 'fecha' }), 'Guardar negados'); });
    });
    trozos(upPed, 1000).forEach(function (t) {
      tareas.push(async function () { revisar(await sb.from('pedidos').upsert(t, { onConflict: 'numero,origen' }), 'Guardar pedidos'); });
    });
    await enParalelo(tareas, 4);
    if (delDias.length) revisar(await sb.from('radar_dias').delete().in('fecha', delDias), 'Quitar días');
    if (nuevoStore) revisar(await sb.from('radar_store').upsert({ id: 1, data: JSON.parse(nuevoStore) }, { onConflict: 'id' }), 'Guardar catálogo');
    if (nuevaMeta) revisar(await sb.from('pedidos_meta').upsert({ id: 1, cortes: nuevaMeta.cortes, asg_pend: nuevaMeta.asg }, { onConflict: 'id' }), 'Guardar cortes');

    // Todo salió bien: se actualizan las fotos
    nsDias.forEach(function (s, d) { snapDias.set(d, s); });
    delDias.forEach(function (d) { snapDias.delete(d); });
    nsPed.forEach(function (s, k) { snapPed.set(k, s); });
    if (nuevoStore) snapStore = nuevoStore;
    if (nuevaMeta) snapMeta = nuevaMeta.s;

    try {
      await sb.from('cargas').insert({ origen: origen || 'excel', detalle: { dias: upDias.map(function (r) { return r.fecha; }), dias_quitados: delDias, pedidos: upPed.length, catalogo: !!nuevoStore, cortes: !!nuevaMeta } });
    } catch (e) { /* la bitácora no es crítica */ }
    return { dias: upDias.length, pedidos: upPed.length };
  }

  // Lo que la página espera de window.claude.use('artifact')
  var artefacto = {
    publish: async function (files) {
      try { return await publicar(files, 'excel'); }
      catch (e) { console.error(e); var er = new Error((e && e.message) || 'no se pudo guardar en Supabase'); er.code = 'nube'; throw er; }
    },
  };

  /* ---------------- guardar todo lo que está en pantalla ---------------- */
  function archivosDeTodo() {
    /* global HISTORY, STORE, PED */
    var files = {};
    var meses = {};
    Object.keys(HISTORY).forEach(function (d) { (meses[d.slice(0, 7)] || (meses[d.slice(0, 7)] = {}))[d] = HISTORY[d]; });
    Object.keys(meses).forEach(function (m) { files['data/radar_' + m + '.json'] = JSON.stringify(meses[m]); });
    if (STORE) files['data/store.json'] = JSON.stringify(STORE);
    if (typeof PED !== 'undefined' && PED.rows) {
      var by = {};
      PED.rows.forEach(function (x) { var m = new Date(x[2] * 60000).toISOString().slice(0, 7); (by[m] || (by[m] = [])).push(x); });
      Object.keys(by).forEach(function (m) { files['data/pedidos_' + m + '.json'] = JSON.stringify(by[m]); });
      files['data/pedidos_index.json'] = JSON.stringify({ cortes: PED.cortes || [], asg: PED.asgP || {} });
    }
    return files;
  }

  async function guardarTodo(motivo) {
    var b = $('nb-sync'); if (b) { b.disabled = true; b.textContent = 'Guardando…'; }
    try {
      if (typeof persistSeen === 'function') { try { persistSeen(); } catch (e) {} }
      try { if (typeof pedEnsure === 'function') await pedEnsure(); } catch (e) {}
      var r = await publicar(archivosDeTodo(), motivo === 'Importación' ? 'importacion' : 'manual');
      aviso('ok', (r.dias || r.pedidos) ? 'Guardado en la base: ' + fmt(r.dias) + ' días de negados y ' + fmt(r.pedidos) + ' pedidos.' : 'La base ya estaba al día: no había nada nuevo que guardar.', 15000);
    } catch (e) {
      console.error(e);
      aviso('err', 'No se pudo guardar en la base: ' + ((e && e.message) || 'error') + '. Intenta de nuevo.', 30000);
    } finally {
      if (b) { b.disabled = false; b.textContent = 'Guardar todo'; }
    }
  }

  /* ---------------- importar un .json o un HTML del tablero anterior ---------------- */
  async function htmlAJson(file) {
    var txt = await file.text();
    var m = /id="emb">([^<]+)</.exec(txt);
    if (!m || m[1].trim() === '[EMB]') throw new Error(file.name + ': no trae datos incrustados');
    var bin = atob(m[1].trim()), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    var E = JSON.parse(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
    if (!E.history) throw new Error(file.name + ': no es un HTML del Radar de Preparación');
    var guardado = (E.store && E.store.updatedAt) || new Date(file.lastModified || Date.now()).toISOString();
    var payload = { app: 'radar-negados', formato: 2, guardado: guardado, history: E.history, store: E.store || {}, pedidos: E.pedidos || null };
    return new File([JSON.stringify(payload)], file.name.replace(/\.html?$/i, '') + '.json', { type: 'application/json' });
  }

  async function importarRespaldo(list) {
    if (typeof radarLoadHistJson !== 'function') { aviso('err', 'La página todavía no termina de cargar.'); return; }
    var archivos = [], errores = [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      try { archivos.push(/\.html?$/i.test(f.name) ? await htmlAJson(f) : f); }
      catch (e) { errores.push(e.message); }
    }
    if (!archivos.length) { aviso('err', 'No se pudo importar: ' + errores.join(' · '), 20000); return; }
    await radarLoadHistJson(archivos);
    if (confirm('Se cargaron ' + archivos.length + ' archivo(s) en pantalla.' + (errores.length ? '\n\nCon problemas: ' + errores.join(' · ') : '') + '\n\n¿Guardarlos ahora en la base de datos?')) {
      await guardarTodo('Importación');
    }
  }

  /* ---------------- arranque ---------------- */
  async function arrancar(session) {
    if (arrancado) return;
    arrancado = true;
    usuario = (session.user && session.user.email) || '';
    try {
      pantallaCargando('Revisando acceso…');
      var acc = revisar(await sb.from('app_usuarios').select('email').limit(1), 'Acceso');
      if (!acc.data || !acc.data.length) {
        arrancado = false;
        await sb.auth.signOut();
        pantallaAcceso('El correo ' + esc(usuario) + ' no tiene acceso. Agrégalo en la tabla app_usuarios de Supabase.', 'err');
        return;
      }
      var datos = await leerDatos();
      pantallaCargando('Armando el tablero…');
      window.__CLOUD_DATA = datos;
      window.claude = window.claude || {};
      window.claude.use = async function (nombre) { return nombre === 'artifact' ? artefacto : null; };

      var src = $('app-src').textContent;
      var s = document.createElement('script');
      s.textContent = src;
      document.body.appendChild(s);

      // Encabezado: deja claro que es la versión en línea
      document.querySelectorAll('.vxh .meta').forEach(function (el) {
        el.innerHTML = el.innerHTML.replace(/Copia de consulta · Últimos 45 días \([^)]*\)/, 'En línea · base de datos');
      });
      barra();
      if (window.VidriReporte) window.VidriReporte.ponerBotones();
      quitarPantalla();
      var nd = Object.keys(datos.history).length;
      if (!nd && !datos.pedidos.rows.length) {
        aviso('ok', 'La base está vacía. Usa «Importar respaldo» para subir tu HTML o .json actual, o carga un Excel.', 30000);
      }
    } catch (e) {
      console.error(e);
      arrancado = false;
      pantalla('<h1>No se pudieron cargar los datos</h1><p class="nl-msg err">' + esc((e && e.message) || e) + '</p><button type="button" onclick="location.reload()">Reintentar</button>');
    }
  }

  async function iniciar() {
    if (!window.supabase || !window.supabase.createClient) {
      pantalla('<h1>Falta la librería de Supabase</h1><p>No se encontró vendor/supabase.js.</p>');
      return;
    }
    if (!C.SUPABASE_URL || /TU-PROYECTO/.test(C.SUPABASE_URL) || !C.SUPABASE_KEY || /TU_CLAVE/.test(C.SUPABASE_KEY)) {
      pantalla('<h1>Falta configurar</h1><p>Abre <b>config.js</b> en el repositorio y pega la URL y la clave pública de tu proyecto de Supabase.</p>');
      return;
    }
    sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    window.__NUBE = { sb: sb, guardarTodo: guardarTodo };
    sb.auth.onAuthStateChange(function (ev, session) {
      if (session && (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION')) setTimeout(function () { arrancar(session); }, 0);
    });
    var r = await sb.auth.getSession();
    if (r.data && r.data.session) arrancar(r.data.session);
    else {
      var h = location.hash || '';
      if (/error_description=/.test(h)) {
        var p = new URLSearchParams(h.slice(1));
        pantallaAcceso('El enlace no sirvió: ' + esc(p.get('error_description')) + '. Pide uno nuevo.', 'err');
      } else if (!/access_token=|code=/.test(h + location.search)) {
        pantallaAcceso();
      } else {
        pantallaCargando('Entrando…');
      }
    }
  }

  iniciar();
})();
