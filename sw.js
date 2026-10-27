/* Concellos Bieito · service worker
   Só garda na caché a carcasa pública da aplicación (HTML, JS, iconas, límites e librarías).
   NUNCA garda datos de Supabase, fotografías, PDF, URL asinadas nin teselas de mapa.
   Actualización controlada: ao publicar cambios, sube VERSION; a app ofrece «Actualizar». */
const VERSION = 'cb-shell-2026-10-26-t02';
const SHELL = ['./', './index.html', './app.js', './galicia.json', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];
const LIBS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/topojson-client@3/dist/topojson-client.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];
const shellUrls = () => new Set(SHELL.map(p => new URL(p, self.registration.scope).href));

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    await Promise.all(LIBS.map(u => c.add(new Request(u, { mode: 'cors', credentials: 'omit' })).catch(() => {})));
  })());
});
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('cb-shell-') && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  url.hash = '';
  const isNav = req.mode === 'navigate' && url.origin === self.location.origin;
  const key = isNav ? new URL('./index.html', self.registration.scope).href : url.href;
  if (!isNav && !shellUrls().has(url.href.split('?')[0]) && !LIBS.includes(url.href)) return; // resto: rede directa, sen caché
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(key, { ignoreSearch: !LIBS.includes(url.href) });
    if (hit) return hit;
    try { return await fetch(req); }
    catch (err) { return (await c.match(new URL('./index.html', self.registration.scope).href)) || Response.error(); }
  })());
});
