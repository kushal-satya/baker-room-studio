/*
 * Service worker: makes Room Studio installable and usable offline.
 * App files are precached and served network first, so edits pushed to
 * GitHub appear on the next load. CDN libraries and fonts are cache first.
 * Bump VERSION when you add or rename files.
 */
const VERSION = 'room-studio-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/canvas.js',
  './js/state.js',
  './js/library.js',
  './js/lists.js',
  './js/props.js',
  './js/storage.js',
  './js/share.js',
  './js/export.js',
  './js/ui.js',
  './data/furniture-library.json',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.5.0/lz-string.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.js'
];
const RUNTIME_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(APP_SHELL);
    await Promise.all(CDN_ASSETS.map(url => cache.add(new Request(url, { mode: 'cors' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache live sync traffic.
  if (url.hostname.endsWith('firebaseio.com') || url.hostname.endsWith('firebasedatabase.app')) return;

  if (url.origin === self.location.origin) {
    // Network first so updates you push to GitHub show up right away;
    // the cache answers when offline or when the network is slow.
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const network = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      });
      network.catch(() => null);
      const timeout = new Promise(resolve => setTimeout(resolve, 3500, null));
      try {
        const res = await Promise.race([network, timeout]);
        if (res) return res;
      } catch (e) { /* offline */ }
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      try { return await network; } catch (e) { return Response.error(); }
    })());
    return;
  }

  if (RUNTIME_HOSTS.includes(url.hostname)) {
    // Cache first for versioned CDN files and fonts.
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (e) {
        return cached || Response.error();
      }
    })());
  }
});
