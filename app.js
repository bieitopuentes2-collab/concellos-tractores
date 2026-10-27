
(()=>{'use strict';
const $=id=>document.getElementById(id), safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=x=>JSON.parse(JSON.stringify(x));
const slug=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const colors={avaria:'#d94b46',visitado:'#1a9a72',fotos:'#2589ce',contactado:'#edb247',pendente:'#929e9c','sen-tractor':'#929e9c','so-apero':'#8166b5','non-localizado':'#d6a133'};
const labels={avaria:'Avaría detectada',visitado:'Visita presencial',fotos:'Fotos sen visita',contactado:'Contactado',pendente:'Pendente','sen-tractor':'Sen tractor asignado','so-apero':'Só apero','non-localizado':'Visitado · tractor sen localizar'};
let client=null,me='',group='',rows=new Map(),currentId='',map=null,layer=null,provinceLayer=null,mapFeatures=null,provinceFeatures=null,refreshTimer=null,busy=false,dirty=false;
let conn=JSON.parse(localStorage.getItem('cb-config')||'{}'); $('url').value=conn.url||'https://kibwuguhptwrogcxjbxn.supabase.co';$('key').value=conn.key||'';
function toast(msg,error=false){let t=$('toast');t.textContent=msg;t.style.background=error?'#972e37':'#193a30';t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),4900)}
function notice(s){$('appNotice').textContent=s;$('appNotice').classList.toggle('hidden',!s)}
function base(row){return {...(row.record||{}),...(row.change||{})}}
function all(){return [...rows.values()].map(x=>base(x)).sort((a,b)=>String(a.name).localeCompare(String(b.name),'gl'))}
// Unha avaría histórica ou unha peza danada NON equivale a tractor inmobilizado.
// Só se destaca parada por avaría expresamente indicada nas notas dunha saída.
function stopForBreakdown(r){
 const visits=r.visits||[];
 const decisive=/\b(?:parad[oa]|inmobilizad[oa]|sen funcionar|non funciona|no funciona|fuera de servicio|fora de servizo)\b.{0,65}\b(?:av[eí]r[ií]a|aver[ií]a|rotura|roto|estropead[oa])\b|\b(?:av[eí]r[ií]a|aver[ií]a)\b.{0,60}\b(?:parad[oa]|inmobilizad[oa]|sen funcionar|non funciona)\b/i;
 const text=visits.map(v=>[v.traballo,v.observacions].filter(Boolean).join(' ')).join(' ');
 return decisive.test(text);
}
function isCrecente(r){return slug(r.name)==='CRECENTE'}
function isNegreira(r){return slug(r.name)==='NEGREIRA'}
function isAranga(r){return slug(r.name)==='ARANGA'}
function hasPlate(r){return (r.machines||[]).some(m=>String(m.matricula||'').trim().length>2)}
// A matrícula documentada é a referencia para distinguir asignacións de rexistros pendentes.
// Negreira ten tractor, pero non se puido localizar na visita; Crecente só dispón de apero.
function noTractor(r){return !isNegreira(r)&&!isCrecente(r)&&!hasPlate(r)}
function tractorCount(r){if(isCrecente(r)||noTractor(r))return 0;if(isNegreira(r))return 1;if(slug(r.name)==='POIO')return 2;return 1}
function inspectState(r){
 const manual=String(r.estadoMecanico||'').toLowerCase();
 const broken=manual==='avariada-confirmada'||(!['operativa','reparada','en-reparacion'].includes(manual)&&stopForBreakdown(r));
 // A visita ao concello non acredita por si soa a comprobación física da máquina.
 let visit=String(r.estadoVisita||'').toLowerCase();
 if(isNegreira(r))visit='non-localizado';
 else if(isAranga(r)&&!(r.visits||[]).length)visit='fotos';
 else if(noTractor(r))visit='sen-tractor';
 else if(isCrecente(r))visit='visitado';
 else if(!visit||visit==='pendente'||visit==='contactado')visit='visitado';
 let state=isCrecente(r)?'so-apero':noTractor(r)?'sen-tractor':isNegreira(r)?'non-localizado':broken?'avaria':visit==='fotos'?'fotos':visit==='visitado'?'visitado':visit==='contactado'?'contactado':'pendente';
 return {state,visit,broken};
}
function kpis(){let a=all(),nvisit=a.filter(r=>inspectState(r).visit==='visitado').length,nfoto=a.filter(r=>inspectState(r).visit==='fotos').length,nbroken=a.filter(r=>inspectState(r).state==='avaria').length,m=a.reduce((s,r)=>s+tractorCount(r),0),nwithout=a.filter(noTractor).length;let stats=[['Concellos',a.length],['Tractores identificados ou declarados',m],['Visitados',nvisit],['Fotos sen visita',nfoto],['Paradas por avaría rexistradas',nbroken],['Sen tractor na relación',nwithout]];$('kpis').innerHTML=stats.map(([k,v])=>`<div class="kpi"><b>${v}</b><span>${safe(k)}</span></div>`).join('')}

