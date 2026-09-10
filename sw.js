// sw.js - Service Worker для Sweet-dreams (v6)
const STATIC_CACHE = "sweet-dreams-static-v6";
const PHOTO_CACHE = "sweet-dreams-photos-v6";

const MAX_CACHED_PHOTOS = 200;

// Предварительное кэширование стилей, манифеста и иконок PWA
const PRECACHE_ASSETS = [
  "./style.css",
  "./mobile.css",
  "./script.js",
  "./manifest.json",
  "./image/icon-192.png",
  "./image/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn("⚠️ Ошибка предкэширования:", err);
      });
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key !== STATIC_CACHE && key !== PHOTO_CACHE) {
              console.log("🧹 Очистка старого кэша:", key);
              return caches.delete(key);
            }
          }),
        );
      })
      .then(() => self.clients.claim()),
  );
});

async function limitCacheSize(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      await cache.delete(keys[0]);
      limitCacheSize(cacheName, maxItems);
    }
  } catch (e) {}
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. Фотографии с Yandex Cloud S3 (Cache-First)
  if (url.hostname.includes("storage.yandexcloud.net")) {
    event.respondWith(
      caches.open(PHOTO_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const networkResponse = await fetch(event.request);
          if (
            networkResponse &&
            (networkResponse.status === 200 ||
              networkResponse.type === "opaque")
          ) {
            cache.put(event.request, networkResponse.clone());
            limitCacheSize(PHOTO_CACHE, MAX_CACHED_PHOTOS);
          }
          return networkResponse;
        } catch (err) {
          const fallback = await cache.match(event.request.url.split("?")[0]);
          if (fallback) return fallback;
          return new Response("", {
            status: 408,
            statusText: "Request Timeout",
          });
        }
      }),
    );
    return;
  }

  // 2. Игнорируем запросы к бэкенду и картам (прямо в сеть)
  if (
    url.hostname.includes("onrender.com") ||
    url.hostname.includes("tile.openstreetmap")
  ) {
    return;
  }

  // 3. HTML и локальные файлы сайта - ВСЕГДА свежие из сети (Network-First)
  if (
    event.request.method === "GET" &&
    (event.request.mode === "navigate" || url.origin === self.location.origin)
  ) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Кэшируем только статические css/js, но не HTML
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            !url.pathname.endsWith(".html") &&
            event.request.mode !== "navigate"
          ) {
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
          return new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          });
        }),
    );
  }
});
