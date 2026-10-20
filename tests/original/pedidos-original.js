/* Copia textual de funciones del tablero HTML original (Radar_de_Negados_2026-10-19.html).
   Solo para pruebas: comparar que la versión TypeScript da exactamente lo mismo. No editar. */
const PED={asgP:{},rows:new Map(),cortes:[],meses:[],loaded:false,loading:null,touch:new Set(),mode:30,from:null,to:null,est:new Set(['R']),bod:'all'};
const PED_BOD={NEJAPA:'N',BAZINNI:'B',MOBU:'M'}, PED_BOD_N={N:'Nejapa',B:'Bazinni',M:'Mobu'};
const PED_SUC={6:'CD NEJAPA',15:'MERLIOT',51:'CENTRO',52:'VENEZUELA',54:'QUEZALTEPEQUE',55:'SOYAPANGO',56:'ESCALON',58:'SANTA ANA I',59:'EJERCITO',60:'SAN MIGUELITO',61:'SANTA ANA II',62:'CONSTITUCION',63:'SONSONATE',64:'SAN BENITO',65:'MEJICANOS',66:'SAN MIGUEL',67:'LOURDES',69:'SAN MIGUEL II',70:'MAYOREO',71:'USULUTAN BY PASS',72:'PILETAS',73:'SOYAPANGO II',100:'B2B'};
const pedSuc=c=>PED_SUC[c]||('Sucursal '+c);
const PED_DOW=['dom','lun','mar','mié','jue','vie','sáb'], PED_DOW_L=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const pedDow=d=>new Date(d+'T00:00:00Z').getUTCDay();
let PED_EMB=null;
const PED_EST={ACTUALIZADO:'A',RECIBIDO:'R',PROCESANDO:'P',ENVIAR:'E'};
const PED_EST_N={A:'Actualizado',R:'Recibido',P:'Procesando',E:'Enviar',O:'Otro'};
const PED_RANK={E:0,R:1,P:2,A:3};
const PED_CAT_N={exi:'Existencia',b2b:'B2B',rot:'Rotación',otr:'Otros'};
const PED_CATS=['exi','b2b','rot','otr'];
const PED_CAT_C={exi:'#3A76B0',b2b:'#DE7A2C',rot:'#4B9A5A',otr:'#9A927F'};
function pedNorm(t){ return String(t==null?'':t).normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().trim(); }
function pedCat(t){ const T=pedNorm(t); if(T.includes('VENTA CORPORATIVA')) return 'b2b'; if(T.includes('EXISTENCIA')) return 'exi'; if(T.includes('ROTACION')) return 'rot'; return 'otr'; }
const pedC=x=>(x[5]==='ven'||x[5]==='lin')?'otr':x[5];
const pedB=x=>x[9]||'N';
function pedMin(v){
  if(v==null||v==='') return 0;
  if(typeof v==='number'){ if(v<2) return 0; return Math.round((v-25569)*1440); }
  if(v instanceof Date){ if(v.getFullYear()<=1900) return 0; return Math.round(Date.UTC(v.getFullYear(),v.getMonth(),v.getDate(),v.getHours(),v.getMinutes())/60000); }
  const s=String(v).trim(); let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2}))?/);
  if(m){ if(+m[3]<=1900) return 0; return Date.UTC(+m[3],m[2]-1,+m[1],+(m[4]||0),+(m[5]||0))/60000; }
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if(m){ if(+m[1]<=1900) return 0; return Date.UTC(+m[1],m[2]-1,+m[3],+(m[4]||0),+(m[5]||0))/60000; }
  return 0;
}
const pedDay=min=>new Date(min*60000).toISOString().slice(0,10);
const pedMonth=min=>new Date(min*60000).toISOString().slice(0,7);
const PED_MES=['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
function pedDayLbl(d){ return (+d.slice(8))+'-'+PED_MES[+d.slice(5,7)-1]; }
function pedCorteLbl(min){ const d=new Date(min*60000); let h=d.getUTCHours(); const ap=h<12?'a. m.':'p. m.'; h=h%12||12; return d.getUTCDate()+' '+PED_MES[d.getUTCMonth()]+', '+h+':'+String(d.getUTCMinutes()).padStart(2,'0')+' '+ap; }
function pedAddDays(d,n){ const x=new Date(d+'T00:00:00Z'); x.setUTCDate(x.getUTCDate()+n); return x.toISOString().slice(0,10); }
/* pedidos con fecha de más de 60 días respecto a su corte: datos anómalos del reporte (p. ej. fechas de dic-2025 recibidos hoy); se omiten */
const PED_MAX_AGE=60*1440;
const pedViejo=x=>x[2]<(x[8]||0)-PED_MAX_AGE;
function pedLastCorte(){ return PED.cortes.length?Math.max(...PED.cortes.map(c=>c.t)):0; }
function pedParse(buf, isText){
  const wb=isText?XLSX.read(buf,{type:'string',FS:';',raw:true}):XLSX.read(buf,{type:'array'});
  const ws=wb.Sheets[wb.SheetNames[0]];
  const A=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null});
  let h=-1; for(let i=0;i<Math.min(A.length,30);i++){ const r=(A[i]||[]).map(pedNorm); if(r.includes('NUMERO PEDIDO')&&r.includes('ESTADO TRANSFERENCIA')){h=i;break;} }
  if(h<0) throw new Error('No encontré las columnas "Número Pedido" y "Estado Transferencia". ¿Es el reporte de transferencias de pedidos?');
  const H=A[h].map(pedNorm), c=n=>H.indexOf(n);
  const ix={num:c('NUMERO PEDIDO'),ori:c('ORIGEN'),fec:c('FECHA'),est:c('ESTADO TRANSFERENCIA'),sku:c('SKUS'),raz:c('RAZON PEDIDO'),act:c('ACTUALIZADO'),rec:c('RECIBIDO'),bod:c('BODEGA')};
  for(const k of ['num','ori','fec','est','sku']) if(ix[k]<0) throw new Error('Falta la columna '+k.toUpperCase()+' en el reporte.');
  const out=[]; let otras=0, sinFecha=0;
  for(let i=h+1;i<A.length;i++){
    const r=A[i]; if(!r||r[ix.num]==null||r[ix.num]==='') continue;
    const bod=ix.bod>=0?PED_BOD[pedNorm(r[ix.bod])]:'N'; if(!bod){ otras++; continue; }
    const f=pedMin(r[ix.fec]); if(!f){ sinFecha++; continue; }
    const e=PED_EST[pedNorm(r[ix.est])]||'O';
    out.push([Number(r[ix.num])||String(r[ix.num]).trim(), Number(r[ix.ori])||String(r[ix.ori]).trim(), f, e, Math.round(Number(r[ix.sku])||0), pedCat(ix.raz>=0?r[ix.raz]:''), ix.act>=0?pedMin(r[ix.act]):0, ix.rec>=0?pedMin(r[ix.rec]):0, 0, bod]);
  }
  return {rows:out, otras, sinFecha};
}
function pedIntegrate(rows){
  let corte=0, fmin=Infinity, fmax=0;
  rows.forEach(x=>{ corte=Math.max(corte,x[2],x[6],x[7]); fmin=Math.min(fmin,x[2]); fmax=Math.max(fmax,x[2]); });
  let nuevos=0, cambios=0, viejos=0;
  for(const x of rows){
    x[8]=corte; const k=x[0]+'-'+x[1], o=PED.rows.get(k);
    { const a=(o&&o[10])||PED.asgP[k]||0; if(a){ x[10]=a; delete PED.asgP[k]; } }
    if(pedViejo(x)){ viejos++; if(o){ PED.rows.delete(k); PED.touch.add(pedMonth(o[2])); } continue; }
    if(!o){ PED.rows.set(k,x); PED.touch.add(pedMonth(x[2])); nuevos++; continue; }
    const ro=PED_RANK[o[3]]??-1, rx=PED_RANK[x[3]]??-1;
    if(rx>ro || (rx===ro && x[8]>=o[8])){
      if(JSON.stringify(o)!==JSON.stringify(x)){ PED.touch.add(pedMonth(o[2])); PED.touch.add(pedMonth(x[2])); PED.rows.set(k,x); if(o[3]!==x[3]||o[4]!==x[4]) cambios++; }
    }
  }
  if(rows.length){ PED.cortes.push({t:corte,ini:fmin,fin:fmax,n:rows.length,cargado:new Date().toISOString()}); PED.cortes.sort((a,b)=>a.t-b.t); PED.cortes=PED.cortes.slice(-120); }
  // conservar 13 meses
  const lim=pedMonth(corte-60*24*400);
  for(const [k,x] of PED.rows) if(pedMonth(x[2])<lim){ PED.rows.delete(k); PED.touch.add(pedMonth(x[2])); }
  for(const [k,x] of PED.rows) if(pedViejo(x)){ PED.rows.delete(k); PED.touch.add(pedMonth(x[2])); }
  return {nuevos,cambios,corte,viejos};
}
function pedRowsB(){ const lc=pedLastCorte(); const a=[...PED.rows.values()].filter(x=>x[3]==='A'||x[8]>=lc); return PED.bod==='all'?a:a.filter(x=>pedB(x)===PED.bod); }
function pedBacklog(est){
  const lc=pedLastCorte(), rows=[...PED.rows.values()].filter(x=>(PED.bod==='all'||pedB(x)===PED.bod)&&est.has(x[3]));
  const ok=rows.filter(x=>x[8]>=lc), stale=rows.filter(x=>x[8]<lc);
  return {lc,ok,stale};
}

