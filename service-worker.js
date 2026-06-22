// ============================================================
//  Service Worker — Умный Планировщик
// ============================================================

const CACHE_NAME = 'smart-planner-v4';
const BASE = new URL('./', self.location).href;

// Файлы приложения — кэшируем при установке
const ASSETS_TO_CACHE = [
    BASE,
    BASE + 'index.html',
    BASE + 'style.css',
    BASE + 'app.js',
    BASE + 'server-api.js',
    BASE + 'manifest.json',
];

// ── Установка ────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    console.log('[SW] Установка v4...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // fetch с cache: 'no-store' гарантирует свежие файлы при установке
            return Promise.all(
                ASSETS_TO_CACHE.map((url) =>
                    fetch(url, { cache: 'no-store' })
                        .then((res) => cache.put(url, res))
                        .catch(() => {}) // не критично, продолжаем
                )
            );
        })
    );
    self.skipWaiting();
});

// ── Активация: удаляем старые кеши, перезагружаем клиентов ──
self.addEventListener('activate', (event) => {
    console.log('[SW] Активация v4...');
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
            ))
            .then(() => self.clients.claim())
            .then(() => self.clients.matchAll({ type: 'window' }))
            .then((clients) => clients.forEach((c) => c.navigate(c.url)))
    );
});

// ── Network-first для HTML/JS/CSS: всегда свежее с сети ─────
self.addEventListener('fetch', (event) => {
    if (!event.request.url.startsWith(self.location.origin)) return;

    const url = event.request.url;
    const isAppFile = ASSETS_TO_CACHE.some((a) => url === a || url === a + '?');

    if (isAppFile) {
        // Network-first: сначала сеть, кэш — только если сеть недоступна
        event.respondWith(
            fetch(event.request, { cache: 'no-store' })
                .then((res) => {
                    // Обновляем кэш свежим ответом
                    const resClone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
                    return res;
                })
                .catch(() => caches.match(event.request)) // Офлайн-фолбэк
        );
    } else {
        // Остальные запросы — кэш если есть, иначе сеть
        event.respondWith(
            caches.match(event.request).then((cached) => cached || fetch(event.request))
        );
    }
});

// ── Push-уведомление ─────────────────────────────────────────
self.addEventListener('push', (event) => {
    let data = {
        title: 'Умный Планировщик',
        body: 'Новое сообщение от вашего помощника',
        icon: '/icon-192.png',
        badge: '/icon-72.png',
        data: {}
    };

    if (event.data) {
        try {
            const parsed = event.data.json();
            data = { ...data, ...parsed };
        } catch {
            data.body = event.data.text();
        }
    }

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: data.icon || '/smart-planner/icon-192.png',
            badge: data.badge || '/smart-planner/icon-72.png',
            vibrate: [200, 100, 200],
            data: data.data || {},
            actions: data.actions || [],
            requireInteraction: true,
            tag: data.tag || 'smart-planner-notification'
        })
    );
});

// ── Клик по уведомлению ──────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const action      = event.notification.data?.action;
    const notifData   = event.notification.data || {};
    const notifContext = notifData.context || '';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.focus();
                    if (action) client.postMessage({ type: 'NOTIFICATION_ACTION', action, context: notifContext });
                    return;
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(self.location.origin + '/smart-planner/');
            }
        })
    );
});

self.addEventListener('notificationclose', () => {});
