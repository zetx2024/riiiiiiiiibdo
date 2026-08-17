const CACHE_NAME = 'iarco-secure-quiz-v13-submit-progress';
const CORE = [
  './', './index.html', './styles.css', './app.js', './quiz.json', './users.json', './sw.js',
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(CORE.map(async url => {
      try {
        const req = new Request(url, {mode: url.startsWith('http') ? 'cors' : 'same-origin'});
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') await cache.put(req, res.clone());
      } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin && !url.hostname.includes('jsdelivr.net')) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) {
      // Refresh in the background when online, but never block the student UI.
      fetch(event.request).then(res => { if (res.ok || res.type === 'opaque') caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone())); }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(event.request);
      if (res.ok || res.type === 'opaque') caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
      return res;
    } catch (_) {
      return new Response('Resource unavailable while offline.', {status: 503, headers: {'Content-Type':'text/plain'}});
    }
  })());
});
