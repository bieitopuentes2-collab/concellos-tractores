
(()=>{'use strict';
const $=id=>document.getElementById(id), safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=x=>JSON.parse(JSON.stringify(x));
const slug=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const colors={avaria:'#d94b46',visitado:'#1a9a72',fotos:'#2589ce',contactado:'#edb247',pendente:'#929e9c','sen-tractor':'#929e9c','so-apero':'#8166b5','non-localizado':'#d6a133'};
const labels={avaria:'Avaría detectada',visitado:'Visita presencial',fotos:'Fotos sen visita',contactado:'Contactado',pendente:'Pendente','sen-tractor':'Sen tractor asignado','so-apero':'Só apero','non-localizado':'Visitado · tractor sen localizar'};
// ===== v2 · CONTROL ADMINISTRATIVO (novo, novembro 2026) =====
// Interruptor: fotografías e documentos OCULTOS (a app queda só para control da información).
// O código, as táboas (concellos_files) e o bucket mantéñense; para volver amosalos, poñer true.
const MOSTRAR_DOCUMENTOS=false;
// Estado xeral do concello (clave `estadoXeral` dentro de `change`). Textos exactos, non cambiar sen migrar datos.
const ESTADOS_XERAIS=['Sen tractor','Sen info','Info non localizable','KMZ preparado','En campo','Campo pechado','Cargado na GDB'];
const COR_XERAL={'Sen tractor':'#e9d5c3','Sen info':'#a3adab','Info non localizable':'#d6a133','KMZ preparado':'#2589ce','En campo':'#8166b5','Campo pechado':'#1a9a72','Cargado na GDB':'#123b32','':'#dce5df'};
// Campos do separador «Control». Todos gárdanse en `change` (merge) coa mesma comprobación de updated_at.
// tipo: t=texto, n=número, d=data (AAAA-MM-DD), sn=Si/Non, ck=marca (Si/Non), e=estado xeral, a=texto longo
const CAMPOS_CONTROL=[
 ['estadoXeral','Estado xeral','e'],['kmzData','Data de preparación do KML/KMZ','d'],['kmzFicheiro','Ficheiro KML/KMZ para campo','t'],
 ['tramos','Tramos preparados','n'],['kmPreparados','km preparados','n'],['tramosSeguros','Tramos seguros','n'],['tramosAproximados','Tramos aproximados','n'],
 ['excelCompanheiro','Excel que acompaña ao KML','ck'], // v3.3: marca (antes desplegable Si/Non; mesmos valores)
 ['kmFeitos','Resultado de campo · km feitos','n'],['kmNonFeitos','Resultado de campo · km non feitos','n'],
 ['actaEnviada','Acta enviada','ck'],['actaAsinada','Acta recibida/asinada','ck'],
 ['notaCampo','Nota de control de campo (visitas)','a'],['notaChamadas','Nota de control de chamadas e correos','a']];
// Nota: as instrucións por concello e a data da acta quitáronse (decisión de Bieito). O PDF xeral de cores é común.
// Modo de cor do mapa: 'seguimento' (orixinal: visitas/avarías) ou 'control' (estado xeral)
let modoCor=(()=>{try{return localStorage.getItem('cb-modoCor')||'seguimento'}catch(e){return 'seguimento'}})();
function estadoXeral(r){return ESTADOS_XERAIS.includes(r.estadoXeral)?r.estadoXeral:''}
function corFicha(r){return modoCor==='control'?COR_XERAL[estadoXeral(r)]:colors[inspectState(r).state]}
function numOu0(v){const n=parseFloat(String(v??'').replace(',','.'));return isNaN(n)?0:n}
function fmtKm(n){return String(Math.round(n*100)/100).replace('.',',')} // coma decimal sempre (non depende do navegador)
let client=null,me='',group='',rows=new Map(),currentId='',map=null,layer=null,provinceLayer=null,mapFeatures=null,provinceFeatures=null,refreshTimer=null,busy=false,dirty=false;
let conn=JSON.parse(localStorage.getItem('cb-config')||'{}'); $('url').value=conn.url||'https://kibwuguhptwrogcxjbxn.supabase.co';$('key').value=conn.key||'sb_publishable_r3uvJUZ5SGmV8X5ZEcquFQ_qlSbsZjr';
function toast(msg,error=false){let t=$('toast');t.textContent=msg;t.style.background=error?'#972e37':'#193a30';t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),4900)}
function notice(s){$('appNotice').textContent=s;$('appNotice').classList.toggle('hidden',!s)}
function base(row){return {...(row.record||{}),...(row.change||{})}}
// v2: as fichas con change.oculto=true (p. ex. fusionadas noutra, ver fusionadoEn) non se amosan nin se contan
function all(){return [...rows.values()].map(x=>base(x)).filter(r=>r.oculto!==true).sort((a,b)=>String(a.name).localeCompare(String(b.name),'gl'))}
// Unha avaría histórica ou unha peza danada NON equivale a tractor inmobilizado.
// Só se destaca parada por avaría expresamente indicada nas notas dunha saída.
function stopForBreakdown(r){
 const visits=r.visits||[];
 const decisive=/\b(?:parad[oa]|inmobilizad[oa]|sen funcionar|non funciona|no funciona|fuera de servicio|fora de servizo)\b.{0,65}\b(?:av[eí]r[ií]a|aver[ií]a|rotura|roto|estropead[oa])\b|\b(?:av[eí]r[ií]a|aver[ií]a)\b.{0,60}\b(?:parad[oa]|inmobilizad[oa]|sen funcionar|non funciona)\b/i;
 const text=visits.map(v=>[v.traballo,v.observacions].filter(Boolean).join(' ')).join(' ');
 return decisive.test(text);
}
// CASOS ESPECIAIS CODIFICADOS (mantidos en v2 por seguridade):
//  · Crecente = só apero (0 tractores) · Negreira = por defecto «tractor non localizado» se non hai estadoVisita; o selector gárdase e respéctase (v3.4, petición de Bieito).
//  · Aranga sen visitas = «fotos» · Poio = 2 tractores.
// Afectan só á cor/etiqueta de SEGUIMENTO e ao reconto de tractores; NON afectan ao estado xeral de control.
function isCrecente(r){return slug(r.name)==='CRECENTE'}
function isNegreira(r){return slug(r.name)==='NEGREIRA'}
function isAranga(r){return slug(r.name)==='ARANGA'}
function hasPlate(r){return (r.machines||[]).some(m=>String(m.matricula||'').trim().length>2)}
// A matrícula documentada é a referencia para distinguir asignacións de rexistros pendentes.
// Negreira ten tractor (por defecto «non-localizado» ata que se garde outro estado); Crecente só dispón de apero.
function noTractor(r){return !isNegreira(r)&&!isCrecente(r)&&!hasPlate(r)}
function tractorCount(r){if(isCrecente(r)||noTractor(r))return 0;if(isNegreira(r))return 1;if(slug(r.name)==='POIO')return 2;return 1}
function inspectState(r){
 const manual=String(r.estadoMecanico||'').toLowerCase();
 const broken=manual==='avariada-confirmada'||(!['operativa','reparada','en-reparacion'].includes(manual)&&stopForBreakdown(r));
 // A visita ao concello non acredita por si soa a comprobación física da máquina.
 let visit=String(r.estadoVisita||'').toLowerCase();
 // v3.4: Negreira usa o valor gardado en estadoVisita; se non hai, queda o histórico «non-localizado».
 if(isNegreira(r)&&!['pendente','contactado','fotos','visitado','non-localizado'].includes(visit))visit='non-localizado';
 else if(isAranga(r)&&!(r.visits||[]).length)visit='fotos';
 else if(noTractor(r))visit='sen-tractor';
 else if(isCrecente(r))visit='visitado';
 else if(!visit||visit==='pendente'||visit==='contactado')visit='visitado';
 let state=isCrecente(r)?'so-apero':noTractor(r)?'sen-tractor':visit==='non-localizado'?'non-localizado':broken?'avaria':visit==='fotos'?'fotos':visit==='visitado'?'visitado':visit==='contactado'?'contactado':'pendente';
 return {state,visit,broken};
}
function kpis(){let a=all(),nvisit=a.filter(r=>inspectState(r).visit==='visitado').length,nfoto=a.filter(r=>inspectState(r).visit==='fotos').length,nbroken=a.filter(r=>inspectState(r).state==='avaria').length,m=a.reduce((s,r)=>s+tractorCount(r),0),nwithout=a.filter(noTractor).length;let stats=[['Concellos',a.length],['Tractores identificados ou declarados',m],['Visitados',nvisit],['Fotos sen visita',nfoto],['Paradas por avaría rexistradas',nbroken],['Sen tractor na relación',nwithout]];
 // v3: o resumo de control vai primeiro; o de seguimento queda nun bloque despregable (mantense aberto/pechado entre actualizacións)
 const prev=$('kpis').querySelector('.segSum'),segOpen=prev?prev.open:false;
 $('kpis').innerHTML=kpisControl(a)+`<details class="segSum"${segOpen?' open':''}><summary>Seguimento · ${a.length} concellos</summary><div class="kpis">${stats.map(([k,v])=>`<div class="kpi"><b>${v}</b><span>${safe(k)}</span></div>`).join('')}</div></details>`}
// Resumo de CONTROL: km totais (destacados) e concellos por estado xeral (un clic filtra a lista)
function kpisControl(a){const n=e=>a.filter(r=>estadoXeral(r)===e).length,sum=k=>a.reduce((s,r)=>s+numOu0(r[k]),0),fv=$('filterXeral')?.value||'';
 const est=[...ESTADOS_XERAIS,''].map(e=>[e,n(e)]).filter(([e,v])=>e||v);
 return `<section class="sumCard" aria-label="Resumo de control"><div class="sumTitle">Control · estado xeral</div>
<div class="kmRow"><div class="kmBox"><b>${fmtKm(sum('kmPreparados'))}</b><span>km preparados</span></div><div class="kmBox"><b>${fmtKm(sum('kmFeitos'))}</b><span>km feitos</span></div><div class="kmBox"><b>${fmtKm(sum('kmNonFeitos'))}</b><span>km non feitos</span></div></div>
<div class="ctrlGrid">${est.map(([e,v])=>{const k=e||'__sen';return `<button type="button" class="ctrlChip${fv===k?' on':''}" data-xeral="${safe(k)}" aria-pressed="${fv===k}" title="Filtrar a lista: ${safe(e||'Sen definir')}"><i class="dot" style="background:${COR_XERAL[e]}"></i><span class="lbl">${safe(e||'Sen definir')}</span><b>${v}</b></button>`}).join('')}</div><div class="actaRow"><span>✉ Actas enviadas <b>${a.filter(r=>r.actaEnviada==='Si').length}</b></span><span>✍ Actas asinadas <b>${a.filter(r=>r.actaAsinada==='Si').length}</b></span></div></section>`}

function matchFilter(r){let q=slug($('search').value);let ok=!q||slug([r.name,r.prov,r.empresa,...(r.machines||[]).map(m=>[m.matricula,m.marca,m.modelo]),r.notaSeaga].join(' ')).includes(q);return ok&&(!$('province').value||r.prov===$('province').value)&&(!$('filter').value||inspectState(r).state===$('filter').value)&&(!$('filterXeral')?.value||($('filterXeral').value==='__sen'?!estadoXeral(r):estadoXeral(r)===$('filterXeral').value))}
function renderList(){let a=all().filter(matchFilter),ctl=modoCor==='control';$('list').innerHTML=a.map(r=>{const st=inspectState(r),ex=estadoXeral(r),lbl=ctl?(ex||'Sen definir'):labels[st.state],bc=ctl?COR_XERAL[ex]:colors[st.state],kp=numOu0(r.kmPreparados),kf=numOu0(r.kmFeitos);
 const nums=(kp?`<span><b>${fmtKm(kp)}</b> km prep.</span>`:'')+(kf?`<span><b>${fmtKm(kf)}</b> km feitos</span>`:'');
 return `<button class="item ${r.id===currentId?'active':''}" data-id="${safe(r.id)}" style="border-left-color:${corFicha(r)}"><span class="itemMain"><strong class="itemName">${safe(r.name)}</strong><span class="itemSub">${safe(r.prov)} · ${tractorCount(r)} tractor(es)${isCrecente(r)?' · só apero':st.state==='non-localizado'?' · tractor non localizado':''}${r.actaEnviada==='Si'||r.actaAsinada==='Si'?` <span class="actaIcos">${r.actaEnviada==='Si'?'<i title="Acta enviada">✉</i>':''}${r.actaAsinada==='Si'?'<i title="Acta asinada">✍</i>':''}</span>`:''}</span>${nums?`<span class="itemNums">${nums}</span>`:''}</span><span class="badge" style="--c:${bc}">${safe(lbl)}</span></button>`}).join('')||'<div class="pad muted">Sen resultados cos filtros actuais.</div>';$('list').querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>openRecord(b.dataset.id)));
 const fv=$('filterXeral')?.value||'';document.querySelectorAll('#kpis .ctrlChip').forEach(c=>{const on=c.dataset.xeral===fv;c.classList.toggle('on',on);c.setAttribute('aria-pressed',on)})}

