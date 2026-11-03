const CACHE = 'sheetnote-shell-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  // Wait for the current page to close; do not switch controllers during a submission.
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('sheetnote-shell-') && key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/src/') || url.pathname.includes('/@vite/')) return;
  // Only cache app shell resources. Never intercept API requests or store user-specific responses.
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/manifest.webmanifest' || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icon-')) {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) void caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(async () => (await caches.match(event.request)) || (url.pathname === '/' || url.pathname === '/index.html' ? await caches.match('/index.html') : Response.error())));
  }
});
