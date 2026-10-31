// LawAI Service Worker v3: public GET assets only; no form/API caching.
const CACHE_VERSION = 'lawai-cache-v3';
const CORE_CACHE = `${CACHE_VERSION}-core`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const MAX_RUNTIME_ENTRIES = 80;
const CORE_ASSETS = ['/', '/offline.html', '/manifest.json', '/footerlogo_192.png',
  '/footerlogo_512.png', '/airobot.html', '/aireport.html', '/lawmap.html'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CORE_CACHE).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('lawai-cache-') && ![CORE_CACHE, RUNTIME_CACHE].includes(key))
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

async function save(request, response) {
  if (!response || response.status !== 200 || response.type === 'opaque' || response.redirected) return;
  if (/no-store|private/i.test(response.headers.get('cache-control') || '')) return;
  if (response.headers.get('vary') === '*') return;
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_RUNTIME_ENTRIES)).map(key => cache.delete(key)));
  } catch (_) { /* Quota/storage failure must not block a network response. */ }
}

async function cachedResponse(request) {
  return (await (await caches.open(RUNTIME_CACHE)).match(request)) ||
    (await (await caches.open(CORE_CACHE)).match(request));
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      /^\/(?:api|auth)(?:\/|$)/.test(url.pathname)) return;
  const navigation = request.mode === 'navigate' || request.destination === 'document';
  const asset = ['style', 'script', 'image', 'font'].includes(request.destination);
  if (!navigation && !asset) return;
  const canCache = !url.search && !request.headers.get('authorization');
  if (navigation) {
    const network = fetch(request);
    event.waitUntil(network.then(response => canCache ? save(request, response) : undefined).catch(() => {}));
    event.respondWith(network.catch(async () => (canCache && await cachedResponse(request)) ||
      await (await caches.open(CORE_CACHE)).match('/offline.html') || Response.error()));
    return;
  }
  const network = fetch(request);
  event.waitUntil(network.then(response => canCache ? save(request, response) : undefined).catch(() => {}));
  event.respondWith((async () => {
    const cached = canCache && await cachedResponse(request);
    if (cached) return cached;
    try { return await network; } catch (_) { return Response.error(); }
  })());
});
