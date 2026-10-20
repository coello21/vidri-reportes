/* Copia textual de funciones del tablero HTML original (Radar_de_Negados_2026-10-19.html).
   Solo para pruebas: comparar que la versión TypeScript da exactamente lo mismo. No editar. */
let HISTORY = {};
let STORE = null;
let DATA_LOADED = false;
const DATA_FILE_NAME = 'Radar_de_Negados_datos.json';
const RETENTION_DAYS = 365;

/* ---------------- helpers ---------------- */
function normKey(s){
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
}
function normText(s){
  return String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
}
const FIELD_MAP = {
  sucursal:'Sucursal', ordendepreparacion:'Orden', pedido:'Pedido', sku:'SKU',
  ubicacion1:'Ubic1', ubicacion2:'Ubic2', cantidad:'Cantidad', cantidadpreparada:'CantPrep',
  um:'UM', disponible:'Disponible', razondepedido:'Razon', descripcion:'Desc',
  categoria:'Categoria', estado:'Estado', preparador:'Preparador', revisador:'Revisador',
  fechacreacion:'Fecha', fechaenviadorevision:'FechaRevision', fechaactualizado:'FechaAct'
};
const BUCKET_LABEL = {positivo:'Error en el proceso', cero:'Sin existencia', negativo:'Inventario negativo'};
const BUCKET_DESC = {positivo:'había en inventario, no se encontró', cero:'disponible = 0', negativo:'disponible < 0'};
const BUCKET_COLOR_VAR = {positivo:'--critical', cero:'--warning', negativo:'--steel'};
const BUCKETS = ['positivo','cero','negativo'];
const EXACTITUD_META = 99.5;
const KEEP_DAYS = 10;
const BACKLOG_CUT_HOUR = 17; // hora de corte del backlog al cierre (17 = 5:00 p. m.) // días que se recuerdan las líneas ya contadas y los pendientes

function fmtInt(n){ return new Intl.NumberFormat('es-SV').format(Math.round(n)); }
function fmtPct(n){ return n.toFixed(1).replace('.', ',') + '%'; }
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function toNum(v){
  if(v==null) return null;
  if(typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).trim().replace(/,/g,'');
  if(s === '') return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}
