// sw.js - Service Worker для Sweet-dreams (v25 - Instant Fast Launch)
const STATIC_CACHE = "sweet-dreams-static-v25";
const PHOTO_CACHE = "sweet-dreams-photos-v25";

const MAX_CACHED_PHOTOS = 200;

// Предварительное кэширование страниц, стилей, манифеста и иконок PWA
const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./memories.html",
  "./style.css",
  "./mobile.css",
  "./memories.css",
  "./memories.js",
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

  // 2. Игнорируем запросы к бэкенду Render и тайлам OpenStreetMap (напрямую в сеть)
  if (
    url.hostname.includes("onrender.com") ||
    url.hostname.includes("tile.openstreetmap")
  ) {
    return;
  }

  // 3. HTML-страницы и навигация PWA — Stale-While-Revalidate (МГНОВЕННЫЙ старт без белого экрана!)
  if (
    event.request.method === "GET" &&
    (event.request.mode === "navigate" || url.pathname.endsWith(".html"))
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cachedResponse = await cache.match(event.request);

        // Фоновый запрос в сеть за свежей версией страницы
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => null);

        // Если страница уже есть в кэше — отдаем МГНОВЕННО (0 мс задержки, нет белого экрана!)
        if (cachedResponse) {
          return cachedResponse;
        }

        // Если в кэше еще нет (первый вход) — ждем ответ из сети
        const networkResponse = await fetchPromise;
        if (networkResponse) return networkResponse;

        // Если офлайн — запасная страница из кэша
        return (
          (await cache.match("./index.html")) ||
          (await cache.match("./memories.html")) ||
          new Response("Offline", { status: 503 })
        );
      })(),
    );
    return;
  }

  // 4. Локальные статические файлы и библиотеки (CSS, JS, иконки, Leaflet CDN) — Cache-First с фоновым обновлением
  if (
    event.request.method === "GET" &&
    (url.origin === self.location.origin ||
      url.hostname.includes("unpkg.com") ||
      url.hostname.includes("jsdelivr.net"))
  ) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          // В фоне тихо обновляем кэш свежим ресурсом
          fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(event.request, networkResponse);
              }
            })
            .catch(() => {});
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
          }
          return networkResponse;
        } catch (err) {
          return new Response("", { status: 408 });
        }
      }),
    );
    return;
  }
});

// =========================================================================
// PUSH NOTIFICATIONS
// =========================================================================
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Sweet Dreams ❤️";
  const options = {
    body: data.body || "Новое воспоминание на карте!",
    icon: "./image/icon-192.png",
    badge: "./image/icon-192.png",
    data: data.data || { url: "./memories.html" },
    vibrate: [200, 100, 200],
    tag: data.tag || data.data?.tag || "sweet-dreams-notification",
    renotify: true,
  };

  if ("setAppBadge" in navigator) {
    navigator.setAppBadge(1).catch(() => {});
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if ("clearAppBadge" in navigator) {
    navigator.clearAppBadge().catch(() => {});
  }
  const targetUrl = event.notification.data?.url || "./memories.html";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            if (client.url.includes("memories.html")) {
              client.navigate(targetUrl);
              return client.focus();
            }
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      }),
  );
});
