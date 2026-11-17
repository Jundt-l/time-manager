// Service worker: работа без интернета и ответы на уведомления.
const VERSION = 'v20';
const CACHE = 'time-manager-' + VERSION;
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest',
  './js/app.js', './js/scheduler.js', './js/sample.js', './js/notify.js', './js/inbox.js', './js/wheel.js', './js/voice.js',
  './js/merge.js', './js/sync.js', './js/account.js', './js/config.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/badge-96.png',
];

self.addEventListener('install', e => {
  // cache: 'reload' — брать файлы из сети, а не из кэша браузера, чтобы новая версия была действительно новой
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('time-manager-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Сначала из кэша, параллельно обновляем кэш из сети: приложение открывается мгновенно и без интернета.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
    return cached || net;
  }));
});

// --- очередь ответов (та же база, что в js/inbox.js) ---
function inboxPut(entry) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('time-manager', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('inbox', { autoIncrement: true });
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result, tx = db.transaction('inbox', 'readwrite');
      tx.objectStore('inbox').add(entry);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

// Напоминание с сервера: приходит, даже когда приложение закрыто.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: e.data ? e.data.text() : 'Мой день' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Мой день', {
    body: d.body || '',
    tag: d.key || 'moy-den',
    data: { key: d.key, day: d.day },
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',
    // сводка — просто сообщение; на напоминание о деле можно ответить кнопками
    actions: d.key && !d.key.startsWith('info:') ? [{ action: 'done', title: '✓ Сделано' }, { action: 'skip', title: '✗ Не сделал' }] : [],
    vibrate: [80, 40, 80],
    requireInteraction: !(d.key && d.key.startsWith('info:')),
  }));
});

self.addEventListener('notificationclick', e => {
  const key = e.notification.data && e.notification.data.key;
  const day = e.notification.data && e.notification.data.day;
  const action = e.action; // 'done', 'skip' или '' (нажали на само уведомление)
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (key && (action === 'done' || action === 'skip')) {
      // Ответ прямо из уведомления: сохраняем, приложение применит его сразу или при следующем открытии.
      await inboxPut({ key, action, day });
      wins.forEach(w => w.postMessage({ type: 'action' }));
      return;
    }
    // Нажали на уведомление: открываем приложение, там есть карточка с ✓ и ✗.
    if (wins.length) return wins[0].focus();
    return self.clients.openWindow('./');
  })());
});
