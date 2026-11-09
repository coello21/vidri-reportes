/* =====================================================================
   Reporte ejecutivo automático (Pedidos CD + Negados)
   Usa los datos que ya están cargados en el Radar y arma el reporte con
   frases fijas (plantillas), sin depender de IA. Se descarga como PDF
   con el diálogo de impresión del navegador ("Guardar como PDF").
   ===================================================================== */
/* REGLA (6 nov 2026): el reporte solo usa los gráficos y tablas que ya están en el Radar, cada uno con un texto corto
   de qué muestra; nada de gráficos nuevos ni texto explicativo largo. Fondo blanco y ningún dato repetido. */
(function () {
  'use strict';

  /* ---------------- formato ---------------- */
  var C = { BLUE: '#1E3A6E', GREEN: '#1E3A6E', ORANGE: '#E0262B', RED: '#E0262B', INK: '#1A1A1A', LINE: '#E3E6EA' };
  var DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  var DOW_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
  function n(v) { return new Intl.NumberFormat('es-SV').format(Math.round(v || 0)); }
  function dec(v, d) { return (v == null || !isFinite(v)) ? '–' : v.toFixed(d == null ? 1 : d).replace('.', ','); }
  function pct(a, b) { return b ? a / b * 100 : 0; }
  function pctTxt(a, b) { return dec(pct(a, b)) + '%'; }
  function pctInt(a, b) { if (!b || !a) return '0%'; var p = a / b * 100; return (p < 1 ? 'menos de 1' : Math.round(p)) + '%'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function nombre(s) { return String(s || '').toLowerCase().split(' ').map(function (w) { return /^(i|ii|iii|iv|v|b2b|cd)$/.test(w) ? w.toUpperCase() : w === 'by' ? w : cap(w); }).join(' '); }
  function dowOf(d) { return new Date(d + 'T00:00:00Z').getUTCDay(); }
  function addD(d, k) { var x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); }
  function dStart(d) { return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 60000; }
  function dayOfMin(m) { return new Date(m * 60000).toISOString().slice(0, 10); }
  function lblCorto(d) { return DOW[dowOf(d)] + ' ' + (+d.slice(8)); }
  function lblFecha(d) { return (+d.slice(8)) + ' ' + MES[+d.slice(5, 7) - 1]; }
  function lblLargo(d) { return cap(DOW_L[dowOf(d)]) + ' ' + (+d.slice(8)) + ' ' + MES[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4); }
  function horaMin(m) { var x = new Date(m * 60000), h = x.getUTCHours(), mi = x.getUTCMinutes(); return horaTxt(h, mi); }
  function horaTxt(h, mi) { if (h === 12 && mi === 0) return '12:00 m.'; var ap = h < 12 ? 'a. m.' : 'p. m.'; return (h % 12 || 12) + ':' + String(mi).padStart(2, '0') + ' ' + ap; }
  function median(a) { if (!a.length) return null; a = a.slice().sort(function (p, q) { return p - q; }); var m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  function lista(items) { return items.length <= 1 ? items.join('') : items.slice(0, -1).join(', ') + ' y ' + items[items.length - 1]; }
  function masMenos(v, unidad) { return v > 0 ? n(v) + ' ' + unidad + ' más' : v < 0 ? n(-v) + ' ' + unidad + ' menos' : 'los mismos ' + unidad; }

  /* ---------------- de dónde salen los datos ----------------
     Radar actual (/radar/): variables de la página (PED, HISTORY, STORE).
     Versión nueva (/app/): la página registra una fuente con VidriReporte.usarFuente(fn). */
  var FUENTE = null, AVISO = null;
  function HISTORY_MOT(d) { var H = src().H || {}, m = H[d] && H[d].mot; return m && m.n ? m : null; }
  function src() {
    if (FUENTE) return FUENTE();
    return {
      rows: (typeof PED !== 'undefined' && PED.rows) || null,
      lc: typeof pedLastCorte === 'function' ? pedLastCorte() : 0,
      H: typeof HISTORY !== 'undefined' ? HISTORY : null,
      S: typeof STORE !== 'undefined' ? STORE : null,
    };
  }
  var pedC = function (x) { return (x[5] === 'ven' || x[5] === 'lin') ? 'otr' : x[5]; };
  var pedB = function (x) { return x[9] || 'N'; };

  /* ---------------- datos de pedidos ---------------- */
  function datosPedidos() {
    var F = src();
    if (!F.rows || !F.rows.size) return null;
    var lc = F.lc; if (!lc) return null;
    var all = []; F.rows.forEach(function (x) { if (x[3] === 'A' || x[8] >= lc) all.push(x); });
    var hoy = dayOfMin(lc), t0 = dStart(hoy), off = lc - t0;
    var pendAt = function (t) { var c = 0; all.forEach(function (x) { if (x[2] >= t) return; if (x[6] ? x[6] >= t : x[3] !== 'A') c++; }); return c; };
    var entre = function (a, b) { return all.filter(function (x) { return x[2] >= a && x[2] < b; }); };

    var ini = pendAt(t0), entR = entre(t0, lc + 1), ent = entR.length, fin = pendAt(lc + 1), ter = ini + ent - fin;
    var terMan = 0, terTar = 0;
    all.forEach(function (x) { if (x[6] && x[6] >= t0 && x[6] <= lc) { if (x[6] < t0 + 720) terMan++; else terTar++; } });

    // misma hora, mismo día de la semana anterior
    var tp = t0 - 7 * 1440, prevDia = dayOfMin(tp);
    var hayPrev = all.some(function (x) { return x[2] >= tp && x[2] < tp + 1440; });
    var prev = null;
    if (hayPrev) {
      var pIni = pendAt(tp), pEnt = entre(tp, tp + off + 1).length, pFin = pendAt(tp + off + 1);
      var pDelDia = all.filter(function (x) { return x[2] >= tp && x[2] < tp + 1440 && x[2] <= tp + off && (x[6] ? x[6] > tp + off : x[3] !== 'A'); }).length;
      var pAsg = all.filter(function (x) { return x[10] && x[10] >= tp && x[10] <= tp + off; }).length;
      prev = { dia: prevDia, ini: pIni, ent: pEnt, fin: pFin, ter: pIni + pEnt - pFin, delDia: pDelDia, asg: pAsg };
    }

    // estado al corte
    var R = all.filter(function (x) { return x[3] === 'R' && x[8] >= lc; });
    var P = all.filter(function (x) { return x[3] === 'P' && x[8] >= lc; });
    var skR = R.reduce(function (s, x) { return s + (x[4] || 0); }, 0);
    var viejos = R.filter(function (x) { return x[2] <= lc - 72 * 60; });
    var porDiaR = {}; R.forEach(function (x) { var d = dayOfMin(x[2]); (porDiaR[d] || (porDiaR[d] = { c: 0, sk: 0 })).c++; porDiaR[d].sk += x[4] || 0; });
    var porDiaV = {}; viejos.forEach(function (x) { var d = dayOfMin(x[2]); (porDiaV[d] || (porDiaV[d] = { c: 0, sk: 0 })).c++; porDiaV[d].sk += x[4] || 0; });
    var skV = viejos.reduce(function (s, x) { return s + (x[4] || 0); }, 0);

    // asignado en el día (hora de creación de la orden de preparación)
    var asg = all.filter(function (x) { return x[10] && x[10] >= t0 && x[10] <= lc; });
    var asgMan = asg.filter(function (x) { return x[10] < t0 + 720; }).length;
    var asgPorDia = {}; asg.forEach(function (x) { var d = dayOfMin(x[2]); asgPorDia[d] = (asgPorDia[d] || 0) + 1; });
    var espera = median(asg.map(function (x) { return (x[10] - (x[7] || x[2])) / 60; }).filter(function (h) { return h >= 0; }));
    var trabajados = all.filter(function (x) { return (x[3] === 'A' || x[3] === 'P') && x[2] >= t0 - 7 * 1440; });
    var cobertura = trabajados.length ? trabajados.filter(function (x) { return x[10]; }).length / trabajados.length : 0;

    // lo que entró hoy
    var delDia = entR, nDia = delDia.length;
    var diaAsig = delDia.filter(function (x) { return x[10] || x[3] === 'P' || x[3] === 'A'; }).length;
    var diaTerm = delDia.filter(function (x) { return x[3] === 'A'; }).length;
    var diaPend = delDia.filter(function (x) { return x[3] !== 'A'; }).length;
    var porMot = {}; delDia.forEach(function (x) { var c = pedC(x); porMot[c] = (porMot[c] || 0) + 1; });
    var nej = delDia.filter(function (x) { return pedB(x) === 'N'; }).length;
    var skDia = delDia.reduce(function (s, x) { return s + (x[4] || 0); }, 0);

    // 15 días: entraron, terminados y sin terminar al cierre
    var dias = []; for (var i = 14; i >= 0; i--) dias.push(addD(hoy, -i));
    var serie = dias.map(function (d) {
      var a = dStart(d), b = d === hoy ? lc + 1 : a + 1440, i0 = pendAt(a), e = entre(a, b).length, f = pendAt(b);
      return { d: d, ent: e, ter: i0 + e - f, fin: f, parcial: d === hoy };
    }).filter(function (r, i, arr) { return r.ent || r.fin || i === arr.length - 1; });

    // pedidos por día y motivo (fecha del pedido), últimos 7 días con pedidos: mismo gráfico que la pestaña Pedidos CD
    var d7 = serie.filter(function (r) { return r.ent; }).slice(-7).map(function (r) { return r.d; }), ix7 = {};
    d7.forEach(function (d, i) { ix7[d] = i; });
    var porMot7 = { exi: [], b2b: [], rot: [], otr: [] }; Object.keys(porMot7).forEach(function (k) { porMot7[k] = d7.map(function () { return 0; }); });
    all.forEach(function (x) { var d = dayOfMin(x[2]); if (!(d in ix7)) return; var c = pedC(x); if (porMot7[c]) porMot7[c][ix7[d]]++; });
    return {
      d7: d7, porMot7: porMot7,
      lc: lc, hoy: hoy, ini: ini, ent: ent, ter: ter, fin: fin, terMan: terMan, terTar: terTar, prev: prev,
      sinAsig: R.length, skR: skR, enPrep: P.length, viejos: viejos.length, skV: skV, porDiaR: porDiaR, porDiaV: porDiaV,
      asg: asg.length, asgMan: asgMan, asgPorDia: asgPorDia, espera: espera, cobertura: cobertura,
      nDia: nDia, diaAsig: diaAsig, diaTerm: diaTerm, diaPend: diaPend, porMot: porMot, nej: nej, skDia: skDia, serie: serie,
    };
  }

  /* ---------------- datos de negados ---------------- */
  function datosNegados(diaPreferido) {
    var F = src(), HISTORY = F.H, STORE = F.S || {};
    if (!HISTORY) return null;
    var dias = Object.keys(HISTORY).filter(function (d) { return HISTORY[d] && HISTORY[d].meta && HISTORY[d].meta.totalFinal; }).sort();
    if (!dias.length) return null;
    var d = (diaPreferido && HISTORY[diaPreferido] && dias.indexOf(diaPreferido) >= 0) ? diaPreferido : dias[dias.length - 1];
    var info = function (x) {
      var r = HISTORY[x], m = r.meta || {}, b = r.bucket || {}, neg = m.totalNegados || 0;
      // con motivo registrado: sin stock = "Existencia a cero" y error en el proceso = el resto (igual que la página)
      if (r.mot) { var ec = Math.min((r.mot.m || {})['Existencia a cero'] || 0, neg); return { d: x, lin: m.totalFinal || 0, neg: neg, err: neg - ec, sst: ec, cero: ec, negat: 0, prep: m.totalPreparados || 0, exactas: m.exactas || 0, v: r.v, mot: true }; }
      return { d: x, lin: m.totalFinal || 0, neg: neg, err: b.positivo || 0, sst: (b.cero || 0) + (b.negativo || 0), cero: b.cero || 0, negat: b.negativo || 0, prep: m.totalPreparados || 0, exactas: m.exactas || 0, v: r.v };
    };
    var hoy = info(d);
    var parcial = typeof isPartialDay === 'function' ? isPartialDay(d) : false;

    var antes = dias.filter(function (x) { return x < d; });
    var prevW = HISTORY[addD(d, -7)] ? info(addD(d, -7)) : null;
    // promedio de los 10 días anteriores con datos
    var ventana = antes.slice(-10).map(info);
    var sL = 0, sN = 0; ventana.forEach(function (r) { sL += r.lin; sN += r.neg; });
    var prom = sL ? sN / sL * 100 : null;
    var pHoy = pct(hoy.neg, hoy.lin);
    // ¿el más alto / más bajo desde cuándo?
    var desde = null, tipo = null;
    if (antes.length >= 3 && prom != null) {
      tipo = pHoy >= prom ? 'alto' : 'bajo';
      var k = antes.length - 1, cnt = 0;
      for (; k >= 0; k--) { var r = info(antes[k]), p = pct(r.neg, r.lin); if (tipo === 'alto' ? p >= pHoy : p <= pHoy) break; cnt++; }
      if (cnt >= 3) desde = k >= 0 ? antes[k] : 'inicio';
    }
    var serie = antes.slice(-10).concat([d]).map(info);

    var hrs = (HISTORY[d].hours || []);
    var negMan = 0, negTar = 0; hrs.forEach(function (v, h) { if (h < 12) negMan += v || 0; else negTar += v || 0; });

    var tiendas = Object.keys(HISTORY[d].stores || {}).map(function (s) { return { s: s, lin: HISTORY[d].stores[s][0], neg: HISTORY[d].stores[s][1] }; })
      .filter(function (t) { return t.neg > 0; }).sort(function (a, b) { return b.neg - a.neg; });
    var codes = HISTORY[d].codes || {}, top = [];
    for (var sku in codes) { var c = codes[sku], t = (c[0] || 0) + (c[1] || 0) + (c[2] || 0); if (t) top.push({ sku: sku, t: t, err: c[0] || 0 }); }
    top.sort(function (a, b) { return b.t - a.t; });
    // motivo principal registrado de cada código del día (si el día trae motivo)
    var MO = HISTORY[d].mot, motSku = {};
    if (MO && MO.q && MO.k) for (var pr in MO.q) for (var sk in MO.q[pr]) { var t2 = motSku[sk] || (motSku[sk] = {}); MO.q[pr][sk].forEach(function (v, i) { if (v) t2[MO.k[i]] = (t2[MO.k[i]] || 0) + v; }); }
    top = top.slice(0, 5).map(function (x) {
      var s = (STORE.skus || {})[x.sku]; x.desc = s && s[0] ? s[0] : '';
      var mm = motSku[x.sku]; if (mm) { var k = Object.keys(mm).sort(function (a, b) { return mm[b] - mm[a]; })[0]; x.mp = (k === '' ? 'Sin motivo' : k) + ' (' + mm[k] + ')'; }
      return x;
    });

    // fill rate y B2B con el mismo cálculo que la tarjeta de la página (los da la página en la fuente)
    var b2b = F.B2B ? F.B2B([d]) : typeof b2bForDates === 'function' ? b2bForDates([d]) : { tot: 0, ok: 0 };
    var fr = F.FR ? F.FR([d]) : null;

    return { hoy: hoy, parcial: parcial, prevW: prevW, prom: prom, ventana: ventana, pHoy: pHoy, desde: desde, tipo: tipo, serie: serie, negMan: negMan, negTar: negTar, tiendas: tiendas, top: top, b2b: b2b, fr: fr };
  }

  /* ---------------- gráficos ---------------- */
  function niceMax(v, paso) { return Math.max(paso, Math.ceil(v / paso) * paso); }
  function grafPedidos(s) {
    var W = 430, H = 128, l = 34, r = 10, t = 12, b = 28, iw = W - l - r, ih = H - t - b, N = s.length;
    var top = Math.max.apply(null, s.map(function (x) { return Math.max(x.ent, x.fin); }).concat([1]));
    var paso = top > 4000 ? 2000 : top > 2000 ? 1000 : top > 800 ? 500 : 100, mx = niceMax(top, paso);
    var slot = iw / N, bw = slot * 0.6, X = function (i) { return l + slot * i + slot / 2; }, Y = function (v) { return t + ih - v / mx * ih; }, g = '';
    for (var v = 0; v <= mx; v += paso) { var y = Y(v); g += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + C.LINE + '" stroke-width=".5"/><text x="' + (l - 5) + '" y="' + (y + 2.5).toFixed(1) + '" class="ax" text-anchor="end">' + n(v) + '</text>'; }
    s.forEach(function (x, i) {
      g += '<rect x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + Y(x.ent).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (x.ent / mx * ih).toFixed(1) + '" fill="' + C.BLUE + '" opacity="' + (x.parcial ? .55 : 1) + '"/>';
      if (i % 2 === (N - 1) % 2) { var w = DOW[dowOf(x.d)], pk = (i === N - 1) ? ' pk' : ''; g += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 17) + '" class="ax' + pk + '" text-anchor="middle">' + w + '</text><text x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" class="ax' + pk + '" text-anchor="middle">' + (+x.d.slice(8)) + '/' + (+x.d.slice(5, 7)) + '</text>'; }
    });
    var pts = function (k) { return s.map(function (x, i) { return X(i).toFixed(1) + ',' + Y(Math.max(0, x[k])).toFixed(1); }).join(' '); };
    g += '<polyline points="' + pts('fin') + '" fill="none" stroke="' + C.ORANGE + '" stroke-width="1.4" stroke-dasharray="4 3"/>';
    var last = s[N - 1]; g += '<text x="' + X(N - 1).toFixed(1) + '" y="' + (Y(last.fin) - 5).toFixed(1) + '" class="lab" fill="' + C.ORANGE + '" text-anchor="middle">' + n(last.fin) + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + g + '</svg>';
  }
  var MOT_PED = [['exi', 'Existencia', '#1E3A6E'], ['b2b', 'B2B', '#E0262B'], ['rot', 'Rotación', '#1A1A1A'], ['otr', 'Otros', '#A3A5A8']];
  /** Pedidos por día y motivo, barras una junto a otra (igual que «Pedidos asignados por día y motivo» del Radar). */
  function grafPedMot(P) {
    var ks = MOT_PED.filter(function (m) { return P.porMot7[m[0]].some(function (v) { return v; }); });
    var D = P.d7, W = 430, H = 132, l = 30, r = 6, t = 12, b = 22, iw = W - l - r, ih = H - t - b, N = D.length || 1;
    var top = 1; ks.forEach(function (m) { P.porMot7[m[0]].forEach(function (v) { top = Math.max(top, v); }); });
    var paso = top > 1500 ? 500 : top > 600 ? 200 : top > 250 ? 100 : 50, mx = niceMax(top * 1.08, paso);
    var slot = iw / N, gw = slot * 0.78, bw = gw / Math.max(1, ks.length), Y = function (v) { return t + ih - v / mx * ih; }, g = '';
    for (var v = 0; v <= mx; v += paso) { var y = Y(v); g += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + C.LINE + '" stroke-width=".5"/><text x="' + (l - 4) + '" y="' + (y + 2.5).toFixed(1) + '" class="ax" text-anchor="end">' + n(v) + '</text>'; }
    D.forEach(function (d, i) {
      var x0 = l + slot * i + (slot - gw) / 2, last = i === N - 1;
      ks.forEach(function (m, j) { var v = P.porMot7[m[0]][i]; g += '<rect x="' + (x0 + j * bw).toFixed(1) + '" y="' + Y(v).toFixed(1) + '" width="' + (bw - 1).toFixed(1) + '" height="' + (v / mx * ih).toFixed(1) + '" fill="' + m[2] + '"/>' + (v ? '<text x="' + (x0 + j * bw + bw / 2 - .5).toFixed(1) + '" y="' + (Y(v) - 2).toFixed(1) + '" class="lab" text-anchor="middle" style="font-size:5px">' + n(v) + '</text>' : ''); });
      g += '<text x="' + (l + slot * i + slot / 2).toFixed(1) + '" y="' + (H - 7) + '" class="ax' + (last ? ' pk' : '') + '" text-anchor="middle">' + lblCorto(d) + '</text>';
    });
    return { svg: '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + g + '</svg>', ks: ks };
  }
  /** Mapa de calor de negados por motivo, últimos 7 días (igual que el Resumen del Radar): % del día y líneas. */
  function mapaMotivos(dHoy) {
    var Hs = src().H || {}, ds = Object.keys(Hs).filter(function (x) { return x <= dHoy && Hs[x] && Hs[x].meta && Hs[x].meta.totalFinal; }).sort().slice(-7);
    var mot = function (d) { return Hs[d].mot && Hs[d].mot.n ? Hs[d].mot : null; };
    if (!ds.some(mot)) return '';
    var ks = {}; ds.forEach(function (d) { var m = mot(d); if (m) Object.keys(m.m).forEach(function (k) { ks[k] = 1; }); });
    var tot = ds.map(function (d) { return Hs[d].meta.totalNegados || 0; });
    var filas = Object.keys(ks).map(function (k) { return { n: k === '' ? 'Sin motivo' : k, v: ds.map(function (d) { var m = mot(d); return m ? (m.m[k] || 0) : 0; }) }; });
    var sd = ds.map(function (d, i) { var m = mot(d); return Math.max(0, tot[i] - (m ? m.n : 0)); });
    var pf = function (f) { return f.v.reduce(function (a, v, i) { return a + (tot[i] ? v / tot[i] : 0); }, 0); };
    filas.sort(function (a, b) { return pf(b) - pf(a); });
    if (sd.some(function (v) { return v; })) filas.push({ n: 'Sin dato', v: sd });
    var cel = function (v, i) { var p = tot[i] ? v / tot[i] : 0, a = v ? Math.round(6 + Math.min(1, p / 0.5) * 74) : 0;
      return '<td class="r"' + (v ? ' style="background:color-mix(in srgb,#E0262B ' + a + '%,#fff)' + (a > 48 ? ';color:#fff' : '') + '"' : '') + '>' + (v ? '<b>' + Math.round(p * 100) + '%</b> <span>(' + n(v) + ')</span>' : '·') + '</td>'; };
    return '<table class="hm"><thead><tr><th>MOTIVO</th>' + ds.map(function (d) { return '<th class="r' + (d === dHoy ? ' hoy' : '') + '">' + lblCorto(d).toUpperCase() + '</th>'; }).join('') + '</tr></thead><tbody>' +
      filas.map(function (f) { return '<tr><td>' + esc(f.n) + '</td>' + f.v.map(cel).join('') + '</tr>'; }).join('') +
      '<tr class="tot"><td>Líneas negadas</td>' + tot.map(function (v) { return '<td class="r">' + n(v) + '</td>'; }).join('') + '</tr></tbody></table>';
  }
  function grafNegados(s, prom) {
    var W = 430, H = 118, l = 30, r = 8, t = 12, b = 16, iw = W - l - r, ih = H - t - b, N = s.length;
    var top = Math.max.apply(null, s.map(function (x) { return pct(x.neg, x.lin); }).concat([prom || 0, 10]));
    var mx = niceMax(top + 3, 10), slot = iw / N, bw = slot * 0.62, g = '';
    var X = function (i) { return l + slot * i + slot / 2; }, Y = function (v) { return t + ih - v / mx * ih; };
    for (var v = 0; v <= mx; v += 10) { var y = Y(v); g += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + C.LINE + '" stroke-width=".5"/><text x="' + (l - 4) + '" y="' + (y + 2.5).toFixed(1) + '" class="ax" text-anchor="end">' + v + '%</text>'; }
    s.forEach(function (x, i) {
      var pn = pct(x.neg, x.lin), last = i === N - 1;
      g += '<rect x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + Y(pn).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (pn / mx * ih).toFixed(1) + '" fill="' + C.RED + '" opacity="' + (last ? 1 : .75) + '"/>';
      g += '<text x="' + X(i).toFixed(1) + '" y="' + (Y(pn) - 3).toFixed(1) + '" class="lab' + (last ? ' hl' : '') + '" text-anchor="middle">' + dec(pn) + '%</text>';
      g += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 5) + '" class="ax' + (last ? ' pk' : '') + '" text-anchor="middle">' + lblCorto(x.d) + '</text>';
    });
    if (prom != null) { var yp = Y(prom); g += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + yp.toFixed(1) + '" y2="' + yp.toFixed(1) + '" stroke="' + C.INK + '" stroke-width="1" stroke-dasharray="4 3"/>'; }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + g + '</svg>';
  }

  /* ---------------- textos (plantillas) ---------------- */
  function armar() {
    var STORE = src().S;
    var P = datosPedidos();
    // Reporte de la mañana (corte antes de las 10 a. m.): cómo cerró AYER (negados, fill rate) y cómo AMANECIMOS hoy (pedidos).
    // Más tarde: el día en curso, y el fill rate con el que cerró ayer como referencia.
    var amanecer = !!(P && (P.lc - dStart(P.hoy)) < 10 * 60);
    var ayer = null;
    if (amanecer) { var Hs = src().H || {}; ayer = Object.keys(Hs).filter(function (x) { return x < P.hoy && Hs[x] && Hs[x].meta && Hs[x].meta.totalFinal; }).sort().pop() || null; }
    var N = datosNegados(amanecer && ayer ? ayer : P ? P.hoy : null);
    if (!P && !N) throw new Error('No hay datos cargados para armar el reporte.');
    var dia = P ? P.hoy : N.hoy.d;
    var cierre = P ? (P.lc - dStart(P.hoy)) >= 16 * 60 + 30 : !N.parcial;
    var corteTxt = P ? horaMin(P.lc) : '';
    var elDia = 'el ' + DOW_L[dowOf(dia)];
    var ElDia = cap(elDia);
    var momento = cierre ? 'cierre del día' : 'corte de las ' + corteTxt;
    var negHora = '';
    try { var u = STORE && STORE.updatedAt ? new Date(STORE.updatedAt) : null; if (u && !isNaN(u)) negHora = horaTxt(u.getHours(), u.getMinutes()); } catch (e) { }

    var h = { kpis: [], acciones: [] };

    /* ----- números de apoyo ----- */
    var revN = (STORE && STORE.revN) || {};
    var dN = N ? N.hoy.d : dia;                                          // día de los negados (ayer en el reporte de la mañana)
    var lp = revN[dN] != null ? revN[dN] : null;                         // líneas preparadas (entregadas al revisador)
    var diaAnt = addD(dN, -7), lpAnt = revN[diaAnt] != null ? revN[diaAnt] : null;
    var lAct = N ? N.hoy.lin : null;                                     // líneas actualizadas (estado A)
    var frV = N && N.fr && N.fr.base ? pct(N.fr.prep, N.fr.base) : null;
    // fill rate con el que cerró el día hábil anterior (para el reporte del día en curso)
    var Hx = src().H || {}, diaPrev = Object.keys(Hx).filter(function (x) { return x < dN && Hx[x] && Hx[x].meta && Hx[x].meta.totalFinal; }).sort().pop() || null;
    var frPrev = null; if (!amanecer && diaPrev && src().FR) { var rp = src().FR([diaPrev]); frPrev = rp && rp.base ? pct(rp.prep, rp.base) : null; }
    var ElDN = cap(amanecer ? 'ayer ' + DOW_L[dowOf(dN)] : 'el ' + DOW_L[dowOf(dN)]);
    var ex = N && N.hoy.prep ? pct(N.hoy.exactas, N.hoy.prep) : null, exAnt = N && N.prevW && N.prevW.prep ? pct(N.prevW.exactas, N.prevW.prep) : null;
    var b2b = N && N.b2b.tot ? pct(N.b2b.ok, N.b2b.tot) : null;
    var sem = function (d) { return 'el ' + DOW_L[dowOf(d)] + ' pasado'; };
    // ----- motivo registrado por el preparador (día del reporte y mismo día de la semana pasada) -----
    var MO = N ? HISTORY_MOT(N.hoy.d) : null, MOW = N && N.prevW ? HISTORY_MOT(N.prevW.d) : null;
    var MOT_SIG = { 'Físico no se encuentra': 'había en sistema y no se encontró', 'Existencia a cero': 'no había producto', 'Sin existencia ubicación picking': 'estaba en tarimas, no en picking', 'Producto incompleto o averiado': 'llegó incompleto o dañado', 'Pasillo bloqueado': 'no se pudo llegar a la ubicación', '': 'el preparador no anotó el motivo' };
    var motLbl = function (k) { return k === '' ? 'Sin motivo' : k; };
    var motKs = MO ? Object.keys(MO.m).sort(function (a, b) { return MO.m[b] - MO.m[a]; }) : [];
    // % sobre lo mayor entre las negadas del día y las que traen motivo (al juntar archivos pueden pasar por pocas)
    var motPct = function (M, k, tot) { var b = M ? Math.max(tot || 0, M.n || 0) : 0; return b ? (M.m[k] || 0) / b * 100 : 0; };
    // códigos y preparadores por motivo (del detalle guardado por día)
    var motDet = function (M) {
      var cod = {}, prep = {};
      if (M && M.q && M.k) for (var pr in M.q) for (var sk in M.q[pr]) M.q[pr][sk].forEach(function (v, i) { if (!v) return; var k = M.k[i]; (cod[k] || (cod[k] = {}))[sk] = (cod[k][sk] || 0) + v; (prep[k] || (prep[k] = {}))[pr] = (prep[k][pr] || 0) + v; });
      return { cod: cod, prep: prep };
    };
    var MD = motDet(MO);
    var topDe = function (o, k) { var x = o[k] || {}; return Object.keys(x).sort(function (a, b) { return x[b] - x[a]; }).slice(0, k === '' ? 1 : 2).map(function (y) { return { id: y, v: x[y] }; }); };
    var F2 = function (d) { var F = src(); if (!F.FR) return null; var r = F.FR([d]); return r && r.base ? pct(r.prep, r.base) : null; };

    /* ----- notas al final: lo bueno y por mejorar (frases cortas, sin repetir las tarjetas) ----- */
    var bueno = [], mejorar = [], dS = function (d) { return DOW[dowOf(d)] + ' ' + (+d.slice(8)); };
    if (lp != null && lpAnt != null && lp > lpAnt) bueno.push(n(lp) + ' líneas preparadas, ' + n(lp - lpAnt) + ' más que el ' + dS(dN) + ' pasado.');
    if (frV != null && N.prevW && F2(N.prevW.d) != null && frV > F2(N.prevW.d) + 0.5) bueno.push('Fill rate arriba del ' + dS(N.prevW.d) + ' (' + dec(F2(N.prevW.d)) + '%).');
    if (N && N.prom != null && N.pHoy <= N.prom) bueno.push('Negados bajo el promedio de ' + N.ventana.length + ' días.');
    if (P) {
      if (cierre && P.fin < P.ini) bueno.push('El pendiente bajó ' + n(P.ini - P.fin) + ' pedidos.');
      if (P.asg && P.cobertura >= 0.5) bueno.push(n(P.asg) + ' pedidos asignados en el día.');
      if (!P.viejos) bueno.push('Nada con más de 72 h sin preparador.');
    }
    if (P && P.viejos) mejorar.push({ q: 'Asignar primero los pedidos con más de 72 h.', a: true });
    if (P && P.fin > P.ini) mejorar.push({ q: 'El pendiente subió ' + n(P.fin - P.ini) + ' pedidos: reforzar la asignación.', a: true });
    if (MO) {
      var tn = N.hoy.neg, fis = MO.m['Físico no se encuentra'] || 0, ec = MO.m['Existencia a cero'] || 0, sep = MO.m['Sin existencia ubicación picking'] || 0, sm = MO.m[''] || 0;
      var cods = function (k) { return topDe(MD.cod, k).map(function (x) { return x.id; }).join(', '); };
      if (fis && fis / tn >= 0.15) mejorar.push({ q: 'Físico no se encuentra: revisar ubicación de ' + cods('Físico no se encuentra') + '.', a: false });
      if (ec && ec / tn >= 0.15) mejorar.push({ q: 'Existencia a cero: pasar a compras ' + cods('Existencia a cero') + '.', a: false });
      if (sep >= 20) mejorar.push({ q: 'Reabastecer picking: ' + cods('Sin existencia ubicación picking') + '.', a: false });
      if (sm >= 10) mejorar.push({ q: n(sm) + ' negadas sin motivo: recordar anotarlo.', a: false });
    } else if (N && N.hoy.err && (N.prom == null || N.pHoy > N.prom)) mejorar.push({ q: 'Error en el proceso: ' + n(N.hoy.err) + ' líneas negadas con producto.', a: false });
    h.bueno = bueno.slice(0, 3); h.mejorar = mejorar.slice(0, 3);

    /* ----- titular y párrafo ----- */
    var t = [], cerroLlev = (amanecer || cierre) ? ' cerró con ' : ' lleva ';
    if (frV != null) t.push(ElDN + cerroLlev + 'fill rate de ' + dec(frV) + '%' + (lp != null ? ' y ' + n(lp) + ' líneas preparadas' : ''));
    else if (lp != null) t.push(ElDN + cerroLlev + n(lp) + ' líneas preparadas');
    else if (N) t.push(ElDN + cerroLlev + n(N.hoy.lin) + ' líneas actualizadas');
    if (P) t.push((t.length ? (amanecer ? '; hoy amanecemos con ' : '; quedan ') : (amanecer ? 'Hoy amanecemos con ' : 'Quedan ')) + n(P.sinAsig) + ' pedidos por asignar');
    h.titulo = t.join('') + (h.mejorar.length ? '; foco: ' + h.mejorar[0].q.charAt(0).toLowerCase() + h.mejorar[0].q.slice(1).replace(/\s*\(.*$/, '').replace(/[.:].*$/, '') : '');

    var lead = [];
    if (N) lead.push((amanecer ? 'Ayer: de ' : 'De ') + n(N.hoy.lin) + ' líneas actualizadas se negó el ' + dec(N.pHoy) + '% (' + n(N.hoy.neg) + '): ' + n(N.hoy.err) + ' por error en el proceso y ' + n(N.hoy.sst) + ' sin stock' +
      (frV != null ? '. Fill rate ' + dec(frV) + '% (' + n(N.fr.prep) + ' de ' + n(N.fr.base) + ' líneas)' : '') + (N.b2b.tot ? ' y B2B ' + dec(pct(N.b2b.ok, N.b2b.tot)) + '% (' + n(N.b2b.ok) + ' de ' + n(N.b2b.tot) + ' pedidos)' : '') + '.');
    if (P) lead.push((amanecer ? 'Hoy, al corte de ' + horaMin(P.lc) + ', amanecemos con ' : (cierre ? 'Al cierre quedan ' : 'Al corte de ' + horaMin(P.lc) + ' hay ')) + n(P.sinAsig) + ' pedidos por asignar' + (P.viejos ? ' (' + n(P.viejos) + ' con más de 72 h)' : '') + ', ' + n(P.enPrep) + ' en preparación' + (P.nDia ? ' y han entrado ' + n(P.nDia) + ' pedidos nuevos' : '') + '.');
    h.lead = lead.join(' ');

    /* ----- tarjetas: valor y una línea corta ----- */
    if (N) {
      h.kpis.push({ l: 'Fill rate', v: frV != null ? dec(frV) + '%' : '–', s: frPrev != null ? 'ayer ' + dec(frPrev) + '%' : (frV != null ? n(N.fr.prep) + ' de ' + n(N.fr.base) + ' líneas' : '') });
      h.kpis.push({ l: 'Negados', v: dec(N.pHoy) + '%', s: N.prom != null ? 'promedio de 10 días ' + dec(N.prom) + '%' : '' });
    }
    if (P) h.kpis.push({ l: 'Por asignar', v: n(P.sinAsig), s: P.viejos ? n(P.viejos) + ' con +72 h' : 'nada con +72 h', o: !!P.viejos });

    /* ----- sección 1: pedidos ----- */
    if (P) {
      var avance = P.asg && P.cobertura >= 0.5 ? (P.asg - (P.asgPorDia[P.hoy] || 0)) : 0;
      h.s1t = amanecer
        ? 'Amanecimos con ' + n(P.sinAsig) + ' pedidos por asignar' + (P.viejos ? ', ' + n(P.viejos) + ' con más de 72 h' : '') + ', y ' + n(P.enPrep) + ' en preparación'
        : cap(P.nDia ? (avance ? 'se avanzó con lo de días anteriores (' + n(avance) + ' pedidos asignados); de lo que cayó hoy ' : 'de lo que cayó hoy ') + (cierre ? 'se asignó' : 'va asignado') + ' el ' + pctInt(P.diaAsig, P.nDia) : 'hoy no han caído pedidos nuevos');
      var det = [];
      var dR = Object.keys(P.porDiaR).sort().reverse(), partesR = [], ant = 0;
      dR.forEach(function (d) { if (d === P.hoy) partesR.push('hoy ' + n(P.porDiaR[d].c)); else if (partesR.length < 4) partesR.push(DOW_L[dowOf(d)] + ' ' + (+d.slice(8)) + ': ' + n(P.porDiaR[d].c)); else ant += P.porDiaR[d].c; });
      if (ant) partesR.push('anteriores ' + n(ant));
      det.push('<b>Por asignar según día de llegada:</b> ' + (partesR.join(' · ') || 'ninguno') + '. En preparación: ' + n(P.enPrep) + '.');
      if (P.asg && P.cobertura >= 0.5) {
        var dA = Object.keys(P.asgPorDia).sort(function (x, y) { return P.asgPorDia[y] - P.asgPorDia[x]; }).slice(0, 5);
        det.push('<b>Lo que se asignó en el día:</b> ' + n(P.asg) + ' pedidos' + (P.asg - P.asgMan ? ' (' + n(P.asgMan) + ' en la mañana y ' + n(P.asg - P.asgMan) + ' en la tarde)' : '') + ': ' + dA.map(function (d) { return n(P.asgPorDia[d]) + ' ' + (d === P.hoy ? 'de hoy' : 'del ' + DOW_L[dowOf(d)]); }).join(', ') + '.' + (P.espera != null ? ' Tiempo hasta tener preparador: ' + Math.round(P.espera) + ' h (mediana).' : ''));
      }
      var mots = Object.keys(P.porMot).sort(function (x, y) { return P.porMot[y] - P.porMot[x]; });
      var NOM = { exi: 'Existencia', b2b: 'B2B', rot: 'Rotación', otr: 'Otros' };
      if (P.nDia) det.push('<b>Lo que entró hoy:</b> ' + mots.map(function (m, i) { return (NOM[m] || m) + ' ' + n(P.porMot[m]) + (i === 0 ? ' (' + pctInt(P.porMot[m], P.nDia) + ')' : ''); }).join(' · ') + ' · Nejapa ' + pctInt(P.nej, P.nDia) + ' · ' + n(P.skDia) + ' SKUs.');
      h.s1det = det;
    }

    /* ----- sección 2: negados ----- */
    if (N) {
      var d2 = N.hoy.d;
      h.s2t = cap((amanecer ? 'ayer ' : 'el ') + DOW_L[dowOf(d2)]) + (frV != null ? ((amanecer || cierre) ? ' cerró con' : ' lleva') + ' fill rate de ' + dec(frV) + '%' : ': ' + dec(100 - N.pHoy) + '% de las líneas sin negado') + (N.prom != null && N.pHoy <= N.prom ? ', negados por debajo del promedio' : '') + (motKs.length ? '; lo que más se negó: ' + lista(motKs.slice(0, 2).map(function (k) { return motLbl(k) + ' (' + pctInt(MO.m[k], N.hoy.neg) + ')'; })) : '; de lo negado, ' + pctInt(N.hoy.err, N.hoy.neg) + ' fue por error en el proceso');
      h.n = N;
    }

    /* ----- plan de mejora ----- */
    var sig = (function () { var d = addD(dia, 1); if (dowOf(d) === 0) d = addD(d, 1); return cap(DOW[dowOf(d)]) + ' ' + (+d.slice(8)); })();
    h.acciones = h.mejorar.map(function (m, i) { return { q: m.q, c: m.a ? (cierre ? sig + ', primera ola' : 'Hoy, antes del cierre') : (i < 3 ? (cierre ? sig : 'Hoy') : 'Esta semana'), a: m.a }; });
    if (!h.acciones.length) h.acciones.push({ q: 'Mantener el ritmo: pendiente, pedidos de más de 72 h y negados dentro de lo normal.', c: '–', a: true });
    void b2b;

    if (amanecer) momento = 'al amanecer (' + corteTxt + ')';
    // lectura de motivos: qué significa cada uno y cómo va contra el mismo día de la semana pasada
    h.motLect = MO ? motKs.slice(0, 4).map(function (k) {
      var p = motPct(MO, k, N.hoy.neg), pw = MOW && N.prevW ? motPct(MOW, k, N.prevW.neg) : null, d = pw != null ? p - pw : null;
      return '<b>' + esc(motLbl(k)) + '</b> ' + Math.round(p) + '%: ' + esc(MOT_SIG[k] || '') + (d != null && Math.abs(d) >= 2 ? ' (' + (d > 0 ? 'sube ' : 'baja ') + Math.round(Math.abs(d)) + ' pts contra ' + sem(N.prevW.d) + ')' : '');
    }) : null;
    h.meta = { dia: dia, cierre: cierre, momento: momento, corteTxt: corteTxt, negHora: negHora, P: P, N: N, amanecer: amanecer };
    return h;
  }

  /* ---------------- HTML del reporte ---------------- */
  var CSS = "@page{size:8.5in 11in;margin:0}*{box-sizing:border-box;margin:0;padding:0}" +
    "body{background:#fff;color:#1A1A1A;font-family:'IBM Plex Sans',sans-serif;font-size:7.6pt;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-variant-numeric:tabular-nums}" +
    ".page{width:8.5in;min-height:11in;padding:.36in .5in .3in;margin:0 auto;position:relative;background:#fff}" +
    ".hd{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:8px;border-bottom:3px solid #D7262B}.hd img{height:36px}" +
    ".hd .r{text-align:right;font-size:6.6pt;color:#6D6E70;line-height:1.6}.hd .r b{display:block;font-weight:600;color:#1A1A1A;font-size:10pt}" +
    ".kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0 4px}.k{border:1px solid #E3E6EA;border-radius:6px;padding:8px 10px}" +
    ".k .l{font-size:6.4pt;color:#6D6E70}.k .v{font-weight:600;font-size:17pt;line-height:1.15;margin:2px 0 1px}.k .v.o{color:#C7453A}.k .s{font-size:6.4pt;color:#6D6E70}" +
    ".sec{margin-top:12px}h2{font-weight:600;font-size:9.5pt;margin:0 0 6px;padding-bottom:3px;border-bottom:1px solid #E3E6EA}h2 span{font-weight:400;color:#6D6E70;font-size:7pt;margin-left:6px}" +
    ".two{display:grid;grid-template-columns:1.15fr 1fr;gap:18px}" +
    ".lg{font-size:6pt;color:#6D6E70;display:flex;gap:12px;margin-bottom:2px}.lg i{display:inline-block;width:7px;height:7px;margin-right:4px;vertical-align:-1px;border-radius:1px}.lg i.ln{height:2px;vertical-align:2px;width:10px}" +
    "svg .ax{font-family:'IBM Plex Sans',Arial,sans-serif;font-size:6px;fill:#6D6E70}svg .ax.pk{fill:#1A1A1A;font-weight:600}svg .lab{font-family:'IBM Plex Sans',Arial,sans-serif;font-size:6.2px;font-weight:600;fill:#3D434B}svg .lab.hl{fill:#1A1A1A}" +
    ".nums{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px}.nums>div{background:#F5F6F8;border-radius:5px;padding:5px 8px}.nums .t{font-size:6pt;color:#6D6E70}.nums .v{font-weight:600;font-size:12pt;line-height:1.15}.nums .now .v{color:#C7453A}" +
    "table.mot{width:100%;border-collapse:collapse;font-size:6.6pt}table.mot th{font-weight:600;font-size:6pt;color:#6D6E70;text-align:left;border-bottom:1px solid #C9CED5;padding:2px 4px}" +
    "table.mot th.r,table.mot td.r{text-align:right}table.mot td{white-space:nowrap;padding:2.6px 4px;border-bottom:1px solid #EEF0F2}table.mot tr.sub td{color:#6D6E70}table.mot tr.tot td{font-weight:600;border-bottom:0;border-top:1px solid #C9CED5}" +
    "table.mot td.desc{white-space:normal}" +
    "table.hm{width:100%;border-collapse:collapse;font-size:6.6pt}table.hm th{font-weight:600;font-size:6pt;color:#1E3A6E;text-align:left;border-bottom:1px solid #C9CED5;padding:3px 4px}table.hm th.r,table.hm td.r{text-align:right}table.hm th.hoy{color:#1A1A1A}" +
    "table.hm td{padding:3px 4px;border-bottom:1px solid #fff;white-space:nowrap}table.hm td span{opacity:.75;font-size:5.8pt}table.hm tr.tot td{color:#1E3A6E;font-weight:600;border-top:1px solid #C9CED5}" +
    ".notas{margin-top:12px;border:1px solid #E3E6EA;border-radius:6px;padding:7px 12px;display:grid;grid-template-columns:1fr 1fr;gap:16px}.notas .t{font-weight:600;font-size:7pt;margin-bottom:2px}.notas .t i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px}.notas ul{padding-left:12px}.notas li{font-size:6.8pt;line-height:1.45;color:#3D434B}" +
    ".foot{margin-top:8px;font-size:5.8pt;color:#9AA1AB;line-height:1.5}" +
    "@media screen{body{padding:56px 0 24px;background:#E9ECEF}.page{box-shadow:0 4px 18px rgba(0,0,0,.12)}" +
    ".tb{position:fixed;top:0;left:0;right:0;z-index:5;display:flex;gap:8px;align-items:center;justify-content:center;padding:10px;background:#1A1A1A;color:#fff;font:13px 'IBM Plex Sans',sans-serif}" +
    ".tb button{font:inherit;font-weight:600;padding:7px 14px;border-radius:5px;border:0;cursor:pointer;background:#D7262B;color:#fff}.tb button.s{background:#fff;color:#1A1A1A}.tb span{opacity:.75;font-size:12px}}" +
    "@media print{.tb{display:none!important}body{padding:0;background:#fff}.page{box-shadow:none;height:11in;overflow:hidden}}";

  function html(h, logo) {
    var M = h.meta, P = M.P, N = M.N, out = [];
    var titulo = 'Reporte ejecutivo · CD Nejapa · ' + lblFecha(M.dia) + ' ' + M.dia.slice(0, 4) + ' · ' + (M.cierre ? 'Cierre' : M.corteTxt);
    out.push('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc('Reporte_ejecutivo_' + M.dia + (M.cierre ? '_cierre' : '_' + M.corteTxt.replace(/[^0-9apm]/g, ''))) + '</title>');
    out.push('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
    out.push('<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&display=swap" rel="stylesheet">');
    out.push('<style>' + CSS + '</style></head><body>');
    out.push('<div class="tb"><button type="button" id="pdf">Descargar PDF</button><button type="button" class="s" id="cerrar">Cerrar</button><span>En la ventana de impresión elige «Guardar como PDF».</span></div>');
    out.push('<section class="page">');
    out.push('<div class="hd">' + (logo ? '<img src="' + logo + '" alt="Vidri">' : '<b>VIDRI</b>') + '<div class="r"><b>Reporte ejecutivo · CD Nejapa</b>' + esc(lblLargo(M.dia)) + ' · ' + esc(M.momento) + '</div></div>');
    out.push('<div class="kpis">' + h.kpis.map(function (k) { return '<div class="k"><div class="l">' + esc(k.l) + '</div><div class="v' + (k.o ? ' o' : '') + '">' + esc(k.v) + '</div><div class="s">' + esc(k.s) + '</div></div>'; }).join('') + '</div>');
    if (P) {
      var dR = Object.keys(P.porDiaR).sort().reverse(), filasR = [], ant = 0;
      dR.forEach(function (d) { if (filasR.length < 4) filasR.push([d === P.hoy ? 'Hoy' : cap(DOW[dowOf(d)]) + ' ' + (+d.slice(8)), P.porDiaR[d].c, P.porDiaR[d].sk]); else ant += P.porDiaR[d].c; });
      out.push('<div class="sec"><h2>Pedidos CD<span>por día y motivo · al corte de ' + esc(M.corteTxt) + ' · ' + n(P.enPrep) + ' en preparación</span></h2><div class="two"><div>');
      var GP = grafPedMot(P);
      out.push('<div class="lg">' + GP.ks.map(function (m) { return '<span><i style="background:' + m[2] + '"></i>' + m[1] + '</span>'; }).join('') + '</div>');
      out.push(GP.svg + '</div><div>');
      out.push('<table class="mot"><thead><tr><th>POR ASIGNAR · DÍA DE LLEGADA</th><th class="r">PEDIDOS</th><th class="r">SKUS</th></tr></thead><tbody>' +
        filasR.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td class="r">' + n(r[1]) + '</td><td class="r">' + n(r[2]) + '</td></tr>'; }).join('') +
        (ant ? '<tr class="sub"><td>Anteriores</td><td class="r">' + n(ant) + '</td><td class="r"></td></tr>' : '') +
        '</tbody></table>');
      out.push('</div></div></div>');
    }
    if (N) {
      var H = N.hoy, pW = N.prevW;
      var MAPA = mapaMotivos(H.d);
      out.push('<div class="sec"><h2>Negados por motivo<span>últimos 7 días · % de las negadas de cada día (líneas)</span></h2>');
      if (MAPA) out.push(MAPA);
      else {
        out.push('<div class="lg"><span><i style="background:' + C.RED + '"></i>% de líneas negadas</span>' + (N.prom != null ? '<span><i class="ln" style="background:' + C.INK + '"></i>Promedio ' + dec(N.prom) + '%</span>' : '') + '</div>');
        out.push(grafNegados(N.serie, N.prom));
      }
      if (N.top.length) {
        var conMp = N.top.some(function (x) { return x.mp; });
        out.push('<h2 style="margin-top:10px">Códigos más negados<span>' + esc(cap(DOW_L[dowOf(H.d)]) + ' ' + (+H.d.slice(8))) + ' · veces negado y su motivo principal</span></h2><table class="mot"><thead><tr><th>CÓDIGO</th><th>DESCRIPCIÓN</th><th class="r">VECES</th>' + (conMp ? '<th>MOTIVO PRINCIPAL</th>' : '') + '</tr></thead><tbody>' +
          N.top.slice(0, 5).map(function (x) { return '<tr><td>' + esc(x.sku) + '</td><td class="desc">' + esc(x.desc) + '</td><td class="r"><b>' + n(x.t) + '</b></td>' + (conMp ? '<td>' + esc(String(x.mp || '–').replace(/\s*\(.*$/, '')) + '</td>' : '') + '</tr>'; }).join('') + '</tbody></table>');
      }
      out.push('</div>');
    }
    if (h.bueno.length || h.mejorar.length) {
      out.push('<div class="notas"><div><div class="t"><i style="background:' + C.GREEN + '"></i>Lo bueno</div><ul>' + (h.bueno.length ? h.bueno.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') : '<li>–</li>') + '</ul></div>' +
        '<div><div class="t"><i style="background:' + C.ORANGE + '"></i>Por mejorar</div><ul>' + (h.mejorar.length ? h.mejorar.map(function (x) { return '<li>' + esc(x.q) + '</li>'; }).join('') : '<li>Mantener el ritmo.</li>') + '</ul></div></div>');
    }
    var foot = ['Fill rate = líneas preparadas ÷ (preparadas + negadas), sin pedidos en cero (todas sus líneas negadas)'];
    if (P && N) foot.push(M.amanecer ? 'Negados: día completo de ayer' : 'Negados a la última carga' + (M.negHora ? ' (' + M.negHora + ')' : ''));
    foot.push('Generado por el Radar');
    out.push('<div class="foot">' + esc(foot.join(' · ')) + '</div></section>');
    out.push('<script>document.getElementById("pdf").onclick=function(){window.print()};document.getElementById("cerrar").onclick=function(){try{parent.__cerrarReporte()}catch(e){window.close()}};<\/script>');
    // si el contenido no cabe en la hoja carta, se achica un poco todo para que nada quede cortado
    out.push('<script>(function(){var p=document.querySelector(".page"),f=p&&p.querySelector(".foot");if(!f)return;var alto=11*96,usado=f.getBoundingClientRect().bottom-p.getBoundingClientRect().top+0.3*96;if(usado>alto)p.style.zoom=(alto/usado).toFixed(3);})();<\/script>');
    out.push('</body></html>');
    return { html: out.join(''), titulo: titulo };
  }

  /* ---------------- ventana del reporte ---------------- */
  function mostrar(doc) {
    var prev = document.getElementById('rep-ov'); if (prev) prev.remove();
    var ov = document.createElement('div'); ov.id = 'rep-ov';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(31,35,40,.55);display:flex';
    var fr = document.createElement('iframe'); fr.title = doc.titulo;
    fr.style.cssText = 'flex:1;border:0;background:#E9ECEF';
    ov.appendChild(fr); document.body.appendChild(ov);
    window.__cerrarReporte = function () { ov.remove(); document.body.style.overflow = ''; };
    document.body.style.overflow = 'hidden';
    fr.srcdoc = doc.html;
  }

  async function generar(btn) {
    var t0 = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Armando…'; }
    try {
      if (typeof DATA_LOADED !== 'undefined' && !DATA_LOADED) throw new Error('Espera a que terminen de cargar los datos.');
      try { if (typeof pedEnsure === 'function') await pedEnsure(); } catch (e) { }
      var h = armar();
      var logoEl = document.querySelector('.vx-logo');
      mostrar(html(h, logoEl ? logoEl.getAttribute('src') : ''));
    } catch (e) {
      console.error(e);
      if (AVISO) AVISO('No se pudo armar el reporte: ' + ((e && e.message) || e));
      else if (typeof showStatus === 'function') showStatus('err', 'No se pudo armar el reporte: ' + ((e && e.message) || e), 15000);
      else alert('No se pudo armar el reporte: ' + ((e && e.message) || e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = t0; }
    }
  }

  function ponerBotones() {
    document.querySelectorAll('.vxh .acts').forEach(function (g) {
      if (g.querySelector('.rep-btn')) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'lnk rep-btn'; b.textContent = 'Reporte ejecutivo';
      b.title = 'Arma el reporte ejecutivo (pedidos y negados) con los datos cargados y lo descarga en PDF';
      b.addEventListener('click', function () { generar(b); });
      var antes = g.querySelector('.cta'); g.insertBefore(b, antes || null);
    });
  }

  window.VidriReporte = { usarFuente: function (fn, aviso) { FUENTE = fn; AVISO = aviso || null; }, armar: armar, html: html, generar: generar, ponerBotones: ponerBotones, _pedidos: datosPedidos, _negados: datosNegados };
})();