function matchFilter(r){let q=slug($('search').value);let ok=!q||slug([r.name,r.prov,r.empresa,...(r.machines||[]).map(m=>[m.matricula,m.marca,m.modelo]),r.notaSeaga].join(' ')).includes(q);return ok&&(!$('province').value||r.prov===$('province').value)&&(!$('filter').value||inspectState(r).state===$('filter').value)}
function renderList(){let a=all().filter(matchFilter);$('list').innerHTML=a.map(r=>`<button class="item ${r.id===currentId?'active':''}" data-id="${safe(r.id)}" style="border-left-color:${colors[inspectState(r).state]}"><span><strong>${safe(r.name)}</strong><br><small class="muted">${safe(r.prov)} · ${tractorCount(r)} tractor(es)${isCrecente(r)?' · só apero':isNegreira(r)?' · tractor non localizado':''}</small></span><span class="pill">${labels[inspectState(r).state]}</span></button>`).join('')||'<div class="pad muted">Sen resultados</div>';$('list').querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>openRecord(b.dataset.id)))}
// ===== TICKET 02 · Mapa cartográfico (IGN/CNIG, sen API key) =====
const IGN_WMTS=(svc,layer,fmt)=>`https://www.ign.es/wmts/${svc}?service=WMTS&request=GetTile&version=1.0.0&layer=${layer}&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}&format=${fmt}`;
const IGN_ATTR='© <a href="https://www.ign.es" target="_blank" rel="noopener">IGN</a>/CNIG · CC BY 4.0 scne.es';
const BASES={
 orto:{label:'Ortofoto PNOA',url:IGN_WMTS('pnoa-ma','OI.OrthoimageCoverage','image/jpeg'),nat:19,attr:'Ortofoto PNOA máxima actualidad '+IGN_ATTR,alt:'gris'},
 topo:{label:'Topográfico IGN',url:IGN_WMTS('mapa-raster','MTN','image/jpeg'),nat:17,attr:'Cartografía ráster '+IGN_ATTR,alt:'gris'},
 gris:{label:'Mapa base sinxelo',url:IGN_WMTS('ign-base','IGNBase-gris','image/jpeg'),nat:18,attr:'Mapa base '+IGN_ATTR,alt:'osm'},
 osm:{label:'OpenStreetMap',url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',nat:19,attr:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',alt:'none'},
 none:{label:'Sen fondo (só límites)',url:null}
};
const LABELS_URL=IGN_WMTS('ign-base','IGNBaseOrto','image/png');
const PNOA_WMS='https://www.ign.es/wms-inspire/pnoa-ma';
const pref=(k,v)=>{try{if(v===undefined)return localStorage.getItem('cb-'+k);localStorage.setItem('cb-'+k,String(v))}catch(e){return null}};
let baseKey='orto',baseLayer=null,labelsLayer=null,fillOp=null,byNameMap=new Map(),layerById=new Map(),selId='',gpsLayer=null,orthoCtl=null,orthoTimer=null,orthoCache=new Map(),orthoAbort=null,tileStat={err:0,ok:0,key:''};
const isMobile=()=>matchMedia('(max-width:1000px)').matches;
function lookupFeature(f,names){let n=[f.properties?.name,f.properties?.NAME,f.properties?.nombre,f.properties?.municipality].filter(Boolean);for(let x of n){let m=names.get(slug(x));if(m)return m;}return null}
function curOpacity(){return fillOp??(baseKey==='orto'||baseKey==='topo'?.5:.82)}
function featStyle(f){
 const r=lookupFeature(f,byNameMap),onImg=baseKey==='orto'||baseKey==='topo',sel=r&&r.id===selId;
 return {color:sel?'#ffd400':onImg?'#ffffffcc':'#ffffff',weight:sel?4:onImg?.9:.7,fillColor:r?colors[inspectState(r).state]:'#dce5df',fillOpacity:r?curOpacity():(onImg?0:.35)};
}
function provStyle(){const onImg=baseKey==='orto'||baseKey==='topo';return {color:onImg?'#ffffff':'#26443b',weight:onImg?3.4:3,opacity:.95,fill:false}}
function mapNotice(s){const n=$('mapNotice');if(!n)return;n.textContent=s||'';n.classList.toggle('hidden',!s)}
function setBase(k,why){
 if(!BASES[k])k='orto';baseKey=k;pref('base',k);
 if(baseLayer){baseLayer.remove();baseLayer=null}
 const b=BASES[k];tileStat={err:0,ok:0,key:k};
 if(b.url){
  baseLayer=L.tileLayer(b.url,{maxZoom:19,maxNativeZoom:b.nat,attribution:b.attr,updateWhenIdle:true,keepBuffer:1,crossOrigin:false,errorTileUrl:'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='});
  baseLayer.on('tileload',e=>{if(tileStat.key===k&&!String(e.tile?.src||'').startsWith('data:'))tileStat.ok++});
  baseLayer.on('tileerror',()=>{if(tileStat.key!==k)return;tileStat.err++;if(tileStat.ok===0&&tileStat.err>=4&&b.alt){const alt=b.alt;mapNotice(`${b.label} non dispoñible agora. Amosando «${BASES[alt].label}».`);setTimeout(()=>mapNotice(''),9000);setBase(alt,'fallback');syncBasePanel()}});
  baseLayer.addTo(map);
 }
 if(!why)mapNotice('');
 if(labelsLayer){labelsLayer.remove();labelsLayer=null}
 if(k==='orto'&&pref('labels')!=='0'){labelsLayer=L.tileLayer(LABELS_URL,{pane:'labels',maxZoom:19,maxNativeZoom:18,updateWhenIdle:true,keepBuffer:1}).addTo(map)}
 if(layer)layer.setStyle(featStyle);if(provinceLayer)provinceLayer.setStyle(provStyle());
 $('map').style.background=k==='none'?'#eef2f0':'#dfe7e2';
 updateOrtho();
}
function syncBasePanel(){document.querySelectorAll('input[name=cbBase]').forEach(i=>i.checked=i.value===baseKey);const lb=document.querySelector('#cbLabels');if(lb)lb.closest('label').style.display=baseKey==='orto'?'':'none';const op=document.querySelector('#cbOpacity');if(op)op.value=Math.round(curOpacity()*100)}
function orthoSrc(){return isMobile()?'PNOA MA · IGN':'Ortofoto PNOA máxima actualidad · IGN/CNIG'}
function updateOrtho(){
 if(!orthoCtl)return;const el=orthoCtl.getContainer();
 if(baseKey!=='orto'){el.style.display='none';return}
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
 control('topright',d=>{d.innerHTML=`<button class="cb-btn" id="cbLayersBtn" title="Fondo e transparencia" aria-label="Fondo e transparencia" aria-expanded="false">▦</button><div class="cb-panel hidden" id="cbLayers"><h4>Fondo</h4>${Object.entries(BASES).map(([k,b])=>`<label><input type="radio" name="cbBase" value="${k}"> ${safe(b.label)}</label>`).join('')}<label><input type="checkbox" id="cbLabels"> Topónimos sobre a ortofoto</label><h4 style="margin-top:8px">Transparencia das cores</h4><input type="range" id="cbOpacity" min="0" max="100" step="5" aria-label="Opacidade das cores municipais"><div class="muted tiny" id="cbOpLabel"></div></div>`;
  const panel=d.querySelector('#cbLayers'),btn=d.querySelector('#cbLayersBtn');
  btn.onclick=()=>{const open=panel.classList.toggle('hidden')===false;btn.classList.toggle('on',open);btn.setAttribute('aria-expanded',open);btn.classList.toggle('hidden',open)};
  map.on('click',()=>{panel.classList.add('hidden');btn.classList.remove('hidden','on')});
  d.querySelectorAll('input[name=cbBase]').forEach(i=>i.onchange=()=>{setBase(i.value);syncBasePanel()});
  const lb=d.querySelector('#cbLabels');lb.checked=pref('labels')!=='0';lb.onchange=()=>{pref('labels',lb.checked?'1':'0');setBase(baseKey)};
  const op=d.querySelector('#cbOpacity'),opl=d.querySelector('#cbOpLabel');const lab=()=>opl.textContent=`Opacidade: ${op.value} %`;
  op.oninput=()=>{fillOp=op.value/100;pref('opacity',fillOp);lab();if(layer)layer.setStyle(featStyle)};
  setTimeout(()=>{syncBasePanel();lab()},0);
 });
 control('topright',d=>{d.innerHTML='<button class="cb-btn" id="cbGps" title="A miña posición (opcional)" aria-label="Amosar a miña posición">⌖</button>';d.querySelector('#cbGps').onclick=toggleGps});
 L.control.scale({position:'bottomleft',imperial:false,maxWidth:120}).addTo(map);
 control('bottomleft',d=>{d.innerHTML=`<details class="cb-legend" ${isMobile()?'':'open'}><summary>Lenda</summary>${Object.keys(labels).map(k=>`<div><i class="mark" style="background:${colors[k]}"></i>${safe(labels[k])}</div>`).join('')}<div><i class="mark" style="background:transparent;border:2px solid #ffd400"></i>Concello seleccionado</div></details>`});
 orthoCtl=control('bottomright',d=>{d.className+=' orthoInfo'});
 map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
}
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
 buildControls();setBase(pref('base')||'orto');
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
const TABS=[['info','Información'],['maq','Maquinaria'],['vis','Visitas'],['trab','Traballos'],['doc','Documentación']];
let currentTab=pref('tab')||'info',lastSync=null,syncState='idle';
function setSync(state,msg){
 syncState=state;const el=$('syncLabel');if(!el)return;
 if(state==='ok')lastSync=new Date();
 const t={ok:`Sincronizado ${lastSync?lastSync.toLocaleTimeString('gl-ES',{hour:'2-digit',minute:'2-digit'}):''}`,saving:'Gardando…',loading:'Sincronizando…',dirty:'Cambios sen gardar',error:'Erro de sincronización',offline:'Sen conexión',idle:'Sen conectar'}[state]||state;
 el.className='sync '+state;el.textContent=msg||t;el.title=msg||t;
 const sv=document.querySelector('[data-quick="save"]');if(sv)sv.classList.toggle('pulse',state==='dirty');
}
function markDirty(){if(!dirty){dirty=true;setSync('dirty')}}
function sheet(state){const s=$('sheet');if(!s)return;s.dataset.state=state;$('actionbar').classList.toggle('hidden',!currentId);if(map)setTimeout(()=>map.invalidateSize(),260)}
function setTab(k,user){currentTab=k;pref('tab',k);document.querySelectorAll('#tabs .tab').forEach(b=>{const on=b.dataset.tab===k;b.classList.toggle('active',on);b.setAttribute('aria-selected',on)});document.querySelectorAll('#detail .pane').forEach(p=>p.classList.toggle('on',p.dataset.pane===k));if(user&&isMobile()&&$('sheet').dataset.state==='peek')sheet('half')}
function tabCounts(r){const d=docsCache.get(currentId);return {maq:(r.machines||[]).length,vis:(r.visits||[]).length,trab:d?d.acts.filter(a=>!a.anulada).length:'',doc:d?d.files.filter(f=>!f.anulado).length:''}}
function renderTabs(r){const c=tabCounts(r);$('tabs').innerHTML=TABS.map(([k,t])=>`<button role="tab" class="tab${k===currentTab?' active':''}" data-tab="${k}" aria-selected="${k===currentTab}">${t}${c[k]!==undefined&&c[k]!==''?`<small>${c[k]}</small>`:''}</button>`).join('');$('tabs').querySelectorAll('.tab').forEach(b=>b.onclick=()=>setTab(b.dataset.tab,true))}
function renderDetail(){
 const row=rows.get(currentId);
 if(!row){$('detailTitle').textContent='Ficha do concello';$('statusTag').textContent='Selecciona no mapa';$('statusTag').style.background='';$('detailMeta').textContent='';$('tabs').innerHTML='';$('detail').innerHTML='<div class="empty muted">Selecciona un concello no mapa ou na lista para ver a súa ficha.</div>';$('actionbar').classList.add('hidden');return}
 const keep=$('detail').scrollTop,r=base(row),s=inspectState(r);
 $('detailTitle').textContent=r.name;$('statusTag').textContent=labels[s.state];$('statusTag').style.background=colors[s.state]+'25';$('statusTag').style.borderColor=colors[s.state];
 $('detailMeta').textContent=`${r.prov||''} · ${r.empresa||'Empresa non indicada'} · ${tractorCount(r)} tractor(es)`;
 renderTabs(r);$('actionbar').classList.remove('hidden');
 let visits=(r.visits||[]).map((v,i)=>`<div class="entry"><strong>${safe(v.fecha||'Sen data')}</strong> · ${safe(v.lugar||'')}<div>${safe(v.traballo||'')}</div><div>${safe(v.observacions||'')}</div><div class="mini">Horas: ${safe(v.horas||'—')}</div><button class="btn" data-editvisit="${i}">Editar</button></div>`).join('')||'<p class="muted">Non hai visitas gardadas.</p>';
 let machines=(r.machines||[]).map((m,i)=>`<div class="entry"><strong>${safe([m.marca,m.modelo].filter(Boolean).join(' ')||'Máquina sen identificar')}</strong><div>${safe(m.matricula||'Matrícula non indicada')} · ${safe(m.apeiro||'')}</div><div class="mini">Inicio: ${safe(m.inicio||'—')} · Fin: ${safe(m.fin||'—')}</div><button class="btn" data-editmachine="${i}">Editar</button> <button class="btn" data-docmachine="${i}">Documentación</button></div>`).join('')||'<p class="muted">Sen maquinaria rexistrada.</p>';
 let contacts=(r.contacts||[]).map((c,i)=>`<div class="entry"><strong>${safe(c.contacto||'Contacto')}</strong><button class="btn" data-editcontact="${i}">Editar contacto</button><button class="btn" data-addhistory="${i}">+ Anotación</button><div class="mini">${(c.historial||[]).map((h,j)=>`<div style="margin:7px 0">${safe(h.fecha||'')} · ${safe(h.resumo||'')} <button class="btn" data-edithistory="${i}:${j}">Editar</button></div>`).join('')}</div></div>`).join('')||'<p class="muted">Sen contactos</p>';
 $('detail').innerHTML=`<section class="pane" data-pane="info"><div class="fields"><label class="field">Estado da comprobación<select id="fVisita"><option value="pendente">Pendente</option><option value="contactado">Contactado</option><option value="non-localizado">Concello visitado, tractor non localizado</option><option value="fotos">Fotos recibidas</option><option value="visitado">Visita presencial</option></select></label><label class="field">Estado mecánico<select id="fMecanica"><option value="sen-datos">Sen datos actualizados</option><option value="operativa">Operativa</option><option value="avariada-confirmada">Parado por avaría (confirmado)</option><option value="en-reparacion">En reparación</option><option value="reparada">Reparada</option><option value="parada">Parada por outra causa</option></select></label><label class="field wide">Observacións xerais<textarea id="fNotas"></textarea></label><label class="field wide">Información documental<textarea id="fDoc"></textarea></label></div><div class="block"><h3>Información de orixe e acta de entrega</h3><div class="fields"><label class="field">Empresa<input id="fEmpresa" value="${safe(r.empresa||'')}" placeholder="Empresa"></label><label class="field">Apeiro<input id="fApeiro" value="${safe(r.apeiro||'')}" placeholder="Apeiro asignado"></label><label class="field">Acta<input id="fActa" value="${safe(r.acta||'')}" placeholder="Si / Non / Pendente"></label><label class="field">Acta asinada (Si / Non / Pendente)<input id="fFirmada" value="${safe(r.firmada||'')}" placeholder="Si / Non / Pendente"></label><label class="field wide">Asinada por (nome e cargo)<input id="fAsinadaPor" value="${safe(r.asinadaPor||'')}" placeholder="Nome e cargo"></label></div></div><div class="block"><div class="paneHead"><h3>Contactos e historial</h3><button class="btn" data-action="contact">+ Contacto</button></div>${contacts}</div><p class="muted">Modifica os campos e pulsa «Gardar». Os cambios sincronízanse en todos os dispositivos.</p></section>
<section class="pane" data-pane="maq"><div class="paneHead"><h3>Maquinaria (${(r.machines||[]).length}) · Tractores contabilizados: ${tractorCount(r)}</h3><button class="btn" data-action="machine">+ Máquina</button></div>${machines}</section>
<section class="pane" data-pane="vis"><div class="paneHead"><h3>Historial de visitas (${(r.visits||[]).length})</h3><button class="btn" data-action="visit">+ Visita</button></div>${visits}</section>
<section class="pane" data-pane="trab"><div id="docs"><span class="muted">Cargando…</span></div></section>
<section class="pane" data-pane="doc"><div class="paneHead"><h3>Fotografías e documentos</h3></div><div class="flex"><button class="btn big" data-quick="camera"><span>📷</span> Facer foto</button><button class="btn big" data-quick="doc"><span>📄</span> Adxuntar PDF / imaxe</button></div><div id="docsFiles"><span class="muted">Cargando…</span></div></section>`;
 $('fVisita').value=['pendente','contactado','fotos','visitado','non-localizado'].includes(s.visit)?s.visit:'pendente';$('fMecanica').value=(s.broken?'avariada-confirmada':(r.estadoMecanico==='avariada'?'operativa':r.estadoMecanico||'operativa'));$('fNotas').value=r.notaSeaga||'';$('fDoc').value=r.comprobacionDocumental||'';
 ['fVisita','fMecanica','fNotas','fDoc','fEmpresa','fApeiro','fActa','fFirmada','fAsinadaPor'].forEach(k=>{$(k).addEventListener('input',markDirty);$(k).addEventListener('change',markDirty)});
 const D=$('detail');
 D.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{let a=b.dataset.action;if(a==='save')saveForm();else if(a==='visit')editVisit(-1);else if(a==='machine')editMachine(-1);else if(a==='photo')uploadDialog({});else if(a==='contact')editContact(-1)});
 D.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>quick(b.dataset.quick));
 D.querySelectorAll('[data-editvisit]').forEach(b=>b.onclick=()=>editVisit(+b.dataset.editvisit));D.querySelectorAll('[data-editmachine]').forEach(b=>b.onclick=()=>editMachine(+b.dataset.editmachine));D.querySelectorAll('[data-editcontact]').forEach(b=>b.onclick=()=>editContact(+b.dataset.editcontact));D.querySelectorAll('[data-addhistory]').forEach(b=>b.onclick=()=>editHistory(+b.dataset.addhistory,-1));D.querySelectorAll('[data-edithistory]').forEach(b=>b.onclick=()=>{let [i,j]=b.dataset.edithistory.split(':').map(Number);editHistory(i,j)});
 D.querySelectorAll('[data-docmachine]').forEach(b=>b.onclick=()=>{const k=+b.dataset.docmachine;machineFilter=machineRef((r.machines||[])[k],k);paintDocs(currentId);setTab('trab',true);D.scrollTop=0});
 setTab(currentTab);D.scrollTop=keep;
 loadDocs(currentId);
}
function paintFiles(id){
 const wrap=$('docsFiles'),d=docsCache.get(id);if(!wrap||!d||id!==currentId)return;
 const fs=d.files.filter(f=>showVoid||!f.anulado),pics=fs.filter(isPic),docs=fs.filter(f=>!isPic(f));
 wrap.innerHTML=`<h3>Fotografías (${pics.length})</h3><div class="thumbs gallery">${pics.map(thumb).join('')||'<span class="muted tiny">Ningunha</span>'}</div><h3>Documentos (${docs.length})</h3>${docs.map(f=>`<button class="entry" style="display:flex;gap:10px;align-items:center;width:100%;text-align:left;cursor:pointer" data-file="${safe(f.id)}"><b style="color:#8a2b2b">PDF</b><span style="flex:1;min-width:0"><strong style="overflow-wrap:anywhere">${safe(f.filename)}</strong><br><span class="mini">${safe([TIPOS_DOC[f.tipo_documento],f.autor_declarado,f.data_documento&&fmtDate(f.data_documento)].filter(Boolean).join(' · '))}</span></span></button>`).join('')||'<p class="muted tiny">Ningún</p>'}`;
 wrap.querySelectorAll('[data-file]').forEach(b=>b.onclick=()=>{const f=d.files.find(x=>x.id==b.dataset.file);if(!f)return;const lst=isPic(f)?pics:docs;viewer(lst,Math.max(0,lst.indexOf(f)))});
 const row=rows.get(id);if(row)renderTabs(base(row));
}
function quick(k){
 if(!currentId)return;
 if(k==='save')return saveForm();
 if(k==='visit')return editVisit(-1);
 if(k==='camera')return uploadDialog({camera:true,tipo_documento:'foto',orixe:'visita'});
 if(k==='doc')return uploadDialog({tipo_documento:'parte'});
}
function openRecord(id,opt={}){
 if(dirty&&id!==currentId&&!confirm('Hai cambios sen gardar nesta ficha. Queres descartalos?'))return;
 if(id!==currentId){machineFilter=null;dirty=false;if(syncState==='dirty')setSync('ok')}
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
async function savePatch(id,patch){const row=rows.get(id);if(!row)throw Error('Ficha inexistente');setSync('saving');let merged={...row.change,...patch};const {data,error}=await client.from('seaga_records').update({change:merged,updated_at:new Date().toISOString()}).eq('group_id',group).eq('record_id',id).eq('updated_at',row.updated_at).select('record_id,record,change,updated_at');if(error)throw error;if(!data?.length){await fetchAll(true);throw Error('Outro dispositivo modificou esta ficha. Actualiza e repite o cambio para evitar sobrescribir datos.')}rows.set(id,parseRow(data[0]));dirty=false;setSync('ok');render();toast('Gardado na nube')}
async function saveForm(){const id=currentId;try{await savePatch(id,{estadoVisita:$('fVisita').value,estadoMecanico:$('fMecanica').value,notaSeaga:$('fNotas').value,comprobacionDocumental:$('fDoc').value,empresa:$('fEmpresa').value.trim(),apeiro:$('fApeiro').value.trim(),acta:$('fActa').value.trim(),firmada:$('fFirmada').value.trim(),asinadaPor:$('fAsinadaPor').value.trim()})}catch(e){setSync(dirty?'dirty':'error',dirty?undefined:'Erro ao gardar');toast(e.message,true)}}
function modal(html,wide){$('modalRoot').innerHTML=`<div class="overlay" id="overlay"><div class="modal${wide?' wide':''}">${html}</div></div>`;$('overlay').addEventListener('click',e=>{if(e.target.id==='overlay')closeModal()});$('modalRoot').querySelectorAll('[data-close]').forEach(b=>b.onclick=closeModal);$('modalRoot').querySelectorAll('input[name=localizacion],input[name=lugar]').forEach(inp=>{const g=document.createElement('button');g.type='button';g.className='btn gpsbtn';g.textContent='📍 Engadir a miña posición';g.onclick=()=>gpsFill(inp);inp.insertAdjacentElement('afterend',g)})}
function closeModal(){$('modalRoot').innerHTML=''}
function modalField(label,name,value='',area=false){return `<label class="field wide">${safe(label)}${area?`<textarea name="${name}">${safe(value)}</textarea>`:`<input name="${name}" value="${safe(value)}">`}</label>`}
function editVisit(i){const id=currentId,r=base(rows.get(id)),v=i<0?{}:r.visits[i];modal(`<h2>${i<0?'Nova visita':'Editar visita'}</h2><p class="muted">${safe(r.name)} · rexistro histórico</p><form id="editForm" class="fields">${modalField('Data (DD/MM/AAAA)','fecha',v.fecha)}${modalField('Lugar','lugar',v.lugar)}${modalField('Horas da máquina','horas',v.horas)}${modalField('Traballo e estado','traballo',v.traballo,true)}${modalField('Observacións','observacions',v.observacions,true)}<div class="flex wide"><button class="btn primary" type="submit">Gardar visita</button><button class="btn" type="button" data-close>Cancelar</button></div></form>`);$('editForm').onsubmit=async e=>{e.preventDefault();let vals=Object.fromEntries(new FormData(e.target)),vs=clone(r.visits||[]);if(i<0)vs.push(vals);else vs[i]=vals;try{await savePatch(id,{visits:vs,estadoVisita:'visitado'});closeModal()}catch(err){toast(err.message,true)}}}
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
  await signUrls(f.data||[]);
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
 let h=`<div class="flex"><button class="btn primary" data-doc="newact">+ Nova actuación</button><button class="btn" data-doc="upload">+ Subir arquivos</button><label class="tiny nowrap"><input type="checkbox" data-doc="void" ${showVoid?'checked':''}> Ver anulados</label></div>`;
 if(machineFilter)h+=`<p class="notice" style="margin:10px 0">Filtrado pola máquina <strong>${safe(mo[machineFilter]||machineFilter)}</strong> <button class="btn" data-doc="clearfilter">Ver todo o concello</button></p>`;
 h+=`<div class="chips">${cnt.map(([k,n])=>`<span class="pill" style="background:${ESTADO_COR[k]}30">${safe(ESTADOS[k])}: <b>${n}</b></span>`).join('')}</div>`;
 h+=acts.map(a=>{const fs=files.filter(f=>f.actuacion_id===a.id),c=ESTADO_COR[a.estado_verificacion]||'#999';return `<div class="entry act${a.anulada?' void':''}" style="border-left:4px solid ${c}"><div class="flex" style="justify-content:space-between"><strong>${safe(actName(a))}</strong><span class="pill" style="background:${c}30">${safe(ESTADOS[a.estado_verificacion]||a.estado_verificacion)}</span></div><div>${safe(a.localizacion||'Localización non indicada')}${a.cantidade!=null?` · <b>${safe(a.cantidade)} ${safe(UNIDADES[a.unidade]||a.unidade||'')}</b>`:''}</div><div class="mini">Fonte: ${safe(a.fonte_informacion)}${a.machine_label?' · Máquina: '+safe(a.machine_label):''}${a.visit_label?' · Visita: '+safe(a.visit_label):''}</div>${a.observacions?`<div class="obs">${safe(a.observacions)}</div>`:''}${a.anulada?`<div class="bad tiny">Anulada: ${safe(a.motivo_anulacion||'')}</div>`:''}<div class="thumbs">${fs.map(thumb).join('')||'<span class="muted tiny">Sen arquivos</span>'}</div><div class="mini">Creada por ${safe(who(a.creado_por))} · ${safe(fmtStamp(a.creado_en))} · Última modificación ${safe(who(a.actualizado_por))} · ${safe(fmtStamp(a.actualizado_en))} · v${a.version}</div><div class="flex" style="margin-top:6px">${a.anulada?'':`<button class="btn" data-act="edit" data-id="${a.id}">Editar</button><button class="btn" data-act="files" data-id="${a.id}">+ Arquivos</button>`}<button class="btn" data-act="hist" data-id="${a.id}">Historial</button>${a.anulada?'':`<button class="btn danger" data-act="void" data-id="${a.id}">Anular</button>`}</div></div>`}).join('')||'<p class="muted">Non hai actuacións rexistradas.</p>';
 h+=`<h3>Arquivos sen actuación asociada (${loose.length})</h3><div class="thumbs">${loose.map(thumb).join('')||'<span class="muted tiny">Ningún</span>'}</div>`;
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
 modal(`<h2>${isNew?'Nova actuación':'Editar actuación'}</h2><p class="muted">${safe(r.name)}</p><form id="actForm" class="fields"><label class="field">Data *<input type="date" name="data_actuacion" required value="${safe(p.data_actuacion||'')}"></label><label class="field">Tipo de traballo *<input name="tipo_traballo" list="tiposTraballo" required value="${safe(p.tipo_traballo||'')}"><datalist id="tiposTraballo">${TIPOS_TRABALLO.map(t=>`<option value="${safe(t)}">`).join('')}</datalist></label><label class="field wide">Localización (parroquia, lugar, pista, coordenadas…)<input name="localizacion" value="${safe(p.localizacion||'')}"></label><label class="field">Superficie ou lonxitude<input type="number" name="cantidade" min="0" step="any" inputmode="decimal" value="${safe(p.cantidade??'')}"></label><label class="field">Unidade<select name="unidade">${opts(UNIDADES,p.unidade||'','—')}</select></label><label class="field">Persoa ou entidade que informa *<input name="fonte_informacion" required value="${safe(p.fonte_informacion||'')}"></label><label class="field">Estado de verificación<select name="estado_verificacion">${opts(ESTADOS,p.estado_verificacion)}</select></label><label class="field">Máquina<select name="machine_ref">${opts(machineOpts(r,p),p.machine_ref||'','— Ningunha —')}</select></label><label class="field">Visita<select name="visit_ref">${opts(visitOpts(r,p),p.visit_ref||'','— Ningunha —')}</select></label><label class="field wide">Observacións<textarea name="observacions">${safe(p.observacions||'')}</textarea></label>${isNew?`<div class="filebox wide"><label class="field">Adxuntar fotografías ou PDF (opcional)<input type="file" name="files" accept="image/jpeg,image/png,image/webp,application/pdf" multiple></label><div class="fields" style="margin-top:8px"><label class="field">Tipo de documento<select name="tipo_documento">${opts(TIPOS_DOC,'foto')}</select></label><label class="field">Orixe dos arquivos<select name="orixe">${opts(ORIXES,'','— Selecciona —')}</select></label></div><p class="muted tiny">O autor declarado dos arquivos será a persoa ou entidade que informa.</p></div>`:''}<div class="flex wide"><button class="btn primary" type="submit">Gardar actuación</button><button class="btn" type="button" data-close>Cancelar</button><span class="status muted tiny"></span></div></form>`);
 const form=$('actForm');
 form.onsubmit=async e=>{e.preventDefault();
  const fs=isNew?[...sel(form,'files').files]:[];
  const payload={data_actuacion:nz(sel(form,'data_actuacion').value),tipo_traballo:nz(sel(form,'tipo_traballo').value),localizacion:nz(sel(form,'localizacion').value),cantidade:nz(sel(form,'cantidade').value)===null?null:Number(sel(form,'cantidade').value),unidade:nz(sel(form,'unidade').value),fonte_informacion:nz(sel(form,'fonte_informacion').value),estado_verificacion:sel(form,'estado_verificacion').value,observacions:nz(sel(form,'observacions').value)};
  Object.assign(payload,linkFrom(r,null,sel(form,'machine_ref').value,sel(form,'visit_ref').value));delete payload.actuacion_id;
  if(!payload.tipo_traballo||!payload.fonte_informacion){toast('Tipo de traballo e fonte son obrigatorios',true);return}
  if(payload.cantidade!==null&&!(payload.cantidade>=0)){toast('Superficie ou lonxitude non válida',true);return}
  const orixe=isNew?nz(sel(form,'orixe').value):null;
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
function exportExcel(){const a=all();let wb=XLSX.utils.book_new();const add=(title,rs)=>XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rs.length?rs:[{sen_datos:''}]),title);add('Concellos',a.map(r=>({id:r.id,provincia:r.prov,concello:r.name,empresa:r.empresa,apeiro:r.apeiro,acta:r.acta,firmada:r.firmada,asinada_por:r.asinadaPor,estado_visita:inspectState(r).visit,estado_maquina:inspectState(r).broken?'parado_por_avaria':(r.estadoMecanico||'operativa'),observacions:r.notaSeaga,documentacion:r.comprobacionDocumental})));add('Maquinaria',a.flatMap(r=>(r.machines||[]).map(m=>({id:r.id,concello:r.name,...m}))));add('Visitas',a.flatMap(r=>(r.visits||[]).map(v=>({id:r.id,concello:r.name,...v}))));XLSX.writeFile(wb,'App_Concellos_Bieito_'+new Date().toISOString().slice(0,10)+'.xlsx')}
async function login(){const url=$('url').value.trim().replace(/\/+$/,'').replace(/\/rest\/v1$/,'');const key=$('key').value.trim();if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)||!key){$('loginError').textContent='Revisa a URL e a clave pública de Supabase.';return}if(!window.supabase?.createClient){$('loginError').textContent='Non cargou a libraría de conexión. Comproba Internet.';return}try{$('loginBtn').disabled=true;client=window.supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true}});const {data,error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;let m=await client.from('seaga_members').select('group_id').eq('user_id',data.user.id).single();if(m.error||!m.data)throw Error('Este usuario non figura na táboa seaga_members');group=m.data.group_id;me=data.user.id;localStorage.setItem('cb-config',JSON.stringify({url,key}));$('password').value='';$('login').classList.add('hidden');$('app').classList.remove('hidden');initSearch();initSheet();setSync('loading');['logoutBtn','refreshBtn','exportBtn'].forEach(x=>$(x).classList.remove('hidden'));await initMap();await fetchAll();refreshTimer=setInterval(()=>{if(document.visibilityState==='visible'&&!dirty)fetchAll()},15000)}catch(e){$('loginError').textContent=e.message}finally{$('loginBtn').disabled=false}}
$('loginBtn').onclick=login;$('password').addEventListener('keydown',e=>{if(e.key==='Enter')login()});$('logoutBtn').onclick=async()=>{if(client)await client.auth.signOut();location.reload()};$('refreshBtn').onclick=()=>{if(dirty&&!confirm('Descartar cambios sen gardar?'))return;dirty=false;fetchAll()};$('exportBtn').onclick=exportExcel;['search','province','filter'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',renderList));
})();
