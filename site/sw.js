// Service worker приложения покупателя KOKORO (specs/025, app-store.md). Делает одно: если открыть приложение без интернета,
// показывает свой экран «Нет интернета» вместо ошибки браузера. Этого требуют магазины приложений: Google Play проверяет, что
// приложение (TWA) открывается без сети, Apple — что оно не выглядит как сломанный сайт (правило 4.2).
//
// Ничего больше не кешируем: страница, скрипты и стили всегда идут из сети — после выкладки покупатель сразу получает новую
// версию, а не старый order.js против новой базы. Трогаем только переходы на главную страницу (/); панель, курьер, кухня,
// запросы к базе и картам идут мимо, как без service worker.
// Правите offline.html — поменяйте v: иначе у тех, у кого service worker уже стоит, останется прежний экран
const CACHE = 'kokoro-offline-v1';
// Без .html: Cloudflare отдаёт /offline.html переадресацией на /offline, а переадресованный ответ service worker не может
// показать при переходе на страницу
const OFFLINE = '/offline';
const OFFLINE_ASSETS = [OFFLINE, '/assets/img/favicon-180.png'];

self.addEventListener('install', (event) => {
  // Кладём только прямые ответы 200: переадресованный ответ нельзя показать при переходе на страницу
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(OFFLINE_ASSETS.map(async (url) => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok || res.redirected) throw new Error(`офлайн-экран: ${url} — ${res.status}${res.redirected ? ', переадресация' : ''}`);
    await cache.put(url, res);
  }))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('kokoro-offline-') && key !== CACHE).map((key) => caches.delete(key))))
      // Предзагрузку перехода не включаем: она шла бы на все страницы сайта, и панель, курьер и кухня (их service worker не трогает)
      // загружались бы дважды
      .then(() => self.clients.claim()),
  );
});

/** Переход на главную приложения: /, /index.html, с ?z=… и #checkout — да; /admin, /courier, /kitchen, /cook — нет */
const isAppPage = (request) => {
  if (request.mode !== 'navigate' || request.method !== 'GET') return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin && (url.pathname === '/' || url.pathname === '/index.html');
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Картинка офлайн-экрана — из кеша, когда сети нет (сам экран без неё тоже читается)
  if (request.method === 'GET' && new URL(request.url).pathname === '/assets/img/favicon-180.png') {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }
  if (!isAppPage(request)) return;
  event.respondWith((async () => {
    try {
      return await fetch(request);
    } catch {
      return (await caches.match(OFFLINE)) || new Response('Нет интернета', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
