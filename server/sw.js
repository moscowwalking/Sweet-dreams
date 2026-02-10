// sw.js
const CACHE_NAME = 'photos-cache-v1';
const MAX_IMAGES = 50; // Максимум фото в кеше

self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Кешируем только фото с Yandex Cloud
  if (event.request.url.includes('storage.yandexcloud.net')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((response) => {
          // Если есть в кеше - возвращаем
          if (response) {
            console.log('🔄 Из кеша:', event.request.url);
            return response;
          }
          
          // Иначе загружаем и кешируем
          return fetch(event.request).then((networkResponse) => {
            if (networkResponse.ok) {
              // Ограничиваем размер кеша
              cache.keys().then((keys) => {
                if (keys.length >= MAX_IMAGES) {
                  cache.delete(keys[0]); // Удаляем самое старое
                }
                cache.put(event.request, networkResponse.clone());
              });
            }
            return networkResponse;
          }).catch(() => {
            // При ошибке сети - пробуем найти похожее старое фото
            return caches.match(event.request.url.split('?')[0]);
          });
        });
      })
    );
  }
});