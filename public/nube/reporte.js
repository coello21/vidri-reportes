/* =====================================================================
   Reporte ejecutivo automático (Pedidos CD + Negados)
   Usa los datos que ya están cargados en el Radar y arma el reporte con
   frases fijas (plantillas), sin depender de IA. Se descarga como PDF
   con el diálogo de impresión del navegador ("Guardar como PDF").
   ===================================================================== */
(function () {
  'use strict';

  /* ---------------- formato ---------------- */
  var C = { BLUE: '#3E6FB0', GREEN: '#4E9A55', ORANGE: '#E07B2E', INK: '#26241F', LINE: '#D8CFBE' };
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

  /* ---------------- datos de pedidos ---------------- */
  function datosPedidos() {
    if (typeof PED === 'undefined' || !PED.rows || !PED.rows.size) return null;
    var lc = pedLastCorte(); if (!lc) return null;
    var all = []; PED.rows.forEach(function (x) { if (x[3] === 'A' || x[8] >= lc) all.push(x); });
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

    return {
      lc: lc, hoy: hoy, ini: ini, ent: ent, ter: ter, fin: fin, terMan: terMan, terTar: terTar, prev: prev,
      sinAsig: R.length, skR: skR, enPrep: P.length, viejos: viejos.length, skV: skV, porDiaR: porDiaR, porDiaV: porDiaV,
      asg: asg.length, asgMan: asgMan, asgPorDia: asgPorDia, espera: espera, cobertura: cobertura,
      nDia: nDia, diaAsig: diaAsig, diaTerm: diaTerm, diaPend: diaPend, porMot: porMot, nej: nej, skDia: skDia, serie: serie,
    };
  }

  /* ---------------- datos de negados ---------------- */
  function datosNegados(diaPreferido) {
    if (typeof HISTORY === 'undefined') return null;
    var dias = Object.keys(HISTORY).filter(function (d) { return HISTORY[d] && HISTORY[d].meta && HISTORY[d].meta.totalFinal; }).sort();
    if (!dias.length) return null;
    var d = (diaPreferido && HISTORY[diaPreferido] && dias.indexOf(diaPreferido) >= 0) ? diaPreferido : dias[dias.length - 1];
    var info = function (x) {
      var r = HISTORY[x], m = r.meta || {}, b = r.bucket || {};
      return { d: x, lin: m.totalFinal || 0, neg: m.totalNegados || 0, err: b.positivo || 0, sst: (b.cero || 0) + (b.negativo || 0), cero: b.cero || 0, negat: b.negativo || 0, prep: m.totalPreparados || 0, exactas: m.exactas || 0, v: r.v };
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
    top = top.slice(0, 5).map(function (x) { var s = (STORE.skus || {})[x.sku]; x.desc = s && s[0] ? s[0] : ''; return x; });

    var b2b = typeof b2bForDates === 'function' ? b2bForDates([d]) : { tot: 0, ok: 0 };

    return { hoy: hoy, parcial: parcial, prevW: prevW, prom: prom, ventana: ventana, pHoy: pHoy, desde: desde, tipo: tipo, serie: serie, negMan: negMan, negTar: negTar, tiendas: tiendas, top: top, b2b: b2b };
  }

  /* ---------------- gráficos ---------------- */
  function niceMax(v, paso) { return Math.max(paso, Math.ceil(v / paso) * paso); }
  function grafPedidos(s) {
    var W = 430, H = 128, l = 34, r = 10, t = 12, b = 28, iw = W - l - r, ih = H - t - b, N = s.length;
    var top = Math.max.apply(null, s.map(function (x) { return Math.max(x.ent, x.ter, x.fin); }).concat([1]));
    var paso = top > 4000 ? 2000 : top > 2000 ? 1000 : top > 800 ? 500 : 100, mx = niceMax(top, paso);
    var slot = iw / N, bw = slot * 0.6, X = function (i) { return l + slot * i + slot / 2; }, Y = function (v) { return t + ih - v / mx * ih; }, g = '';
    for (var v = 0; v <= mx; v += paso) { var y = Y(v); g += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + C.LINE + '" stroke-width=".5"/><text x="' + (l - 5) + '" y="' + (y + 2.5).toFixed(1) + '" class="ax" text-anchor="end">' + n(v) + '</text>'; }
    s.forEach(function (x, i) {
      g += '<rect x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + Y(x.ent).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (x.ent / mx * ih).toFixed(1) + '" fill="' + C.BLUE + '" opacity="' + (x.parcial ? .55 : 1) + '"/>';
      if (i % 2 === (N - 1) % 2) { var w = DOW[dowOf(x.d)], pk = (i === N - 1) ? ' pk' : ''; g += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 17) + '" class="ax' + pk + '" text-anchor="middle">' + w + '</text><text x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" class="ax' + pk + '" text-anchor="middle">' + (+x.d.slice(8)) + '/' + (+x.d.slice(5, 7)) + '</text>'; }
    });
    var pts = function (k) { return s.map(function (x, i) { return X(i).toFixed(1) + ',' + Y(Math.max(0, x[k])).toFixed(1); }).join(' '); };
    g += '<polyline points="' + pts('ter') + '" fill="none" stroke="' + C.GREEN + '" stroke-width="1.6"/>';
    s.forEach(function (x, i) { g += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(Math.max(0, x.ter)).toFixed(1) + '" r="1.6" fill="' + C.GREEN + '"/>'; });
    g += '<polyline points="' + pts('fin') + '" fill="none" stroke="' + C.ORANGE + '" stroke-width="1.4" stroke-dasharray="4 3"/>';
    var last = s[N - 1]; g += '<text x="' + X(N - 1).toFixed(1) + '" y="' + (Y(last.fin) - 5).toFixed(1) + '" class="lab" fill="' + C.ORANGE + '" text-anchor="middle">' + n(last.fin) + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + g + '</svg>';
  }
  function grafNegados(s, prom) {
    var W = 430, H = 118, l = 30, r = 8, t = 12, b = 16, iw = W - l - r, ih = H - t - b, N = s.length;
    var top = Math.max.apply(null, s.map(function (x) { return pct(x.neg, x.lin); }).concat([prom || 0, 10]));
    var mx = niceMax(top + 3, 10), slot = iw / N, bw = slot * 0.62, g = '';
    var X = function (i) { return l + slot * i + slot / 2; }, Y = function (v) { return t + ih - v / mx * ih; };
    for (var v = 0; v <= mx; v += 10) { var y = Y(v); g += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + C.LINE + '" stroke-width=".5"/><text x="' + (l - 4) + '" y="' + (y + 2.5).toFixed(1) + '" class="ax" text-anchor="end">' + v + '%</text>'; }
    s.forEach(function (x, i) {
      var pe = pct(x.err, x.lin), ps = pct(x.sst, x.lin), last = i === N - 1;
      g += '<rect x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + Y(pe).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (pe / mx * ih).toFixed(1) + '" fill="' + C.ORANGE + '"/>';
      g += '<rect x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + Y(pe + ps).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (ps / mx * ih).toFixed(1) + '" fill="' + C.BLUE + '"/>';
      g += '<text x="' + X(i).toFixed(1) + '" y="' + (Y(pct(x.neg, x.lin)) - 3).toFixed(1) + '" class="lab' + (last ? ' hl' : '') + '" text-anchor="middle">' + dec(pct(x.neg, x.lin)) + '%</text>';
      g += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 5) + '" class="ax' + (last ? ' pk' : '') + '" text-anchor="middle">' + lblCorto(x.d) + '</text>';
    });
    if (prom != null) { var yp = Y(prom); g += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + yp.toFixed(1) + '" y2="' + yp.toFixed(1) + '" stroke="' + C.INK + '" stroke-width="1" stroke-dasharray="4 3"/>'; }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + g + '</svg>';
  }

  /* ---------------- textos (plantillas) ---------------- */
  function armar() {
    var P = datosPedidos();
    var N = datosNegados(P ? P.hoy : null);
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
    var lp = revN[dia] != null ? revN[dia] : null;                       // líneas preparadas (entregadas al revisador)
    var diaAnt = addD(dia, -7), lpAnt = revN[diaAnt] != null ? revN[diaAnt] : null;
    var lAct = N && N.hoy.d === dia ? N.hoy.lin : null;                 // líneas actualizadas (estado A)
    var ex = N && N.hoy.prep ? pct(N.hoy.exactas, N.hoy.prep) : null, exAnt = N && N.prevW && N.prevW.prep ? pct(N.prevW.exactas, N.prevW.prep) : null;
    var b2b = N && N.b2b.tot ? pct(N.b2b.ok, N.b2b.tot) : null;
    var sem = function (d) { return 'el ' + DOW_L[dowOf(d)] + ' pasado'; };

    /* ----- lo bueno y lo que hay que mejorar (reglas fijas, en positivo) ----- */
    var bueno = [], mejorar = [];
    if (lp != null) bueno.push(n(lp) + ' líneas preparadas (entregadas al revisador)' + (lpAnt != null && lp > lpAnt ? ', ' + n(lp - lpAnt) + ' más que ' + sem(dia) : '') + (lAct != null ? '; ' + n(lAct) + ' líneas actualizadas' : '') + '.');
    if (P) {
      if (P.ter) bueno.push('Se terminaron ' + n(P.ter) + ' pedidos' + (P.prev && P.ter > P.prev.ter ? ', ' + n(P.ter - P.prev.ter) + ' más que ' + sem(P.prev.dia) + ' a la misma hora' : '') + '.');
      if (P.fin < P.ini) bueno.push('El pendiente bajó en ' + n(P.ini - P.fin) + ' pedidos durante el día.');
      if (P.asg && P.cobertura >= 0.5) { var viejosAsg = P.asg - (P.asgPorDia[P.hoy] || 0); bueno.push('Se asignaron ' + n(P.asg) + ' pedidos' + (viejosAsg ? ', ' + n(viejosAsg) + ' de días anteriores' : '') + '.'); }
      if (!P.viejos) bueno.push('Todo lo que llevaba más de 72 h ya tiene preparador.');
    }
    if (N) {
      if (N.prom != null && N.pHoy <= N.prom) bueno.push('Negados en ' + dec(N.pHoy) + '%, por debajo del promedio de los ' + N.ventana.length + ' días anteriores (' + dec(N.prom) + '%).');
      if (ex != null && ex >= 99.5) bueno.push('Exactitud de picking en meta: ' + dec(ex) + '%.');
      else if (ex != null && exAnt != null && ex > exAnt + 0.5) bueno.push('La exactitud de picking subió a ' + dec(ex) + '% (' + dec(exAnt) + '% ' + sem(N.prevW.d) + ').');
      if (N.prevW && N.hoy.sst < N.prevW.sst && N.hoy.neg) bueno.push('Menos negadas sin stock que ' + sem(N.prevW.d) + ' (' + n(N.hoy.sst) + ' contra ' + n(N.prevW.sst) + ').');
    }
    if (P && P.viejos) {
      var vdM = Object.keys(P.porDiaV).sort(function (x, y) { return P.porDiaV[y].c - P.porDiaV[x].c; });
      mejorar.push({ q: 'Asignar primero los ' + n(P.viejos) + ' pedidos con más de 72 h sin preparador (' + n(P.porDiaV[vdM[0]].c) + ' del ' + DOW_L[dowOf(vdM[0])] + '; ' + n(P.skV) + ' SKUs).', a: true });
    }
    if (P && P.fin > P.ini) mejorar.push({ q: 'Recuperar el ritmo de asignación: plan con maestros de olas para los ' + n(P.sinAsig) + ' pedidos por asignar (' + n(P.skR) + ' SKUs).', a: true });
    if (N && N.hoy.err && (N.prom == null || N.pHoy > N.prom)) mejorar.push({ q: 'Bajar el error en el proceso: ' + n(N.hoy.err) + ' líneas se negaron con stock en sistema. Revisar por zona y preparador' + (N.prom != null ? ' para volver al promedio de ' + dec(N.prom) + '%' : '') + '.', a: false });
    if (N && N.prevW && N.hoy.sst > N.prevW.sst * 1.25 && N.hoy.sst >= 50) mejorar.push({ q: 'Coordinar con inventario las ' + n(N.hoy.sst) + ' líneas negadas sin stock.', a: false });
    if (ex != null && ex < 99.5) mejorar.push({ q: 'Llevar la exactitud de picking de ' + dec(ex) + '% hacia la meta de 99,5%: ' + n(N.hoy.prep - N.hoy.exactas) + ' líneas se mandaron incompletas.', a: false });
    if (N && N.tiendas.length && N.hoy.neg && N.tiendas[0].neg / N.hoy.neg >= 0.12) mejorar.push({ q: 'Revisar con ' + nombre(N.tiendas[0].s) + ' sus ' + n(N.tiendas[0].neg) + ' líneas negadas (' + pctInt(N.tiendas[0].neg, N.hoy.neg) + ' del día).', a: false });
    if (!bueno.length) bueno.push('Se cargaron los datos del día.');
    h.bueno = bueno; h.mejorar = mejorar.slice(0, 5);

    /* ----- titular y párrafo ----- */
    var t = [];
    if (lp != null) t.push(ElDia + (cierre ? ' cerró con ' : ' lleva ') + n(lp) + ' líneas preparadas');
    if (P && P.ter) t.push((t.length ? '' : ElDia + ' ') + (t.length ? 'y ' : (cierre ? 'cerró con ' : 'lleva ')) + n(P.ter) + ' pedidos terminados');
    if (!t.length && N) t.push(ElDia + (cierre ? ' cerró con ' : ' lleva ') + n(N.hoy.lin) + ' líneas actualizadas');
    h.titulo = t.join(' ') + (h.mejorar.length ? '; foco: ' + h.mejorar[0].q.charAt(0).toLowerCase() + h.mejorar[0].q.slice(1).replace(/\s*\(.*$/, '').replace(/[.:].*$/, '') : '');

    var lead = [];
    if (P) {
      lead.push('Entraron ' + n(P.ent) + ' pedidos y se terminaron ' + n(P.ter) + (P.terTar ? ' (' + n(P.terMan) + ' en la mañana y ' + n(P.terTar) + ' en la tarde)' : '') + '; ' + (cierre ? 'quedan ' : 'van ') + n(P.fin) + ' por terminar.');
      if (P.prev) lead.push('A la misma hora ' + sem(P.prev.dia) + ' se habían terminado ' + n(P.prev.ter) + '.');
    }
    if (N) lead.push('De ' + n(N.hoy.lin) + ' líneas actualizadas, el ' + dec(100 - N.pHoy) + '% se preparó sin negado' + (N.prom != null ? ' (promedio de los ' + N.ventana.length + ' días anteriores: ' + dec(100 - N.prom) + '%)' : '') + '.');
    h.lead = lead.join(' ');

    /* ----- tarjetas ----- */
    if (lp != null) h.kpis.push({ l: 'Líneas preparadas', v: n(lp), o: false, s: (lAct != null ? n(lAct) + ' líneas actualizadas' : 'entregadas al revisador') + (lpAnt != null ? ' · ' + sem(dia) + ': ' + n(lpAnt) : '') });
    if (P) h.kpis.push({ l: 'Pedidos terminados', v: n(P.ter), o: false, s: 'entraron ' + n(P.ent) + ' · ' + (cierre ? 'quedan ' : 'van ') + n(P.fin) + ' por terminar · ' + n(P.sinAsig) + ' por asignar' });
    if (N) {
      h.kpis.push({ l: 'Negados del día', v: dec(N.pHoy) + '%', o: false, s: n(N.hoy.neg) + ' de ' + n(N.hoy.lin) + ' líneas · ' + pctInt(N.hoy.err, N.hoy.neg) + ' por error en el proceso · ' + pctInt(N.hoy.sst, N.hoy.neg) + ' sin stock' });
      h.kpis.push({ l: 'Exactitud de picking', v: ex != null ? dec(ex) + '%' : '–', o: false, s: n(N.hoy.exactas) + ' de ' + n(N.hoy.prep) + ' líneas completas · meta 99,5%' });
    }
    if (h.kpis.length < 4 && P) h.kpis.push({ l: 'Por asignar con más de 72 h', v: n(P.viejos), o: false, s: P.viejos ? n(P.skV) + ' SKUs' : 'todo tiene preparador' });

    /* ----- sección 1: pedidos ----- */
    if (P) {
      var avance = P.asg && P.cobertura >= 0.5 ? (P.asg - (P.asgPorDia[P.hoy] || 0)) : 0;
      h.s1t = P.nDia ? (avance ? 'Se avanzó con lo de días anteriores (' + n(avance) + ' pedidos asignados); de lo que cayó hoy ' : 'De lo que cayó hoy ') + (cierre ? 'se asignó' : 'va asignado') + ' el ' + pctInt(P.diaAsig, P.nDia) + ' y se terminó el ' + pctInt(P.diaTerm, P.nDia) : 'Hoy no han caído pedidos nuevos';
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
      h.s2t = cap('el ' + DOW_L[dowOf(d2)]) + ': ' + dec(100 - N.pHoy) + '% de las líneas se preparó sin negado' + (N.prom != null && N.pHoy <= N.prom ? ', mejor que el promedio' : '') + '; de lo negado, ' + pctInt(N.hoy.err, N.hoy.neg) + ' fue por error en el proceso';
      h.n = N;
    }

    /* ----- plan de mejora ----- */
    var sig = (function () { var d = addD(dia, 1); if (dowOf(d) === 0) d = addD(d, 1); return cap(DOW[dowOf(d)]) + ' ' + (+d.slice(8)); })();
    h.acciones = h.mejorar.map(function (m, i) { return { q: m.q, c: m.a ? (cierre ? sig + ', primera ola' : 'Hoy, antes del cierre') : (i < 3 ? (cierre ? sig : 'Hoy') : 'Esta semana'), a: m.a }; });
    if (!h.acciones.length) h.acciones.push({ q: 'Mantener el ritmo: pendiente, pedidos de más de 72 h y negados dentro de lo normal.', c: '–', a: true });
    void b2b;

    h.meta = { dia: dia, cierre: cierre, momento: momento, corteTxt: corteTxt, negHora: negHora, P: P, N: N };
    return h;
  }

  /* ---------------- HTML del reporte ---------------- */
  var CSS = "@page{size:8.5in 11in;margin:0}*{box-sizing:border-box;margin:0;padding:0}" +
    "body{background:#EEE7D9;color:#26241F;font-family:'IBM Plex Sans',sans-serif;font-size:7.6pt;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    ".page{width:8.5in;min-height:11in;padding:.32in .5in .3in;margin:0 auto;position:relative;background:#EEE7D9}" +
    ".hd{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:7px;border-bottom:3px solid #D7262B}.hd img{height:36px}" +
    ".hd .r{text-align:right;font-family:'IBM Plex Mono';font-size:6.1pt;letter-spacing:.8px;color:#5c564b;line-height:1.7;text-transform:uppercase}.hd .r b{font-weight:500;color:#26241F;font-size:6.6pt}" +
    ".eb{font-family:'IBM Plex Mono';font-size:5.6pt;letter-spacing:1.3px;color:#6F685C;text-transform:uppercase;margin-top:9px}" +
    "h1{font-family:'Newsreader',serif;font-weight:600;font-size:15pt;line-height:1.18;margin:3px 0 6px;max-width:6.6in}" +
    ".lead{font-size:7.2pt;color:#3a362f;max-width:7.2in}" +
    ".kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:8px 0 9px}.k{border:1px solid #D8CFBE;background:#F5EFE3;border-radius:5px;padding:7px 10px 8px}" +
    ".k .l{font-family:'IBM Plex Mono';font-size:5.4pt;letter-spacing:1.1px;color:#6F685C;text-transform:uppercase}.k .v{font-family:'Newsreader',serif;font-size:17pt;line-height:1.15;margin:1px 0 2px}.k .v.o{color:#E07B2E}.k .s{font-size:6.3pt;color:#4d483f;line-height:1.35}" +
    ".sec{border-top:1.6px solid #26241F;padding-top:5px;margin-top:6px}.sec .eb{margin-top:0;color:#E07B2E}" +
    "h2{font-family:'Newsreader',serif;font-weight:600;font-size:10.6pt;line-height:1.2;margin:1px 0 6px}" +
    ".two{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:6px}.cap{font-size:6.4pt;color:#5c564b;margin-bottom:3px}" +
    ".lg{font-family:'IBM Plex Mono';font-size:5.5pt;color:#5c564b;display:flex;gap:10px;margin-bottom:2px}.lg i{display:inline-block;width:7px;height:7px;margin-right:3px;vertical-align:-1px}.lg i.ln{height:2px;vertical-align:2px;width:10px}" +
    "svg .ax{font-family:'IBM Plex Mono';font-size:6px;fill:#6F685C}svg .ax.pk{fill:#E07B2E}svg .lab{font-family:'IBM Plex Mono';font-size:6.2px;font-weight:500;fill:#4d483f}svg .lab.hl{fill:#E07B2E}" +
    ".flow{display:flex;align-items:center;gap:5px;margin-bottom:7px}.flow .b{border:1px solid #bdb3a1;background:#F5EFE3;padding:4px 7px;flex:1}.flow .b.now{border-color:#E07B2E}" +
    ".flow .b .t{font-family:'IBM Plex Mono';font-size:5.2pt;color:#6F685C;letter-spacing:.8px}.flow .b .v{font-family:'Newsreader',serif;font-size:13pt;line-height:1.1}.flow .b.now .v,.flow .b.now .t{color:#E07B2E}.flow .op{font-family:'IBM Plex Mono';font-size:8pt;color:#6F685C}" +
    ".det p{font-size:6.4pt;margin-bottom:2px;line-height:1.38}.det b,.mt2 b{font-weight:600}.mt2{font-size:6.4pt;margin-top:4px}" +
    "table.mot{width:100%;border-collapse:collapse;font-size:6.5pt}table.mot th{font-family:'IBM Plex Mono';font-weight:400;font-size:5.3pt;letter-spacing:.8px;color:#6F685C;text-align:left;border-bottom:1px solid #26241F;padding:2px 3px}" +
    "table.mot th.r,table.mot td.r{text-align:right}table.mot td{white-space:nowrap;padding:2.4px 3px;border-bottom:1px solid #D8CFBE}table.mot tr.sub td{font-style:italic;color:#6F685C;font-size:6pt}table.mot tr.tot td{font-weight:600;border-bottom:1.4px solid #26241F}" +
    "table.mot td.desc{white-space:normal}" +
    ".mini{display:grid;grid-template-columns:repeat(3,1fr);margin-top:6px}.mini>div{border-left:3px solid #CFC5B2;padding:0 8px}.mini .v{font-family:'Newsreader',serif;font-size:11pt;line-height:1.1}.mini .s{font-size:6.1pt;color:#4d483f;line-height:1.35}" +
    "table.ac{width:100%;border-collapse:collapse;font-size:6.5pt;margin-top:2px}table.ac th{font-family:'IBM Plex Mono';font-weight:400;font-size:5.3pt;letter-spacing:.8px;color:#6F685C;text-align:left;border-bottom:1px solid #26241F;padding:2px 4px}" +
    "table.ac td{padding:2.6px 4px;border-bottom:1px solid #D8CFBE;vertical-align:top}table.ac td.w{font-family:'IBM Plex Mono';font-size:5.9pt;white-space:nowrap}" +
    ".bm{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 8px}.bm>div{border:1px solid #D8CFBE;border-radius:5px;padding:6px 10px 7px;background:#F5EFE3}.bm .b{border-left:4px solid #4E9A55}.bm .m{border-left:4px solid #E07B2E}.bm .t{font-family:'IBM Plex Mono';font-size:5.6pt;letter-spacing:1.1px;text-transform:uppercase;color:#6F685C;margin-bottom:3px}.bm ul{margin:0;padding-left:12px}.bm li{font-size:6.6pt;line-height:1.4;margin-bottom:1.5px}.tag{font-family:'IBM Plex Mono';font-size:5.4pt;letter-spacing:.8px;padding:1px 5px;border-radius:2px}.tag.a{background:#DCE9D6;color:#2F6B3F}.tag.m{background:#F6DFC6;color:#B5591B}" +
    ".foot{margin-top:6px;font-family:'IBM Plex Mono';font-size:5.2pt;color:#6F685C;line-height:1.55;border-top:1px solid #CFC5B2;padding-top:4px}" +
    "@media screen{body{padding:56px 0 24px;background:#d9d1c1}.page{box-shadow:0 4px 18px rgba(0,0,0,.15)}" +
    ".tb{position:fixed;top:0;left:0;right:0;z-index:5;display:flex;gap:8px;align-items:center;justify-content:center;padding:10px;background:#26241F;color:#fff;font:13px 'IBM Plex Sans',sans-serif}" +
    ".tb button{font:inherit;font-weight:600;padding:7px 14px;border-radius:5px;border:0;cursor:pointer;background:#D7262B;color:#fff}.tb button.s{background:#fff;color:#26241F}.tb span{opacity:.75;font-size:12px}}" +
    "@media print{.tb{display:none!important}body{padding:0;background:#EEE7D9}.page{box-shadow:none;height:11in;overflow:hidden}}";

  function html(h, logo) {
    var M = h.meta, P = M.P, N = M.N, out = [];
    var titulo = 'Reporte ejecutivo · CD Nejapa · ' + lblFecha(M.dia) + ' ' + M.dia.slice(0, 4) + ' · ' + (M.cierre ? 'Cierre' : M.corteTxt);
    out.push('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc('Reporte_ejecutivo_' + M.dia + (M.cierre ? '_cierre' : '_' + M.corteTxt.replace(/[^0-9apm]/g, ''))) + '</title>');
    out.push('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
    out.push('<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600&family=Newsreader:opsz,wght@6..72,400;6..72,600&display=swap" rel="stylesheet">');
    out.push('<style>' + CSS + '</style></head><body>');
    out.push('<div class="tb"><button type="button" id="pdf">Descargar PDF</button><button type="button" class="s" id="cerrar">Cerrar</button><span>En la ventana de impresión elige «Guardar como PDF».</span></div>');
    out.push('<section class="page">');
    out.push('<div class="hd">' + (logo ? '<img src="' + logo + '" alt="Vidri">' : '<b>VIDRI</b>') + '<div class="r">Reporte ejecutivo · CD Nejapa<br><b>' + esc(lblLargo(M.dia)) + ' · ' + esc(M.momento) + '</b><br>Negados y pedidos' + (P ? ' al corte de ' + esc(M.corteTxt) : '') + '</div></div>');
    out.push('<div class="eb">' + [P ? 'Pedidos CD' : '', N ? 'Negados' : ''].filter(Boolean).join(' · ') + '</div>');
    out.push('<h1>' + esc(h.titulo) + '</h1><p class="lead">' + esc(h.lead) + '</p>');
    out.push('<div class="kpis">' + h.kpis.map(function (k) { return '<div class="k"><div class="l">' + esc(k.l) + '</div><div class="v' + (k.o ? ' o' : '') + '">' + esc(k.v) + '</div><div class="s">' + esc(k.s) + '</div></div>'; }).join('') + '</div>');
    out.push('<div class="bm"><div class="b"><div class="t">Lo bueno del día</div><ul>' + h.bueno.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="m"><div class="t">Qué mejorar</div><ul>' + (h.mejorar.length ? h.mejorar.map(function (x) { return '<li>' + (x.a ? '<b>Prioridad:</b> ' : '') + esc(x.q) + '</li>'; }).join('') : '<li>Mantener el ritmo del día.</li>') + '</ul></div></div>');
    var sec = 1;
    if (P) {
      out.push('<div class="sec"><div class="eb">' + (sec++) + ' · Pedidos CD</div><h2>' + esc(h.s1t) + '</h2><div class="two"><div>');
      out.push('<p class="cap">Entraron por día (barras), terminados (verde) y pedidos sin terminar al cierre (naranja). El ' + lblFecha(P.hoy) + ' va al corte de ' + esc(M.corteTxt) + '.</p>');
      out.push('<div class="lg"><span><i style="background:' + C.BLUE + '"></i>Entraron</span><span><i class="ln" style="background:' + C.GREEN + '"></i>Terminados</span><span><i class="ln" style="background:' + C.ORANGE + '"></i>Sin terminar al cierre</span></div>');
      out.push(grafPedidos(P.serie) + '</div><div>');
      out.push('<div class="flow"><div class="b"><div class="t">INICIÓ</div><div class="v">' + n(P.ini) + '</div><div class="t">SIN TERMINAR</div></div><span class="op">+</span><div class="b"><div class="t">ENTRARON</div><div class="v">' + n(P.ent) + '</div><div class="t">EN EL DÍA</div></div><span class="op">−</span><div class="b"><div class="t">TERMINADOS</div><div class="v">' + n(P.ter) + '</div><div class="t">EN EL DÍA</div></div><span class="op">=</span><div class="b now"><div class="t">AL CORTE</div><div class="v">' + n(P.fin) + '</div><div class="t">SIN TERMINAR</div></div></div>');
      out.push('<div class="det">' + h.s1det.map(function (p) { return '<p>' + p + '</p>'; }).join('') + '</div></div></div></div>');
    }
    if (N) {
      var H = N.hoy, pW = N.prevW;
      out.push('<div class="sec"><div class="eb">' + (sec++) + ' · Negados (día' + (N.parcial ? ', parcial' : '') + ')</div><h2>' + esc(h.s2t) + '</h2><div class="two"><div>');
      out.push('<p class="cap">% de líneas negadas por día y motivo.' + (N.prom != null ? ' Línea discontinua: promedio de los ' + N.ventana.length + ' días anteriores (' + dec(N.prom) + '%).' : '') + '</p>');
      out.push('<div class="lg"><span><i style="background:' + C.ORANGE + '"></i>Negadas por error en el proceso (había stock)</span><span><i style="background:' + C.BLUE + '"></i>Negadas sin stock</span></div>');
      out.push(grafNegados(N.serie, N.prom) + '</div><div>');
      var col = function (r) { return r ? '<b>' + n(r.err) + '</b> · ' + pctInt(r.err, r.neg) : '–'; };
      var col2 = function (r) { return r ? '<b>' + n(r.sst) + '</b> · ' + pctInt(r.sst, r.neg) : '–'; };
      var colT = function (r) { return r ? n(r.neg) + ' · ' + dec(pct(r.neg, r.lin)) + '%' : '–'; };
      var hd2 = function (r) { return (DOW[dowOf(r.d)] + ' ' + (+r.d.slice(8))).toUpperCase(); };
      out.push('<table class="mot"><thead><tr><th>MOTIVO</th><th class="r">' + hd2(H) + (N.parcial ? ' (PARCIAL)' : ' (DÍA)') + '</th>' + (pW ? '<th class="r">' + hd2(pW) + ' (DÍA)</th>' : '') + '</tr></thead><tbody>');
      out.push('<tr><td><b>Negadas por error en el proceso</b> (había stock)</td><td class="r">' + col(H) + '</td>' + (pW ? '<td class="r">' + col(pW) + '</td>' : '') + '</tr>');
      out.push('<tr><td><b>Negadas sin stock</b> (0 o negativo)</td><td class="r">' + col2(H) + '</td>' + (pW ? '<td class="r">' + col2(pW) + '</td>' : '') + '</tr>');
      out.push('<tr class="sub"><td>↳ existencia 0 · existencia negativa</td><td class="r">' + n(H.cero) + ' · ' + n(H.negat) + '</td>' + (pW ? '<td class="r">' + n(pW.cero) + ' · ' + n(pW.negat) + '</td>' : '') + '</tr>');
      out.push('<tr class="tot"><td>Total negados</td><td class="r">' + colT(H) + '</td>' + (pW ? '<td class="r">' + colT(pW) + '</td>' : '') + '</tr></tbody></table>');
      out.push('<p class="mt2"><b>Negados en la mañana:</b> ' + n(N.negMan) + ' · <b>en la tarde:</b> ' + n(N.negTar) + ' (por hora en que se cerró la línea)</p>');
      var t1 = N.tiendas[0], t2 = N.tiendas[1];
      out.push('<div class="mini"><div><div class="v">' + (H.prep ? dec(pct(H.exactas, H.prep)) + '%' : '–') + '</div><div class="s">exactitud de picking · meta 99,5%</div></div>');
      out.push('<div><div class="v">' + (N.b2b.tot ? dec(pct(N.b2b.ok, N.b2b.tot)) + '%' : '–') + '</div><div class="s">fill rate B2B' + (N.b2b.tot ? ' · ' + n(N.b2b.ok) + ' de ' + n(N.b2b.tot) + ' pedidos completos' : ' · sin pedidos B2B cerrados') + '</div></div>');
      out.push('<div><div class="v">' + (t1 ? n(t1.neg) : '–') + '</div><div class="s">' + (t1 ? 'negados en ' + esc(nombre(t1.s)) + (t2 ? ' · ' + esc(nombre(t2.s)) + ' ' + n(t2.neg) : '') : 'sin negados por sucursal') + '</div></div></div>');
      out.push('</div></div>');
      if (N.top.length) {
        out.push('<table class="mot" style="margin-top:2px"><thead><tr><th>CÓDIGOS CON MÁS NEGADOS</th><th>DESCRIPCIÓN</th><th class="r">VECES</th><th class="r">ERROR EN EL PROCESO</th></tr></thead><tbody>' +
          N.top.map(function (x) { return '<tr><td>' + esc(x.sku) + '</td><td class="desc">' + esc(x.desc) + '</td><td class="r"><b>' + n(x.t) + '</b></td><td class="r">' + n(x.err) + '</td></tr>'; }).join('') + '</tbody></table>');
      }
      out.push('</div>');
    }
    var foot = [];
    if (P) foot.push('Pedidos al corte de ' + M.corteTxt + (N ? '; negados al de la última carga' + (M.negHora ? ' (' + M.negHora + ')' : '') : ''));
    if (N && N.parcial) foot.push('El Radar marca el ' + lblFecha(N.hoy.d) + ' como parcial: las líneas que aún no están en estado A no entran');
    foot.push('Sin asignar = estado Recibido · 72 h = de la fecha del pedido al corte, contando sábado y domingo · Espera hasta asignación = de Recibido a la creación de la orden de preparación');
    if (P && P.prev) foot.push('Pedidos: comparación contra el ' + DOW_L[dowOf(P.prev.dia)] + ' ' + (+P.prev.dia.slice(8)) + ' a la misma hora');
    if (N && N.prevW) foot.push('Negados: comparación contra el ' + DOW_L[dowOf(N.prevW.d)] + ' ' + (+N.prevW.d.slice(8)) + ' (día completo)');
    foot.push('Productividad no incluida: sus datos aún no están en la base');
    foot.push('Reporte generado automáticamente por el Radar con reglas fijas');
    out.push('<div class="foot">' + esc(foot.join(' · ')) + '</div></section>');
    out.push('<script>document.getElementById("pdf").onclick=function(){window.print()};document.getElementById("cerrar").onclick=function(){try{parent.__cerrarReporte()}catch(e){window.close()}};<\/script>');
    out.push('</body></html>');
    return { html: out.join(''), titulo: titulo };
  }

  /* ---------------- ventana del reporte ---------------- */
  function mostrar(doc) {
    var prev = document.getElementById('rep-ov'); if (prev) prev.remove();
    var ov = document.createElement('div'); ov.id = 'rep-ov';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(38,36,31,.55);display:flex';
    var fr = document.createElement('iframe'); fr.title = doc.titulo;
    fr.style.cssText = 'flex:1;border:0;background:#d9d1c1';
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
      if (typeof showStatus === 'function') showStatus('err', 'No se pudo armar el reporte: ' + ((e && e.message) || e), 15000);
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

  window.VidriReporte = { armar: armar, html: html, generar: generar, ponerBotones: ponerBotones, _pedidos: datosPedidos, _negados: datosNegados };
})();