// ===== TICKET 02 · Mapa cartográfico (IGN/CNIG, sen API key) =====
const IGN_WMTS=(svc,layer,fmt)=>`https://www.ign.es/wmts/${svc}?service=WMTS&request=GetTile&version=1.0.0&layer=${layer}&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}&format=${fmt}`;
const IGN_ATTR='© <a href="https://www.ign.es" target="_blank" rel="noopener">IGN</a>/CNIG · CC BY 4.0 scne.es';
const BASES={
 orto:{label:'Ortofoto PNOA',url:IGN_WMTS('pnoa-ma','OI.OrthoimageCoverage','image/jpeg'),nat:19,attr:'Ortofoto PNOA máxima actualidad '+IGN_ATTR,alt:'ortow'},
 // v3.3: mesma ortofoto PNOA servida polo WMS oficial do IGN. Úsase só se o WMTS falla (non aparece no selector).
 ortow:{label:'Ortofoto PNOA (WMS)',wms:'https://www.ign.es/wms-inspire/pnoa-ma',layers:'OI.OrthoimageCoverage',nat:19,attr:'Ortofoto PNOA máxima actualidad (WMS) '+IGN_ATTR,alt:'gris',oculto:true},
 topo:{label:'Topográfico IGN',url:IGN_WMTS('mapa-raster','MTN','image/jpeg'),nat:17,attr:'Cartografía ráster '+IGN_ATTR,alt:'gris'},
 gris:{label:'Mapa base sinxelo',url:IGN_WMTS('ign-base','IGNBase-gris','image/jpeg'),nat:18,attr:'Mapa base '+IGN_ATTR,alt:'osm'},
 osm:{label:'OpenStreetMap',url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',nat:19,attr:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',alt:'none'},
 none:{label:'Sen fondo (só límites)',url:null}
};
const LABELS_URL=IGN_WMTS('ign-base','IGNBaseOrto','image/png');
const PNOA_WMS='https://www.ign.es/wms-inspire/pnoa-ma';
// v3.3: a preferencia de fondo gárdase nunha clave nova. Na v3.2 un fallo puntual de teselas (cobertura móbil) gardaba
// o fondo alternativo («Mapa base sinxelo») como preferencia e a ortofoto xa non volvía aparecer nunca máis nese dispositivo.
const PREF_BASE='base33';
const isImg=k=>k==='orto'||k==='ortow'||k==='topo',isOrto=k=>k==='orto'||k==='ortow';
const pref=(k,v)=>{try{if(v===undefined)return localStorage.getItem('cb-'+k);localStorage.setItem('cb-'+k,String(v))}catch(e){return null}};
let baseKey='orto',baseLayer=null,labelsLayer=null,fillOp=null,byNameMap=new Map(),layerById=new Map(),selId='',gpsLayer=null,orthoCtl=null,orthoTimer=null,orthoCache=new Map(),orthoAbort=null,tileStat={err:0,ok:0,key:''};
const isMobile=()=>matchMedia('(max-width:1000px)').matches;
function lookupFeature(f,names){let n=[f.properties?.name,f.properties?.NAME,f.properties?.nombre,f.properties?.municipality].filter(Boolean);for(let x of n){let m=names.get(slug(x));if(m)return m;}return null}
function curOpacity(){return fillOp??(isImg(baseKey)?.4:.82)}
// v3.3: sobre a ortofoto as cores dos concellos esvaécense ao achegarse, para que a imaxe se vexa (antes tapábana ao 50 %)
function zoomFade(){if(!isImg(baseKey)||!map)return 1;const z=map.getZoom();return z>=13?.15:z>=11?.4:z>=9?.7:1}
function featStyle(f){
 const r=lookupFeature(f,byNameMap),onImg=isImg(baseKey),sel=r&&r.id===selId,op=curOpacity()*zoomFade();
 return {color:sel?'#ffd400':onImg?'#ffffffcc':'#ffffff',weight:sel?4:onImg?.9:.7,fillColor:r?corFicha(r):'#dce5df',fillOpacity:r?(sel&&onImg?Math.min(op,.12):op):(onImg?0:.35)};
}
function provStyle(){const onImg=isImg(baseKey);return {color:onImg?'#ffffff':'#26443b',weight:onImg?3.4:3,opacity:.95,fill:false}}
function mapNotice(s){const n=$('mapNotice');if(!n)return;n.textContent=s||'';n.classList.toggle('hidden',!s)}
function setBase(k,why){
 if(!BASES[k])k='orto';baseKey=k;if(why!=='fallback'&&why!=='init')pref(PREF_BASE,k); // o fondo alternativo automático NON se garda
 if(baseLayer){baseLayer.remove();baseLayer=null}
 const b=BASES[k];tileStat={err:0,ok:0,key:k};
 if(b.url||b.wms){
  const lo={maxZoom:19,maxNativeZoom:b.nat,attribution:b.attr,updateWhenIdle:true,keepBuffer:1,crossOrigin:false,errorTileUrl:'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='};
  baseLayer=b.wms?L.tileLayer.wms(b.wms,{...lo,layers:b.layers,format:'image/jpeg',transparent:false,version:'1.3.0',styles:''}):L.tileLayer(b.url,lo);
  baseLayer.on('tileload',e=>{if(tileStat.key===k&&!String(e.tile?.src||'').startsWith('data:'))tileStat.ok++});
  baseLayer.on('tileerror',()=>{if(tileStat.key!==k)return;tileStat.err++;if(tileStat.ok===0&&tileStat.err>=6&&b.alt&&navigator.onLine!==false){const alt=b.alt;mapNotice(`${b.label} non dispoñible agora. Amosando «${BASES[alt].label}».`);setTimeout(()=>mapNotice(''),9000);setBase(alt,'fallback');syncBasePanel()}});
  baseLayer.addTo(map);
 }
 if(!why)mapNotice('');
 if(labelsLayer){labelsLayer.remove();labelsLayer=null}
 if(isOrto(k)&&pref('labels')!=='0'){labelsLayer=L.tileLayer(LABELS_URL,{pane:'labels',maxZoom:19,maxNativeZoom:18,updateWhenIdle:true,keepBuffer:1}).addTo(map)}
 if(layer)layer.setStyle(featStyle);if(provinceLayer)provinceLayer.setStyle(provStyle());
 $('map').style.background=k==='none'?'#eef2f0':'#dfe7e2';
 updateOrtho();
}
function syncBasePanel(){document.querySelectorAll('input[name=cbBase]').forEach(i=>i.checked=i.value===(baseKey==='ortow'?'orto':baseKey));const lb=document.querySelector('#cbLabels');if(lb)lb.closest('label').style.display=isOrto(baseKey)?'':'none';const op=document.querySelector('#cbOpacity');if(op)op.value=Math.round(curOpacity()*100)}
function orthoSrc(){return isMobile()?'PNOA MA · IGN':'Ortofoto PNOA máxima actualidad · IGN/CNIG'}
function updateOrtho(){
 if(!orthoCtl)return;const el=orthoCtl.getContainer();
 if(!isOrto(baseKey)){el.style.display='none';return}
 el.style.display='';clearTimeout(orthoTimer);
 if(map.getZoom()<11){el.textContent=orthoSrc()+' · achégate para ver a data de voo';return}
 orthoTimer=setTimeout(queryOrthoDate,900);
}
async function queryOrthoDate(){
 const el=orthoCtl.getContainer(),c=map.getCenter(),key=c.lat.toFixed(2)+','+c.lng.toFixed(2);
 const show=d=>{el.textContent=orthoSrc()+' · '+(d?(isMobile()?'voo: ':'voo no centro do mapa: ')+d:'data de voo non dispoñible')};
 if(orthoCache.has(key))return show(orthoCache.get(key));
 el.textContent=orthoSrc()+' · consultando data…';
 try{orthoAbort?.abort();orthoAbort=new AbortController();const d=.0005;
  const u=`${PNOA_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=OI.MosaicElement&QUERY_LAYERS=OI.MosaicElement&STYLES=&CRS=EPSG:4326&BBOX=${c.lat-d},${c.lng-d},${c.lat+d},${c.lng+d}&WIDTH=11&HEIGHT=11&I=5&J=5&INFO_FORMAT=application/json&FEATURE_COUNT=1`;
  const r=await fetch(u,{signal:orthoAbort.signal,credentials:'omit'});if(!r.ok)throw Error(r.status);
  const j=await r.json(),p=j?.features?.[0]?.properties||{};const k=Object.keys(p).find(x=>/fech|date|vuelo/i.test(x));
  let v=k?String(p[k]):'';const m=v.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);if(m)v=(m[3]?m[3]+'/':'')+m[2]+'/'+m[1];const rk=Object.keys(p).find(x=>/resol/i.test(x));if(v&&rk&&p[rk])v+=` · ${String(p[rk]).replace('.',',')} m/píxel`;
  orthoCache.set(key,v);show(v);
 }catch(e){if(e.name==='AbortError')return;orthoCache.set(key,'');show('')}
}
function control(pos,build){const C=L.Control.extend({onAdd(){const d=L.DomUtil.create('div','leaflet-control cb');L.DomEvent.disableClickPropagation(d);L.DomEvent.disableScrollPropagation(d);build(d);return d}});return new C({position:pos}).addTo(map)}
function buildControls(){
 L.control.zoom({position:'topright'}).addTo(map);
 control('topright',d=>{d.innerHTML=`<button class="cb-btn" id="cbLayersBtn" title="Fondo e transparencia" aria-label="Fondo e transparencia" aria-expanded="false">▦</button><div class="cb-panel hidden" id="cbLayers"><h4>Fondo</h4>${Object.entries(BASES).filter(([,b])=>!b.oculto).map(([k,b])=>`<label><input type="radio" name="cbBase" value="${k}"> ${safe(b.label)}</label>`).join('')}<label><input type="checkbox" id="cbLabels"> Topónimos sobre a ortofoto</label><h4 style="margin-top:8px">Colorear concellos por</h4><label><input type="radio" name="cbModo" value="seguimento"> Seguimento (visitas / avarías)</label><label><input type="radio" name="cbModo" value="control"> Estado xeral (control)</label><h4 style="margin-top:8px">Transparencia das cores</h4><input type="range" id="cbOpacity" min="0" max="100" step="5" aria-label="Opacidade das cores municipais"><div class="muted tiny" id="cbOpLabel"></div></div>`;
  const panel=d.querySelector('#cbLayers'),btn=d.querySelector('#cbLayersBtn');
  btn.onclick=()=>{const open=panel.classList.toggle('hidden')===false;btn.classList.toggle('on',open);btn.setAttribute('aria-expanded',open);btn.classList.toggle('hidden',open)};
  map.on('click',()=>{panel.classList.add('hidden');btn.classList.remove('hidden','on')});
  d.querySelectorAll('input[name=cbBase]').forEach(i=>i.onchange=()=>{setBase(i.value);syncBasePanel()});
  d.querySelectorAll('input[name=cbModo]').forEach(i=>{i.checked=i.value===modoCor;i.onchange=()=>setModoCor(i.value)});
  const lb=d.querySelector('#cbLabels');lb.checked=pref('labels')!=='0';lb.onchange=()=>{pref('labels',lb.checked?'1':'0');setBase(baseKey)};
  const op=d.querySelector('#cbOpacity'),opl=d.querySelector('#cbOpLabel');const lab=()=>opl.textContent=`Opacidade: ${op.value} %`;
  op.oninput=()=>{fillOp=op.value/100;pref('opacity',fillOp);lab();if(layer)layer.setStyle(featStyle)};
  setTimeout(()=>{syncBasePanel();lab()},0);
 });
 control('topright',d=>{d.innerHTML='<button class="cb-btn" id="cbGps" title="A miña posición (opcional)" aria-label="Amosar a miña posición">⌖</button>';d.querySelector('#cbGps').onclick=toggleGps});
 L.control.scale({position:'bottomleft',imperial:false,maxWidth:120}).addTo(map);
 control('bottomleft',d=>{d.id='cbLegendBox';renderLegend(d)});
 orthoCtl=control('bottomright',d=>{d.className+=' orthoInfo'});
 map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
}
// Lenda segundo o modo de cor (seguimento ou estado xeral)
function renderLegend(d){d=d||$('cbLegendBox');if(!d)return;const open=d.querySelector('details')?d.querySelector('details').open:!isMobile();
 const items=modoCor==='control'?[...ESTADOS_XERAIS.map(e=>[COR_XERAL[e],e]),[COR_XERAL[''],'Sen definir']]:Object.keys(labels).map(k=>[colors[k],labels[k]]);
 d.innerHTML=`<details class="cb-legend" ${open?'open':''}><summary>Lenda · ${modoCor==='control'?'estado xeral':'seguimento'}</summary>${items.map(([c,t])=>`<div><i class="mark" style="background:${c}"></i>${safe(t)}</div>`).join('')}<div><i class="mark" style="background:transparent;border:2px solid #ffd400"></i>Concello seleccionado</div></details>`}
