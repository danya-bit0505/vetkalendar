// СОСТАВ.SCAN — service worker
// Стратегия: stale-while-revalidate для файлов самого приложения.
//  1) Открываем мгновенно из кэша (работает и без интернета).
//  2) Параллельно в фоне проверяем сеть; если файл изменился — обновляем кэш
//     и сообщаем странице, чтобы она показала плашку «Доступно обновление».
// Запросы к базам составов (Роскачество, OFF, GitHub) не перехватываются.

const CACHE_NAME = 'sostavscan-shell-v4';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=> cache.addAll(APP_SHELL))
      .catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys=>
      Promise.all(keys.filter(k=> k!==CACHE_NAME).map(k=> caches.delete(k)))
    ).then(()=> self.clients.claim())
  );
});

async function notifyClients(){
  const list = await self.clients.matchAll({type:'window'});
  list.forEach(c=> c.postMessage({type:'UPDATE_READY'}));
}

// тянем свежую версию, кладём в кэш; changed — если содержимое реально поменялось
async function revalidate(req, cached){
  const res = await fetch(req, {cache:'no-store'});
  if(!res || !res.ok) return {res:null, changed:false};
  let changed = false;
  if(cached){
    try{
      const [a, b] = await Promise.all([cached.clone().text(), res.clone().text()]);
      changed = a !== b;
    }catch(e){ changed = false; }
  }
  const cache = await caches.open(CACHE_NAME);
  await cache.put(req, res.clone());
  return {res, changed};
}

self.addEventListener('fetch', (event)=>{
  const req = event.request;
  if(req.method !== 'GET') return;

  let url;
  try{ url = new URL(req.url); }catch(e){ return; }
  if(url.origin !== self.location.origin) return;
  // проверка связи из приложения должна идти строго в сеть, а не из кэша
  if(url.searchParams.has('_ping')) return;

  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');

  event.respondWith((async ()=>{
    let cached = await caches.match(req, {ignoreSearch:true});
    if(!cached && req.mode === 'navigate') cached = await caches.match('./index.html');

    const network = revalidate(req, cached).then(r=>{
      if(r.changed && isPage) event.waitUntil(notifyClients());
      return r.res;
    }).catch(()=> null);

    if(cached){
      event.waitUntil(network); // фоновая проверка не обрывается
      return cached;
    }
    const res = await network;
    return res || new Response('Нет сети и файла нет в кэше', {status:503, headers:{'Content-Type':'text/plain; charset=utf-8'}});
  })());
});
