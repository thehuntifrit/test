const CACHE_NAME = 'hunt-cache-v4';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/root.css',
  './css/appnav.css',
  './css/mobcard.css',
  './css/moblist.css',
  './js/app.js',
  './js/cal.js',
  './js/dataManager.js',
  './js/mobCard.js',
  './js/mobSorter.js',
  './js/modal.js',
  './js/readme.js',
  './js/sidebar.js',
  './js/server.js',
  './js/worker.js',
  './js/lib/marked.min.js',
  './js/lib/purify.min.js',
  './json/maintenance.json',
  './json/mob_data.json',
  './json/mob_locations.json',
  './maps/Amh_Araeng.webp',
  './maps/Central_Thanalan.webp',
  './maps/Coerthas_Western_Highlands.webp',
  './maps/Garlemald.webp',
  './maps/Il_Mheg.webp',
  './maps/Kozama\'uka.webp',
  './maps/Labyrinthos.webp',
  './maps/Living_Memory.webp',
  './maps/The_Azim_Steppe.webp',
  './maps/Ultima_Thule.webp',
  './maps/Upper_La_Noscea.webp',
  './maps/Urqopacha.webp',
  './maps/Yanxia.webp',
  './icon/The_Hunt.png',
  './sound/01 FFXIV_Linkshell_Transmission.mp3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.endsWith('.json') || url.pathname.includes('/maps/') || url.pathname.includes('/icon/') || url.pathname.includes('/sound/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        });
        return cachedResponse || fetchPromise;
      })
    );
  } else {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request);
      })
    );
  }
});




