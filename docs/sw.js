const VERSION = '2026.11.20-1934';
const SHELL = 'shell-' + VERSION;
const FILES = ['./', 'index.html', 'app.js', 'style.css', 'vendor/sql-wasm.wasm', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => { for (const k of await caches.keys()) if (k.startsWith('shell-') && k !== SHELL) await caches.delete(k); await self.clients.claim(); })());
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
// Offline mode: the app writes a flag into Cache Storage; when it's set nothing goes to the network.
const isOffline = async () => !!(await (await caches.open('flags')).match('offline'));
const blocked = () => new Response('Offline mode is on', { status: 503, statusText: 'Offline mode' });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  e.respondWith((async () => {
    const offline = await isOffline();
    if (e.request.method !== 'GET' || url.origin !== location.origin) return offline ? blocked() : fetch(e.request);
    const cache = await caches.open(SHELL);
    const hit = e.request.mode === 'navigate' ? await cache.match('index.html') : await cache.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    return offline ? blocked() : fetch(e.request);
  })());
});