/* ---------------- Hora de asignación: se toma del Rpt_OrdenesPreparacion (Pedido + Sucursal + Fecha Creación) ---------------- */
const PED_SUC_INV=(()=>{ const m={}; for(const c in PED_SUC) m[pedNorm(PED_SUC[c])]=+c; return m; })();
function pedAsgParse(buf){
  const wb=XLSX.read(buf,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]];
  const A=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null});
  let h=-1; for(let i=0;i<Math.min(A.length,30);i++){ const r=(A[i]||[]).map(pedNorm); if(r.includes('ORDEN DE PREPARACION')&&r.includes('PEDIDO')&&r.includes('FECHA CREACION')){h=i;break;} }
  if(h<0) return null;
  const H=A[h].map(pedNorm), c=n=>H.indexOf(n), ix={suc:c('SUCURSAL'),ped:c('PEDIDO'),fc:c('FECHA CREACION'),fa:c('FECHA ACTUALIZADO')};
  const M=new Map(); let sinSuc=0, maxT=0;
  for(let i=h+1;i<A.length;i++){ const r=A[i]; if(!r||r[ix.ped]==null||r[ix.ped]==='') continue;
    const code=PED_SUC_INV[pedNorm(r[ix.suc])]; if(code==null){ sinSuc++; continue; }
    const t=pedMin(r[ix.fc]); if(!t) continue; maxT=Math.max(maxT,t,ix.fa>=0?pedMin(r[ix.fa]):0);
    const k=(Number(r[ix.ped])||String(r[ix.ped]).trim())+'-'+code; const o=M.get(k); if(!o||t<o) M.set(k,t); }
  return {M,sinSuc,maxDay:maxT?pedDay(maxT):null};
}
function pedAsgApply(M){
  let a=0,p=0;
  for(const [k,t] of M){ const x=PED.rows.get(k);
    if(x){ if(!x[10]||t<x[10]){ x[10]=t; PED.touch.add(pedMonth(x[2])); a++; } }
    else if(!PED.asgP[k]||t<PED.asgP[k]){ PED.asgP[k]=t; p++; } }
  return {n:M.size,a,p};
}
var __exp={PED,pedParse,pedIntegrate,pedAsgParse,pedAsgApply,pedRowsB,pedBacklog,pedLastCorte};
