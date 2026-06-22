// ============================================================
//  Service Worker — Умный Планировщик
//  Работает в фоне даже когда приложение закрыто.
//  Получает push-уведомления от сервера и показывает их.
// ============================================================

const CACHE_NAME = 'smart-planner-v3';
// Используем BASE чтобы правильно работать на GitHub Pages (/smart-planner/)
// и на любом другом хостинге одновременно
const BASE = new URL('./', self.location).href;
const ASSETS_TO_CACHE = [
    BASE,
    BASE + 'index.html',
    BASE + 'style.css',
    BASE + 'app.js',
    BASE + 'server-api.js',
    BASE + 'manifest.json',
];

// ── Установка: кешируем файлы приложения ──────────────────────
self.addEventListener('install', (event) => {
    console.log('[SW] Установка...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
                // Если кеширование не удалось — не критично, продолжаем
                console.warn('[SW] Кеширование частично не удалось:', err);
            });
        })
    );
    self.skipWaiting();
});

// ── Активация: удаляем старые кеши ───────────────────────────
self.addEventListener('activate', (event) => {
    console.log('[SW] Активация...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// ── Перехват запросов: отдаём из кеша если есть ──────────────
self.addEventListener('fetch', (event) => {
    // Не перехватываем запросы к серверу и внешним сервисам
    if (!event.request.url.startsWith(self.location.origin)) return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            return cached || fetch(event.request);
        })
    );
});

// ── Получение push-уведомления ────────────────────────────────
self.addEventListener('push', (event) => {
    console.log('[SW] Получено push-уведомление');

    let data = {
        title: 'Умный Планировщик',
        body: 'Новое сообщение от вашего помощника',
        icon: '/icon-192.png',
        badge: '/icon-72.png',
        data: {}
    };

    // Разбираем данные из уведомления
    if (event.data) {
        try {
            const parsed = event.data.json();
            data = { ...data, ...parsed };
        } catch {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: data.icon || '/smart-planner/icon-192.png',
        badge: data.badge || '/smart-planner/icon-72.png',
        vibrate: [200, 100, 200],
        data: data.data || {},
        actions: data.actions || [],
        requireInteraction: true,
        tag: data.tag || 'smart-planner-notification'
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// ── Нажатие на уведомление ────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Нажато уведомление:', event.action);
    event.notification.close();

    const action = event.notification.data?.action;

    const notifData = event.notification.data || {};
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

// ── Закрытие уведомления без нажатия ─────────────────────────
self.addEventListener('notificationclose', (event) => {
    console.log('[SW] Уведомление закрыто без нажатия');
});
