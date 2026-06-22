import express from 'express';
import cors from 'cors';

import webpush from 'web-push';
import cron from 'node-cron';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json());

// ─── КОНФИГУРАЦИЯ (все секреты берутся из переменных окружения Render) ──────
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@smartplanner.app';
const SERVER_SECRET = process.env.SERVER_SECRET || 'change_me_in_env';

// ─── ХРАНИЛИЩЕ (в памяти сервера — подходит для одного пользователя) ────────
// При рестарте сервера подписки сохраняются в памяти.
// Для продакшена с несколькими пользователями — заменить на PostgreSQL.
let pushSubscriptions = [];
let scheduledPushTime = '09:00'; // время утреннего уведомления (UTC+3 = UTC-3ч)

// ─── НАСТРОЙКА WEB PUSH ──────────────────────────────────────────────────────
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// ─── MIDDLEWARE: простая проверка секрета ────────────────────────────────────
function checkSecret(req, res, next) {
    const secret = req.headers['x-server-secret'];
    if (secret !== SERVER_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// ════════════════════════════════════════════════════════════════════════════
//  МАРШРУТЫ API
// ════════════════════════════════════════════════════════════════════════════

// ── Проверка работоспособности сервера ──────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        time: new Date().toISOString(),
        push_configured: !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY),
        gemini_configured: !!GEMINI_API_KEY
    });
});

// ── Получить VAPID публичный ключ (нужен для подписки на push в браузере) ───
app.get('/vapid-public-key', (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// ── Подписать устройство на push-уведомления ─────────────────────────────────
app.post('/subscribe', checkSecret, (req, res) => {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: 'Invalid subscription object' });
    }
    // Не дублируем подписки для одного endpoint
    const exists = pushSubscriptions.some(s => s.endpoint === subscription.endpoint);
    if (!exists) {
        pushSubscriptions.push(subscription);
        console.log(`[Push] Новое устройство подписано. Всего: ${pushSubscriptions.length}`);
    }
    res.json({ success: true, total: pushSubscriptions.length });
});

// ── Отписать устройство от push-уведомлений ──────────────────────────────────
app.post('/unsubscribe', checkSecret, (req, res) => {
    const { endpoint } = req.body;
    pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== endpoint);
    res.json({ success: true });
});

// ── Отправить push прямо сейчас (для тестирования) ───────────────────────────
app.post('/push/test', checkSecret, async (req, res) => {
    const { title = 'Умный Планировщик', body = 'Тест уведомления!' } = req.body;
    const results = await sendPushToAll({ title, body, icon: '/icon-192.png' });
    res.json({ sent: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length });
});

// ── Запрос к Gemini ──────────────────────────────────────────────────────────
// Тело запроса: { context: "...", messages: [{role, content}], systemPrompt: "..." }
app.post('/ai/chat', checkSecret, async (req, res) => {
    const { context, messages = [], systemPrompt, customPrompt } = req.body;

    if (!GEMINI_API_KEY) {
        return res.status(503).json({ error: 'Gemini API key не настроен на сервере' });
    }

    // Собираем историю в формат Gemini
    const geminiContents = [];

    // Системный промпт — с учётом кастомного промпта пользователя
    const systemText = systemPrompt || buildDefaultSystemPrompt(context, customPrompt);
    geminiContents.push({ role: 'user', parts: [{ text: systemText }] });
    geminiContents.push({ role: 'model', parts: [{ text: 'Понятно, готова помочь!' }] });

    // Добавляем историю диалога
    for (const msg of messages) {
        geminiContents.push({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        });
    }

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: geminiContents,
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 1024,
                    }
                })
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Gemini] Ошибка статус:', response.status);
            console.error('[Gemini] Ошибка тело:', errorText);

            // При перегрузке (503) — один автоматический повтор через 5 секунд
            if (response.status === 503) {
                console.log('[Gemini] Перегрузка, повтор через 5 секунд...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                const retry = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
                    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: geminiContents, generationConfig: { temperature: 0.7, maxOutputTokens: 1024 } }) }
                );
                if (retry.ok) {
                    const retryData = await retry.json();
                    console.log('[Gemini] Повтор успешен, токенов:', retryData.usageMetadata?.totalTokenCount || '?');
                    const retryText = retryData.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    return res.json({ reply: retryText });
                }
            }

            return res.status(502).json({ error: 'Ошибка Gemini API', details: errorText });
        }

        const data = await response.json();
        console.log('[Gemini] Ответ получен, токенов:', data.usageMetadata?.totalTokenCount || '?');
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        res.json({ reply: text });

    } catch (err) {
        console.error('[Gemini] Сетевая ошибка:', err.message);
        res.status(500).json({ error: 'Не удалось связаться с Gemini', details: err.message });
    }
});