function setModoCor(m){modoCor=m==='control'?'control':'seguimento';try{localStorage.setItem('cb-modoCor',modoCor)}catch(e){}document.querySelectorAll('input[name=cbModo]').forEach(i=>i.checked=i.value===modoCor);renderLegend();render()}
function toggleGps(){
 const b=$('cbGps');
 if(gpsLayer){gpsLayer.remove();gpsLayer=null;b.classList.remove('on');return}
 if(!navigator.geolocation){toast('Este navegador non permite a localización',true);return}
 b.disabled=true;
 navigator.geolocation.getCurrentPosition(p=>{b.disabled=false;const ll=[p.coords.latitude,p.coords.longitude],acc=Math.round(p.coords.accuracy);
  gpsLayer=L.layerGroup([L.circle(ll,{radius:acc,color:'#2a7fff',weight:1,fillOpacity:.12,interactive:false}),L.marker(ll,{icon:L.divIcon({className:'gpsDot',iconSize:[16,16]}),keyboard:false}).bindTooltip(`A túa posición (±${acc} m). Non se garda.`)]).addTo(map);
  b.classList.add('on');map.flyTo(ll,Math.max(map.getZoom(),14),{duration:.6});
 },e=>{b.disabled=false;toast(e.code===1?'Permiso de localización denegado. Actívao en Axustes se o necesitas.':'Non se puido obter a posición: '+e.message,true)},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
}
function gpsFill(input){
 if(!navigator.geolocation){toast('Este navegador non permite a localización',true);return}
 navigator.geolocation.getCurrentPosition(p=>{const t=`GPS ${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)} (±${Math.round(p.coords.accuracy)} m)`;input.value=input.value.trim()?input.value.trim()+' · '+t:t;input.dispatchEvent(new Event('input',{bubbles:true}));toast('Posición engadida ao campo. Revísaa antes de gardar.')},e=>toast(e.code===1?'Permiso de localización denegado':'Non se puido obter a posición',true),{enableHighAccuracy:true,timeout:15000});
}
async function loadBoundaries(){
 const toFeat=(t,o)=>topojson.feature(t,t.objects[o]).features.filter(f=>/^(15|27|32|36)/.test(String(f.id??f.properties?.id??'')));
 try{const r=await fetch('galicia.json');if(!r.ok)throw Error(r.status);const t=await r.json();return {mun:toFeat(t,'municipalities'),prov:toFeat(t,'provinces')}}
 catch(e){console.warn('galicia.json non dispoñible, uso es-atlas',e);
  const [a,b]=await Promise.all([fetch('https://unpkg.com/es-atlas/es/municipalities.json'),fetch('https://unpkg.com/es-atlas/es/provinces.json')]);if(!a.ok)throw Error('HTTP '+a.status);
  return {mun:toFeat(await a.json(),'municipalities'),prov:b.ok?toFeat(await b.json(),'provinces'):[]}}
}
function renderMap(){
 if(!map||!layer)return;
 byNameMap=new Map(all().map(r=>[slug(r.name),r]));layerById=new Map();
 layer.eachLayer(l=>{const r=lookupFeature(l.feature,byNameMap);if(r)layerById.set(r.id,l)});
 layer.setStyle(featStyle);highlight(currentId,false);
}
function highlight(id,fit){
 selId=id||'';if(!layer)return;layer.setStyle(featStyle);
 const l=layerById.get(id);if(!l)return;l.bringToFront();provinceLayer?.bringToFront();
 if(fit){const b=l.getBounds(),m=isMobile();map.flyToBounds(b,m?{paddingTopLeft:[24,70],paddingBottomRight:[24,Math.round(innerHeight*.55)],maxZoom:12,duration:.6}:{padding:[50,50],maxZoom:12,duration:.6})}
}
async function initMap(){
 map=L.map('map',{zoomControl:false,preferCanvas:true,tap:true,minZoom:6,maxZoom:19,worldCopyJump:false}).setView([42.78,-7.85],8);
 map.createPane('labels');map.getPane('labels').style.zIndex=450;map.getPane('labels').style.pointerEvents='none';
 const savedOp=parseFloat(pref('opacity'));if(!isNaN(savedOp))fillOp=savedOp;
 buildControls();setBase(pref(PREF_BASE)||'orto','init');map.on('zoomend',()=>{if(layer&&isImg(baseKey))layer.setStyle(featStyle)});
 map.on('moveend',updateOrtho);
 addEventListener('resize',()=>map.invalidateSize());
 try{
  const {mun,prov}=await loadBoundaries();if(!mun.length)throw Error('Non se atoparon os límites de Galicia');
  mapFeatures=mun;provinceFeatures=prov;
  const hover=matchMedia('(hover:hover)').matches;
  layer=L.geoJSON(mun,{style:featStyle,onEachFeature:(f,l)=>{if(hover)l.bindTooltip(safe(f.properties?.name||'Concello'),{sticky:true});l.on('click',()=>{const r=lookupFeature(f,byNameMap);if(r)openRecord(r.id,{fromMap:true});else toast(`${f.properties?.name||'Este concello'} non ten ficha de seguimento`)})}}).addTo(map);
  if(prov.length){provinceLayer=L.geoJSON(prov,{interactive:false,style:provStyle()}).addTo(map);provinceLayer.bringToFront()}
  map.fitBounds(layer.getBounds(),{padding:[12,12]});map.setMaxBounds(layer.getBounds().pad(.6));
  renderMap();
 }catch(e){console.error(e);mapNotice('Non se puideron cargar os límites municipais; a lista segue funcionando.')}
}
function render(){kpis();renderList();renderMap();if(currentId)renderDetail()}
function labelRow(k,v){return `<p><strong>${safe(k)}:</strong> ${safe(v??'—')}</p>`}
function editButton(action,title){return `<button class="btn" data-action="${action}">${title}</button>`}
// ===== TICKET 02 · Ficha con pestanas, folla inferior móbil, estado de sincronización =====
// v2: engádese «Control». «Documentación» (fotos/PDF) queda oculta mentres MOSTRAR_DOCUMENTOS=false.
// v3.3: «Visitas» leva tamén os km e as notas de campo; «Chamadas» (novo) leva as notas de chamadas/correos e os contactos.
// «Control» queda só con marcas (ticks) e o estado xeral.
const TABS=[['ctrl','Control'],['info','Información'],['maq','Maquinaria'],['vis','Visitas'],['cham','Chamadas'],['trab','Traballos'],['doc','Documentación']].filter(([k])=>k!=='doc'||MOSTRAR_DOCUMENTOS);
let currentTab=TABS.some(([k])=>k===pref('tab'))?pref('tab'):'ctrl',lastSync=null,syncState='idle';
function setSync(state,msg){
 syncState=state;const el=$('syncLabel');if(!el)return;
 if(state==='ok')lastSync=new Date();
 const t={ok:`Sincronizado ${lastSync?lastSync.toLocaleTimeString('gl-ES',{hour:'2-digit',minute:'2-digit'}):''}`,saving:'Gardando…',loading:'Sincronizando…',dirty:'Cambios sen gardar',error:'Erro de sincronización',offline:'Sen conexión',idle:'Sen conectar'}[state]||state;
 el.className='sync '+state;document.body.classList.toggle('cb-dirty',state==='dirty');el.textContent=msg||t;el.title=msg||t;
 const sv=document.querySelector('[data-quick="save"]');if(sv)sv.classList.toggle('pulse',state==='dirty');
}
function markDirty(){if(!dirty){dirty=true;setSync('dirty')}}
function sheet(state){const s=$('sheet');if(!s)return;s.dataset.state=state;$('actionbar').classList.toggle('hidden',!currentId);if(map)setTimeout(()=>map.invalidateSize(),260)}
function setTab(k,user){currentTab=k;pref('tab',k);document.querySelectorAll('#tabs .tab').forEach(b=>{const on=b.dataset.tab===k;b.classList.toggle('active',on);b.setAttribute('aria-selected',on)});document.querySelectorAll('#detail .pane').forEach(p=>p.classList.toggle('on',p.dataset.pane===k));if(user&&isMobile()&&$('sheet').dataset.state==='peek')sheet('half')}
function tabCounts(r){const d=docsCache.get(currentId);return {maq:(r.machines||[]).length,vis:(r.visits||[]).length,cham:parseNotas(r.notaChamadas).length||'',trab:d?d.acts.filter(a=>!a.anulada).length:'',doc:d?d.files.filter(f=>!f.anulado).length:''}}
function renderTabs(r){const c=tabCounts(r);$('tabs').innerHTML=TABS.map(([k,t])=>`<button role="tab" class="tab${k===currentTab?' active':''}" data-tab="${k}" aria-selected="${k===currentTab}">${t}${c[k]!==undefined&&c[k]!==''?`<small>${c[k]}</small>`:''}</button>`).join('');$('tabs').querySelectorAll('.tab').forEach(b=>b.onclick=()=>setTab(b.dataset.tab,true))}
function renderDetail(){
 const row=rows.get(currentId);
 if(!row){$('detailTitle').textContent='Ficha do concello';$('statusTag').textContent='Selecciona no mapa';$('statusTag').style.background='';$('detailMeta').innerHTML='';$('tabs').innerHTML='';$('detail').innerHTML='<div class="empty muted">Selecciona un concello no mapa ou na lista para ver a súa ficha.</div>';$('actionbar').classList.add('hidden');return}
 const keep=$('detail').scrollTop,r=base(row),s=inspectState(r);
 $('detailTitle').textContent=r.name;$('statusTag').textContent=labels[s.state];$('statusTag').style.background=colors[s.state]+'25';$('statusTag').style.borderColor=colors[s.state];
 $('detailMeta').innerHTML=`<span class="sep">${safe(r.prov||'')}</span><span class="sep">${safe(r.empresa||'Empresa non indicada')}</span><span class="sep">${tractorCount(r)} tractor(es)</span><span class="badge" style="--c:${COR_XERAL[estadoXeral(r)]}" title="Estado xeral">${safe(estadoXeral(r)||'Estado xeral sen definir')}</span><span class="actaIcos" title="Acta enviada / asinada"><i>✉ ${r.actaEnviada==='Si'?'✓':'—'}</i><i>✍ ${r.actaAsinada==='Si'?'✓':'—'}</i></span>`;
 renderTabs(r);$('actionbar').classList.remove('hidden');
 let visits=(r.visits||[]).map((v,i)=>`<div class="entry visitEntry"><div class="visitHead"><strong>${safe(v.fecha||'Sen data')}</strong>${horasBadge(v.horas)}<span class="visitLugar">${safe(v.lugar||'')}</span></div><div>${safe(v.traballo||'')}</div><div>${safe(v.observacions||'')}</div><button class="btn" data-editvisit="${i}">Editar</button></div>`).join('')||'<p class="muted">Non hai visitas gardadas.</p>';
 let machines=(r.machines||[]).map((m,i)=>`<div class="entry"><strong>${safe([m.marca,m.modelo].filter(Boolean).join(' ')||'Máquina sen identificar')}</strong><div>${safe(m.matricula||'Matrícula non indicada')} · ${safe(m.apeiro||'')}</div><div class="mini">Inicio: ${safe(m.inicio||'—')} · Fin: ${safe(m.fin||'—')}</div><button class="btn" data-editmachine="${i}">Editar</button> <button class="btn" data-docmachine="${i}">${MOSTRAR_DOCUMENTOS?'Documentación':'Traballos'}</button></div>`).join('')||'<p class="muted">Sen maquinaria rexistrada.</p>';
 let contacts=(r.contacts||[]).map((c,i)=>`<div class="entry"><strong>${safe(c.contacto||'Contacto')}</strong><button class="btn" data-editcontact="${i}">Editar contacto</button><button class="btn" data-addhistory="${i}">+ Anotación</button><div class="mini">${(c.historial||[]).map((h,j)=>`<div style="margin:7px 0">${safe(h.fecha||'')} · ${safe(h.resumo||'')} <button class="btn" data-edithistory="${i}:${j}">Editar</button></div>`).join('')}</div></div>`).join('')||'<p class="muted">Sen contactos</p>';
 $('detail').innerHTML=`${paneControl(r)}<section class="pane" data-pane="info"><div class="fields"><label class="field">Estado da comprobación<select id="fVisita"><option value="pendente">Pendente</option><option value="contactado">Contactado</option><option value="non-localizado">Concello visitado, tractor non localizado</option><option value="fotos">Fotos recibidas</option><option value="visitado">Visita presencial</option></select></label><label class="field">Estado mecánico<select id="fMecanica"><option value="sen-datos">Sen datos actualizados</option><option value="operativa">Operativa</option><option value="avariada-confirmada">Parado por avaría (confirmado)</option><option value="en-reparacion">En reparación</option><option value="reparada">Reparada</option><option value="parada">Parada por outra causa</option></select></label><label class="field wide">Observacións xerais<textarea id="fNotas"></textarea></label><label class="field wide">Información documental<textarea id="fDoc"></textarea></label></div><div class="block"><h3>Información de orixe e acta de entrega</h3><div class="fields"><label class="field">Empresa<input id="fEmpresa" value="${safe(r.empresa||'')}" placeholder="Empresa"></label><label class="field">Apeiro<input id="fApeiro" value="${safe(r.apeiro||'')}" placeholder="Apeiro asignado"></label><label class="field">Acta<input id="fActa" value="${safe(r.acta||'')}" placeholder="Si / Non / Pendente"></label><label class="field">Acta asinada (Si / Non / Pendente)<input id="fFirmada" value="${safe(r.firmada||'')}" placeholder="Si / Non / Pendente"></label><label class="field wide">Asinada por (nome e cargo)<input id="fAsinadaPor" value="${safe(r.asinadaPor||'')}" placeholder="Nome e cargo"></label></div></div><p class="muted tiny">Os contactos e o seu historial están agora no separador «Chamadas».</p><p class="muted">Modifica os campos e pulsa «Gardar». Os cambios sincronízanse en todos os dispositivos.</p></section>
<section class="pane" data-pane="maq"><div class="paneHead"><h3>Maquinaria (${(r.machines||[]).length}) · Tractores contabilizados: ${tractorCount(r)}</h3><button class="btn" data-action="machine">+ Máquina</button></div>${machines}</section>
${paneVisitas(r,visits)}${paneChamadas(r,contacts)}
<section class="pane" data-pane="trab"><div id="docs"><span class="muted">Cargando…</span></div></section>
${MOSTRAR_DOCUMENTOS?`<section class="pane" data-pane="doc"><div class="paneHead"><h3>Fotografías e documentos</h3></div><div class="flex"><button class="btn big" data-quick="camera"><span>📷</span> Facer foto</button><button class="btn big" data-quick="doc"><span>📄</span> Adxuntar PDF / imaxe</button></div><div id="docsFiles"><span class="muted">Cargando…</span></div></section>`:''}`;
 $('fVisita').value=['pendente','contactado','fotos','visitado','non-localizado'].includes(s.visit)?s.visit:'pendente';$('fMecanica').value=(s.broken?'avariada-confirmada':(r.estadoMecanico==='avariada'?'operativa':r.estadoMecanico||'operativa'));$('fNotas').value=r.notaSeaga||'';$('fDoc').value=r.comprobacionDocumental||'';
 ['fVisita','fMecanica','fNotas','fDoc','fEmpresa','fApeiro','fActa','fFirmada','fAsinadaPor',...CAMPOS_CONTROL.map(c=>'c_'+c[0])].forEach(k=>{$(k).addEventListener('input',markDirty);$(k).addEventListener('change',markDirty)});
 const D=$('detail');bindFicha();
 D.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{let a=b.dataset.action;if(a==='save')saveForm();else if(a==='visit')editVisit(-1);else if(a==='machine')editMachine(-1);else if(a==='photo'&&MOSTRAR_DOCUMENTOS)uploadDialog({});else if(a==='contact')editContact(-1)});
 D.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>quick(b.dataset.quick));
 D.querySelectorAll('[data-editvisit]').forEach(b=>b.onclick=()=>editVisit(+b.dataset.editvisit));D.querySelectorAll('[data-editmachine]').forEach(b=>b.onclick=()=>editMachine(+b.dataset.editmachine));D.querySelectorAll('[data-editcontact]').forEach(b=>b.onclick=()=>editContact(+b.dataset.editcontact));D.querySelectorAll('[data-addhistory]').forEach(b=>b.onclick=()=>editHistory(+b.dataset.addhistory,-1));D.querySelectorAll('[data-edithistory]').forEach(b=>b.onclick=()=>{let [i,j]=b.dataset.edithistory.split(':').map(Number);editHistory(i,j)});
 D.querySelectorAll('[data-docmachine]').forEach(b=>b.onclick=()=>{const k=+b.dataset.docmachine;machineFilter=machineRef((r.machines||[])[k],k);paintDocs(currentId);setTab('trab',true);D.scrollTop=0});
 setTab(currentTab);D.scrollTop=keep;
 loadDocs(currentId);
}
// ===== v3 · Separador «Control»: vista de lectura + modo edición, e notas con data =====
// As claves gardadas NON cambian: estadoXeral, kmzData, kmzFicheiro, tramos, kmPreparados, tramosSeguros, tramosAproximados,
// excelCompanheiro, kmFeitos, kmNonFeitos, actaAsinada, notaCampo, notaChamadas (todas en `change`, coa comprobación de updated_at).
// As notas seguen sendo un texto: cada entrada nova engádese AO PRINCIPIO como unha liña «DD/MM/AAAA · texto»
// (nas chamadas, opcionalmente «DD/MM/AAAA · Chamada: texto» ou «… · Correo: texto»).
let ctrlEdit=false,ctrlEditId='';const borradorNotas=new Map();
const CTRL_UI={estadoXeral:{l:'Estado xeral',h:'Situación global do concello no proceso de control.'},
 kmzData:{l:'Data de preparación'},kmzFicheiro:{l:'Ficheiro KML/KMZ',ph:'p. ex. Concello_campo_linas.kmz',w:1},
 excelCompanheiro:{l:'Excel e instrucións para o compañeiro',h:'Preparado o Excel que acompaña ao KML/KMZ.'},tramos:{l:'Tramos preparados',u:'tramos',st:'1'},kmPreparados:{l:'Lonxitude preparada',u:'km'},
 tramosSeguros:{l:'Tramos seguros',u:'tramos',st:'1'},tramosAproximados:{l:'Tramos aproximados',u:'tramos',st:'1'},
 kmFeitos:{l:'Feitos',u:'km'},kmNonFeitos:{l:'Non feitos',u:'km'},
 actaEnviada:{l:'Acta enviada',h:'Enviada ao concello para asinar.'},actaAsinada:{l:'Acta recibida / asinada',h:'Recibida de volta asinada. Ao gardar actualiza tamén «Acta asinada» (firmada).'},
 notaCampo:{l:'Notas de campo e visitas',h:'Unha entrada por liña. As liñas que comezan por DD/MM/AAAA amósanse coa súa data.',w:1},
 notaChamadas:{l:'Notas de chamadas e correos',h:'Unha entrada por liña, igual ca nas notas de campo.',w:1}};
