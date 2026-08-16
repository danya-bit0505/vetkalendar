// ВетКалендарь — service worker
// Кэширует оболочку приложения для офлайн-работы. Данные питомцев хранятся
// отдельно (localStorage + GitHub-синк), sw отвечает только за файлы.

const CACHE_VERSION = 'v1';
const CACHE_NAME = `vetkalendar-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon.png',
];

// Установка — кладём оболочку приложения в кэш
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Активация — удаляем кэши старых версий
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Запросы — cache-first с фоновым обновлением и офлайн-фоллбеком
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Навигация по страницам приложения — при отсутствии сети отдаём закэшированный index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Остальное (иконки, манифест, шрифты) — сначала кэш, параллельно обновляем в фоне
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
