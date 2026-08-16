// Меняй эту версию при каждом деплое с изменениями в закэшированных файлах —
// иначе браузер продолжит отдавать старые файлы из кэша.
const CACHE_NAME = 'app-cache-v1';

// Всё, что нужно для полностью офлайн-работы приложения.
// Пути — относительные, от корня где лежит sw.js.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Установка: кладём app shell в кэш
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting(); // новый SW активируется сразу, не дожидаясь закрытия всех вкладок
});

// Активация: чистим старые версии кэша
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first для app shell, с фоллбеком на сеть для всего остального
self.addEventListener('fetch', (event) => {
  // Не трогаем не-GET запросы (например POST к GitHub API)
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // Кэшируем новые запрошенные ресурсы на лету (например картинки, добавленные позже)
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Офлайн и файла нет в кэше — можно вернуть index.html как фоллбек для навигации
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});
