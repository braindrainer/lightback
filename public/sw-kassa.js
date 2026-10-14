// Service Worker der Kassa: nur die App-Hülle cachen. Verkäufe brauchen eine Verbindung, weil Belege am Server
// signiert werden (RKSV) – offline zeigt die Kassa einen Hinweis und sperrt den Verkauf.
const CACHE = 'loc-kassa-v1';
const HUELLE = ['/kassa', '/manifest-kassa.webmanifest', '/icons/vorort-192.png', '/icons/vorort-512.png', '/icons/vorort.svg'];

const brauchbar = (r) => r && r.ok && !r.redirected && r.type === 'basic';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    for (const u of HUELLE) {
      try { const r = await fetch(u, { credentials: 'same-origin' }); if (brauchbar(r)) await c.put(u, r); } catch { /* später */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('loc-kassa-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Unveränderliche Bundles: Cache zuerst
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (brauchbar(r)) c.put(req, r.clone());
      return r;
    }));
    return;
  }
  // Seiten der App: Netz zuerst, sonst zuletzt gespeicherte Fassung
  if (url.pathname === '/kassa' || url.pathname.startsWith('/kassa/')) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const r = await fetch(req);
        if (brauchbar(r) && req.mode === 'navigate' && url.pathname === '/kassa') c.put('/kassa', r.clone());
        return r;
      } catch {
        return (await c.match(req)) || (await c.match('/kassa')) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
  }
});
