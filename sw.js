// sw.js - Service Worker для Sweet-dreams
const STATIC_CACHE = 'sweet-dreams-static-v1';
const PHOTO_CACHE = 'sweet-dreams-photos-v1';
const MAP_CACHE = 'sweet-dreams-maps-v1';

const MAX_CACHED_PHOTOS = 200;
const MAX_CACHED_TILES = 300;

// Предварительное кэширование ключевых статических файлов
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './memories.html',
  './style.css',
  './script.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('⚠️ Ошибка предкэширования некоторых файлов:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== STATIC_CACHE && key !== PHOTO_CACHE && key !== MAP_CACHE) {
            console.log('🧹 Удаление старого кэша:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Хелпер ограничения размера кэша
async function limitCacheSize(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    limitCacheSize(cacheName, maxItems);
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Фотографии с Yandex Cloud S3 (Cache-First)
  if (url.hostname.includes('storage.yandexcloud.net')) {
    event.respondWith(
      caches.open(PHOTO_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            cache.put(event.request, networkResponse.clone());
            limitCacheSize(PHOTO_CACHE, MAX_CACHED_PHOTOS);
          }
          return networkResponse;
        } catch (err) {
          // Если сеть недоступна, возвращаем кэш по URL без query-параметров
          const fallback = await cache.match(event.request.url.split('?')[0]);
          if (fallback) return fallback;
          throw err;
        }
      })
    );
    return;
  }

  // 2. Тайлы карты OpenStreetMap (Cache-First)
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(MAP_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            cache.put(event.request, networkResponse.clone());
            limitCacheSize(MAP_CACHE, MAX_CACHED_TILES);
          }
          return networkResponse;
        } catch (err) {
          return cachedResponse;
        }
      })
    );
    return;
  }

  // 3. API запросы к бэкенду (Render) - всегда из сети без кэширования Service Worker
  if (url.hostname.includes('sweet-dreams-f8nc.onrender.com')) {
    return;
  }

  // 4. Локальные статические файлы сайта (Network-First с fallback на Cache)
  if (event.request.method === 'GET' && (event.request.mode === 'navigate' || url.origin === self.location.origin)) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(event.request);
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('./memories.html');
          }
        })
    );
  }
});