function toDate(v){
  if(v==null || v==='') return null;
  if(v instanceof Date) return isNaN(v) ? null : v;
  if(typeof v === 'number'){
    const d = XLSX.SSF.parse_date_code(v);
    return d ? new Date(d.y, d.m-1, d.d, d.H, d.M, Math.floor(d.S)) : null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m) return new Date(+m[1], +m[2]-1, +m[3], +(m[4]||0), +(m[5]||0), +(m[6]||0));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m) return new Date(+m[3], +m[2]-1, +m[1], +(m[4]||0), +(m[5]||0), +(m[6]||0));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function ymd(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function addDays(day, n){ const d = new Date(day+'T12:00:00'); d.setDate(d.getDate()+n); return ymd(d); }
function cleanText(v, fallback){ const s = v==null ? '' : String(v).trim(); return s === '' ? fallback : s; }

/* ---------------- workbook parsing ---------------- */
const NEED_LABEL = {SKU:'SKU', Pedido:'Pedido', Orden:'Orden de Preparación', CantPrep:'Cantidad Preparada', Cantidad:'Cantidad',
  Disponible:'Disponible', Desc:'Descripción', Sucursal:'Sucursal', Estado:'Estado', Fecha:'Fecha Creación', FechaAct:'Fecha Actualizado'};

function parseWorkbook(arrayBuffer){
  const wb = XLSX.read(arrayBuffer, {type:'array', cellDates:true});
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, {header:1, raw:true, defval:null});

  let headerIdx = -1, headerMap = null;
  for(let i=0;i<Math.min(rows.length,15);i++){
    const r = rows[i];
    if(!r) continue;
    const keys = r.map(c => c==null?'':normKey(c));
    if(keys.includes('sku') && keys.includes('sucursal')){
      headerIdx = i;
      headerMap = {};
      r.forEach((cell,ci) => {
        const nk = cell==null?'':normKey(cell);
        if(FIELD_MAP[nk] && !(FIELD_MAP[nk] in headerMap)) headerMap[FIELD_MAP[nk]] = ci;
      });
      break;
    }
  }
  if(headerIdx === -1) throw new Error('No se encontró la fila de encabezados (se busca "Sucursal" y "SKU").');
  for(const k of Object.keys(NEED_LABEL)){ if(!(k in headerMap)) throw new Error('Falta la columna requerida: ' + NEED_LABEL[k]); }

  const out = [];
  for(let i=headerIdx+1;i<rows.length;i++){
    const r = rows[i];
    if(!r) continue;
    const sku = r[headerMap.SKU];
    if(sku==null || String(sku).trim()==='') continue;
    const rec = {};
    for(const k in headerMap){ rec[k] = r[headerMap[k]]; }
    rec.SKU = String(rec.SKU).trim();
    rec.Pedido = cleanText(rec.Pedido, '');
    rec.Orden = cleanText(rec.Orden, '');
    rec.Cantidad = toNum(rec.Cantidad);
    rec.CantPrep = toNum(rec.CantPrep);
    rec.Disponible = toNum(rec.Disponible);
    rec.Sucursal = cleanText(rec.Sucursal, '(Sin sucursal)');
    rec.Estado = cleanText(rec.Estado, '').toUpperCase();
    rec.Desc = cleanText(rec.Desc, '');
    rec.Categoria = cleanText(rec.Categoria, '(Sin categoría)');
    rec.Preparador = cleanText(rec.Preparador, '(Sin preparador)');
    rec.Fecha = toDate(rec.Fecha);
    rec.FechaAct = toDate(rec.FechaAct);
    rec.FechaRevision = toDate(rec.FechaRevision);
    out.push(rec);
  }
  return out;
}

/* ---------------- deduplicación ----------------
   Paso 1 — mismo Pedido + SKU: se conserva UNA fila. Si solo cambia la Razón de
   Pedido es el mismo registro repetido. Si el pedido se reasignó a otra Orden de
   Preparación, se conserva la orden en estado A (lista para despacho); si hay
   varias en A, la de Fecha Actualizado más reciente.
   Paso 2 — misma Orden + SKU: solo se descarta cuando Cantidad, Cantidad Preparada
   y Disponible son idénticos (una orden puede consolidar varios pedidos). */