// v3.4 · Horas do tractor nas visitas (clave existente visits[].horas, texto tipo «5807 h»)
// Normaliza o que se escribe: «5807» ou «5807,5» → «5807 h» / «5807,5 h»; texto doutro tipo gárdase tal cal.
function horasNorm(v){const t=String(v??'').trim();if(!t)return '';const m=/^(\d+(?:[.,]\d+)?)\s*(h|horas?)?\.?$/i.exec(t);return m?m[1].replace('.',',')+' h':t}
function horasTxt(v){const t=String(v??'').trim();return t&&t!=='-'&&t!=='—'?horasNorm(t):''}
function horasBadge(v){const h=horasTxt(v);return h?`<span class="hBadge" title="Horas do tractor na visita">⏱ ${safe(h)}</span>`:'<span class="hBadge nd" title="Sen horas rexistradas">— h</span>'}
function fechaClave(f){const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(f||''));return m?m[3]+m[2].padStart(2,'0')+m[1].padStart(2,'0'):''}
// Visita máis recente (por data; a igual data, a última engadida) que ten horas
function ultimasHoras(vs){let best=null;(vs||[]).forEach((v,i)=>{if(!horasTxt(v.horas))return;const k=fechaClave(v.fecha)+'|'+String(i).padStart(5,'0');if(!best||k>best.k)best={k,v}});return best&&best.v}
function isoAgl(d){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d||''));return m?`${m[3]}/${m[2]}/${m[1]}`:''}
function nomeBonito(s){return String(s||'').toLowerCase().replace(/(^|[\s(\-])(\S)/g,(m,a,b)=>a+b.toUpperCase()).replace(/ (De|Do|Da|Dos|Das|E) /g,m=>m.toLowerCase())}
const RE_NOTA=/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:[·:\-–]\s*)?(.*)$/;
// Converte o texto dunha nota en entradas. Con data: ordenadas da máis nova á máis antiga. Sen data: ao final, como entradas antigas.
function parseNotas(txt){const out=[];String(txt||'').split(/\r?\n/).forEach((l,i)=>{if(!l.trim())return;const m=RE_NOTA.exec(l);
  if(m){const d=m[1].padStart(2,'0'),mm=m[2].padStart(2,'0');let t=m[4],tipo='';const mt=/^(Chamada|Correo)\s*:\s*/i.exec(t);if(mt){tipo=mt[1][0].toUpperCase()+mt[1].slice(1).toLowerCase();t=t.slice(mt[0].length)}
   out.push({data:`${d}/${mm}/${m[3]}`,clave:m[3]+mm+d,tipo,texto:t,orde:i})}
  else l.split(/\s+\|\s+/).forEach((p,j)=>{if(p.trim())out.push({data:'',clave:'',tipo:'',texto:p.trim(),orde:i+j/100})})});
 return out.sort((a,b)=>a.clave&&b.clave?(b.clave.localeCompare(a.clave)||a.orde-b.orde):a.clave?-1:b.clave?1:a.orde-b.orde)}
function datoV3(lbl,val,w){return `<div class="dato${w?' w':''}"><dt>${safe(lbl)}</dt><dd>${val===''||val==null?'<span class="nd">—</span>':val}</dd></div>`}
function tickV3(v){return v==='Si'?'<span class="sn si">✓ Si</span>':v==='Non'?'<span class="sn non">— Non</span>':'<span class="nd">—</span>'}
function snV3(v){return v==='Si'?'<span class="sn si">Si</span>':v==='Non'?'<span class="sn non">Non</span>':''}
function numV3(v,u){if(v===''||v==null)return '';return `${fmtKm(numOu0(v))}${u?` <small>${u}</small>`:''}`}
function notaCard(r,k){const campo=k==='notaCampo',ents=parseNotas(r[k]),b=borradorNotas.get(currentId+'|'+k)||{},hoxe=today();
 return `<section class="card noteCard" data-notacard="${k}"><div class="cardHead"><h3>${campo?'Notas de campo e visitas':'Chamadas e correos'}</h3><span class="count" title="Entradas">${ents.length}</span></div>
<form class="noteAdd" data-nota="${k}" novalidate>
 <div class="noteRow"><label class="field">Data<input type="date" id="nd_${k}" value="${safe(b.d||hoxe)}" max="${hoxe}" required></label>${campo?'':`<label class="field">Tipo (opcional)<select id="nt_${k}"><option value="">—</option><option${b.t==='Chamada'?' selected':''}>Chamada</option><option${b.t==='Correo'?' selected':''}>Correo</option></select></label>`}</div>
 <label class="field">Anotación<textarea id="n_${k}" rows="2" placeholder="${campo?'Que se viu ou se fixo na visita…':'Con quen se falou, que se pediu, que responderon…'}">${safe(b.x||'')}</textarea></label>
 ${campo?`<label class="check"><input type="checkbox" id="nv_${k}"${b.v?' checked':''}> Rexistrar tamén no historial de visitas</label>
 <label class="field horasField"${b.v?'':' hidden'} id="nhw_${k}">Horas do tractor (h) <small class="help">opcional · as que marca o contador nese momento</small><span class="unit"><input id="nhr_${k}" type="text" inputmode="decimal" autocomplete="off" placeholder="p. ex. 5807" value="${safe(b.h||'')}"><em>h</em></span></label>`:''}
 <div class="noteFoot"><span class="hint" id="nh_${k}" role="alert"></span><button class="btn primary" type="submit">＋ Engadir nota</button></div>
</form>
<ol class="timeline">${ents.map(e=>`<li class="${e.data?'':'undated'}"><div class="tlDate">${e.data?safe(e.data):'Sen data · rexistro anterior'}${e.tipo?` <span class="tag">${safe(e.tipo)}</span>`:''}</div><div class="tlText">${safe(e.texto)}</div></li>`).join('')||'<li class="emptyTl muted">Aínda non hai notas.</li>'}</ol></section>`}
// v3.3: fases do proceso como marcas. Non hai claves novas: marcar unha fase cambia `estadoXeral`.
const FASES=['KMZ preparado','En campo','Campo pechado','Cargado na GDB'];
function ctrlInp(r,k){const c=CAMPOS_CONTROL.find(x=>x[0]===k);if(!c)return '';const [,t,tipo]=c,u=CTRL_UI[k]||{l:t},v=r[k]??'',id='c_'+k,lab=safe(u.l),help=u.h?`<small class="help">${safe(u.h)}</small>`:'',wc=u.w?' wide':'';
  if(tipo==='e')return `<label class="field wide">${lab}<select id="${id}"><option value="">— Sen definir —</option>${ESTADOS_XERAIS.map(e=>`<option${e===r[k]?' selected':''}>${safe(e)}</option>`).join('')}</select>${help}</label>`;
  if(tipo==='sn')return `<label class="field">${lab}<select id="${id}"><option value="">— Sen indicar —</option><option${v==='Si'?' selected':''}>Si</option><option${v==='Non'?' selected':''}>Non</option></select>${help}</label>`;
  // ck = marca (tick): gárdase «Si» / «Non»
  if(tipo==='ck')return `<label class="tick"><input type="checkbox" id="${id}"${v==='Si'?' checked':''}><span><b>${lab}</b>${help}</span></label>`;
  if(tipo==='a')return `<label class="field${wc}">${lab}<textarea id="${id}" rows="4">${safe(v)}</textarea>${help}</label>`;
  if(tipo==='n')return `<label class="field">${lab}<span class="unit"><input id="${id}" type="number" min="0" step="${u.st||'0.01'}" inputmode="decimal" value="${safe(v)}" placeholder="0"><em>${safe(u.u||'')}</em></span>${help}</label>`;
  if(tipo==='d')return `<label class="field">${lab}<input id="${id}" type="date" value="${safe(/^\d{4}-\d{2}-\d{2}$/.test(v)?v:'')}">${help}</label>`;
  return `<label class="field${wc}">${lab}<input id="${id}" value="${safe(v)}"${u.ph?` placeholder="${safe(u.ph)}"`:''}>${help}</label>`}
const ctrlG=(r,ks)=>ks.map(k=>ctrlInp(r,k)).join('');
function faseOn(ex,f){const i=ESTADOS_XERAIS.indexOf(ex);return i>=0&&i>=ESTADOS_XERAIS.indexOf(f)}
function barraGardar(){return `<div class="ctrlBar"><div class="avisos" data-avisos role="status" aria-live="polite"></div><div class="ctrlBarRow"><span class="flag c">Sen cambios</span><span class="flag d">● Cambios sen gardar</span><button type="button" class="btn" data-ctrl="cancelar">Cancelar</button><button type="button" class="btn primary" data-ctrl="gardar">✓ Gardar</button></div></div>`}
// Separador «Control»: SÓ marcas + estado xeral, para ver dunha ollada en que situación está o concello
function paneControl(r){
 const ex=estadoXeral(r),col=COR_XERAL[ex];
 return `<section class="pane ctrlPane" data-pane="ctrl"><form class="ctrlForm" novalidate>
 <div class="card estadoCard" style="--c:${col}"><div class="fields">${ctrlG(r,['estadoXeral'])}</div></div>
 <fieldset class="card"><legend>Fases do traballo</legend><div class="ticks">${FASES.map((f,i)=>`<label class="tick"><input type="checkbox" id="cf_${i}" data-fase="${safe(f)}"${faseOn(ex,f)?' checked':''}><span><b>${safe(f)}</b></span></label>`).join('')}</div><small class="help">Marcar ou desmarcar unha fase cambia o «Estado xeral». Os km e os datos do KMZ están no separador «Visitas».</small></fieldset>
 <fieldset class="card"><legend>Material para o compañeiro de campo</legend><div class="ticks">${ctrlG(r,['excelCompanheiro'])}</div></fieldset>
 <fieldset class="card"><legend>Acta</legend><div class="ticks">${ctrlG(r,['actaEnviada','actaAsinada'])}</div><small class="help">Datos de orixe (só lectura): Acta «${safe(r.acta||'—')}» · Acta asinada «${safe(r.firmada||'—')}» · Asinada por «${safe(r.asinadaPor||'—')}».</small></fieldset>
 ${barraGardar()}
</form>
<p class="ctrlNote">Só se gardan os campos que cambiaches; o resto da ficha non se toca. Se outro dispositivo cambiou a ficha, avísase e non se sobrescribe.</p></section>`}
// Separador «Visitas»: KMZ e km (preparados / feitos / non feitos), notas de campo con data e historial de visitas
function paneVisitas(r,visits){
 const kf=r.kmFeitos,kn=r.kmNonFeitos,sf=numOu0(kf),sn=numOu0(kn),tot=sf+sn,pct=tot?Math.round(sf/tot*100):0;
 return `<section class="pane" data-pane="vis">
 <section class="card campoCard"><div class="cardHead"><h3>KMZ e resultado de campo</h3></div>
  ${tot?`<div class="prog" aria-label="Porcentaxe feita"><div class="bar"><i style="width:${pct}%"></i></div><small><span>${pct} % feito</span><span>${fmtKm(tot)} km revisados${numOu0(r.kmPreparados)?` de ${fmtKm(numOu0(r.kmPreparados))} preparados`:''}</span></small></div>`:''}
  <h4 class="subH">Preparación do KMZ</h4><div class="fields">${ctrlG(r,['kmzData','kmzFicheiro','tramos','kmPreparados','tramosSeguros','tramosAproximados'])}</div><small class="help">Os tramos seguros + aproximados deberían sumar os tramos preparados. O PDF xeral de cores é común.</small>
  <h4 class="subH">Resultado de campo</h4><div class="fields">${ctrlG(r,['kmFeitos','kmNonFeitos'])}</div><small class="help">km feitos + non feitos non deberían superar os km preparados.</small>
  ${barraGardar()}
 </section>
 ${notaCard(r,'notaCampo')}
 <section class="card visitsCard"><div class="paneHead"><h3>Historial de visitas (${(r.visits||[]).length})</h3><button class="btn" data-action="visit">+ Visita</button></div>${(()=>{const u=ultimasHoras(r.visits);return u?`<div class="ultHoras"><span>Horas última visita</span><b>${safe(horasTxt(u.horas))}</b><small>${safe(u.fecha||'sen data')}</small></div>`:''})()}${visits}</section>
 <details class="card notaFull"><summary>Texto completo das notas de campo (para corrixir)</summary><div class="fields">${ctrlG(r,['notaCampo'])}</div>${barraGardar()}</details>
</section>`}
// Separador «Chamadas»: notas de chamadas e correos con data, e contactos co seu historial
function paneChamadas(r,contacts){
 return `<section class="pane" data-pane="cham">
 ${notaCard(r,'notaChamadas')}
 <section class="card"><div class="paneHead"><h3>Contactos e historial</h3><button class="btn" data-action="contact">+ Contacto</button></div>${contacts}</section>
 <details class="card notaFull"><summary>Texto completo das chamadas e correos (para corrixir)</summary><div class="fields">${ctrlG(r,['notaChamadas'])}</div>${barraGardar()}</details>
</section>`}
function validarControl(){const num=k=>{const e=$('c_'+k);return e&&e.value.trim()!==''?Number(e.value.replace(',','.')):null},av=[];
 ['tramos','kmPreparados','tramosSeguros','tramosAproximados','kmFeitos','kmNonFeitos'].forEach(k=>{const e=$('c_'+k),v=num(k),bad=!!e&&((v!==null&&!(v>=0))||(e.validity&&e.validity.badInput));if(e)e.classList.toggle('inv',bad);if(bad)av.push(['erro',`«${CTRL_UI[k].l}» ten que ser un número igual ou maior ca 0.`])});
 const t=num('tramos'),s=num('tramosSeguros'),a=num('tramosAproximados');if(t!==null&&(s||0)+(a||0)>t)av.push(['aviso',`Seguros + aproximados (${(s||0)+(a||0)}) superan os tramos preparados (${t}).`]);
 const p=num('kmPreparados'),f=num('kmFeitos'),n=num('kmNonFeitos');if(p!==null&&(f||0)+(n||0)>p*1.05)av.push(['aviso',`km feitos + non feitos (${fmtKm((f||0)+(n||0))}) superan os km preparados (${fmtKm(p)}).`]);
 const ex=$('c_estadoXeral')?.value||'';if((ex==='Campo pechado'||ex==='Cargado na GDB')&&f===null)av.push(['aviso',`Estado «${ex}» sen km feitos rexistrados.`]);
 if((ex==='KMZ preparado'||ex==='En campo')&&!($('c_kmzFicheiro')?.value||'').trim())av.push(['aviso','Falta indicar o ficheiro KML/KMZ.']);
 const html=av.map(([c,m])=>`<div class="aviso ${c}">${c==='erro'?'⛔':'⚠'} ${safe(m)}</div>`).join('');document.querySelectorAll('#detail [data-avisos]').forEach(b=>b.innerHTML=html)}
