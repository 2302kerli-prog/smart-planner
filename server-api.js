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

    // Регистрируем service worker — путь относительный, работает в любой подпапке
    const swPath = new URL('service-worker.js', window.location.href).pathname;
    const registration = await navigator.serviceWorker.register(swPath);
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

// Сохранить время вечернего пуша
async function saveEveningPushTime() {
    const input = document.getElementById('eveningPushTimeInput');
    const time  = input?.value;
    if (!time) return;
    try {
        await serverRequest('/settings/evening-push-time', {
            method: 'POST',
            body: JSON.stringify({ time })
        });
        const statusEl = document.getElementById('serverStatusText');
        if (statusEl) { statusEl.textContent = '🌙 Вечерний пуш сохранён'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
    } catch (e) {
        alert('Не удалось сохранить: ' + e.message);
    }
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

    const profile = AppData.settings?.userProfile || {};
    const profileLines = [];
    if (profile.name)       profileLines.push(`Имя: ${profile.name}`);
    if (profile.age)        profileLines.push(`Возраст: ${profile.age} лет`);
    if (profile.occupation) profileLines.push(`Чем занимается: ${profile.occupation}`);
    if (profile.context)    profileLines.push(`О себе: ${profile.context}`);
    const profileText = profileLines.length
        ? `\nПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ:\n${profileLines.join('\n')}`
        : '';

    // Расписание на ближайшие 7 дней — ИИ видит загрузку и может предлагать даты
    const upcomingLines = [];
    for (let i = 1; i <= 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const dayTasks = AppData.tasksByDate[dateStr] || [];
        upcomingLines.push(dayTasks.length
            ? `${dateStr}: ${dayTasks.length} задач`
            : `${dateStr}: свободно`);
    }

    const mediaBooks  = (AppData.media?.books  || []).map(i => i.title).join(', ') || 'пусто';
    const mediaMovies = (AppData.media?.movies || []).map(i => i.title).join(', ') || 'пусто';
    const mediaSeries = (AppData.media?.series || []).map(i => i.title).join(', ') || 'пусто';

    return `Дата: ${today}
Выполнено задач сегодня: ${doneTasks} из ${todayTasks.length}${profileText}

ЦЕЛИ:
${goalsText || 'Цели не заданы'}

ПЛАН НА СЕГОДНЯ:
${todayText}

ЗАГРУЗКА БЛИЖАЙШИХ 7 ДНЕЙ:
${upcomingLines.join('\n')}

ПОЛКА ДОСУГА:
Книги 📚: ${mediaBooks}
Фильмы 🎬: ${mediaMovies}
Сериалы 🍿: ${mediaSeries}`;
}

// Отправляем сообщение ИИ
async function sendToAI(userMessage, chatHistory = []) {
    const context = buildContext();

    const clientDate = typeof activeDate !== 'undefined' ? activeDate : new Date().toISOString().split('T')[0];

    return serverRequest('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
            context,
            messages: chatHistory,
            userMessage,
            customPrompt: localStorage.getItem('custom_prompt') || '',
            clientDate
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

// Слушаем сообщения от service worker (нажатие на уведомление)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'NOTIFICATION_ACTION') {
            const { action, context } = event.data;
            if (action === 'open_planner') {
                closePanel('settingsPanel');
            } else if (action === 'open_ai_chat') {
                // Вечернее уведомление → открываем чат и ИИ сама начинает разговор
                openAiChat();
                if (context === 'evening') {
                    setTimeout(() => {
                        const input = document.getElementById('chatInput');
                        if (input && !input.value) {
                            input.value = 'Подведи итоги моего дня как коуч';
                            sendChatMessage();
                        }
                    }, 700);
                }
            }
        }
    });
}