// ── Обновить время утреннего уведомления ─────────────────────────────────────
app.post('/settings/push-time', checkSecret, (req, res) => {
    const { time } = req.body; // формат "HH:MM" по московскому времени
    if (!time || !/^\d{2}:\d{2}$/.test(time)) {
        return res.status(400).json({ error: 'Укажите время в формате HH:MM' });
    }
    // Конвертируем московское время (UTC+3) в UTC для cron
    const [hours, minutes] = time.split(':').map(Number);
    const utcHours = (hours - 3 + 24) % 24;
    scheduledPushTime = `${String(utcHours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
    setupMorningCron();
    res.json({ success: true, utcTime: scheduledPushTime, moscowTime: time });
});

// ── Экспорт всех данных пользователя (переносимость) ─────────────────────────
app.get('/export', checkSecret, (req, res) => {
    res.json({
        exportedAt: new Date().toISOString(),
        subscriptions: pushSubscriptions.length,
        note: 'Основные данные (цели, задачи, заметки) хранятся локально на вашем устройстве. Скачайте их из настроек приложения.'
    });
});

// ════════════════════════════════════════════════════════════════════════════
//  PUSH-ЛОГИКА
// ════════════════════════════════════════════════════════════════════════════

async function sendPushToAll(payload) {
    if (pushSubscriptions.length === 0) {
        console.log('[Push] Нет подписчиков');
        return [];
    }

    const results = await Promise.all(
        pushSubscriptions.map(async (subscription) => {
            try {
                await webpush.sendNotification(subscription, JSON.stringify(payload));
                return { success: true, endpoint: subscription.endpoint.slice(-20) };
            } catch (err) {
                console.error('[Push] Ошибка отправки:', err.statusCode, err.message);
                // Если подписка устарела — удаляем
                if (err.statusCode === 410 || err.statusCode === 404) {
                    pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== subscription.endpoint);
                    console.log('[Push] Устаревшая подписка удалена');
                }
                return { success: false, error: err.message };
            }
        })
    );
    return results;
}

// ════════════════════════════════════════════════════════════════════════════
//  CRON — УТРЕННЕЕ УВЕДОМЛЕНИЕ
// ════════════════════════════════════════════════════════════════════════════

let morningCronJob = null;

function setupMorningCron() {
    if (morningCronJob) morningCronJob.stop();

    const [hours, minutes] = scheduledPushTime.split(':');
    const cronExpression = `${minutes} ${hours} * * *`;

    morningCronJob = cron.schedule(cronExpression, async () => {
        console.log('[Cron] Запускаю утреннее уведомление...');
        await sendPushToAll({
            title: 'Доброе утро! 🌅',
            body: 'Открой планировщик — твой ИИ-помощник готов составить план дня.',
            icon: 'https://2302kerli-prog.github.io/smart-planner/icon-192.png',
            data: { action: 'open_planner' }
        });
    }, { timezone: 'UTC' });

    console.log(`[Cron] Утреннее уведомление запланировано: ${scheduledPushTime} UTC`);
}

// ════════════════════════════════════════════════════════════════════════════
//  СИСТЕМНЫЙ ПРОМПТ ДЛЯ GEMINI
// ════════════════════════════════════════════════════════════════════════════

function buildDefaultSystemPrompt(context, customPrompt) {
    const today = new Date().toISOString().split('T')[0];
    return `Ты — персональный ИИ-помощник в приложении "Умный Планировщик".
Твоя роль: коуч, администратор и мотиватор.
${customPrompt ? `\nЛИЧНЫЕ ПРЕДПОЧТЕНИЯ ПОЛЬЗОВАТЕЛЯ (соблюдать всегда):\n${customPrompt}\n` : ''}
КРИТИЧЕСКИ ВАЖНО — ФОРМАТ ОТВЕТА:
Когда пользователь просит добавить задачу, запланировать дело, поставить в план — возвращай:

Текст ответа...
<ACTIONS>
[{"type":"add_task","text":"Название задачи","date":"YYYY-MM-DD"}]
</ACTIONS>

Когда пользователь просит записать в заметки, добавить заметку, написать в раздел — возвращай:

Текст ответа...
<ACTIONS>
[{"type":"add_note","folder":"название папки","title":"Заголовок","text":"Текст заметки"}]
</ACTIONS>

Можно комбинировать несколько действий в одном ACTIONS блоке:
<ACTIONS>
[{"type":"add_task","text":"Задача","date":"2026-06-22"},{"type":"add_note","folder":"Дом","title":"Покупки","text":"Красный фонарик"}]
</ACTIONS>

Правила для дат:
- "сегодня" = ${today}
- "завтра" = следующий день после ${today}
- "23 июня" или "23.06" = ${today.split('-')[0]}-06-23
- Если дата не указана = ${today}

Правила для заметок:
- Если папка не указана — используй "Дом" по умолчанию
- Если папка не существует — используй ближайшую по смыслу из: Школа, Работа, Дом
- Title делай кратким (2-5 слов), text — полным содержанием

Примеры:
"добавь задачу приготовить ужин на сегодня" →
<ACTIONS>[{"type":"add_task","text":"Приготовить ужин","date":"${today}"}]</ACTIONS>

"запиши в заметки раздел Дом купить красный фонарик" →
<ACTIONS>[{"type":"add_note","folder":"Дом","title":"Покупки","text":"Купить красный фонарик"}]</ACTIONS>

Если пользователь просто общается — отвечай БЕЗ блока ACTIONS.

Правила общения:
— Говори на русском языке, тепло и по-дружески
— Никогда не добавляй задачи без явной просьбы
— Отвечай коротко и по делу

Контекст пользователя:
${context || 'Данные о целях и задачах не переданы.'}`;
}

// ════════════════════════════════════════════════════════════════════════════
//  ЗАПУСК
// ════════════════════════════════════════════════════════════════════════════

setupMorningCron();

app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`   Gemini: ${GEMINI_API_KEY ? '✓ настроен' : '✗ ключ не задан'}`);
    console.log(`   Push:   ${VAPID_PUBLIC_KEY ? '✓ настроен' : '✗ VAPID ключи не заданы'}`);
});