function gardarBorrador(k){const x=$('n_'+k)?.value||'',d=$('nd_'+k)?.value||'',t=$('nt_'+k)?.value||'',v=!!$('nv_'+k)?.checked,h=$('nhr_'+k)?.value||'',key=currentId+'|'+k;if(x||t||v||h||(d&&d!==today()))borradorNotas.set(key,{x,d,t,v,h});else borradorNotas.delete(key)}
async function engadirNota(k){const h=$('nh_'+k),tx=$('n_'+k),dEl=$('nd_'+k),d=dEl.value,txt=tx.value.trim().replace(/\s*\n+\s*/g,' / ');h.textContent='';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){h.textContent='Indica unha data válida.';dEl.focus();return}
 if(d>today()){h.textContent='A data non pode ser posterior a hoxe.';dEl.focus();return}
 if(!txt){h.textContent='Escribe a anotación antes de engadila.';tx.focus();return}
 const hr=$('nhr_'+k);if(hr&&$('nv_'+k)?.checked&&hr.value.trim()&&!/^\d+(?:[.,]\d+)?\s*h?$/i.test(hr.value.trim())){h.textContent='As horas do tractor teñen que ser un número (p. ex. 5807 ou 5807,5).';hr.focus();return}
 const tipo=$('nt_'+k)?.value||'',linha=`${isoAgl(d)} · ${tipo?tipo+': ':''}${txt}`,ta=$('c_'+k),prev=(ta.value||'').trim();ta.value=prev?linha+'\n'+prev:linha;
 const extra={};if($('nv_'+k)?.checked){const r=base(rows.get(currentId));extra.visits=[...clone(r.visits||[]),{fecha:isoAgl(d),lugar:'Concello de '+nomeBonito(r.name),horas:horasNorm($('nhr_'+k)?.value),traballo:'',observacions:txt}];extra.estadoVisita='visitado'}
 const key=currentId+'|'+k,bk=borradorNotas.get(key)||{x:tx.value,d,t:tipo,v:!!$('nv_'+k)?.checked,h:$('nhr_'+k)?.value||''};borradorNotas.delete(key);dirty=true;
 const ok=await saveForm(extra);
 if(ok){toast(extra.visits?'Nota e visita gardadas':'Nota engadida e gardada');return}
 borradorNotas.set(key,bk);if(document.body.contains(ta))ta.value=prev;else renderDetail()}
// v3.3: os formularios xa non teñen modo lectura/edición: as marcas e os campos edítanse directamente.
// A barra «Gardar / Cancelar» aparece só cando hai cambios sen gardar.
function syncFases(){const ex=$('c_estadoXeral')?.value||'';FASES.forEach((f,i)=>{const c=$('cf_'+i);if(c)c.checked=faseOn(ex,f)})}
function bindFicha(){const D=$('detail');if(!D.querySelector('[data-pane="ctrl"]'))return;
 D.querySelectorAll('form.ctrlForm').forEach(f=>f.addEventListener('submit',e=>e.preventDefault()));
 if(!D.dataset.v33){D.dataset.v33='1';const vc=e=>{if(e.target.id?.startsWith('c_'))validarControl()};D.addEventListener('input',vc);D.addEventListener('change',vc)} // #detail persiste: escoitar só unha vez
 const sel=$('c_estadoXeral'),r0=base(rows.get(currentId)),previo=ESTADOS_XERAIS.indexOf(r0.estadoXeral)<ESTADOS_XERAIS.indexOf(FASES[0])?(estadoXeral(r0)):'';
 if(sel)sel.addEventListener('change',syncFases);
 FASES.forEach((f,i)=>{const c=$('cf_'+i);if(!c)return;c.onchange=()=>{sel.value=c.checked?f:(i>0?FASES[i-1]:previo);syncFases();markDirty();validarControl()}});
 D.querySelectorAll('[data-ctrl="cancelar"]').forEach(b=>b.onclick=()=>{if(dirty&&!confirm('Descartar os cambios sen gardar?'))return;dirty=false;setSync('ok');ctrlEdit=false;['notaCampo','notaChamadas'].forEach(k=>borradorNotas.delete(currentId+'|'+k));renderDetail()});
 D.querySelectorAll('[data-ctrl="gardar"]').forEach(b=>b.onclick=()=>saveForm());
 D.querySelectorAll('.noteAdd').forEach(fm=>{const k=fm.dataset.nota,nv=$('nv_'+k),hw=$('nhw_'+k);if(nv&&hw)nv.addEventListener('change',()=>{hw.hidden=!nv.checked;if(nv.checked)$('nhr_'+k)?.focus({preventScroll:true})});fm.addEventListener('submit',e=>{e.preventDefault();engadirNota(k)});fm.addEventListener('input',()=>{gardarBorrador(k);markDirty()});fm.addEventListener('change',()=>gardarBorrador(k))});
 if(dirty)validarControl()}

// Le os campos de control e devolve SÓ os que cambiaron respecto ao valor actual (así non se crean claves baleiras)
function controlPatch(r){const out={};for(const [k,,tipo] of CAMPOS_CONTROL){const el=$('c_'+k);if(!el)continue;
  // marca: marcada = «Si»; desmarcada = «Non» só se antes era «Si» (así non se crean claves baleiras)
  if(tipo==='ck'){const old=r[k]===undefined||r[k]===''?null:r[k],nv=el.checked?'Si':(old==='Si'?'Non':old);if(nv!==old)out[k]=nv;continue}let v=el.value.trim();
  if(tipo==='n')v=v===''?null:Number(v.replace(',','.'));else if(v==='')v=null;
  const old=r[k]===undefined||r[k]===''?null:r[k];
  if(tipo==='n'&&v!==null&&!(v>=0))throw Error('Valor numérico non válido en «'+CAMPOS_CONTROL.find(c=>c[0]===k)[1]+'»');
  if(String(old??'')!==String(v??''))out[k]=v}
 return out}