const ESTADO_RANK = {A:0, R:1, P:2};
function rankOf(r){ return (r.Estado in ESTADO_RANK) ? ESTADO_RANK[r.Estado] : 3; }
function timeOf(d){ return d ? d.getTime() : -1; }
function preferRow(a, b){ // true si a es mejor que b
  const ra = rankOf(a), rb = rankOf(b);
  if(ra !== rb) return ra < rb;
  const ta = timeOf(a.FechaAct), tb = timeOf(b.FechaAct);
  if(ta !== tb) return ta > tb;
  return timeOf(a.Fecha) > timeOf(b.Fecha);
}
function pedidoLess(a, b){
  const na = Number(a), nb = Number(b);
  if(isFinite(na) && isFinite(nb) && na !== nb) return na < nb;
  return a < b;
}
function dedupRecords(records){
  const best = new Map();
  for(const r of records){
    const k = r.Pedido + '|' + r.SKU;
    const cur = best.get(k);
    if(!cur || preferRow(r, cur)) best.set(k, r);
  }
  const afterPass1 = Array.from(best.values());
  const groups = new Map();
  for(const r of afterPass1){
    const k = r.Orden + '|' + r.SKU;
    if(!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const drop = new Set();
  for(const g of groups.values()){
    if(g.length < 2) continue;
    const ref = g[0];
    if(!g.every(r => r.Cantidad === ref.Cantidad && r.CantPrep === ref.CantPrep && r.Disponible === ref.Disponible)) continue;
    const keep = g.reduce((a,b) => (rankOf(b) < rankOf(a) || (rankOf(b) === rankOf(a) && pedidoLess(b.Pedido, a.Pedido))) ? b : a);
    g.forEach(r => { if(r !== keep) drop.add(r); });
  }
  return {
    rows: afterPass1.filter(r => !drop.has(r)),
    dedupPedidoSku: records.length - afterPass1.length,
    dedupOrdenSku: drop.size
  };
}

function bucketOf(v){ return v < 0 ? 'negativo' : (v === 0 ? 'cero' : 'positivo'); }

/* ---------------- almacenamiento ----------------
   HISTORY[fecha] puede ser:
   - versión anterior (sin campo v): resumen calculado con las reglas viejas, se muestra tal cual.
   - v:2: resumen del día armado línea por línea con las reglas nuevas (solo estado A,
     día = Fecha Actualizado). Es aditivo: cada carga suma solo las líneas nuevas.
   STORE guarda lo necesario para no contar dos veces una línea y para dar
   seguimiento a los pendientes (P/R) entre cargas. */
function ensureStore(){
  if(!STORE) STORE = {};
  STORE.skus = STORE.skus || {};
  STORE.seen = STORE.seen || {};
  STORE.pending = STORE.pending || {};
  STORE.covered = STORE.covered || [];
  STORE.b2b = STORE.b2b || {};         // pedido corporativo -> [último día, líneas, 1 si todas completas]
  STORE.backlog = STORE.backlog || {}; // día -> [pedidos, líneas, hora de corte]
  if(!('legacyCutoff' in STORE)){
    const legacy = Object.keys(HISTORY).filter(d => HISTORY[d].v !== 2).sort();
    STORE.legacyCutoff = legacy.length ? legacy[legacy.length-1] : null;
  }
}
let SEEN = null; // Map creDate -> Set(keys)
function seenMap(){
  if(SEEN) return SEEN;
  SEEN = new Map();
  for(const d in STORE.seen){ SEEN.set(d, new Set(STORE.seen[d] ? STORE.seen[d].split(',') : [])); }
  return SEEN;
}
function isSeen(key){ for(const s of seenMap().values()){ if(s.has(key)) return true; } return false; }
function markSeen(key, creDate){ const m = seenMap(); if(!m.has(creDate)) m.set(creDate, new Set()); m.get(creDate).add(key); }
function persistSeen(){
  const m = seenMap();
  const dates = Array.from(m.keys()).sort();
  const keepFrom = dates.length ? addDays(dates[dates.length-1], -KEEP_DAYS) : null;
  STORE.seen = {};
  for(const d of dates){
    if(keepFrom && d < keepFrom){ m.delete(d); continue; }
    STORE.seen[d] = Array.from(m.get(d)).join(',');
  }
}

function isLegacyDay(d){ return !!HISTORY[d] && HISTORY[d].v !== 2; }
function isPartialDay(d){ return !!HISTORY[d] && HISTORY[d].v === 2 && !STORE.covered.includes(d); }
function firstNewDay(){ return Object.keys(HISTORY).sort().find(d => HISTORY[d].v === 2) || null; }

function newDaySummary(d){
  return {v:2, date:d,
    meta:{totalFinal:0, totalNegados:0, totalPreparados:0, exactas:0},
    bucket:{positivo:0, cero:0, negativo:0},
    codes:{}, stores:{}, hours:Array(24).fill(0), preps:{}, pairs:{}, prepSkus:{}};
}
const BIDX = {positivo:0, cero:1, negativo:2};
function addLineToDay(sum, r){
  const m = sum.meta;
  m.totalFinal++;
  const st = sum.stores[r.Sucursal] || (sum.stores[r.Sucursal] = [0,0]);
  st[0]++;
  const p = sum.preps[r.Preparador] || (sum.preps[r.Preparador] = [0,0]);
  if(r.CantPrep <= 0){
    m.totalNegados++;
    const b = bucketOf(r.Disponible);
    sum.bucket[b]++;
    const c = sum.codes[r.SKU] || (sum.codes[r.SKU] = [0,0,0]);
    c[BIDX[b]]++;
    st[1]++;
    p[0]++;
    sum.hours[r.Fin.getHours()]++;
    const pr = sum.pairs[r.Preparador] || (sum.pairs[r.Preparador] = {});
    pr[r.SKU] = (pr[r.SKU] || 0) + 1;
    STORE.skus[r.SKU] = [r.Desc, r.Categoria];
  } else {
    m.totalPreparados++;
    // Exactitud de picking: se mandó lo pedido o más (más es normal: caja completa).
    if(r.CantPrep >= r.Cantidad) m.exactas++;
    p[1]++;
    const ps = sum.prepSkus[r.Preparador] || (sum.prepSkus[r.Preparador] = {});
    ps[r.SKU] = (ps[r.SKU] || 0) + 1;
  }
}

/* Integra un Excel al histórico. Nunca reemplaza un día: solo agrega las líneas
   que no se habían contado y actualiza los pendientes. */
function integrateRecords(records){
  ensureStore();
  const {rows, dedupPedidoSku, dedupOrdenSku} = dedupRecords(records);
  const cutoff = STORE.legacyCutoff;
  const res = {added:0, addedByDay:{}, already:0, legacyIgnored:0, sinDato:0, otherEstado:0, pendingNow:0,
               resolved:0, dedupPedidoSku, dedupOrdenSku, totalRows:records.length};

  let maxTs = 0;
  records.forEach(r => { maxTs = Math.max(maxTs, timeOf(r.FechaAct), timeOf(r.Fecha)); });
  const creDates = new Set();
  const b2bPed = new Set(records.filter(r => /CORPORATIVA/i.test(String(r.Razon || ''))).map(r => r.Pedido));
  const rowKeys = new Set(rows.map(r => r.Pedido + '|' + r.SKU));

  for(const r of rows){
    const key = r.Pedido + '|' + r.SKU;
    if(!r.Fecha){ res.sinDato++; continue; }
    const creDate = ymd(r.Fecha);
    // Líneas creadas en días de la versión anterior ya están contadas en esos resúmenes.
    if(cutoff && creDate <= cutoff){ res.legacyIgnored++; continue; }
    creDates.add(creDate);

    if(r.Estado === 'A'){
      if(r.CantPrep == null || r.Cantidad == null || r.Disponible == null || !(r.FechaAct || r.FechaRevision)){ res.sinDato++; continue; }
      // Día = Fecha Actualizado; si viene vacía se usa Fecha Enviado Revisión.
      r.Fin = r.FechaAct || r.FechaRevision;
      if(isSeen(key)){ res.already++; if(STORE.pending[key]){ delete STORE.pending[key]; } continue; }
      const day = ymd(r.Fin);
      if(isLegacyDay(day)){ res.legacyIgnored++; continue; }
      if(!HISTORY[day]) HISTORY[day] = newDaySummary(day);
      addLineToDay(HISTORY[day], r);
      if(b2bPed.has(r.Pedido)){
        const b = STORE.b2b[r.Pedido] || (STORE.b2b[r.Pedido] = [day, 0, 1]);
        if(day > b[0]) b[0] = day;
        b[1]++;
        if(!(r.CantPrep >= r.Cantidad)) b[2] = 0;
      }
      markSeen(key, creDate);
      if(STORE.pending[key]){ delete STORE.pending[key]; res.resolved++; }
      res.added++;
      if(!r.FechaAct) res.fechaRespaldo = (res.fechaRespaldo || 0) + 1;
      res.addedByDay[day] = (res.addedByDay[day] || 0) + 1;
    } else if(r.Estado === 'P' || r.Estado === 'R'){
      if(isSeen(key)) continue;
      STORE.pending[key] = [r.Estado, r.Sucursal, r.Preparador, r.SKU, creDate];
    } else {
      res.otherEstado++;
    }
  }

  // Un día de creación queda "completo" cuando se cargó un reporte sacado después de ese día.
  const maxDay = maxTs > 0 ? ymd(new Date(maxTs)) : null;
  creDates.forEach(d => { if(maxDay && maxDay > d && !STORE.covered.includes(d)) STORE.covered.push(d); });
  STORE.covered.sort();

  // Limpieza: pendientes demasiado viejos y llaves ya no necesarias.
  const allCre = Object.values(STORE.pending).map(p => p[4]).concat(Array.from(creDates)).sort();
  if(allCre.length){
    const keepFrom = addDays(allCre[allCre.length-1], -KEEP_DAYS);
    for(const k in STORE.pending){ if(STORE.pending[k][4] < keepFrom) delete STORE.pending[k]; }
  }
  // B2B: los pedidos ya cerrados y viejos se resumen en su día para que el archivo no crezca.
  if(maxDay){
    const pendPed = new Set(Object.keys(STORE.pending).map(k => k.split('|')[0]));
    const foldBefore = addDays(maxDay, -KEEP_DAYS);
    for(const p in STORE.b2b){
      const b = STORE.b2b[p];
      if(b[0] < foldBefore && !pendPed.has(p) && HISTORY[b[0]] && HISTORY[b[0]].v === 2){
        const m = HISTORY[b[0]].meta;
        m.b2bTot = (m.b2bTot || 0) + 1;
        m.b2bOk = (m.b2bOk || 0) + b[2];
        delete STORE.b2b[p];
      }
    }
  }

  persistSeen();
  STORE.covered = STORE.covered.filter(d => HISTORY[d] || (maxDay && d >= addDays(maxDay, -KEEP_DAYS)));

  res.pendingNow = Object.keys(STORE.pending).length;
  STORE.updatedAt = new Date().toISOString();
  _dayViewCache.clear();
  return res;
}

function pendingSummary(){
  const out = {total:0, P:0, R:0};
  if(typeof STORE === 'undefined' || !STORE || !STORE.pending) return out;
  for(const k in STORE.pending){ out.total++; out[STORE.pending[k][0]]++; }
  return out;
}
function parsePreparadorName(raw){
  const parts = String(raw).split(' - ');
  return parts.length > 1 ? parts.slice(1).join(' - ').trim() : raw;
}

/* Vista de un día con la misma forma para ambas versiones. */
const _dayViewCache = new Map();
const EMPTY_VIEW = {meta:{totalNegados:0,totalFinal:0,totalPreparados:0}, bucketCounts:{}, codes:[], byStore:[], byHour:[],
  byPreparador:[], byCategoria:[], fillRateByPreparador:[], pairs:[], preparedPairs:[]};
function dayView(d){
  const rec = HISTORY[d];
  if(!rec) return EMPTY_VIEW;
  if(rec.v === 1) return legacyView(d, rec);
  if(rec.v !== 2) return rec;
  if(_dayViewCache.has(d)) return _dayViewCache.get(d);
  const m = rec.meta;
  const info = sku => { const s = STORE.skus[sku]; return s ? [s[0], s[1] || '(Sin categoría)'] : ['', '(Sin categoría)']; };
  const codes = [];
  for(const sku in rec.codes){
    const arr = rec.codes[sku], inf = info(sku);
    BUCKETS.forEach((b,i) => { if(arr[i]) codes.push({sku, desc:inf[0], cat:inf[1], bucket:b, count:arr[i]}); });
  }
  codes.sort((a,b) => b.count - a.count);
  const storeNames = Object.keys(rec.stores);
  const byStore = storeNames.filter(n => rec.stores[n][1] > 0).map(n => ({name:n, count:rec.stores[n][1]})).sort((a,b) => b.count - a.count);
  const byHour = rec.hours.map((count,hour) => ({hour, count}));
  const fillRateByPreparador = Object.keys(rec.preps).map(raw => {
    const v = rec.preps[raw], sol = v[0] + v[1];
    return {raw, name:parsePreparadorName(raw), preparados:v[1], negados:v[0], solicitado:sol, fillRate: sol ? v[1]/sol*100 : 0};
  });
  const byPreparador = fillRateByPreparador.filter(p => p.negados > 0).map(p => ({raw:p.raw, name:p.name, count:p.negados})).sort((a,b) => b.count - a.count);
  const pairs = [];
  for(const raw in rec.pairs){
    const nm = parsePreparadorName(raw);
    for(const sku in rec.pairs[raw]) pairs.push({sku, desc:info(sku)[0], prepRaw:raw, prepName:nm, count:rec.pairs[raw][sku]});
  }
  const preparedPairs = [];
  for(const raw in rec.prepSkus){ for(const sku in rec.prepSkus[raw]) preparedPairs.push({sku, prepRaw:raw, count:rec.prepSkus[raw][sku]}); }
  const view = {v:2, date:d,
    meta:{...m, pct: m.totalFinal ? m.totalNegados/m.totalFinal*100 : 0, fecha:d, branchCount:storeNames.length},
    bucketCounts: rec.bucket, codes, byStore, storeNames, byHour, byPreparador, fillRateByPreparador, pairs, preparedPairs};
  _dayViewCache.set(d, view);
  return view;
}

/* Días de la versión anterior guardados en forma compacta: se reconstruyen igual que antes. */
function legacyView(d, rec){
  if(_dayViewCache.has(d)) return _dayViewCache.get(d);
  const desc = sku => (STORE.skus[sku] || [''])[0];
  const codes = [];
  for(const sku in rec.codes){
    const arr = rec.codes[sku];
    BUCKETS.forEach((b,i) => { if(arr[i]) codes.push({sku, desc:desc(sku), bucket:b, count:arr[i]}); });
  }
  codes.sort((a,b) => b.count - a.count);
  const fillRateByPreparador = Object.keys(rec.preps).map(raw => {
    const v = rec.preps[raw], sol = v[0] + v[1];
    return {raw, name:parsePreparadorName(raw), preparados:v[1], negados:v[0], solicitado:sol, fillRate: sol ? v[1]/sol*100 : 0};
  });
  const byPreparador = fillRateByPreparador.filter(p => p.negados > 0).map(p => ({raw:p.raw, name:p.name, count:p.negados})).sort((a,b) => b.count - a.count);
  const pairs = [];
  for(const raw in rec.pairs){
    const nm = parsePreparadorName(raw);
    for(const sku in rec.pairs[raw]) pairs.push({sku, desc:desc(sku), prepRaw:raw, prepName:nm, count:rec.pairs[raw][sku]});
  }
  const preparedPairs = [];
  for(const raw in rec.prepSkus){ for(const sku in rec.prepSkus[raw]) preparedPairs.push({sku, prepRaw:raw, count:rec.prepSkus[raw][sku]}); }
  const view = {v:1, date:d, meta:rec.meta, bucketCounts:rec.bucketCounts, codes,
    byStore: rec.byStore.map(s => ({name:s[0], count:s[1]})),
    byHour: rec.hours.map((count,hour) => ({hour, count})),
    byPreparador, fillRateByPreparador, pairs, preparedPairs,
    byCategoria: rec.cats.map(c => ({cat:c[0], total:c[1], codes:c[2].map(x => ({sku:x[0], desc:desc(x[0]), count:x[1]}))}))};
  _dayViewCache.set(d, view);
  return view;
}

/* ---------------- date range (día único o rango combinado) ---------------- */
function datesInRange(from, to){
  const dates = Object.keys(HISTORY).sort();
  if(!from || !to) return dates;
  return dates.filter(d => d >= from && d <= to);
}

/* Suma exacta de los días seleccionados (1 día, rango o histórico). */
function buildAggregatedVM(from, to){
  const dates = datesInRange(from, to);
  if(!dates.length) return null;

  let totalOriginal=0, dedupPedidoSku=0, dedupOrdenSku=0, totalFinal=0, totalNegados=0, totalPreparados=0;
  let exactas=0, prepEval=0, legacyDays=0, newDays=0, partialDays=0, singleLegacyBranch=null;
  const bucketCounts = {positivo:0, cero:0, negativo:0};
  const codeMap = new Map(), topMap = new Map(), storeMap = new Map(), hourMap = new Map();
  const negBy = new Map(), prepBy = new Map();
  const catTotal = new Map(), catSku = new Map();
  const storeNames = new Set();

  const addCat = (cat, sku, desc, count) => {
    if(!catSku.has(cat)) catSku.set(cat, new Map());
    const mm = catSku.get(cat);
    if(!mm.has(sku)) mm.set(sku, {sku, desc, count:0});
    mm.get(sku).count += count;
  };

  for(const d of dates){
    const rec = dayView(d);
    const legacy = rec.v !== 2;
    const m = rec.meta || {};
    if(legacy){
      legacyDays++;
      totalOriginal += m.totalOriginal||0;
      dedupPedidoSku += m.dedupPedidoSku||0;
      dedupOrdenSku += m.dedupOrdenSku||0;
      if(dates.length === 1) singleLegacyBranch = m.branchCount;
    } else {
      newDays++;
      exactas += m.exactas||0;
      prepEval += m.totalPreparados||0;
      if(isPartialDay(d)) partialDays++;
    }
    totalFinal += m.totalFinal||0;
    totalNegados += m.totalNegados||0;
    totalPreparados += m.totalPreparados||0;

    const bc = rec.bucketCounts || {};
    BUCKETS.forEach(b => { bucketCounts[b] += bc[b]||0; });

    // Lista completa de códigos (no el top 50 guardado) -> Top 12 exacto en cualquier rango.
    (rec.codes||[]).forEach(c => {
      const key = c.sku+'|'+c.bucket;
      if(!codeMap.has(key)) codeMap.set(key, {sku:c.sku, desc:c.desc, bucket:c.bucket, count:0});
      codeMap.get(key).count += c.count;
      if(!topMap.has(c.sku)) topMap.set(c.sku, {sku:c.sku, desc:c.desc, count:0});
      topMap.get(c.sku).count += c.count;
    });

    // Categorías: total real del día + códigos (completos en días nuevos, top 20 en la versión anterior).
    if(legacy){
      (rec.byCategoria||[]).forEach(cat => {
        catTotal.set(cat.cat, (catTotal.get(cat.cat)||0) + (cat.total||0));
        (cat.codes||[]).forEach(c => addCat(cat.cat, c.sku, c.desc, c.count));
      });
    } else {
      (rec.codes||[]).forEach(c => {
        catTotal.set(c.cat, (catTotal.get(c.cat)||0) + c.count);
        addCat(c.cat, c.sku, c.desc, c.count);
      });
    }

    (rec.byStore||[]).forEach(s => {
      storeMap.set(s.name, (storeMap.get(s.name)||0) + s.count);
      if(legacy) storeNames.add(s.name);
    });
    if(!legacy) (rec.storeNames||[]).forEach(n => storeNames.add(n));

    (rec.byHour||[]).forEach(h => { hourMap.set(h.hour, (hourMap.get(h.hour)||0) + h.count); });

    (rec.fillRateByPreparador||[]).forEach(p => {
      negBy.set(p.raw, (negBy.get(p.raw)||0) + (p.negados||0));
      prepBy.set(p.raw, (prepBy.get(p.raw)||0) + (p.preparados||0));
    });
  }

  const codes = Array.from(codeMap.values()).sort((a,b) => b.count - a.count);
  const topCodes = Array.from(topMap.values()).sort((a,b) => b.count - a.count);
  const byStore = Array.from(storeMap, ([name,count]) => ({name,count})).filter(s => s.count > 0).sort((a,b) => b.count - a.count);
  const byHour = Array.from({length:24}, (_,h) => ({hour:h, count: hourMap.get(h) || 0}));
  const allRaw = new Set([...negBy.keys(), ...prepBy.keys()]);
  const fillRateByPreparador = Array.from(allRaw).map(raw => {
    const negadosN = negBy.get(raw)||0, preparadosN = prepBy.get(raw)||0, solicitado = negadosN + preparadosN;
    return {raw, name:parsePreparadorName(raw), preparados:preparadosN, negados:negadosN, solicitado, fillRate: solicitado ? preparadosN/solicitado*100 : 0};
  }).sort((a,b) => b.solicitado - a.solicitado);
  const byPreparador = fillRateByPreparador.filter(p => p.negados > 0)
    .map(p => ({raw:p.raw, name:p.name, count:p.negados})).sort((a,b) => b.count - a.count);
  const byCategoria = Array.from(catTotal, ([cat,total]) => {
    const list = Array.from((catSku.get(cat)||new Map()).values()).sort((a,b) => b.count - a.count);
    return {cat, total, codes:list.slice(0,20)};
  }).filter(c => c.total > 0).sort((a,b) => b.total - a.total);

  const single = dates.length === 1;
  return {
    date: single ? dates[0] : null,
    rangeFrom: dates[0],
    rangeTo: dates[dates.length-1],
    rangeDays: dates.length,
    legacyDays, newDays, partialDays,
    meta: {
      totalOriginal, dedupPedidoSku, dedupOrdenSku, totalFinal, totalNegados, totalPreparados,
      pct: totalFinal ? totalNegados/totalFinal*100 : 0,
      fecha: single ? dates[0] : null,
      branchCount: singleLegacyBranch != null ? singleLegacyBranch : storeNames.size,
      exactas, prepEval
    },
    bucketCounts, codes, topCodes, byStore, byHour, byPreparador, byCategoria, fillRateByPreparador
  };
}
function b2bForDates(dates){
  const set = new Set(dates);
  const pendPed = new Set(Object.keys(STORE.pending || {}).map(k => k.split('|')[0]));
  let tot = 0, ok = 0, enProceso = 0;
  dates.forEach(d => { const r = HISTORY[d]; if(r && r.v === 2){ tot += r.meta.b2bTot || 0; ok += r.meta.b2bOk || 0; } });
  for(const p in (STORE.b2b || {})){
    const b = STORE.b2b[p];
    if(!set.has(b[0])) continue;
    if(pendPed.has(p)){ enProceso++; continue; }
    tot++; ok += b[2];
  }
  return {tot, ok, enProceso};
}
/* ===================== Unidades negadas y rankings ===================== */
function addLineToDay(sum, r){
  const m = sum.meta;
  m.totalFinal++;
  const st = sum.stores[r.Sucursal] || (sum.stores[r.Sucursal] = [0,0]);
  st[0]++;
  const p = sum.preps[r.Preparador] || (sum.preps[r.Preparador] = [0,0]);
  if(r.CantPrep <= 0){
    m.totalNegados++;
    const b = bucketOf(r.Disponible);
    sum.bucket[b]++;
    const c = sum.codes[r.SKU] || (sum.codes[r.SKU] = [0,0,0]);
    c[BIDX[b]]++;
    st[1]++;
    p[0]++;
    sum.hours[r.Fin.getHours()]++;
    const pr = sum.pairs[r.Preparador] || (sum.pairs[r.Preparador] = {});
    pr[r.SKU] = (pr[r.SKU] || 0) + 1;
    const q = sum.qty || (sum.qty = {});
    q[r.SKU] = (q[r.SKU] || 0) + (r.Cantidad || 0);
    STORE.skus[r.SKU] = [r.Desc, r.Categoria, String(r.UM==null?'':r.UM).trim()];
  } else {
    m.totalPreparados++;
    if(r.CantPrep >= r.Cantidad) m.exactas++;
    p[1]++;
    const ps = sum.prepSkus[r.Preparador] || (sum.prepSkus[r.Preparador] = {});
    ps[r.SKU] = (ps[r.SKU] || 0) + 1;
  }
}
var __exp={get HISTORY(){return HISTORY},set HISTORY(v){HISTORY=v},get STORE(){return STORE},set STORE(v){STORE=v},parseWorkbook,integrateRecords,buildAggregatedVM,b2bForDates,isPartialDay,_dayViewCache,resetSeen:()=>{SEEN=null}};
