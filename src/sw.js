const VERSION = '__VERSION__';
const SHELL = 'shell-' + VERSION;
const FILES = ['./', 'index.html', 'app.js', 'style.css', 'vendor/sql-wasm.wasm', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => { for (const k of await caches.keys()) if (k.startsWith('shell-') && k !== SHELL) await caches.delete(k); await self.clients.claim(); })());
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    if (e.request.mode === 'navigate') return (await cache.match('index.html')) || fetch(e.request);
    return (await cache.match(e.request, { ignoreSearch: true })) || fetch(e.request);
  })());
});
