// ВетКалендарь — service worker
//
// Стратегия:
//  • Запуск — всегда из кэша, мгновенно и без сети (cache-first).
//  • Обновление — в фоне: при каждом запуске (и по сигналу от страницы) SW
//    скачивает свежий index.html. Если он отличается от сохранённого, он
//    кладётся в кэш и страница получает сообщение UPDATE_READY.
//  • Шрифты Google — отдельный кэш, который переживает смену версии.
//  • Запросы к GitHub API (бэкап данных) SW не трогает вообще.
//
// Данные питомцев хранятся отдельно (localStorage + GitHub-синк), SW отвечает
// только за файлы приложения.
//
// ВАЖНО: при изменении иконок/manifest.json или самого sw.js поднимайте
// CACHE_VERSION — тогда оболочка пересоберётся целиком. Для правок одного
// index.html поднимать версию не нужно: он обновляется сам.

const CACHE_VERSION = 'v2';
const CACHE_NAME = `vetkalendar-shell-${CACHE_VERSION}`;
const FONT_CACHE = 'vetkalendar-fonts';
const KEEP_CACHES = [CACHE_NAME, FONT_CACHE];

const INDEX_URL = './index.html';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const APP_SHELL = [
  './',
  INDEX_URL,
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon.png',
];

// ---------- Установка: кладём оболочку в кэш (мимо HTTP-кэша браузера) ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// ---------- Активация: чистим кэши старых версий, но не кэш шрифтов ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !KEEP_CACHES.includes(k)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ---------- Сообщения от страницы ----------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CHECK_UPDATE') {
    event.waitUntil(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(INDEX_URL);
        await refreshIndex(cache, cached).catch(() => null);
      })
    );
  }
});

// ---------- Запросы ----------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Шрифты Google: из кэша сразу, в фоне обновляем
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event, req, FONT_CACHE));
    return;
  }

  // Всё остальное чужое (GitHub API и т.п.) — напрямую в сеть, SW не вмешивается
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  event.respondWith(staleWhileRevalidate(event, req, CACHE_NAME));
});

// Открытие приложения: отдаём index.html из кэша, свежую версию проверяем в фоне
function handleNavigation(event) {
  const ready = (async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(INDEX_URL);
    const refresh = refreshIndex(cache, cached).catch(() => null);
    return { cached, refresh };
  })();

  // waitUntil вызываем сразу (синхронно), чтобы браузер не убил SW до конца фоновой проверки
  event.waitUntil(ready.then(({ refresh }) => refresh));

  return ready.then(async ({ cached, refresh }) => {
    if (cached) return cached;

    // Кэша нет (например, вытеснен системой) — пробуем сеть
    const fresh = await refresh;
    if (fresh) return fresh;

    return new Response('Нет сети, и сохранённой копии приложения пока нет. Откройте приложение один раз с интернетом.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  });
}

// Скачивает свежий index.html. Если он изменился — кладёт в кэш и уведомляет страницы.
// Если в кэше ничего не было — просто сохраняет и возвращает ответ.
async function refreshIndex(cache, cached) {
  const res = await fetch(INDEX_URL, { cache: 'no-cache' });
  if (!res || !res.ok) return null;

  const forCache = res.clone();

  if (!cached) {
    await cache.put(INDEX_URL, forCache);
    return res;
  }

  const [oldText, newText] = await Promise.all([cached.clone().text(), res.clone().text()]);
  if (oldText === newText) return null;

  await cache.put(INDEX_URL, forCache);
  await notifyClients('UPDATE_READY');
  return null;
}

async function notifyClients(type) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  list.forEach((c) => c.postMessage({ type }));
}

// Из кэша сразу; параллельно качаем свежую копию. Принимаем opaque-ответы (шрифты без CORS).
function staleWhileRevalidate(event, req, cacheName) {
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  const ready = (async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);

    const network = fetch(sameOrigin ? new Request(req, { cache: 'no-cache' }) : req)
      .then(async (res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          await cache.put(req, res.clone());
        }
        return res;
      })
      .catch(() => null);

    return { cached, network };
  })();

  event.waitUntil(ready.then(({ network }) => network));

  return ready.then(async ({ cached, network }) => {
    if (cached) return cached;
    const res = await network;
    return res || new Response('', { status: 504 });
  });
}