function paintFiles(id){
 const wrap=$('docsFiles'),d=docsCache.get(id);if(!wrap||!d||id!==currentId)return;
 const fs=d.files.filter(f=>showVoid||!f.anulado),pics=fs.filter(isPic),docs=fs.filter(f=>!isPic(f));
 wrap.innerHTML=`<h3>Fotografías (${pics.length})</h3><div class="thumbs gallery">${pics.map(thumb).join('')||'<span class="muted tiny">Ningunha</span>'}</div><h3>Documentos (${docs.length})</h3>${docs.map(f=>`<button class="entry" style="display:flex;gap:10px;align-items:center;width:100%;text-align:left;cursor:pointer" data-file="${safe(f.id)}"><b style="color:#8a2b2b">PDF</b><span style="flex:1;min-width:0"><strong style="overflow-wrap:anywhere">${safe(f.filename)}</strong><br><span class="mini">${safe([TIPOS_DOC[f.tipo_documento],f.autor_declarado,f.data_documento&&fmtDate(f.data_documento)].filter(Boolean).join(' · '))}</span></span></button>`).join('')||'<p class="muted tiny">Ningún</p>'}`;
 wrap.querySelectorAll('[data-file]').forEach(b=>b.onclick=()=>{const f=d.files.find(x=>x.id==b.dataset.file);if(!f)return;const lst=isPic(f)?pics:docs;viewer(lst,Math.max(0,lst.indexOf(f)))});
 const row=rows.get(id);if(row)renderTabs(base(row));
}
function quick(k){
 if(!currentId)return;
 if(!MOSTRAR_DOCUMENTOS&&(k==='camera'||k==='doc'))return; // v2: fotos/documentos ocultos
 if(k==='save')return saveForm();
 if(k==='visit')return editVisit(-1);
 if(k==='camera')return uploadDialog({camera:true,tipo_documento:'foto',orixe:'visita'});
 if(k==='doc')return uploadDialog({tipo_documento:'parte'});
}
function openRecord(id,opt={}){
 if(dirty&&id!==currentId&&!confirm('Hai cambios sen gardar nesta ficha. Queres descartalos?'))return;
 if(id!==currentId){machineFilter=null;dirty=false;ctrlEdit=false;if(syncState==='dirty')setSync('ok')}
 currentId=id;renderList();renderDetail();
 let x=rows.get(id);if(x)$('mapHint').textContent=base(x).name;
 highlight(id,true);
 if(isMobile()){$('sidebar').classList.remove('open');sheet(opt.fromMap?'peek':'half')}
 const it=document.querySelector(`#list [data-id="${CSS.escape(id)}"]`);if(it&&!isMobile())it.scrollIntoView({block:'nearest'});
}
function initSearch(){
 const inp=$('mapSearch'),box=$('searchResults');let hits=[],on=0;
 const paint=()=>{box.innerHTML=hits.map((r,i)=>`<button type="button" role="option" class="${i===on?'on':''}" data-id="${safe(r.id)}"><span>${safe(r.name)}</span><span class="pill" style="background:${colors[inspectState(r).state]}30">${safe(labels[inspectState(r).state])}</span></button>`).join('')||'<div class="pad muted">Sen resultados</div>';box.classList.toggle('hidden',!inp.value.trim());box.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>pick(b.dataset.id))};
 const pick=id=>{inp.value='';box.classList.add('hidden');inp.blur();openRecord(id)};
 inp.addEventListener('input',()=>{const q=slug(inp.value);hits=q?all().filter(r=>slug(r.name).includes(q)).sort((a,b)=>(slug(b.name)===q)-(slug(a.name)===q)||slug(a.name).indexOf(q)-slug(b.name).indexOf(q)||a.name.length-b.name.length).slice(0,8):[];on=0;paint()});
 inp.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){on=Math.min(on+1,hits.length-1);paint();e.preventDefault()}else if(e.key==='ArrowUp'){on=Math.max(on-1,0);paint();e.preventDefault()}else if(e.key==='Enter'&&hits[on]){pick(hits[on].id)}else if(e.key==='Escape'){inp.value='';box.classList.add('hidden')}});
 document.addEventListener('click',e=>{if(!e.target.closest('.searchBox'))box.classList.add('hidden')});
}
function initSheet(){
 const s=$('sheet'),h=$('sheetHead');let y0=null,t0=0,moved=false;
 const order=['peek','half','full'];
 h.addEventListener('pointerdown',e=>{if(!isMobile()||e.target.closest('button,.tab'))return;y0=e.clientY;t0=Date.now();moved=false;s.classList.add('dragging');h.setPointerCapture(e.pointerId)});
 h.addEventListener('pointermove',e=>{if(y0===null)return;const dy=e.clientY-y0;if(Math.abs(dy)>6)moved=true;const base_=s.getBoundingClientRect();s.style.transform=`translateY(${Math.max(0,(s.dataset.state==='full'?0:s.dataset.state==='half'?base_.height*.45:base_.height-92)+dy)}px)`});
 const end=e=>{if(y0===null)return;const dy=e.clientY-y0;s.classList.remove('dragging');s.style.transform='';y0=null;let i=order.indexOf(s.dataset.state);if(i<0)i=0;
  if(!moved){sheet(order[i===2?1:i+1]);return}
  if(dy<-40)i=Math.min(2,i+1);else if(dy>40)i=Math.max(0,i-1);sheet(order[i])};
 h.addEventListener('pointerup',end);h.addEventListener('pointercancel',end);
 $('sheetClose').onclick=()=>sheet('peek');
 $('listToggle').onclick=()=>$('sidebar').classList.add('open');$('sideClose').onclick=()=>$('sidebar').classList.remove('open');
 if(isMobile())$('sideClose').style.display='';
 $('actionbar').querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>quick(b.dataset.quick));
 addEventListener('online',()=>{setSync('loading');fetchAll(true)});addEventListener('offline',()=>setSync('offline'));
 addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
}
// PWA: só a carcasa da app vai á caché; nunca datos nin documentos.
function initPWA(){
 if(!('serviceWorker' in navigator)||location.protocol!=='https:')return;
 let reloading=false;
 navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(reg=>{if(!reg)return;
  const offer=w=>{if(!w)return;$('updateBar').classList.remove('hidden');$('updateBtn').onclick=()=>{if(dirty&&!confirm('Hai cambios sen gardar. Actualizar igualmente?'))return;reloading=true;w.postMessage('SKIP_WAITING')};$('updateLater').onclick=()=>$('updateBar').classList.add('hidden')};
  if(reg.waiting&&navigator.serviceWorker.controller)offer(reg.waiting);
  reg.addEventListener('updatefound',()=>{const w=reg.installing;w?.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)offer(w)})});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reg.update().catch(()=>{})});
 }).catch(e=>console.warn('SW',e));
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloading)location.reload()});
}
initPWA();
function parseRow(row){return {record_id:row.record_id,record:row.record||{},change:row.change||{},updated_at:row.updated_at}}
async function fetchAll(force){if(!client||!group||busy||(dirty&&!force))return;if(!navigator.onLine){setSync('offline');return}busy=true;if(syncState!=='dirty')setSync('loading');try{let {data,error}=await client.from('seaga_records').select('record_id,record,change,updated_at').eq('group_id',group).order('record_id').limit(1000);if(error)throw error;rows=new Map(data.map(x=>[x.record_id,parseRow(x)]));if(force)dirty=false;setSync(dirty?'dirty':'ok');render();notice(data.length?'':'A base está baleira. Aínda hai que cargar as fichas recuperadas na túa base de datos.');}catch(e){setSync('error','Erro de sincronización: '+e.message);toast('Non se puido actualizar: '+e.message,true)}finally{busy=false}}
async function savePatch(id,patch){const row=rows.get(id);if(!row)throw Error('Ficha inexistente');setSync('saving');let merged={...row.change,...patch};const {data,error}=await client.from('seaga_records').update({change:merged,updated_at:new Date().toISOString()}).eq('group_id',group).eq('record_id',id).eq('updated_at',row.updated_at).select('record_id,record,change,updated_at');if(error)throw error;if(!data?.length){await fetchAll(true);throw Error('Outro dispositivo modificou esta ficha. Actualiza e repite o cambio para evitar sobrescribir datos.')}rows.set(id,parseRow(data[0]));dirty=false;ctrlEdit=false;setSync('ok');render();toast('Gardado na nube')}
async function saveForm(extra){const id=currentId;try{const r0=base(rows.get(id)),cp=controlPatch(r0);await savePatch(id,{...cp,estadoVisita:$('fVisita').value,estadoMecanico:$('fMecanica').value,notaSeaga:$('fNotas').value,comprobacionDocumental:$('fDoc').value,empresa:$('fEmpresa').value.trim(),apeiro:$('fApeiro').value.trim(),acta:$('fActa').value.trim(),firmada:('actaAsinada' in cp)?(cp.actaAsinada||''):$('fFirmada').value.trim(),asinadaPor:$('fAsinadaPor').value.trim(),...(extra||{})});return true}catch(e){setSync(dirty?'dirty':'error',dirty?undefined:'Erro ao gardar');toast(e.message,true);return false}}
function modal(html,wide){$('modalRoot').innerHTML=`<div class="overlay" id="overlay"><div class="modal${wide?' wide':''}">${html}</div></div>`;$('overlay').addEventListener('click',e=>{if(e.target.id==='overlay')closeModal()});$('modalRoot').querySelectorAll('[data-close]').forEach(b=>b.onclick=closeModal);$('modalRoot').querySelectorAll('input[name=localizacion],input[name=lugar]').forEach(inp=>{const g=document.createElement('button');g.type='button';g.className='btn gpsbtn';g.textContent='📍 Engadir a miña posición';g.onclick=()=>gpsFill(inp);inp.insertAdjacentElement('afterend',g)})}
function closeModal(){$('modalRoot').innerHTML=''}
function modalField(label,name,value='',area=false){return `<label class="field wide">${safe(label)}${area?`<textarea name="${name}">${safe(value)}</textarea>`:`<input name="${name}" value="${safe(value)}">`}</label>`}
function editVisit(i){const id=currentId,r=base(rows.get(id)),v=i<0?{}:r.visits[i];modal(`<h2>${i<0?'Nova visita':'Editar visita'}</h2><p class="muted">${safe(r.name)} · rexistro histórico</p><form id="editForm" class="fields">${modalField('Data (DD/MM/AAAA)','fecha',v.fecha)}<label class="field wide">Horas do tractor (h)<span class="unit"><input name="horas" inputmode="decimal" autocomplete="off" placeholder="p. ex. 5807" value="${safe(v.horas||'')}"><em>h</em></span></label>${modalField('Lugar','lugar',v.lugar)}${modalField('Traballo e estado','traballo',v.traballo,true)}${modalField('Observacións','observacions',v.observacions,true)}<div class="flex wide"><button class="btn primary" type="submit">Gardar visita</button><button class="btn" type="button" data-close>Cancelar</button></div></form>`);$('editForm').onsubmit=async e=>{e.preventDefault();let vals=Object.fromEntries(new FormData(e.target)),vs=clone(r.visits||[]);if('horas' in vals)vals.horas=String(vals.horas).trim()===String(v.horas??'').trim()?(v.horas??''):horasNorm(vals.horas); /* v3.4: «5807» → «5807 h»; sen tocar se non cambia */if(i<0)vs.push(vals);else vs[i]=vals;try{await savePatch(id,{visits:vs,estadoVisita:'visitado'});closeModal()}catch(err){toast(err.message,true)}}}
function editMachine(i){const id=currentId,r=base(rows.get(id)),m=i<0?{}:r.machines[i];modal(`<h2>${i<0?'Nova máquina':'Editar máquina'}</h2><form id="editForm" class="fields">${modalField('Marca','marca',m.marca)}${modalField('Modelo','modelo',m.modelo)}${modalField('Matrícula','matricula',m.matricula)}${modalField('Apeiro','apeiro',m.apeiro)}${modalField('Inicio','inicio',m.inicio)}${modalField('Fin','fin',m.fin)}<div class="flex wide"><button class="btn primary" type="submit">Gardar máquina</button><button class="btn" type="button" data-close>Cancelar</button></div></form>`);$('editForm').onsubmit=async e=>{e.preventDefault();let vals=Object.fromEntries(new FormData(e.target)),ms=clone(r.machines||[]);if(i<0)ms.push(vals);else ms[i]={...ms[i],...vals};try{await savePatch(id,{machines:ms});closeModal()}catch(err){toast(err.message,true)}}}
function editContact(i){
 const id=currentId,r=base(rows.get(id)),old=i<0?{}:(r.contacts||[])[i]||{};
 modal(`<h2>${i<0?'Novo contacto':'Editar contacto'}</h2><form id="editForm" class="fields">${modalField('Persoa, cargo, teléfono e correo','contacto',old.contacto||'',true)}<div class="flex wide"><button class="btn primary" type="submit">Gardar contacto</button><button class="btn" type="button" data-close>Cancelar</button></div></form>`);
 $('editForm').onsubmit=async e=>{e.preventDefault();let cs=clone(r.contacts||[]),value=new FormData(e.target).get('contacto');if(i<0)cs.push({contacto:value,historial:[]});else cs[i]={...cs[i],contacto:value};try{await savePatch(id,{contacts:cs});closeModal()}catch(err){toast(err.message,true)}};
}
function editHistory(i,j){
 const id=currentId,r=base(rows.get(id)),c=(r.contacts||[])[i],h=j<0?{}:(c.historial||[])[j]||{};
 if(!c)return;
 modal(`<h2>${j<0?'Nova anotación':'Editar anotación'} · ${safe(c.contacto||'Contacto')}</h2><form id="editForm" class="fields">${modalField('Data (DD/MM/AAAA)','fecha',h.fecha||'')}${modalField('Resumo da chamada ou xestión','resumo',h.resumo||'',true)}<div class="flex wide"><button class="btn primary" type="submit">Gardar anotación</button><button class="btn" type="button" data-close>Cancelar</button></div></form>`);
 $('editForm').onsubmit=async e=>{e.preventDefault();let cs=clone(r.contacts||[]),hs=cs[i].historial||[],v=Object.fromEntries(new FormData(e.target));if(j<0)hs.push(v);else hs[j]={...hs[j],...v};cs[i].historial=hs;try{await savePatch(id,{contacts:cs});closeModal()}catch(err){toast(err.message,true)}};
}
// ===== TICKET 01 · Documentación e traballos =====
const BUCKET='concellos-documentos',MIME_OK=['image/jpeg','image/png','image/webp','application/pdf'],MAX_MB=12;
const ESTADOS={declarado:'Declarado',documentacion_recibida:'Documentación recibida',verificado_documental:'Verificado documentalmente',verificado_presencial:'Verificado presencialmente'};
const ESTADO_COR={declarado:'#929e9c',documentacion_recibida:'#edb247',verificado_documental:'#2589ce',verificado_presencial:'#1a9a72'};
const TIPOS_TRABALLO=['Desbroce de faixas de xestión de biomasa','Rozas mecanizadas','Desbroce de beirarrúas e cunetas','Mantemento de pistas forestais','Limpeza de parcelas','Traballo agrícola','Transporte','Outro'];
const TIPOS_DOC={foto:'Fotografía',parte:'Parte de traballo',acta:'Acta',informe:'Informe',factura:'Factura / albará',outro:'Outro'};
const ORIXES={visita:'Visita presencial',concello:'Concello (correo / rexistro)',whatsapp:'WhatsApp',empresa:'Empresa adxudicataria',xunta:'Xunta / Consellería',outro:'Outro'};
const UNIDADES={ha:'ha',m2:'m²',m:'m',km:'km',h:'h',ud:'ud'};
const ACT_COLS='id,record_id,data_actuacion,tipo_traballo,localizacion,cantidade,unidade,observacions,fonte_informacion,estado_verificacion,machine_ref,machine_label,visit_ref,visit_label,anulada,motivo_anulacion,version,creado_por,creado_en,actualizado_por,actualizado_en';
const FILE_COLS='id,record_id,path,filename,description,mime_type,created_at,actuacion_id,machine_ref,machine_label,visit_ref,visit_label,tipo_documento,autor_declarado,orixe,data_documento,tamano_bytes,subido_por,anulado,motivo_anulacion,version';
let docsCache=new Map(),docsSig=new Map(),urlCache=new Map(),machineFilter=null,showVoid=false;
function machineRef(m,i){const p=String(m?.matricula||'').trim();return p.length>2?'mat:'+slug(p):'idx:'+i}
function machineLabel(m,i){return [[m?.marca,m?.modelo].filter(Boolean).join(' ')||'Máquina '+(i+1),m?.matricula].filter(Boolean).join(' · ')}
function visitRef(v,i){return 'idx:'+i+'|'+(v?.fecha||'')}
function visitLabel(v){return [v?.fecha||'Sen data',v?.lugar].filter(Boolean).join(' · ')}
function machineOpts(r,extra){const o=Object.fromEntries((r.machines||[]).map((m,i)=>[machineRef(m,i),machineLabel(m,i)]));if(extra?.machine_ref&&!o[extra.machine_ref])o[extra.machine_ref]=extra.machine_label||extra.machine_ref;return o}
function visitOpts(r,extra){const o=Object.fromEntries((r.visits||[]).map((v,i)=>[visitRef(v,i),visitLabel(v)]));if(extra?.visit_ref&&!o[extra.visit_ref])o[extra.visit_ref]=extra.visit_label||extra.visit_ref;return o}
function opts(obj,sel,empty){return (empty!==undefined?`<option value="">${safe(empty)}</option>`:'')+Object.entries(obj).map(([k,v])=>`<option value="${safe(k)}"${k===sel?' selected':''}>${safe(v)}</option>`).join('')}
function fmtDate(d){if(!d)return 'Sen data';const [y,m,dd]=String(d).slice(0,10).split('-');return dd?`${dd}/${m}/${y}`:String(d)}
function fmtStamp(t){return t?new Date(t).toLocaleString('gl-ES',{dateStyle:'short',timeStyle:'short'}):'—'}
function who(u){return !u?'—':u===me?'ti':'usuario '+String(u).slice(0,8)}
function today(){const d=new Date();return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)}
function sel(form,name){return form.querySelector(`[name="${name}"]`)}
function nz(v){v=String(v??'').trim();return v===''?null:v}
function actName(a){return `${fmtDate(a.data_actuacion)} · ${a.tipo_traballo}`}
function isPic(f){return String(f.mime_type||'').startsWith('image/')}
async function signUrls(files){
 const now=Date.now(),need=[...new Set(files.filter(f=>!(urlCache.get(f.path)?.exp>now+120000)).map(f=>f.path))];
 for(let k=0;k<need.length;k+=100){const {data,error}=await client.storage.from(BUCKET).createSignedUrls(need.slice(k,k+100),3600);if(error)throw error;(data||[]).forEach(x=>{if(x.signedUrl)urlCache.set(x.path,{url:x.signedUrl,exp:now+3600000})})}
}
async function loadDocs(id){
 const wrap=$('docs');if(!wrap)return;
 if(docsCache.has(id))paintDocs(id);
 try{
  const [a,f]=await Promise.all([
   client.from('concellos_actuacions').select(ACT_COLS).eq('group_id',group).eq('record_id',id).order('data_actuacion',{ascending:false,nullsFirst:false}).order('creado_en',{ascending:false}),
   client.from('concellos_files').select(FILE_COLS).eq('group_id',group).eq('record_id',id).order('created_at',{ascending:false})]);
  if(a.error||f.error)throw (a.error||f.error);
  if(MOSTRAR_DOCUMENTOS)await signUrls(f.data||[]); // v2: sen URLs de Storage se os documentos están ocultos
  const sig=JSON.stringify([a.data,f.data]);
  if(docsSig.get(id)===sig&&docsCache.has(id)){if(id===currentId&&!$('docs')?.dataset.painted)paintDocs(id);return}
  docsCache.set(id,{acts:a.data||[],files:f.data||[]});docsSig.set(id,sig);
  if(id===currentId)paintDocs(id);
 }catch(e){console.error(e);if(id===currentId&&!docsCache.has(id)&&$('docs'))$('docs').innerHTML=`<p class="bad">Non se pode cargar a documentación (${safe(e.message)}). Comproba que se executou a migración sql/001_documentacion_traballos.sql.</p>`}
}
function thumb(f){const u=urlCache.get(f.path)?.url,t=[TIPOS_DOC[f.tipo_documento]||'Arquivo',f.filename,f.autor_declarado&&'Aporta: '+f.autor_declarado].filter(Boolean).join(' · ');return `<button type="button" class="thumb${f.anulado?' void':''}" data-file="${safe(f.id)}" title="${safe(t)}">${isPic(f)&&u?`<img alt="${safe(f.filename)}" src="${safe(u)}" loading="lazy">`:`<b>PDF</b><span>${safe(f.filename)}</span>`}</button>`}
function paintDocs(id){
 const wrap=$('docs'),d=docsCache.get(id);if(!wrap||!d||id!==currentId)return;
 const r=base(rows.get(id)),mo=machineOpts(r),byM=x=>!machineFilter||x.machine_ref===machineFilter;
 const acts=d.acts.filter(a=>(showVoid||!a.anulada)&&byM(a)),files=d.files.filter(f=>showVoid||!f.anulado),actIds=new Set(d.acts.map(a=>a.id));
 const loose=files.filter(f=>(!f.actuacion_id||!actIds.has(f.actuacion_id))&&byM(f));
 const cnt=Object.keys(ESTADOS).map(k=>[k,d.acts.filter(a=>!a.anulada&&byM(a)&&a.estado_verificacion===k).length]);
 let h=`<div class="flex"><button class="btn primary" data-doc="newact">+ Nova actuación</button>${MOSTRAR_DOCUMENTOS?'<button class="btn" data-doc="upload">+ Subir arquivos</button>':''}<label class="tiny nowrap"><input type="checkbox" data-doc="void" ${showVoid?'checked':''}> Ver anulados</label></div>`;
 if(machineFilter)h+=`<p class="notice" style="margin:10px 0">Filtrado pola máquina <strong>${safe(mo[machineFilter]||machineFilter)}</strong> <button class="btn" data-doc="clearfilter">Ver todo o concello</button></p>`;
 h+=`<div class="chips">${cnt.map(([k,n])=>`<span class="pill" style="background:${ESTADO_COR[k]}30">${safe(ESTADOS[k])}: <b>${n}</b></span>`).join('')}</div>`;
 h+=acts.map(a=>{const fs=files.filter(f=>f.actuacion_id===a.id),c=ESTADO_COR[a.estado_verificacion]||'#999';return `<div class="entry act${a.anulada?' void':''}" style="border-left:4px solid ${c}"><div class="flex" style="justify-content:space-between"><strong>${safe(actName(a))}</strong><span class="pill" style="background:${c}30">${safe(ESTADOS[a.estado_verificacion]||a.estado_verificacion)}</span></div><div>${safe(a.localizacion||'Localización non indicada')}${a.cantidade!=null?` · <b>${safe(a.cantidade)} ${safe(UNIDADES[a.unidade]||a.unidade||'')}</b>`:''}</div><div class="mini">Fonte: ${safe(a.fonte_informacion)}${a.machine_label?' · Máquina: '+safe(a.machine_label):''}${a.visit_label?' · Visita: '+safe(a.visit_label):''}</div>${a.observacions?`<div class="obs">${safe(a.observacions)}</div>`:''}${a.anulada?`<div class="bad tiny">Anulada: ${safe(a.motivo_anulacion||'')}</div>`:''}${MOSTRAR_DOCUMENTOS?`<div class="thumbs">${fs.map(thumb).join('')||'<span class="muted tiny">Sen arquivos</span>'}</div>`:''}<div class="mini">Creada por ${safe(who(a.creado_por))} · ${safe(fmtStamp(a.creado_en))} · Última modificación ${safe(who(a.actualizado_por))} · ${safe(fmtStamp(a.actualizado_en))} · v${a.version}</div><div class="flex" style="margin-top:6px">${a.anulada?'':`<button class="btn" data-act="edit" data-id="${a.id}">Editar</button>${MOSTRAR_DOCUMENTOS?`<button class="btn" data-act="files" data-id="${a.id}">+ Arquivos</button>`:''}`}<button class="btn" data-act="hist" data-id="${a.id}">Historial</button>${a.anulada?'':`<button class="btn danger" data-act="void" data-id="${a.id}">Anular</button>`}</div></div>`}).join('')||'<p class="muted">Non hai actuacións rexistradas.</p>';
 if(MOSTRAR_DOCUMENTOS)h+=`<h3>Arquivos sen actuación asociada (${loose.length})</h3><div class="thumbs">${loose.map(thumb).join('')||'<span class="muted tiny">Ningún</span>'}</div>`;
 wrap.innerHTML=h;wrap.dataset.painted='1';paintFiles(id);
 const actById=x=>d.acts.find(a=>a.id===x);
 wrap.querySelectorAll('[data-doc]').forEach(b=>{const k=b.dataset.doc;if(k==='void')b.onchange=()=>{showVoid=b.checked;paintDocs(id)};else b.onclick=()=>{if(k==='newact')editAct(null);else if(k==='upload')uploadDialog({});else if(k==='clearfilter'){machineFilter=null;paintDocs(id)}}});
 wrap.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{const a=actById(b.dataset.id),k=b.dataset.act;if(!a)return;if(k==='edit')editAct(a);else if(k==='files')uploadDialog({actuacion_id:a.id});else if(k==='hist')showHistory('concellos_actuacions',a.id,actName(a));else if(k==='void')voidItem('act',a)});
 wrap.querySelectorAll('[data-file]').forEach(b=>b.onclick=()=>{const f=d.files.find(x=>x.id==b.dataset.file);if(!f)return;const lst=f.actuacion_id&&actIds.has(f.actuacion_id)?files.filter(x=>x.actuacion_id===f.actuacion_id):loose;viewer(lst.length?lst:[f],Math.max(0,lst.indexOf(f)))});
}
function refreshDocs(id){docsSig.delete(id);return loadDocs(id)}
async function viewer(list,idx){
 const f=list[idx];if(!f)return;
 try{await signUrls([f])}catch(e){toast('Non se puido xerar o enlace: '+e.message,true);return}
 const u=urlCache.get(f.path)?.url||'',d=docsCache.get(currentId),a=d?.acts.find(x=>x.id===f.actuacion_id);
 const meta=[['Tipo',TIPOS_DOC[f.tipo_documento]||'—'],['Actuación',a?actName(a):'—'],['Máquina',f.machine_label||'—'],['Visita',f.visit_label||'—'],['Aporta (autor declarado)',f.autor_declarado||'—'],['Orixe',ORIXES[f.orixe]||f.orixe||'—'],['Data do documento',f.data_documento?fmtDate(f.data_documento):'—'],['Descrición',f.description||'—'],['Subido',`${who(f.subido_por)} · ${fmtStamp(f.created_at)}`]];
 modal(`<div class="flex" style="justify-content:space-between"><strong style="overflow-wrap:anywhere">${safe(f.filename)}</strong><span class="muted tiny">${idx+1} / ${list.length}</span></div>${f.anulado?`<p class="bad tiny">Anulado: ${safe(f.motivo_anulacion||'')}</p>`:''}${isPic(f)?`<img class="big" alt="${safe(f.filename)}" src="${safe(u)}">`:`<iframe class="pdfview" src="${safe(u)}" title="${safe(f.filename)}"></iframe>`}<div class="metagrid">${meta.map(([k,v])=>`<span class="muted">${safe(k)}</span><span>${safe(v)}</span>`).join('')}</div><div class="flex" style="margin-top:12px">${list.length>1?'<button class="btn" data-v="prev">‹ Anterior</button><button class="btn" data-v="next">Seguinte ›</button>':''}<a class="btn" href="${safe(u)}" target="_blank" rel="noopener">Abrir en nova lapela</a>${f.anulado?'':'<button class="btn" data-v="edit">Editar datos</button>'}<button class="btn" data-v="hist">Historial</button>${f.anulado?'':'<button class="btn danger" data-v="void">Anular</button>'}<button class="btn" data-close>Pechar</button></div>`,true);
 $('modalRoot').querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{const k=b.dataset.v;if(k==='prev')viewer(list,(idx-1+list.length)%list.length);else if(k==='next')viewer(list,(idx+1)%list.length);else if(k==='edit')editFile(f);else if(k==='hist')showHistory('concellos_files',String(f.id),f.filename);else if(k==='void')voidItem('file',f)});
}
function lockForm(form,on,txt){form.querySelectorAll('button,input,select,textarea').forEach(x=>x.disabled=on);const s=form.querySelector('.status');if(s)s.textContent=txt||''}
function fileFields(withAct,p,r){
 const d=docsCache.get(currentId),acts=(d?.acts||[]).filter(a=>!a.anulada);
 return `${withAct?`<label class="field wide">Actuación asociada<select name="actuacion_id">${opts(Object.fromEntries(acts.map(a=>[a.id,actName(a)])),p.actuacion_id||'','— Ningunha —')}</select></label>`:''}<label class="field">Tipo de documento<select name="tipo_documento">${opts(TIPOS_DOC,p.tipo_documento||'foto')}</select></label><label class="field">Data do documento<input type="date" name="data_documento" value="${safe(p.data_documento||'')}"></label><label class="field">Persoa ou entidade que o aporta *<input name="autor_declarado" required value="${safe(p.autor_declarado||'')}" placeholder="Ex.: Concello · técnico de medio rural"></label><label class="field">Orixe *<select name="orixe" required>${opts(ORIXES,p.orixe||'','— Selecciona —')}</select></label>${withAct?`<label class="field">Máquina<select name="machine_ref">${opts(machineOpts(r,p),p.machine_ref||'','— Ningunha / a da actuación —')}</select></label><label class="field">Visita<select name="visit_ref">${opts(visitOpts(r,p),p.visit_ref||'','— Ningunha / a da actuación —')}</select></label>`:''}<label class="field wide">Descrición<input name="description" value="${safe(p.description||'')}"></label>`;
}
function checkFiles(fs){for(const f of fs){if(!MIME_OK.includes(f.type))throw Error(`Formato non admitido: ${f.name}. Só JPG, PNG, WEBP ou PDF (en iPhone, configura a cámara como «Máis compatible»).`);if(f.size>MAX_MB*1048576)throw Error(`Supera ${MAX_MB} MB: ${f.name}`)}}
async function uploadFiles(id,fs,meta,progress){
 checkFiles(fs);let ok=0;
 for(const f of fs){
  progress?.(`Subindo ${ok+1} de ${fs.length}: ${f.name}`);
  const path=`${group}/${encodeURIComponent(id)}/${crypto.randomUUID()}-${f.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  const up=await client.storage.from(BUCKET).upload(path,f,{upsert:false,contentType:f.type});
  if(up.error)throw Error(`${f.name}: ${up.error.message} (${ok} subidos antes do erro)`);
  const ins=await client.from('concellos_files').insert({group_id:group,record_id:id,path,filename:f.name,mime_type:f.type,tamano_bytes:f.size,...meta});
  if(ins.error)throw Error(`${f.name}: ${ins.error.message} (${ok} subidos antes do erro)`);
  ok++;
 }
 return ok;
}
function linkFrom(r,act,mref,vref){
 const out={actuacion_id:act?.id||null,machine_ref:nz(mref)||act?.machine_ref||null,visit_ref:nz(vref)||act?.visit_ref||null};
 out.machine_label=out.machine_ref?(machineOpts(r,act)[out.machine_ref]||act?.machine_label||null):null;
 out.visit_label=out.visit_ref?(visitOpts(r,act)[out.visit_ref]||act?.visit_label||null):null;
 return out;
}
function editAct(a){
 const id=currentId,r=base(rows.get(id)),isNew=!a,p=a||{data_actuacion:today(),estado_verificacion:'declarado',machine_ref:machineFilter||''};
 modal(`<h2>${isNew?'Nova actuación':'Editar actuación'}</h2><p class="muted">${safe(r.name)}</p><form id="actForm" class="fields"><label class="field">Data *<input type="date" name="data_actuacion" required value="${safe(p.data_actuacion||'')}"></label><label class="field">Tipo de traballo *<input name="tipo_traballo" list="tiposTraballo" required value="${safe(p.tipo_traballo||'')}"><datalist id="tiposTraballo">${TIPOS_TRABALLO.map(t=>`<option value="${safe(t)}">`).join('')}</datalist></label><label class="field wide">Localización (parroquia, lugar, pista, coordenadas…)<input name="localizacion" value="${safe(p.localizacion||'')}"></label><label class="field">Superficie ou lonxitude<input type="number" name="cantidade" min="0" step="any" inputmode="decimal" value="${safe(p.cantidade??'')}"></label><label class="field">Unidade<select name="unidade">${opts(UNIDADES,p.unidade||'','—')}</select></label><label class="field">Persoa ou entidade que informa *<input name="fonte_informacion" required value="${safe(p.fonte_informacion||'')}"></label><label class="field">Estado de verificación<select name="estado_verificacion">${opts(ESTADOS,p.estado_verificacion)}</select></label><label class="field">Máquina<select name="machine_ref">${opts(machineOpts(r,p),p.machine_ref||'','— Ningunha —')}</select></label><label class="field">Visita<select name="visit_ref">${opts(visitOpts(r,p),p.visit_ref||'','— Ningunha —')}</select></label><label class="field wide">Observacións<textarea name="observacions">${safe(p.observacions||'')}</textarea></label>${isNew&&MOSTRAR_DOCUMENTOS?`<div class="filebox wide"><label class="field">Adxuntar fotografías ou PDF (opcional)<input type="file" name="files" accept="image/jpeg,image/png,image/webp,application/pdf" multiple></label><div class="fields" style="margin-top:8px"><label class="field">Tipo de documento<select name="tipo_documento">${opts(TIPOS_DOC,'foto')}</select></label><label class="field">Orixe dos arquivos<select name="orixe">${opts(ORIXES,'','— Selecciona —')}</select></label></div><p class="muted tiny">O autor declarado dos arquivos será a persoa ou entidade que informa.</p></div>`:''}<div class="flex wide"><button class="btn primary" type="submit">Gardar actuación</button><button class="btn" type="button" data-close>Cancelar</button><span class="status muted tiny"></span></div></form>`);
 const form=$('actForm');
 form.onsubmit=async e=>{e.preventDefault();
  const fs=isNew&&MOSTRAR_DOCUMENTOS?[...sel(form,'files').files]:[];
  const payload={data_actuacion:nz(sel(form,'data_actuacion').value),tipo_traballo:nz(sel(form,'tipo_traballo').value),localizacion:nz(sel(form,'localizacion').value),cantidade:nz(sel(form,'cantidade').value)===null?null:Number(sel(form,'cantidade').value),unidade:nz(sel(form,'unidade').value),fonte_informacion:nz(sel(form,'fonte_informacion').value),estado_verificacion:sel(form,'estado_verificacion').value,observacions:nz(sel(form,'observacions').value)};
  Object.assign(payload,linkFrom(r,null,sel(form,'machine_ref').value,sel(form,'visit_ref').value));delete payload.actuacion_id;
  if(!payload.tipo_traballo||!payload.fonte_informacion){toast('Tipo de traballo e fonte son obrigatorios',true);return}
  if(payload.cantidade!==null&&!(payload.cantidade>=0)){toast('Superficie ou lonxitude non válida',true);return}
  const orixe=isNew&&MOSTRAR_DOCUMENTOS?nz(sel(form,'orixe').value):null;
  try{checkFiles(fs);if(fs.length&&!orixe)throw Error('Indica a orixe dos arquivos')}catch(err){toast(err.message,true);return}
  lockForm(form,true,'Gardando…');
  try{
   let saved;
   if(isNew){const res=await client.from('concellos_actuacions').insert({group_id:group,record_id:id,...payload}).select(ACT_COLS).single();if(res.error)throw res.error;saved=res.data}
   else{const res=await client.from('concellos_actuacions').update(payload).eq('id',a.id).eq('version',a.version).select(ACT_COLS);if(res.error)throw res.error;if(!res.data?.length){await refreshDocs(id);throw Error('Esta actuación foi modificada noutro dispositivo. Revisa a versión actual e repite o cambio.')}saved=res.data[0]}
   if(fs.length){const n=await uploadFiles(id,fs,{actuacion_id:saved.id,machine_ref:saved.machine_ref,machine_label:saved.machine_label,visit_ref:saved.visit_ref,visit_label:saved.visit_label,tipo_documento:sel(form,'tipo_documento').value,orixe,autor_declarado:saved.fonte_informacion,data_documento:saved.data_actuacion},t=>lockForm(form,true,t));toast(`Actuación gardada con ${n} arquivo(s)`)}else toast('Actuación gardada na nube');
   closeModal();await refreshDocs(id);
  }catch(err){lockForm(form,false);toast('Erro: '+err.message,true);refreshDocs(id)}
 };
}
function uploadDialog(preset){
 if(!MOSTRAR_DOCUMENTOS){toast('As fotografías e documentos están desactivados nesta versión');return}
 const id=currentId,r=base(rows.get(id));
 modal(`<h2>${preset.camera?'Fotografía desde a cámara':'Subir fotografías ou documentos'}</h2><p class="muted">${safe(r.name)} · almacén privado · JPG, PNG, WEBP ou PDF (máx. ${MAX_MB} MB)</p><form id="upForm" class="fields"><label class="field wide">${preset.camera?'Fotografía *':'Arquivos *'}<input type="file" name="files" ${preset.camera?'accept="image/jpeg,image/png,image/webp" capture="environment"':'accept="image/jpeg,image/png,image/webp,application/pdf" multiple'} required></label>${fileFields(true,{...preset,machine_ref:preset.machine_ref||machineFilter||''},r)}<div class="flex wide"><button class="btn primary" type="submit">Subir arquivos</button><button class="btn" type="button" data-close>Cancelar</button><span class="status muted tiny"></span></div></form>`);
 const form=$('upForm');
 form.onsubmit=async e=>{e.preventDefault();
  const fs=[...sel(form,'files').files],act=(docsCache.get(id)?.acts||[]).find(a=>a.id===sel(form,'actuacion_id').value)||null;
  const meta={...linkFrom(r,act,sel(form,'machine_ref').value,sel(form,'visit_ref').value),tipo_documento:sel(form,'tipo_documento').value,data_documento:nz(sel(form,'data_documento').value),autor_declarado:nz(sel(form,'autor_declarado').value),orixe:nz(sel(form,'orixe').value),description:nz(sel(form,'description').value)};
  try{if(!fs.length)throw Error('Selecciona polo menos un arquivo');if(!meta.autor_declarado||!meta.orixe)throw Error('Autor declarado e orixe son obrigatorios');checkFiles(fs)}catch(err){toast(err.message,true);return}
  lockForm(form,true,'Subindo…');
  try{const n=await uploadFiles(id,fs,meta,t=>lockForm(form,true,t));closeModal();toast(`${n} arquivo(s) subidos á nube`);await refreshDocs(id)}
  catch(err){lockForm(form,false);toast('Erro ao subir: '+err.message,true);refreshDocs(id)}
 };
}
function editFile(f){
 const id=currentId,r=base(rows.get(id));
 modal(`<h2>Editar datos do arquivo</h2><p class="muted" style="overflow-wrap:anywhere">${safe(f.filename)} · o arquivo orixinal non se modifica</p><form id="fForm" class="fields">${fileFields(true,f,r)}<div class="flex wide"><button class="btn primary" type="submit">Gardar</button><button class="btn" type="button" data-close>Cancelar</button><span class="status muted tiny"></span></div></form>`);
 const form=$('fForm');
 form.onsubmit=async e=>{e.preventDefault();
  const act=(docsCache.get(id)?.acts||[]).find(a=>a.id===sel(form,'actuacion_id').value)||null;
  const patch={...linkFrom(r,act,sel(form,'machine_ref').value,sel(form,'visit_ref').value),tipo_documento:sel(form,'tipo_documento').value,data_documento:nz(sel(form,'data_documento').value),autor_declarado:nz(sel(form,'autor_declarado').value),orixe:nz(sel(form,'orixe').value),description:nz(sel(form,'description').value)};
  if(!patch.autor_declarado||!patch.orixe){toast('Autor declarado e orixe son obrigatorios',true);return}
  lockForm(form,true,'Gardando…');
  try{const res=await client.from('concellos_files').update(patch).eq('id',f.id).eq('version',f.version??1).select('id');if(res.error)throw res.error;if(!res.data?.length)throw Error('Este arquivo foi modificado noutro dispositivo. Pecha e volve abrilo.');closeModal();toast('Datos do arquivo gardados');await refreshDocs(id)}
  catch(err){lockForm(form,false);toast(err.message,true);refreshDocs(id)}
 };
}
function voidItem(kind,x){
 const id=currentId,isAct=kind==='act',name=isAct?actName(x):x.filename;
 modal(`<h2>Anular ${isAct?'actuación':'arquivo'}</h2><p class="muted" style="overflow-wrap:anywhere">${safe(name)}</p><p class="tiny">Non se borra: queda no historial e pódese consultar con «Ver anulados».${isAct?' Os arquivos asociados mantéñense.':''}</p><form id="vForm" class="fields"><label class="field wide">Motivo *<textarea name="motivo" required></textarea></label><div class="flex wide"><button class="btn danger" type="submit">Anular</button><button class="btn" type="button" data-close>Cancelar</button><span class="status muted tiny"></span></div></form>`);
 const form=$('vForm');
 form.onsubmit=async e=>{e.preventDefault();const motivo=nz(sel(form,'motivo').value);if(!motivo){toast('Indica o motivo',true);return}
  lockForm(form,true,'Gardando…');
  try{const t=isAct?'concellos_actuacions':'concellos_files',patch=isAct?{anulada:true,motivo_anulacion:motivo}:{anulado:true,motivo_anulacion:motivo};const res=await client.from(t).update(patch).eq('id',x.id).eq('version',x.version??1).select('id');if(res.error)throw res.error;if(!res.data?.length)throw Error('Modificado noutro dispositivo. Volve abrir e repite.');closeModal();toast('Anulado');await refreshDocs(id)}
  catch(err){lockForm(form,false);toast(err.message,true)}
 };
}
async function showHistory(table,rid,title){
 const skip=new Set(['version','actualizado_en','actualizado_por','creado_en','creado_por','created_at','subido_por','group_id','record_id','id']);
 const {data,error}=await client.from('concellos_historial').select('accion,datos_antes,datos_despois,usuario,data').eq('taboa',table).eq('rexistro_id',String(rid)).order('data',{ascending:false}).limit(200);
 if(error){toast('Non se puido ler o historial: '+error.message,true);return}
 const rows_=(data||[]).map(h=>{const o=h.datos_antes||{},n=h.datos_despois||{};let body;if(h.accion==='insert')body='Creación do rexistro';else{const ks=[...new Set([...Object.keys(o),...Object.keys(n)])].filter(k=>!skip.has(k)&&JSON.stringify(o[k])!==JSON.stringify(n[k]));body=ks.map(k=>`${k}: ${o[k]??'—'} → ${n[k]??'—'}`).join('\n')||'Sen cambios visibles'}return `<div class="entry"><strong>${safe(fmtStamp(h.data))}</strong> · ${safe(who(h.usuario))} · ${safe(h.accion)}<div class="mini">${safe(body)}</div></div>`}).join('')||'<p class="muted">Sen historial.</p>';
 modal(`<h2>Historial</h2><p class="muted" style="overflow-wrap:anywhere">${safe(title)}</p>${rows_}<div class="flex"><button class="btn" data-close>Pechar</button></div>`);
}
// Fila de exportación por concello (Excel e CSV). Inclúe os campos de control v2.
function filaExport(r){const o={id:r.id,provincia:r.prov,concello:r.name,empresa:r.empresa,apeiro:r.apeiro,acta:r.acta,firmada:r.firmada,asinada_por:r.asinadaPor,estado_visita:inspectState(r).visit,estado_maquina:inspectState(r).broken?'parado_por_avaria':(r.estadoMecanico||'operativa'),observacions:r.notaSeaga,documentacion:r.comprobacionDocumental};
 for(const [k] of CAMPOS_CONTROL)o[k]=r[k]??'';return o}
// CSV (separador «;» e BOM UTF-8 para que Excel en galego/castelán o abra ben). Exporta a lista FILTRADA.
function exportCSV(){const a=all().filter(matchFilter),rs=a.map(filaExport);if(!rs.length){toast('Non hai concellos na lista filtrada',true);return}
 const cols=Object.keys(rs[0]),q=v=>{v=String(v??'');return /[;"\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
 const txt='\ufeff'+[cols.join(';'),...rs.map(r=>cols.map(c=>q(r[c])).join(';'))].join('\r\n');
 const url=URL.createObjectURL(new Blob([txt],{type:'text/csv;charset=utf-8'})),el=document.createElement('a');el.href=url;el.download='Control_Concellos_'+new Date().toISOString().slice(0,10)+'.csv';document.body.appendChild(el);el.click();el.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);toast(`CSV exportado (${rs.length} concellos)`)}
function exportExcel(){const a=all();let wb=XLSX.utils.book_new();const add=(title,rs)=>XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rs.length?rs:[{sen_datos:''}]),title);add('Concellos',a.map(filaExport));add('Maquinaria',a.flatMap(r=>(r.machines||[]).map(m=>({id:r.id,concello:r.name,...m}))));add('Visitas',a.flatMap(r=>(r.visits||[]).map(v=>({id:r.id,concello:r.name,...v}))));XLSX.writeFile(wb,'App_Concellos_Bieito_'+new Date().toISOString().slice(0,10)+'.xlsx')}
function credsConexion(){const url=$('url').value.trim().replace(/\/+$/,'').replace(/\/rest\/v1$/,'');const key=$('key').value.trim();return{url,key,ok:/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)&&!!key}}
function crearCliente(url,key){return window.supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}})}
function paramsAuth(){const h=new URLSearchParams((location.hash||'').replace(/^#/,'')),q=new URLSearchParams((location.search||'').replace(/^\?/,''));const g=k=>h.get(k)||q.get(k)||'';return{type:g('type'),access_token:g('access_token'),code:g('code'),token_hash:g('token_hash'),error:g('error_description')||g('error')}}
function amosarReset(){$('login').classList.add('hidden');$('resetBox').classList.remove('hidden');$('newPwd')?.focus()}
function limparUrlAuth(){try{history.replaceState({},'',location.pathname+(location.pathname.endsWith('/')?'':'/'))}catch(e){}}
function msgLogin(ok,texto){if($('loginMsg'))$('loginMsg').textContent=ok?texto:'';$('loginError').textContent=ok?'':texto}
async function entrarSesion(userId,url,key,groupId){group=groupId;me=userId;localStorage.setItem('cb-config',JSON.stringify({url,key}));$('password').value='';if($('newPwd'))$('newPwd').value='';if($('newPwd2'))$('newPwd2').value='';$('login').classList.add('hidden');$('resetBox')?.classList.add('hidden');$('app').classList.remove('hidden');initSearch();initSheet();setSync('loading');['logoutBtn','refreshBtn','exportBtn','csvBtn'].forEach(x=>$(x)?.classList.remove('hidden'));await initMap();await fetchAll();if(refreshTimer)clearInterval(refreshTimer);refreshTimer=setInterval(()=>{if(document.visibilityState==='visible'&&!dirty)fetchAll()},15000)}
async function login(){const {url,key,ok}=credsConexion();if(!ok){msgLogin(false,'Revisa a URL e a clave pública de Supabase.');return}if(!window.supabase?.createClient){msgLogin(false,'Non cargou a libraría de conexión. Comproba Internet.');return}try{$('loginBtn').disabled=true;client=crearCliente(url,key);const {data,error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;let m=await client.from('seaga_members').select('group_id').eq('user_id',data.user.id).single();if(m.error||!m.data)throw Error('Este usuario non figura na táboa seaga_members');await entrarSesion(data.user.id,url,key,m.data.group_id)}catch(e){msgLogin(false,e.message)}finally{$('loginBtn').disabled=false}}
async function pedirRecuperacion(){const {url,key,ok}=credsConexion();const email=$('email').value.trim();if(!ok){msgLogin(false,'Revisa a URL e a clave pública de Supabase.');return}if(!email){msgLogin(false,'Pon o correo de acceso para enviarche a recuperación.');return}if(!window.supabase?.createClient){msgLogin(false,'Non cargou a libraría de conexión. Comproba Internet.');return}try{$('forgotBtn').disabled=true;const c=crearCliente(url,key);const redirectTo=location.origin+location.pathname;const {error}=await c.auth.resetPasswordForEmail(email,{redirectTo});if(error)throw error;localStorage.setItem('cb-config',JSON.stringify({url,key}));msgLogin(true,'Se o correo está autorizado, recibirás unha ligazón. Mira a caixa de entrada e o correo non desexado.')}catch(e){msgLogin(false,e.message)}finally{$('forgotBtn').disabled=false}}
async function iniciarRecuperacion(){const p=paramsAuth();if(p.error){msgLogin(false,p.error);return}if(!(p.type==='recovery'||p.access_token||p.code||p.token_hash))return;const {url,key,ok}=credsConexion();if(!ok||!window.supabase?.createClient){msgLogin(false,'Falta a URL ou a clave pública para completar a recuperación.');return}try{client=crearCliente(url,key);if(p.token_hash&&client.auth.verifyOtp){const {error}=await client.auth.verifyOtp({token_hash:p.token_hash,type:'recovery'});if(error)throw error}let session=(await client.auth.getSession())?.data?.session;if(!session&&p.code&&client.auth.exchangeCodeForSession){const r=await client.auth.exchangeCodeForSession(p.code);if(r.error)throw r.error;session=r.data?.session}if(client.auth.onAuthStateChange)client.auth.onAuthStateChange(ev=>{if(ev==='PASSWORD_RECOVERY')amosarReset()});if(session||p.type==='recovery'){amosarReset();return}await new Promise(r=>setTimeout(r,400));session=(await client.auth.getSession())?.data?.session;if(session)amosarReset();else msgLogin(false,'Non se puido abrir a sesión de recuperación. Pide unha ligazón nova.')}catch(e){msgLogin(false,e.message)}}
async function gardarContrasinalNovo(){const p1=$('newPwd').value,p2=$('newPwd2').value;if(p1.length<8){$('resetError').textContent='O contrasinal ten que ter polo menos 8 caracteres.';return}if(p1!==p2){$('resetError').textContent='Os dous campos teñen que coincidir.';return}try{$('savePwdBtn').disabled=true;$('resetError').textContent='';const {error}=await client.auth.updateUser({password:p1});if(error)throw error;const sess=(await client.auth.getSession())?.data?.session;const userId=sess?.user?.id;if(!userId)throw Error('Non hai sesión despois de cambiar o contrasinal.');const {url,key,ok}=credsConexion();if(!ok)throw Error('Revisa a URL e a clave pública de Supabase.');let m=await client.from('seaga_members').select('group_id').eq('user_id',userId).single();if(m.error||!m.data)throw Error('Este usuario non figura na táboa seaga_members');limparUrlAuth();await entrarSesion(userId,url,key,m.data.group_id)}catch(e){$('resetError').textContent=e.message}finally{$('savePwdBtn').disabled=false}}
$('loginBtn').onclick=login;$('password').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
if($('forgotBtn'))$('forgotBtn').onclick=pedirRecuperacion;
if($('savePwdBtn')){$('savePwdBtn').onclick=gardarContrasinalNovo;['newPwd','newPwd2'].forEach(id=>$(id)?.addEventListener('keydown',e=>{if(e.key==='Enter')gardarContrasinalNovo()}))}
iniciarRecuperacion();
$('logoutBtn').onclick=async()=>{if(client)await client.auth.signOut();location.reload()};$('refreshBtn').onclick=()=>{if(dirty&&!confirm('Descartar cambios sen gardar?'))return;dirty=false;fetchAll()};$('exportBtn').onclick=exportExcel;if($('csvBtn'))$('csvBtn').onclick=exportCSV;['search','province','filter','filterXeral'].forEach(id=>$(id)?.addEventListener(id==='search'?'input':'change',renderList));
// Chips do resumo de control: un clic filtra pola categoría (outro clic quita o filtro)
$('kpis').addEventListener('click',e=>{const b=e.target.closest('[data-xeral]');if(!b||!$('filterXeral'))return;const v=b.dataset.xeral;$('filterXeral').value=$('filterXeral').value===v?'':v;renderList()});
})();
