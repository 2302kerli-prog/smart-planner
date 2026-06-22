// ============================================================
//  server-api.js — Умный Планировщик
//  Всё общение с сервером через один модуль.
//  Чтобы сменить сервер — меняем только SERVER_URL в настройках.
// ============================================================

// ── Настройки соединения ──────────────────────────────────────
function getServerConfig() {
    return {
        url: localStorage.getItem('server_url') || '',
        secret: localStorage.getItem('server_secret') || ''
    };
}

// ── Базовый запрос к серверу ──────────────────────────────────
async function serverRequest(path, options = {}) {
    const { url, secret } = getServerConfig();

    if (!url) {
        throw new Error('Адрес сервера не указан в настройках');
    }

    const response = await fetch(`${url}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'x-server-secret': secret,
            ...(options.headers || {})
        }
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `Ошибка сервера: ${response.status}`);
    }

    return response.json();
}

// ============================================================
//  PUSH-УВЕДОМЛЕНИЯ
// ============================================================

// Регистрируем service worker и подписываемся на push
async function setupPushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Push-уведомления не поддерживаются в этом браузере');
    }

    // Регистрируем service worker
    const registration = await navigator.serviceWorker.register('/service-worker.js');
    console.log('[Push] Service Worker зарегистрирован');

    // Запрашиваем разрешение
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        throw new Error('Разрешение на уведомления не получено');
    }

    // Получаем публичный VAPID ключ с сервера
    const { url } = getServerConfig();
    const vapidResponse = await fetch(`${url}/vapid-public-key`);
    const { publicKey } = await vapidResponse.json();

    // Подписываемся на push
    const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    // Отправляем подписку на сервер
    await serverRequest('/subscribe', {
        method: 'POST',
        body: JSON.stringify(subscription)
    });

    console.log('[Push] Подписка успешно оформлена');
    return true;
}

// Отписываемся от push
async function disablePushNotifications() {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return;

    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
        await serverRequest('/unsubscribe', {
            method: 'POST',
            body: JSON.stringify({ endpoint: subscription.endpoint })
        });
        await subscription.unsubscribe();
    }
    console.log('[Push] Подписка отменена');
}

// Проверяем текущий статус подписки
async function getPushStatus() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return 'unsupported';
    }
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return 'unregistered';

    const subscription = await registration.pushManager.getSubscription();
    return subscription ? 'subscribed' : 'unsubscribed';
}

// Обновляем время утреннего уведомления
async function updatePushTime(moscowTime) {
    return serverRequest('/settings/push-time', {
        method: 'POST',
        body: JSON.stringify({ time: moscowTime })
    });
}

// Тестовое уведомление
async function sendTestPush() {
    return serverRequest('/push/test', {
        method: 'POST',
        body: JSON.stringify({
            title: 'Тест 🎉',
            body: 'Push-уведомления работают!'
        })
    });
}

// ============================================================
//  GEMINI ИИ-ПОМОЩНИК
// ============================================================

// Собираем контекст из данных приложения
function buildContext() {
    if (typeof AppData === 'undefined') return 'Данные недоступны';

    const today = typeof activeDate !== 'undefined' ? activeDate : new Date().toISOString().split('T')[0];
    const todayTasks = AppData.tasksByDate[today] || [];
    const doneTasks = todayTasks.filter(t => t.done).length;

    const goalsText = AppData.goals.map(g => {
        const remaining = g.microtasks?.filter(m => !m.done).length || 0;
        return `• ${g.title} — прогресс ${g.progress}%, дедлайн: ${g.deadline || 'не указан'}, осталось шагов: ${remaining}`;
    }).join('\n');

    const todayText = todayTasks.length > 0
        ? todayTasks.map(t => `• [${t.done ? '✓' : ' '}] ${t.text}`).join('\n')
        : 'Задач на сегодня пока нет';

    return `Дата: ${today}
Выполнено задач сегодня: ${doneTasks} из ${todayTasks.length}

ЦЕЛИ:
${goalsText || 'Цели не заданы'}

ПЛАН НА СЕГОДНЯ:
${todayText}`;
}

// Отправляем сообщение ИИ
async function sendToAI(userMessage, chatHistory = []) {
    const context = buildContext();

    return serverRequest('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
            context,
            messages: chatHistory,
            userMessage
        })
    });
}

// Проверяем соединение с сервером
async function checkServerConnection() {
    const { url } = getServerConfig();
    if (!url) return { ok: false, error: 'Адрес сервера не указан' };

    try {
        const data = await fetch(`${url}/health`).then(r => r.json());
        return {
            ok: true,
            gemini: data.gemini_configured,
            push: data.push_configured
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// ============================================================
//  УТИЛИТЫ
// ============================================================

// Конвертация VAPID ключа из base64 в Uint8Array (требование браузерного API)
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Слушаем сообщения от service worker (например, нажатие на уведомление)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'NOTIFICATION_ACTION') {
            const action = event.data.action;
            console.log('[App] Действие из уведомления:', action);
            if (action === 'open_planner') {
                // Открываем приложение на главном экране
                closePanel('settingsPanel');
            }
        }
    });
}
