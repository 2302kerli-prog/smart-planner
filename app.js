'use strict';

/* ==============================================
   УТИЛИТЫ
   ============================================== */
const createId = () => Date.now() + Math.floor(Math.random() * 1000);

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

function parseDateString(value) {
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
}

function formatDateLocal(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getTodayString() {
    return formatDateLocal(new Date());
}

/* ==============================================
   СОСТОЯНИЕ ПРИЛОЖЕНИЯ
   (selectedGoalId объявлен заранее — normalizeAppData() ниже уже на него ссылается)
   ============================================== */
let selectedGoalId = null;

/* ==============================================
   ПРОФИЛИ ПОЛЬЗОВАТЕЛЕЙ
   ============================================== */
const PROFILES_KEY       = 'smart_planner_profiles';
const ACTIVE_PROFILE_KEY = 'smart_planner_active_profile';

function loadProfiles()         { try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]'); } catch { return []; } }
function saveProfiles(p)        { localStorage.setItem(PROFILES_KEY, JSON.stringify(p)); }
function getActiveProfileId()   { return localStorage.getItem(ACTIVE_PROFILE_KEY) || ''; }
function setActiveProfileId(id) { localStorage.setItem(ACTIVE_PROFILE_KEY, id); }

function applyActiveProfile() {
    const pid = getActiveProfileId();
    STORAGE_KEY = pid ? `smart_planner_db_${pid}` : 'smart_planner_db';
}

/* ==============================================
   БАЗА ДАННЫХ В LOCALSTORAGE
   ============================================== */
let STORAGE_KEY = 'smart_planner_db'; // обновляется через applyActiveProfile()

const DEFAULT_DATA = {
    settings: {
        darkGlass: false,
        apiKey: ''
    },
    goals: [
        { id: 1, title: 'Запустить школу в сентябре', deadline: '2026-09-01', microtasks: [
            { id: 101, text: 'Подготовить план занятий', done: true },
            { id: 102, text: 'Запустить форму записи', done: false },
            { id: 103, text: 'Провести вебинар', done: false }
        ]},
        { id: 2, title: 'Сдать экзамены', deadline: '2026-07-01', microtasks: [
            { id: 201, text: 'Выучить 40 билетов', done: true },
            { id: 202, text: 'Решить тесты', done: false }
        ]},
        { id: 3, title: 'Вылечить зубы', deadline: '2026-10-01', microtasks: [
            { id: 301, text: 'Сходить на консультацию', done: false },
            { id: 302, text: 'Полечить кариес', done: false }
        ]}
    ],
    tasksByDate: {},
    notesFolders: [
        { id: 'school', name: 'Школа', notes: [{ id: 1, title: 'Список билетов', text: '1. Основы ИИ\n2. Логика и базы данных\n3. CSS Магия', done: false }] },
        { id: 'work', name: 'Работа', notes: [] },
        { id: 'home', name: 'Дом', notes: [{ id: 2, title: 'Покупки', text: 'Светильник розового цвета (Икеа)', done: false }] }
    ],
    media: {
        books: [{ id: 1, title: 'Атлант расправил плечи' }],
        movies: [{ id: 2, title: 'Интерстеллар' }],
        series: [{ id: 3, title: 'Черное зеркало' }]
    }
};

function normalizeAppData(data) {
    const normalized = data || {};
    normalized.settings = { darkGlass: false, apiKey: '', ...(normalized.settings || {}) };
    normalized.tasksByDate = normalized.tasksByDate || {};
    normalized.notesFolders = Array.isArray(normalized.notesFolders) ? normalized.notesFolders : [];
    normalized.media = { books: [], movies: [], series: [], ...(normalized.media || {}) };
    ['books', 'movies', 'series'].forEach((tab) => {
        if (!Array.isArray(normalized.media[tab])) normalized.media[tab] = [];
    });
    normalized.goals = Array.isArray(normalized.goals) ? normalized.goals : [];
    normalized.goals.forEach((goal) => {
        if (!Array.isArray(goal.microtasks)) goal.microtasks = [];
        updateGoalStatus(goal);
    });
    normalized.notesFolders.forEach((folder) => {
        if (!folder.id) folder.id = `folder_${createId()}`;
        if (!Array.isArray(folder.notes)) folder.notes = [];
    });
    return normalized;
}

let AppData = null;

function loadAppData() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        AppData = saved ? normalizeAppData(JSON.parse(saved)) : normalizeAppData(JSON.parse(JSON.stringify(DEFAULT_DATA)));
    } catch {
        AppData = normalizeAppData(JSON.parse(JSON.stringify(DEFAULT_DATA)));
    }
}

function saveDb() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(AppData));
}

/* ==============================================
   СОСТОЯНИЕ ПРИЛОЖЕНИЯ
   ============================================== */
let activeDate = getTodayString();
let currentFolderId = '';
let currentMediaTab = 'books';
let activeNoteId = null;
let draggedItem = null;
let dragSrcIndex = null;
let activeGoalPickerData = null;
let activeMoveMediaId = null;
let isPlanFullscreen = false;

const initialCalendarDate = parseDateString(activeDate) || new Date();
let calendarYear = initialCalendarDate.getFullYear();
let calendarMonth = initialCalendarDate.getMonth();

const monthNames = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

/* ==============================================
   ИНИЦИАЛИЗАЦИЯ
   ============================================== */
function initApp() {
    applyActiveProfile();
    loadAppData();
    currentFolderId = AppData.notesFolders[0]?.id || '';
    applyInitialSettings();
    renderGoalsWidget();
    renderDailyPlan();
    setupCalendar();
    renderFolders();
    renderNotes();
    renderMedia();
    initHoldButton();
    setupKeyboardListeners();
    setupBubbleInteraction();
    updateProfileDisplay();
    setTimeout(checkAndCarryOverTasks, 800); // небольшая задержка чтобы UI прорисовался
}

window.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();

    const profiles = loadProfiles();

    if (profiles.length === 0) {
        // Проверяем: есть ли старые данные без профилей → мигрируем
        const legacyData = localStorage.getItem('smart_planner_db');
        if (legacyData) {
            const defaultProfile = { id: `p_${createId()}`, name: 'Я', emoji: '👤' };
            saveProfiles([defaultProfile]);
            setActiveProfileId(defaultProfile.id);
            localStorage.setItem(`smart_planner_db_${defaultProfile.id}`, legacyData);
            localStorage.removeItem('smart_planner_db');
            initApp();
        } else {
            // Первый запуск — показываем создание профиля
            showProfileCreation(true);
        }
    } else {
        if (!getActiveProfileId()) setActiveProfileId(profiles[0].id);
        initApp();
    }
});

function setupKeyboardListeners() {
    document.getElementById('manualTaskInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addManualTask();
    });
    document.getElementById('newMicrotaskInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addMicrotaskToGoal();
    });
    document.getElementById('mediaInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addMediaItem();
    });
    document.getElementById('aiTaskInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiRequest(); }
    });
    document.getElementById('profileNameInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmCreateProfile();
    });
}

/* ==============================================
   ОБЩИЕ НАСТРОЙКИ
   ============================================== */
function applyInitialSettings() {
    if (AppData.settings.darkGlass) {
        document.body.classList.add('dark-glass');
        document.getElementById('darkGlassToggle').checked = true;
    }
    applyServerSettings();
}

function toggleDarkGlass() {
    const isChecked = document.getElementById('darkGlassToggle').checked;
    AppData.settings.darkGlass = isChecked;
    saveDb();
    document.body.classList.toggle('dark-glass', isChecked);
    updateThemeBasedOnProgress(parseInt(document.getElementById('progressText').innerText) || 0);
}

function saveApiKey() {
    AppData.settings.apiKey = document.getElementById('apiKeyInput').value;
    saveDb();
}

function confirmResetData() {
    document.getElementById('resetConfirmModal').classList.remove('hidden');
}

function closeResetModal() {
    document.getElementById('resetConfirmModal').classList.add('hidden');
}

function resetAllData() {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
}

/* ==============================================
   ЛОГИКА ТЕМ И ГРАДИЕНТОВ
   0-29%: красный | 30-49%: оранжевый | 50-79%: жёлтый | 80-100%: зелёный
   ============================================== */
function updateThemeBasedOnProgress(percent) {
    const body = document.body;
    body.classList.remove('theme-red', 'theme-orange', 'theme-yellow', 'theme-green');
    if (percent < 30)      body.classList.add('theme-red');
    else if (percent < 50) body.classList.add('theme-orange');
    else if (percent < 80) body.classList.add('theme-yellow');
    else                   body.classList.add('theme-green');
}

/* ==============================================
   РЕАКЦИЯ ШАРОВ НА КУРСОР / КАСАНИЕ
   ============================================== */
function setupBubbleInteraction() {
    const container = document.getElementById('bubbleContainer');
    if (!container) return;
    const bubbles = Array.from(container.querySelectorAll('.bubble'));

    function nudgeBubbles(clientX, clientY) {
        bubbles.forEach((bubble) => {
            const rect = bubble.getBoundingClientRect();
            const bx = rect.left + rect.width / 2;
            const by = rect.top + rect.height / 2;
            const dx = bx - clientX;
            const dy = by - clientY;
            const dist = Math.hypot(dx, dy) || 1;
            const radius = 160;
            if (dist < radius) {
                const force = (1 - dist / radius) * 22;
                const offsetX = (dx / dist) * force;
                const offsetY = (dy / dist) * force;
                bubble.style.marginLeft = `${offsetX}px`;
                bubble.style.marginTop = `${offsetY}px`;
            } else {
                bubble.style.marginLeft = '';
                bubble.style.marginTop = '';
            }
        });
    }

    function resetBubbles() {
        bubbles.forEach((bubble) => {
            bubble.style.marginLeft = '';
            bubble.style.marginTop = '';
        });
    }

    document.addEventListener('mousemove', (e) => nudgeBubbles(e.clientX, e.clientY));
    document.addEventListener('mouseleave', resetBubbles);
    document.addEventListener('touchmove', (e) => {
        if (e.touches[0]) nudgeBubbles(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    document.addEventListener('touchend', resetBubbles);
}

/* ==============================================
   УНИВЕРСАЛЬНЫЙ ДИАЛОГ ПРИЛОЖЕНИЯ (замена alert/confirm/prompt)
   ============================================== */
let appDialogConfig = null;

function showAppDialog(config) {
    appDialogConfig = config || {};
    const modal = document.getElementById('appDialogModal');
    const input = document.getElementById('appDialogInput');
    const message = document.getElementById('appDialogMessage');
    const extra = document.getElementById('appDialogExtraActions');
    const confirmBtn = document.getElementById('appDialogConfirmBtn');
    const cancelBtn = document.getElementById('appDialogCancelBtn');

    document.getElementById('appDialogTitle').innerText = appDialogConfig.title || 'Действие';
    message.innerText = appDialogConfig.message || '';
    message.classList.toggle('hidden', !appDialogConfig.message);
    input.classList.toggle('hidden', !appDialogConfig.input);
    input.value = appDialogConfig.inputValue || '';
    input.placeholder = appDialogConfig.placeholder || 'Введите название';
    confirmBtn.innerText = appDialogConfig.confirmText || 'Готово';
    cancelBtn.innerText = appDialogConfig.cancelText || 'Отмена';
    confirmBtn.className = `px-5 py-2 ${appDialogConfig.danger ? 'bg-red-500' : 'bg-teal-500'} text-white rounded-full font-bold text-xs active:scale-95`;

    extra.innerHTML = '';
    (appDialogConfig.extraActions || []).forEach((action) => {
        const button = document.createElement('button');
        button.className = `w-full p-2 rounded-xl text-sm font-semibold ${action.danger ? 'text-red-600 bg-red-100/50' : 'text-gray-700 bg-white/50'} active:scale-95 transition-all text-center`;
        button.innerText = action.label;
        button.onclick = () => {
            closeAppDialog();
            action.onClick?.();
        };
        extra.appendChild(button);
    });

    modal.classList.remove('hidden');
    if (appDialogConfig.input) setTimeout(() => input.focus(), 50);
}

function submitAppDialog() {
    if (!appDialogConfig) return;
    const input = document.getElementById('appDialogInput');
    const value = input.value.trim();
    if (appDialogConfig.input && !value) {
        input.classList.add('voice-listening');
        setTimeout(() => input.classList.remove('voice-listening'), 450);
        return;
    }
    const onConfirm = appDialogConfig.onConfirm;
    closeAppDialog();
    onConfirm?.(value);
}

function closeAppDialog() {
    document.getElementById('appDialogModal').classList.add('hidden');
    appDialogConfig = null;
}

/* ==============================================
   ГОЛОСОВОЙ ВВОД (Web Speech API)
   ============================================== */
let activeRecognition = null;

function autoResizeTextarea(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

function startVoiceInput(targetId, onDone) {
    const target = document.getElementById(targetId);
    if (!target) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showAppDialog({
            title: 'Голос недоступен',
            message: 'Браузер сейчас не дает доступ к распознаванию речи. Можно ввести текст вручную.',
            confirmText: 'Понятно'
        });
        return;
    }
    if (activeRecognition) {
        activeRecognition.stop();
        activeRecognition = null;
    }
    const recognition = new SpeechRecognition();
    activeRecognition = recognition;
    recognition.lang = 'ru-RU';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    target.classList.add('voice-listening');

    const baseText = target.value; // текст до начала диктовки
    let finalText = '';             // накопленный финальный текст

    recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const t = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalText += (finalText ? ' ' : '') + t;
            } else {
                interim += t;
            }
        }
        const sep = baseText.trim() ? ' ' : '';
        const preview = (finalText + (finalText && interim ? ' ' : '') + interim).trim();
        target.value = baseText + (preview ? sep + preview : '');
        if (target.tagName === 'TEXTAREA') autoResizeTextarea(target);
    };

    recognition.onerror = (e) => {
        if (e.error === 'no-speech') return; // тишина — не ошибка
        showAppDialog({
            title: 'Не расслышала',
            message: 'Попробуйте ещё раз или введите текст вручную.',
            confirmText: 'Ок'
        });
    };
    recognition.onend = () => {
        target.classList.remove('voice-listening');
        activeRecognition = null;
        // Убираем промежуточный текст — оставляем только финальный
        const sep = baseText.trim() && finalText ? ' ' : '';
        target.value = baseText + sep + finalText;
        if (target.tagName === 'TEXTAREA') autoResizeTextarea(target);
        onDone?.(finalText);
    };
    recognition.start();
}

/* ==============================================
   ПЛАН ДНЯ — РАЗВЁРТЫВАНИЕ НА ПОЛНЫЙ ЭКРАН
   ============================================== */
function navigateDay(direction) {
    const current = parseDateString(activeDate) || new Date();
    current.setDate(current.getDate() + direction);
    activeDate = formatDateLocal(current);

    // Синхронизируем календарь с новой датой
    calendarYear = current.getFullYear();
    calendarMonth = current.getMonth();

    renderDailyPlan();
    setupCalendar();
}

function togglePlanFullscreen() {
    const dailyBlock = document.getElementById('dailyPlanBlock');
    const goalsContainer = document.getElementById('goalsWidgetContainer');
    const icon = document.getElementById('fullscreenIcon');

    isPlanFullscreen = !isPlanFullscreen;

    const aiInputBar = document.getElementById('aiInputBar');
    if (isPlanFullscreen) {
        dailyBlock.classList.add('plan-fullscreen');
        goalsContainer.classList.add('hidden');
        aiInputBar?.classList.add('hidden');
        icon.setAttribute('data-lucide', 'minimize-2');
    } else {
        dailyBlock.classList.remove('plan-fullscreen');
        goalsContainer.classList.remove('hidden');
        aiInputBar?.classList.remove('hidden');
        icon.setAttribute('data-lucide', 'maximize-2');
    }
    lucide.createIcons();
}

/* ==============================================
   ПЛАН ДНЯ — СПИСОК ЗАДАЧ И DRAG & DROP СОРТИРОВКА
   ============================================== */
function renderDailyPlan() {
    const options = { weekday: 'long', day: 'numeric', month: 'numeric' };
    const dateObj = parseDateString(activeDate) || new Date();
    const formattedDate = dateObj.toLocaleDateString('ru-RU', options);
    document.getElementById('activeDateTitle').innerText = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);

    const taskList = document.getElementById('taskList');
    taskList.innerHTML = '';
    const tasks = AppData.tasksByDate[activeDate] || [];

    if (tasks.length === 0) {
        taskList.innerHTML = `<div class="text-center py-12 text-gray-500 italic text-sm">На этот день планов нет. Время отдыхать! 🍀</div>`;
        document.getElementById('progressText').innerText = '0%';
        updateThemeBasedOnProgress(0);
        return;
    }

    tasks.forEach((task, index) => {
        const item = document.createElement('div');
        item.className = `task-item flex items-center justify-between p-3 relative overflow-hidden ${task.done ? 'task-done' : ''}`;
        item.setAttribute('draggable', 'true');
        item.setAttribute('data-id', task.id);
        item.setAttribute('data-index', index);
        item.addEventListener('dragstart', handleTaskDragStart);
        item.addEventListener('dragover', handleTaskDragOver);
        item.addEventListener('dragleave', handleTaskDragLeave);
        item.addEventListener('drop', handleTaskDrop);
        item.addEventListener('dragend', handleTaskDragEnd);

        let goalLine = '';
        if (task.goalId) {
            const goalColors = ['bg-red-300', 'bg-purple-300', 'bg-teal-300'];
            goalLine = `<div class="absolute left-0 top-0 bottom-0 w-2 ${goalColors[(task.goalId - 1) % 3]}"></div>`;
        }

        item.innerHTML = `
            ${goalLine}
            <div class="flex items-center gap-3 flex-1 min-w-0 ${task.goalId ? 'pl-1' : ''}">
                <div class="drag-handle shrink-0 text-gray-400 select-none">
                    <i data-lucide="grip-vertical" class="w-5 h-5 pointer-events-none"></i>
                </div>
                <span class="handwriting text-2xl text-gray-800 transition-all truncate select-text" onclick="toggleTask(${task.id})">
                    ${index + 1}. ${escapeHtml(task.text)}
                </span>
            </div>
            <div class="flex items-center gap-0.5 shrink-0">
                <button class="p-1.5 text-gray-400 active:text-gray-600 transition-colors" onclick="openTaskActions(event, ${task.id})" title="Действия">
                    <i data-lucide="more-vertical" class="w-4 h-4 pointer-events-none"></i>
                </button>
                <div class="circle-check w-6 h-6 rounded-full border-2 border-white bg-transparent shadow-inner transition-colors flex shrink-0 items-center justify-center cursor-pointer" onclick="toggleTask(${task.id})">
                    ${task.done ? '<div class="w-3 h-3 bg-white rounded-full"></div>' : ''}
                </div>
            </div>
        `;
        taskList.appendChild(item);
    });

    lucide.createIcons();
    updateProgressPercentage();
}

function handleTaskDragStart(e) {
    draggedItem = this;
    dragSrcIndex = this.getAttribute('data-index');
    this.classList.add('sortable-ghost');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'task');
}

function handleTaskDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    this.classList.add('drag-over');
    return false;
}

function handleTaskDragLeave() {
    this.classList.remove('drag-over');
}

function handleTaskDrop(e) {
    e.stopPropagation();
    this.classList.remove('drag-over');
    const targetIndex = Number(this.getAttribute('data-index'));
    if (dragSrcIndex !== null && Number(dragSrcIndex) !== targetIndex) {
        const tasks = AppData.tasksByDate[activeDate] || [];
        const moved = tasks.splice(Number(dragSrcIndex), 1)[0];
        tasks.splice(targetIndex, 0, moved);
        saveDb();
        renderDailyPlan();
    }
    return false;
}

function handleTaskDragEnd() {
    this.classList.remove('sortable-ghost');
    document.querySelectorAll('.task-item.drag-over').forEach((item) => item.classList.remove('drag-over'));
    draggedItem = null;
    dragSrcIndex = null;
}

function toggleTask(taskId) {
    const tasks = AppData.tasksByDate[activeDate] || [];
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    task.done = !task.done;

    if (task.goalId && task.microtaskId) {
        const goal = AppData.goals.find((g) => g.id === task.goalId);
        if (goal) {
            const mtask = goal.microtasks.find((m) => m.id === task.microtaskId);
            if (mtask) {
                mtask.done = task.done;
                recalculateGoalProgress(goal);
            }
        }
    }

    saveDb();
    renderDailyPlan();
    renderGoalsWidget();
}

/* ==============================================
   ДЕЙСТВИЯ С ЗАДАЧАМИ: МЕНЮ, УДАЛЕНИЕ, ПЕРЕНОС
   ============================================== */
function openTaskActions(event, taskId) {
    event.stopPropagation();
    // Закрываем все открытые меню
    document.querySelectorAll('.task-actions-menu').forEach(m => m.remove());

    const btn = event.currentTarget;
    const rect = btn.getBoundingClientRect();

    const menu = document.createElement('div');
    menu.className = 'task-actions-menu fixed z-[150] glass-panel rounded-2xl shadow-xl overflow-hidden min-w-[150px] text-sm';
    menu.style.top  = (rect.bottom + 6) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.innerHTML = `
        <button class="w-full text-left px-4 py-3 flex items-center gap-3 text-gray-700 active:bg-white/60" onclick="openMoveTaskPicker(${taskId}); this.closest('.task-actions-menu').remove()">
            <i data-lucide="calendar-days" class="w-4 h-4 text-teal-600 pointer-events-none"></i> Перенести
        </button>
        <div class="border-t border-white/30 mx-3"></div>
        <button class="w-full text-left px-4 py-3 flex items-center gap-3 text-red-500 active:bg-red-50/50" onclick="deleteTask(${taskId}); this.closest('.task-actions-menu').remove()">
            <i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i> Удалить
        </button>
    `;
    document.body.appendChild(menu);
    lucide.createIcons();

    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 0);
}

function deleteTask(taskId) {
    const tasks = AppData.tasksByDate[activeDate] || [];
    AppData.tasksByDate[activeDate] = tasks.filter(t => t.id !== taskId);
    saveDb();
    renderDailyPlan();
}

function openMoveTaskPicker(taskId) {
    taskMoveId = taskId;
    const input = document.getElementById('goalDatePickerInput');
    input.value = activeDate;
    input.min = getTodayString();
    document.getElementById('goalDatePickerModal').querySelector('h3').textContent = 'На какой день перенести?';
    document.getElementById('goalDatePickerModal').classList.remove('hidden');
}

function moveTaskToDate(taskId, targetDate) {
    const tasks = AppData.tasksByDate[activeDate] || [];
    const idx   = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return;

    const [task] = tasks.splice(idx, 1);
    if (!AppData.tasksByDate[targetDate]) AppData.tasksByDate[targetDate] = [];
    // При переносе сбрасываем done
    AppData.tasksByDate[targetDate].push({ ...task, done: false });
    saveDb();
    renderDailyPlan();
    setupCalendar();
}

/* ==============================================
   АВТОПЕРЕНОС НЕВЫПОЛНЕННЫХ ЗАДАЧ ПРОШЛОГО ДНЯ
   ============================================== */
function checkAndCarryOverTasks() {
    const today     = getTodayString();
    const lastCheck = localStorage.getItem('carry_over_check') || '';
    if (lastCheck === today) return; // уже проверяли сегодня

    // Ищем невыполненные задачи за последние 7 дней (кроме сегодня)
    const overdueTasks = [];
    for (let i = 1; i <= 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = formatDateLocal(d);
        const dayTasks = AppData.tasksByDate[dateStr] || [];
        dayTasks.filter(t => !t.done).forEach(t => overdueTasks.push({ ...t, _fromDate: dateStr }));
    }

    localStorage.setItem('carry_over_check', today);
    if (overdueTasks.length === 0) return;

    const preview = overdueTasks.slice(0, 3).map(t => `• ${t.text}`).join('\n');
    const extra   = overdueTasks.length > 3 ? `\n...и ещё ${overdueTasks.length - 3}` : '';

    showAppDialog({
        title: `${overdueTasks.length} незавершённых задач`,
        message: `Перенести на сегодня?\n\n${preview}${extra}`,
        confirmText: 'Перенести',
        cancelText: 'Оставить',
        onConfirm: () => {
            if (!AppData.tasksByDate[today]) AppData.tasksByDate[today] = [];
            overdueTasks.forEach(t => {
                const { _fromDate, ...task } = t;
                // Убираем из старой даты
                AppData.tasksByDate[_fromDate] = (AppData.tasksByDate[_fromDate] || []).filter(x => x.id !== task.id);
                // Добавляем сегодня (сбрасываем done)
                AppData.tasksByDate[today].push({ ...task, id: createId(), done: false });
            });
            saveDb();
            renderDailyPlan();
            setupCalendar();
        }
    });
}

function addManualTask() {
    const input = document.getElementById('manualTaskInput');
    const text = input.value.trim();
    if (!text) return;

    if (!AppData.tasksByDate[activeDate]) AppData.tasksByDate[activeDate] = [];
    AppData.tasksByDate[activeDate].push({ id: createId(), text, done: false });

    saveDb();
    input.value = '';
    renderDailyPlan();
    setupCalendar();
}

function updateProgressPercentage() {
    const tasks = AppData.tasksByDate[activeDate] || [];
    const allTasks = tasks.length;
    const doneTasks = tasks.filter((t) => t.done).length;

    if (allTasks === 0) {
        document.getElementById('progressText').innerText = '0%';
        updateThemeBasedOnProgress(0);
        return;
    }

    const percent = Math.round((doneTasks / allTasks) * 100);
    document.getElementById('progressText').innerText = percent + '%';
    updateThemeBasedOnProgress(percent);
}

/* ==============================================
   БЛОК: МОИ ЦЕЛИ (GOALS)
   ============================================== */
function recalculateGoalProgressValue(goal) {
    if (!goal.microtasks || goal.microtasks.length === 0) {
        goal.progress = 0;
        return;
    }
    const total = goal.microtasks.length;
    const completed = goal.microtasks.filter((task) => task.done).length;
    goal.progress = Math.round((completed / total) * 100);
}

function getGoalStatusText(goal) {
    if (!goal?.deadline) return 'Без дедлайна';
    const deadline = parseDateString(goal.deadline);
    if (!deadline) return 'Некорректный дедлайн';
    const today = parseDateString(getTodayString());
    const diffDays = Math.ceil((deadline - today) / 86400000);
    const remainingTasks = goal.microtasks?.filter((task) => !task.done).length || 0;

    if (diffDays < 0) return `Просрочено на ${Math.abs(diffDays)} дн.; осталось шагов: ${remainingTasks}`;
    if (diffDays === 0) return `Дедлайн сегодня; осталось шагов: ${remainingTasks}`;
    if (remainingTasks === 0) return `Готово; до дедлайна ${diffDays} дн.`;
    const pace = Math.max(1, Math.ceil(diffDays / remainingTasks));
    return `Осталось ${diffDays} дн.; примерно 1 шаг каждые ${pace} дн.`;
}

function updateGoalStatus(goal) {
    recalculateGoalProgressValue(goal);
    goal.time = getGoalStatusText(goal);
    const statusEl = document.getElementById('goalTimeHint');
    if (statusEl && goal.id === selectedGoalId) statusEl.innerText = goal.time;
    const badge = document.getElementById('goalProgressBadge');
    if (badge && goal.id === selectedGoalId) badge.innerText = `${goal.progress}%`;
}

function recalculateGoalProgress(goal) {
    updateGoalStatus(goal);
}

function renderGoalsWidget() {
    const container = document.getElementById('goalsWidget');
    container.innerHTML = '';

    const colors = ['bg-pink-200/60 border-pink-100', 'bg-purple-200/60 border-purple-100', 'bg-teal-200/60 border-teal-100'];

    AppData.goals.forEach((goal, index) => {
        updateGoalStatus(goal);
        const card = document.createElement('div');
        card.className = `goal-card flex-1 p-2 text-center relative overflow-hidden flex flex-col justify-center items-center h-24 ${colors[index % colors.length]}`;
        card.onclick = () => openGoalDetail(goal.id);
        const status = goal.deadline ? getGoalStatusText(goal).split(';')[0] : 'Без дедлайна';
        card.innerHTML = `
            <span class="absolute left-1 top-1 text-gray-700/60 font-bold text-xs">${goal.progress}%</span>
            <p class="handwriting text-gray-800 font-bold text-sm leading-snug w-full px-1 text-center truncate-2-lines">${escapeHtml(goal.title)}</p>
            <span class="text-[10px] text-gray-600 mt-1 leading-tight line-clamp-1">${escapeHtml(status)}</span>
        `;
        container.appendChild(card);
    });

    saveDb();
    lucide.createIcons();
}

function openGoalDetail(goalId) {
    selectedGoalId = goalId;
    const goal = AppData.goals.find((item) => item.id === goalId);
    if (!goal) return;

    updateGoalStatus(goal);
    document.getElementById('goalTitleInput').value = goal.title;
    document.getElementById('goalDeadlineInput').value = goal.deadline || '';
    document.getElementById('goalProgressBadge').innerText = `${goal.progress}%`;
    document.getElementById('goalTimeHint').innerText = goal.time || getGoalStatusText(goal);

    renderGoalMicrotasks(goal);
    openPanel('goalDetailPanel');
}

function renderGoalMicrotasks(goal) {
    const list = document.getElementById('goalMicrotaskList');
    list.innerHTML = '';

    if (!goal.microtasks || goal.microtasks.length === 0) {
        list.innerHTML = '<p class="text-xs text-gray-500 italic py-2 text-center">Нет мелких шагов. Добавьте первый!</p>';
        updateGoalStatus(goal);
        return;
    }

    goal.microtasks.forEach((mt) => {
        const isLinked = checkIfLinkedToToday(goal.id, mt.id);
        const item = document.createElement('div');
        item.className = 'flex items-center justify-between p-2 glass-panel text-xs';
        item.innerHTML = `
            <div class="flex items-center gap-2 flex-1 min-w-0 pr-2">
                <input type="checkbox" ${mt.done ? 'checked' : ''} class="h-4 w-4 text-teal-600 rounded shrink-0">
                <span class="truncate ${mt.done ? 'line-through text-gray-500' : 'text-gray-800 font-medium'}">${escapeHtml(mt.text)}</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                ${!mt.done ? `
                    <button class="js-link-today px-2 py-1 rounded bg-white/50 text-gray-700 text-[10px] active:scale-90 font-bold"
                            ${isLinked ? 'disabled style="opacity: 0.5;"' : ''}>
                        ${isLinked ? 'В плане' : '+ сегодня'}
                    </button>
                    <button class="js-pick-date p-1 rounded bg-white/40 hover:bg-white/60 text-gray-600 active:scale-90 transition-all" title="Запланировать на дату">
                        <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
                    </button>
                ` : ''}
                <button class="js-delete-mt text-red-500 px-1 active:scale-75">✕</button>
            </div>
        `;
        item.querySelector('input[type="checkbox"]').addEventListener('change', () => toggleMicrotask(goal.id, mt.id));
        item.querySelector('.js-link-today')?.addEventListener('click', () => linkMicrotaskToToday(goal.id, mt.id, mt.text));
        item.querySelector('.js-pick-date')?.addEventListener('click', () => openGoalDatePicker(goal.id, mt.id, mt.text));
        item.querySelector('.js-delete-mt').addEventListener('click', () => deleteMicrotask(goal.id, mt.id));
        list.appendChild(item);
    });

    updateGoalStatus(goal);
    lucide.createIcons();
}

let goalDatePickerData = null;
let taskMoveId = null; // id задачи, ожидающей переноса
function openGoalDatePicker(goalId, mtId, text) {
    goalDatePickerData = { goalId, mtId, text };
    document.getElementById('goalDatePickerInput').value = activeDate;
    document.getElementById('goalDatePickerModal').classList.remove('hidden');
}

function closeGoalDatePicker() {
    document.getElementById('goalDatePickerModal').classList.add('hidden');
    goalDatePickerData = null;
}

function submitGoalDatePicker() {
    const dateInput = document.getElementById('goalDatePickerInput').value;
    if (!dateInput) return;

    // Режим переноса задачи
    if (taskMoveId !== null) {
        const id = taskMoveId;
        taskMoveId = null;
        moveTaskToDate(id, dateInput);
        closeGoalDatePicker();
        document.getElementById('goalDatePickerModal').querySelector('h3').textContent = 'Выберите дату';
        return;
    }

    if (!goalDatePickerData) return;

    const { goalId, mtId, text } = goalDatePickerData;
    if (!AppData.tasksByDate[dateInput]) AppData.tasksByDate[dateInput] = [];

    const alreadyAssigned = AppData.tasksByDate[dateInput].some((t) => t.goalId === goalId && t.microtaskId === mtId);
    if (!alreadyAssigned) {
        AppData.tasksByDate[dateInput].push({ id: createId(), text, done: false, goalId, microtaskId: mtId });
        saveDb();
        renderDailyPlan();
        setupCalendar();
    }

    closeGoalDatePicker();
    const goal = AppData.goals.find((g) => g.id === selectedGoalId);
    if (goal) renderGoalMicrotasks(goal);
}

function checkIfLinkedToToday(goalId, mtId) {
    const todayTasks = AppData.tasksByDate[activeDate] || [];
    return todayTasks.some((t) => t.goalId === goalId && t.microtaskId === mtId);
}

function linkMicrotaskToToday(goalId, mtId, text) {
    if (!AppData.tasksByDate[activeDate]) AppData.tasksByDate[activeDate] = [];
    if (checkIfLinkedToToday(goalId, mtId)) return;

    AppData.tasksByDate[activeDate].push({ id: createId(), text, done: false, goalId, microtaskId: mtId });

    saveDb();
    renderDailyPlan();
    setupCalendar();
    const goal = AppData.goals.find((g) => g.id === goalId);
    if (goal) renderGoalMicrotasks(goal);
}

function toggleMicrotask(goalId, mtId) {
    const goal = AppData.goals.find((g) => g.id === goalId);
    if (!goal) return;
    const mt = goal.microtasks.find((m) => m.id === mtId);
    if (!mt) return;

    mt.done = !mt.done;
    for (const date in AppData.tasksByDate) {
        const task = AppData.tasksByDate[date].find((t) => t.goalId === goalId && t.microtaskId === mtId);
        if (task) task.done = mt.done;
    }

    recalculateGoalProgress(goal);
    saveDb();
    renderGoalsWidget();
    renderDailyPlan();
    renderGoalMicrotasks(goal);
}

function addMicrotaskToGoal() {
    const input = document.getElementById('newMicrotaskInput');
    const text = input.value.trim();
    if (!text || !selectedGoalId) return;

    const goal = AppData.goals.find((g) => g.id === selectedGoalId);
    if (!goal) return;
    if (!goal.microtasks) goal.microtasks = [];
    goal.microtasks.push({ id: createId(), text, done: false });

    recalculateGoalProgress(goal);
    saveDb();
    input.value = '';
    renderGoalMicrotasks(goal);
    renderGoalsWidget();
}

function deleteMicrotask(goalId, mtId) {
    const goal = AppData.goals.find((g) => g.id === goalId);
    if (!goal) return;

    goal.microtasks = goal.microtasks.filter((m) => m.id !== mtId);
    for (const date in AppData.tasksByDate) {
        AppData.tasksByDate[date] = AppData.tasksByDate[date].filter((t) => !(t.goalId === goalId && t.microtaskId === mtId));
    }

    recalculateGoalProgress(goal);
    saveDb();
    renderGoalMicrotasks(goal);
    renderGoalsWidget();
    renderDailyPlan();
}

function saveGoalChanges() {
    if (!selectedGoalId) return;
    const goal = AppData.goals.find((item) => item.id === selectedGoalId);
    if (!goal) return;

    goal.title = document.getElementById('goalTitleInput').value.trim() || 'Без названия';
    goal.deadline = document.getElementById('goalDeadlineInput').value;

    updateGoalStatus(goal);
    saveDb();
    renderGoalsWidget();
}

/* ==============================================
   БЛОК: КАЛЕНДАРЬ
   ============================================== */
function setupCalendar() {
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    document.getElementById('monthYearTitle').innerText = `${monthNames[calendarMonth]} ${calendarYear}`;

    const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay();
    const correctedFirstDayIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1;
    const totalDays = new Date(calendarYear, calendarMonth + 1, 0).getDate();

    for (let i = 0; i < correctedFirstDayIndex; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'py-2';
        grid.appendChild(emptyCell);
    }

    for (let day = 1; day <= totalDays; day++) {
        const formattedDateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        const dayCell = document.createElement('div');
        dayCell.className = 'py-2 text-sm font-semibold rounded-lg cursor-pointer transition-all hover:bg-white/40 active:scale-90 flex flex-col justify-center items-center h-12';
        dayCell.className += formattedDateStr === activeDate
            ? ' bg-white/70 shadow-sm border border-white/60 text-gray-900'
            : ' text-gray-700';

        const tasksCount = AppData.tasksByDate[formattedDateStr]?.length || 0;
        const dotIndicator = tasksCount > 0 ? '<div class="w-1.5 h-1.5 bg-gray-800 rounded-full mt-0.5"></div>' : '';

        dayCell.innerHTML = `<span>${day}</span>${dotIndicator}`;
        dayCell.onclick = () => selectCalendarDate(formattedDateStr);
        grid.appendChild(dayCell);
    }
}

function changeMonth(dir) {
    calendarMonth += dir;
    if (calendarMonth < 0) {
        calendarMonth = 11;
        calendarYear--;
    } else if (calendarMonth > 11) {
        calendarMonth = 0;
        calendarYear++;
    }
    setupCalendar();
}

function selectCalendarDate(dateString) {
    activeDate = dateString;
    setupCalendar();
    renderDailyPlan();
    closePanel('calendarPanel');
}

/* ==============================================
   БЛОК: ЗАМЕТКИ И ПАПКИ
   ============================================== */
let lastFolderTap = { id: null, time: 0 };

function handleFolderTap(folderId) {
    const now = Date.now();
    const isDoubleTap = lastFolderTap.id === folderId && now - lastFolderTap.time < 360;
    currentFolderId = folderId;
    renderFolders();
    renderNotes();
    if (isDoubleTap) editFolderDialog();
    lastFolderTap = { id: folderId, time: now };
}

function renderFolders() {
    const list = document.getElementById('foldersList');
    list.innerHTML = '';

    AppData.notesFolders.forEach((folder) => {
        const button = document.createElement('button');
        const isActive = folder.id === currentFolderId;
        button.className = `folder-pill px-4 py-2 rounded-full font-bold text-xs shrink-0 transition-all ${isActive ? 'bg-white/80 text-gray-800 shadow-sm border border-white/40' : 'bg-white/30 text-gray-600'}`;
        button.innerText = folder.name;
        button.setAttribute('draggable', 'true');
        button.onclick = () => handleFolderTap(folder.id);
        button.ondblclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            currentFolderId = folder.id;
            renderFolders();
            renderNotes();
            editFolderDialog();
        };
        button.oncontextmenu = (event) => {
            event.preventDefault();
            currentFolderId = folder.id;
            renderFolders();
            renderNotes();
            editFolderDialog();
        };
        button.addEventListener('dragstart', (event) => handleFolderDragStart(event, folder.id));
        button.addEventListener('dragover', handleFolderDragOver);
        button.addEventListener('dragleave', handleFolderDragLeave);
        button.addEventListener('drop', (event) => handleFolderDrop(event, folder.id));
        list.appendChild(button);
    });

    const editBtn = document.getElementById('editActiveFolderBtn');
    editBtn.classList.toggle('hidden', AppData.notesFolders.length === 0);

    const addFolderBtn = document.createElement('button');
    addFolderBtn.className = 'px-3 py-2 rounded-full bg-white/40 text-gray-800 font-bold text-xs shrink-0 active:scale-90 transition-transform hover:bg-white/60';
    addFolderBtn.innerHTML = "<i data-lucide='plus' class='w-3.5 h-3.5 inline'></i>";
    addFolderBtn.onclick = openFolderCreateDialog;
    list.appendChild(addFolderBtn);

    lucide.createIcons();
}

function openFolderCreateDialog() {
    showAppDialog({
        title: 'Новый раздел',
        message: 'Название раздела заметок',
        input: true,
        confirmText: 'Создать',
        onConfirm: (folderName) => {
            const newId = `folder_${createId()}`;
            AppData.notesFolders.push({ id: newId, name: folderName.trim(), notes: [] });
            currentFolderId = newId;
            saveDb();
            renderFolders();
            renderNotes();
        }
    });
}

function editFolderDialog() {
    const folder = AppData.notesFolders.find((item) => item.id === currentFolderId);
    if (!folder) return;
    showAppDialog({
        title: `Раздел "${folder.name}"`,
        message: 'Можно переименовать или удалить раздел вместе с его заметками.',
        confirmText: 'Переименовать',
        onConfirm: () => openFolderRenameDialog(folder.id),
        extraActions: [{
            label: 'Удалить раздел',
            danger: true,
            onClick: () => confirmDeleteFolder(folder.id)
        }]
    });
}

function openFolderRenameDialog(folderId) {
    const folder = AppData.notesFolders.find((item) => item.id === folderId);
    if (!folder) return;
    showAppDialog({
        title: 'Название раздела',
        message: 'Введите новое название.',
        input: true,
        inputValue: folder.name,
        confirmText: 'Сохранить',
        onConfirm: (newName) => {
            folder.name = newName.trim();
            saveDb();
            renderFolders();
        }
    });
}

function confirmDeleteFolder(folderId) {
    const folder = AppData.notesFolders.find((item) => item.id === folderId);
    if (!folder) return;
    showAppDialog({
        title: 'Удалить раздел?',
        message: `Раздел "${folder.name}" и все его заметки будут удалены.`,
        confirmText: 'Удалить',
        danger: true,
        onConfirm: () => {
            AppData.notesFolders = AppData.notesFolders.filter((item) => item.id !== folderId);
            currentFolderId = AppData.notesFolders[0]?.id || '';
            saveDb();
            renderFolders();
            renderNotes();
        }
    });
}

function handleFolderDragStart(event, folderId) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `folder:${folderId}`);
    event.currentTarget.classList.add('sortable-ghost');
}

function handleFolderDragOver(event) {
    event.preventDefault();
    event.currentTarget.classList.add('drag-over');
}

function handleFolderDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
    event.currentTarget.classList.remove('sortable-ghost');
}

function handleFolderDrop(event, targetFolderId) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    event.currentTarget.classList.remove('sortable-ghost');
    const dragData = event.dataTransfer.getData('text/plain');
    if (dragData.startsWith('note:')) {
        const [, fromFolderId, rawNoteId] = dragData.split(':');
        moveNoteToFolder(parseInt(rawNoteId), fromFolderId || currentFolderId, targetFolderId);
    } else if (dragData.startsWith('folder:')) {
        moveFolderBefore(dragData.split(':')[1], targetFolderId);
    }
}

function moveFolderBefore(sourceFolderId, targetFolderId) {
    if (!sourceFolderId || sourceFolderId === targetFolderId) return;
    const sourceIndex = AppData.notesFolders.findIndex((folder) => folder.id === sourceFolderId);
    const targetIndex = AppData.notesFolders.findIndex((folder) => folder.id === targetFolderId);
    if (sourceIndex === -1 || targetIndex === -1) return;
    const [movedFolder] = AppData.notesFolders.splice(sourceIndex, 1);
    const adjustedTarget = AppData.notesFolders.findIndex((folder) => folder.id === targetFolderId);
    AppData.notesFolders.splice(adjustedTarget, 0, movedFolder);
    currentFolderId = sourceFolderId;
    saveDb();
    renderFolders();
    renderNotes();
}

// Горизонтальная прокрутка списка разделов колесом мыши (десктоп)
document.addEventListener('DOMContentLoaded', () => {
    const foldersList = document.getElementById('foldersList');
    foldersList?.addEventListener('wheel', (event) => {
        if (event.deltaY === 0) return;
        event.preventDefault();
        foldersList.scrollLeft += event.deltaY;
    }, { passive: false });
});

function renderNotes() {
    const container = document.getElementById('notesList');
    container.innerHTML = '';

    const folder = AppData.notesFolders.find((item) => item.id === currentFolderId);
    if (!folder || folder.notes.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 italic text-center py-12">В этой папке пусто</p>';
        return;
    }

    folder.notes.forEach((note) => {
        const card = document.createElement('div');
        card.className = `note-card p-4 flex items-center justify-between gap-4 relative overflow-hidden cursor-pointer ${note.done ? 'note-done' : ''}`;
        card.setAttribute('draggable', 'true');
        card.addEventListener('dragstart', (event) => handleNoteDragStart(event, note.id));

        card.innerHTML = `
            <div class="circle-check w-6 h-6 rounded-full border-2 border-white bg-transparent shadow-inner transition-colors flex shrink-0 items-center justify-center cursor-pointer z-10">
                ${note.done ? '<div class="w-3 h-3 bg-white rounded-full"></div>' : ''}
            </div>
            <div class="flex-1 min-w-0 js-open-note">
                <h4 class="font-bold text-gray-800 text-base truncate leading-tight">${escapeHtml(note.title || 'Без названия')}</h4>
                <p class="text-xs text-gray-500 line-clamp-2 mt-1 leading-snug break-words">${escapeHtml(note.text || 'Нет текста...')}</p>
            </div>
            <button class="js-delete-note p-2 text-red-400 hover:text-red-600 transition-colors shrink-0 z-10 active:scale-75" title="Удалить заметку">
                <i data-lucide="trash-2" class="w-5 h-5 pointer-events-none"></i>
            </button>
        `;
        card.querySelector('.circle-check').addEventListener('click', (event) => toggleNoteDone(note.id, event));
        card.querySelector('.js-open-note').addEventListener('click', () => openNoteEdit(note.id));
        card.querySelector('.js-delete-note').addEventListener('click', (event) => deleteNoteInstantly(note.id, event));
        container.appendChild(card);
    });

    lucide.createIcons();
}

function toggleNoteDone(noteId, event) {
    event.stopPropagation();
    const folder = AppData.notesFolders.find((f) => f.id === currentFolderId);
    const note = folder?.notes.find((n) => n.id === noteId);
    if (!note) return;
    note.done = !note.done;
    saveDb();
    renderNotes();
}

function deleteNoteInstantly(noteId, event) {
    event.stopPropagation();
    const folder = AppData.notesFolders.find((item) => item.id === currentFolderId);
    const note = folder?.notes.find((item) => item.id === noteId);
    if (!folder || !note) return;
    showAppDialog({
        title: 'Удалить заметку?',
        message: note.title || 'Без названия',
        confirmText: 'Удалить',
        danger: true,
        onConfirm: () => {
            folder.notes = folder.notes.filter((item) => item.id !== noteId);
            saveDb();
            renderNotes();
        }
    });
}

function handleNoteDragStart(event, noteId) {
    event.dataTransfer.setData('text/plain', `note:${currentFolderId}:${noteId}`);
}

function moveNoteToFolder(noteId, fromFolderId, toFolderId) {
    if (fromFolderId === toFolderId) return;
    const fromFolder = AppData.notesFolders.find((f) => f.id === fromFolderId);
    const toFolder = AppData.notesFolders.find((f) => f.id === toFolderId);
    if (!fromFolder || !toFolder) return;

    const noteIndex = fromFolder.notes.findIndex((n) => n.id === noteId);
    if (noteIndex > -1) {
        const noteToMove = fromFolder.notes.splice(noteIndex, 1)[0];
        toFolder.notes.push(noteToMove);
        saveDb();
        renderNotes();
        renderFolders();
    }
}

function openNoteEdit(noteId) {
    const folder = AppData.notesFolders.find((item) => item.id === currentFolderId);
    if (!folder) return;
    const note = folder.notes.find((item) => item.id === noteId);
    if (!note) return;

    activeNoteId = noteId;
    document.getElementById('editNoteTitle').value = note.title;
    document.getElementById('editNoteText').value = note.text;
    document.getElementById('noteEditModal').classList.remove('hidden');
}

function addNewNote() {
    const folder = AppData.notesFolders.find((item) => item.id === currentFolderId);
    if (!folder) return;

    const newNote = { id: createId(), title: 'Новая заметка', text: '', done: false };
    folder.notes.push(newNote);
    saveDb();
    renderNotes();
    openNoteEdit(newNote.id);
}

function saveActiveNote() {
    const folder = AppData.notesFolders.find((item) => item.id === currentFolderId);
    const note = folder?.notes.find((item) => item.id === activeNoteId);
    if (note) {
        note.title = document.getElementById('editNoteTitle').value;
        note.text = document.getElementById('editNoteText').value;
        saveDb();
        renderNotes();
    }
    closeNoteEdit();
}

function closeNoteEdit() {
    document.getElementById('noteEditModal').classList.add('hidden');
    activeNoteId = null;
}

/* ==============================================
   БЛОК: КНИГИ И ФИЛЬМЫ (МЕДИА)
   ============================================== */
function setMediaTab(tab) {
    currentMediaTab = tab;
    document.getElementById('tabBooks').className = `flex-1 py-2 rounded-xl text-sm font-bold ${tab === 'books' ? 'bg-white/60 text-gray-800 shadow-sm border border-white/40' : 'text-gray-500'}`;
    document.getElementById('tabMovies').className = `flex-1 py-2 rounded-xl text-sm font-bold ${tab === 'movies' ? 'bg-white/60 text-gray-800 shadow-sm border border-white/40' : 'text-gray-500'}`;
    document.getElementById('tabSeries').className = `flex-1 py-2 rounded-xl text-sm font-bold ${tab === 'series' ? 'bg-white/60 text-gray-800 shadow-sm border border-white/40' : 'text-gray-500'}`;
    setupMediaDragSupport();
    renderMedia();
}

function setupMediaDragSupport() {
    const tabs = ['tabBooks', 'tabMovies', 'tabSeries'];
    const names = ['books', 'movies', 'series'];
    tabs.forEach((tabId, idx) => {
        const el = document.getElementById(tabId);
        el.ondragover = (event) => { event.preventDefault(); el.classList.add('drag-over'); };
        el.ondragleave = () => el.classList.remove('drag-over');
        el.ondrop = (event) => {
            event.preventDefault();
            el.classList.remove('drag-over');
            const dragData = event.dataTransfer.getData('text/plain');
            if (!dragData.startsWith('media:')) return;
            const [, fromTab, rawItemId] = dragData.split(':');
            moveMediaToTab(parseInt(rawItemId), fromTab || currentMediaTab, names[idx]);
        };
    });
}

function renderMedia() {
    const container = document.getElementById('mediaList');
    container.innerHTML = '';

    const items = AppData.media[currentMediaTab] || [];
    if (items.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 italic text-center py-12">Список пуст. Добавьте первую находку!</p>';
        return;
    }

    items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'media-row flex justify-between items-center p-3 relative overflow-hidden';
        row.setAttribute('draggable', 'true');
        row.setAttribute('data-index', index);
        row.setAttribute('data-id', item.id);
        row.addEventListener('dragstart', handleMediaDragStart);
        row.addEventListener('dragover', handleMediaDragOverLocal);
        row.addEventListener('dragleave', handleMediaDragLeaveLocal);
        row.addEventListener('drop', handleMediaDropLocal);
        row.addEventListener('dragend', handleMediaDragEnd);

        row.innerHTML = `
            <span class="text-gray-800 font-medium truncate flex-1 mr-4">${escapeHtml(item.title)}</span>
            <div class="flex items-center gap-2">
                <button class="js-move-media p-1 text-gray-400 hover:text-gray-700 active:scale-75 transition-transform" title="Переместить полку">
                    <i data-lucide="shrink" class="w-4 h-4"></i>
                </button>
                <button class="js-delete-media text-red-500 active:scale-75 px-1"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            </div>
        `;
        row.querySelector('.js-move-media').addEventListener('click', (event) => openMoveMediaDialog(item.id, event));
        row.querySelector('.js-delete-media').addEventListener('click', () => deleteMedia(item.id));
        container.appendChild(row);
    });

    lucide.createIcons();
}

function handleMediaDragStart(event) {
    draggedItem = this;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `media:${currentMediaTab}:${this.getAttribute('data-id')}`);
    this.classList.add('sortable-ghost');
}

function handleMediaDragOverLocal(event) {
    event.preventDefault();
    this.classList.add('drag-over');
    return false;
}

function handleMediaDragLeaveLocal() {
    this.classList.remove('drag-over');
}

function handleMediaDropLocal(event) {
    event.stopPropagation();
    this.classList.remove('drag-over');
    const srcIdx = draggedItem?.getAttribute('data-index');
    const targetIdx = this.getAttribute('data-index');
    if (srcIdx !== null && targetIdx !== null && srcIdx !== targetIdx) {
        const arr = AppData.media[currentMediaTab];
        const moved = arr.splice(Number(srcIdx), 1)[0];
        arr.splice(Number(targetIdx), 0, moved);
        saveDb();
        renderMedia();
    }
    return false;
}

function handleMediaDragEnd() {
    this.classList.remove('sortable-ghost');
    this.classList.remove('drag-over');
    draggedItem = null;
}

function moveMediaToTab(itemId, fromTab, toTab) {
    if (fromTab === toTab) return;
    const fromArray = AppData.media[fromTab];
    const toArray = AppData.media[toTab];
    if (!fromArray || !toArray) return;

    const index = fromArray.findIndex((i) => i.id === itemId);
    if (index > -1) {
        const itemToMove = fromArray.splice(index, 1)[0];
        toArray.push(itemToMove);
        saveDb();
        renderMedia();
    }
}

function openMoveMediaDialog(itemId, event) {
    event.stopPropagation();
    activeMoveMediaId = itemId;
    const targetList = document.getElementById('moveItemFoldersList');
    targetList.innerHTML = '';

    const tabNamesMap = { books: 'Книги 📚', movies: 'Фильмы 🎬', series: 'Сериалы 🍿' };

    for (const tab in tabNamesMap) {
        if (tab === currentMediaTab) continue;
        const btn = document.createElement('button');
        btn.className = 'w-full p-2 rounded-xl text-sm font-semibold text-gray-700 bg-white/50 active:scale-95 transition-all text-center';
        btn.innerText = tabNamesMap[tab];
        btn.onclick = () => {
            moveMediaToTab(activeMoveMediaId, currentMediaTab, tab);
            closeMoveModal();
        };
        targetList.appendChild(btn);
    }

    document.getElementById('moveItemModalTitle').innerText = 'Перенос досуга';
    document.getElementById('moveItemModal').classList.remove('hidden');
}

function closeMoveModal() {
    document.getElementById('moveItemModal').classList.add('hidden');
    activeMoveMediaId = null;
}

function addMediaItem() {
    const input = document.getElementById('mediaInput');
    const title = input.value.trim();
    if (!title) return;

    AppData.media[currentMediaTab].push({ id: createId(), title });
    saveDb();
    input.value = '';
    renderMedia();
}

function deleteMedia(itemId) {
    const item = AppData.media[currentMediaTab].find((i) => i.id === itemId);
    if (!item) return;
    showAppDialog({
        title: 'Удалить из списка?',
        message: item.title,
        confirmText: 'Удалить',
        danger: true,
        onConfirm: () => {
            AppData.media[currentMediaTab] = AppData.media[currentMediaTab].filter((i) => i.id !== itemId);
            saveDb();
            renderMedia();
        }
    });
}

/* ==============================================
   УПРАВЛЕНИЕ СЛАЙД-ПАНЕЛЯМИ
   ============================================== */
function openPanel(id) {
    document.querySelectorAll('.slide-panel').forEach((p) => p.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function closePanel(id) {
    document.getElementById(id).classList.remove('active');
}

/* ==============================================
   КНОПКА МИКРОФОНА: КОРОТКОЕ НАЖАТИЕ = ГОЛОС, УДЕРЖАНИЕ = ТЕКСТ
   ============================================== */
function initHoldButton() {
    const micBtn = document.getElementById('micBtn');
    const textWrapper = document.getElementById('textInputWrapper');
    let pressTimer;
    let longPressTriggered = false;

    function expandTextInput() {
        micBtn.classList.add('hidden');
        textWrapper.classList.remove('hidden');
        textWrapper.classList.add('flex');
        document.getElementById('aiTaskInput').focus();
    }

    function startPress() {
        longPressTriggered = false;
        pressTimer = window.setTimeout(() => {
            longPressTriggered = true;
            expandTextInput();
        }, 600);
    }

    function cancelPress() {
        if (pressTimer) clearTimeout(pressTimer);
    }

    micBtn.addEventListener('click', () => {
        if (longPressTriggered) {
            longPressTriggered = false;
            return;
        }
        // Короткое нажатие — сразу открываем текстовое поле и запускаем голосовой ввод
        expandTextInput();
        startVoiceInput('aiTaskInput');
    });
    micBtn.addEventListener('mousedown', startPress);
    micBtn.addEventListener('mouseup', cancelPress);
    micBtn.addEventListener('mouseleave', cancelPress);
    micBtn.addEventListener('touchstart', (event) => {
        event.preventDefault();
        startPress();
    });
    micBtn.addEventListener('touchend', (event) => {
        event.preventDefault();
        cancelPress();
        if (!longPressTriggered) {
            expandTextInput();
            startVoiceInput('aiTaskInput');
        }
    });
}

function collapseToMicOnly() {
    const textWrapper = document.getElementById('textInputWrapper');
    const micBtn = document.getElementById('micBtn');
    textWrapper.classList.add('hidden');
    textWrapper.classList.remove('flex');
    micBtn.classList.remove('hidden');
}

/* ==============================================
   ЗАПРОС К ИИ-ПОМОЩНИКУ
   ============================================== */
function sendAiRequest() {
    const input = document.getElementById('aiTaskInput');
    const val = input.value.trim();
    if (!val) return;

    document.getElementById('aiResponseText').innerText = `Я получила запрос: "${val}".\n\nГолосовой и текстовый ввод уже работают на уровне интерфейса. Чтобы я могла реально добавлять задачи, заметки и планы — подключите свой бесплатный API-ключ Gemini в Настройках.`;
    document.getElementById('aiResponseModal').classList.remove('hidden');

    input.value = '';
    collapseToMicOnly();
}

function closeAiModal() {
    document.getElementById('aiResponseModal').classList.add('hidden');
}

/* ==============================================
   НАСТРОЙКИ СЕРВЕРА И PUSH-УВЕДОМЛЕНИЙ
   ============================================== */
function applyServerSettings() {
    const url = localStorage.getItem('server_url') || '';
    const secret = localStorage.getItem('server_secret') || '';
    const customPrompt = localStorage.getItem('custom_prompt') || '';
    const el = document.getElementById('serverUrlInput');
    const sel = document.getElementById('serverSecretInput');
    const cp = document.getElementById('customPromptInput');
    if (el) el.value = url;
    if (sel) sel.value = secret;
    if (cp) cp.value = customPrompt;
    updatePushStatusUI();
}

function saveCustomPrompt() {
    const val = document.getElementById('customPromptInput')?.value || '';
    localStorage.setItem('custom_prompt', val);
}

function clearCustomPrompt() {
    localStorage.removeItem('custom_prompt');
    const el = document.getElementById('customPromptInput');
    if (el) el.value = '';
    showAppDialog({
        title: 'Готово',
        message: 'Личный промпт сброшен. ИИ будет использовать стандартные настройки.',
        confirmText: 'Ок'
    });
}

function saveServerSettings() {
    const url = document.getElementById('serverUrlInput')?.value.trim().replace(/\/$/, '') || '';
    const secret = document.getElementById('serverSecretInput')?.value.trim() || '';
    localStorage.setItem('server_url', url);
    localStorage.setItem('server_secret', secret);
}

async function checkConnection() {
    const statusText = document.getElementById('serverStatusText');
    if (statusText) statusText.innerText = 'Проверяю...';

    const result = await checkServerConnection();

    if (statusText) {
        if (result.ok) {
            statusText.innerText = `✅ Подключено · Gemini ${result.gemini ? '✓' : '✗'} · Push ${result.push ? '✓' : '✗'}`;
        } else {
            statusText.innerText = `❌ Ошибка: ${result.error}`;
        }
    }
}

async function updatePushStatusUI() {
    const statusText = document.getElementById('pushStatusText');
    const btn = document.getElementById('pushToggleBtn');
    if (!statusText || !btn) return;

    const status = await getPushStatus();
    if (status === 'subscribed') {
        statusText.innerText = 'Статус: ✅ Уведомления включены';
        btn.innerText = 'Отключить';
    } else if (status === 'unsupported') {
        statusText.innerText = 'Статус: ⚠️ Не поддерживается браузером';
        btn.disabled = true;
    } else {
        statusText.innerText = 'Статус: выключены';
        btn.innerText = 'Включить';
    }
}

async function togglePush() {
    const statusText = document.getElementById('pushStatusText');
    const status = await getPushStatus();

    try {
        if (status === 'subscribed') {
            if (statusText) statusText.innerText = 'Отключаю...';
            await disablePushNotifications();
        } else {
            if (statusText) statusText.innerText = 'Подключаю...';
            await setupPushNotifications();
        }
    } catch (err) {
        showAppDialog({
            title: 'Ошибка уведомлений',
            message: err.message,
            confirmText: 'Понятно'
        });
    }
    updatePushStatusUI();
}

async function savePushTime() {
    const time = document.getElementById('pushTimeInput')?.value;
    if (!time) return;
    try {
        await updatePushTime(time);
        showAppDialog({
            title: 'Время сохранено',
            message: `Утреннее напоминание будет приходить в ${time} МСК`,
            confirmText: 'Ок'
        });
    } catch (err) {
        showAppDialog({ title: 'Ошибка', message: err.message, confirmText: 'Ок' });
    }
}

async function testPush() {
    try {
        await sendTestPush();
        showAppDialog({
            title: 'Отправлено!',
            message: 'Тестовое уведомление отправлено. Оно придёт в течение нескольких секунд.',
            confirmText: 'Ок'
        });
    } catch (err) {
        showAppDialog({ title: 'Ошибка', message: err.message, confirmText: 'Ок' });
    }
}

/* ==============================================
   ИИ-ЧАТ — ЛОГИКА И РЕНДЕР
   ============================================== */
const CHAT_STORAGE_KEY = 'smart_planner_chat';
let chatHistory = [];
let isVoiceReplyEnabled = false;
let isSpeaking = false;
let pendingSuggestions = [];

// Загружаем историю чата из localStorage
function loadChatHistory() {
    try {
        const saved = localStorage.getItem(CHAT_STORAGE_KEY);
        chatHistory = saved ? JSON.parse(saved) : [];
    } catch {
        chatHistory = [];
    }
}

// Сохраняем историю чата
function saveChatHistory() {
    // Храним максимум 100 сообщений чтобы не переполнить localStorage
    if (chatHistory.length > 100) chatHistory = chatHistory.slice(-100);
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatHistory));
}

// Форматируем время сообщения
function formatMessageTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// Добавляем сообщение в историю и рендерим
function addMessage(role, content, time = new Date().toISOString()) {
    const message = { role, content, time };
    chatHistory.push(message);
    saveChatHistory();
    renderMessage(message);
    scrollChatToBottom();
}

// Рендерим одно сообщение
function renderMessage(message) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    const placeholder = container.querySelector('.chat-placeholder');
    if (placeholder) placeholder.remove();

    const isUser = message.role === 'user';
    const isError = message.role === 'assistant' && (
        message.content.includes('Не удалось связаться с сервером') ||
        message.content.includes('Ошибка Gemini API')
    );

    const wrapper = document.createElement('div');
    wrapper.className = isUser ? 'flex justify-end' : 'flex justify-start';

    const bubbleClass = isUser ? 'chat-bubble-user' : (isError ? 'chat-bubble-error' : 'chat-bubble-ai');

    wrapper.innerHTML = `
        <div class="relative group">
            <div class="${bubbleClass}">${escapeHtml(message.content)}</div>
            <div class="chat-time ${isUser ? 'text-right' : 'text-left'}">${formatMessageTime(message.time)}</div>
            ${isError ? `
                <button class="js-retry-btn mt-1 px-3 py-1 text-xs font-bold rounded-full bg-white/60 text-teal-700 active:scale-90 transition-transform border border-teal-200 hover:bg-teal-50">
                    🔄 Повторить
                </button>
            ` : ''}
            <!-- Кнопка копирования — появляется при наведении/долгом нажатии -->
            <button class="js-copy-btn absolute ${isUser ? 'left-0' : 'right-0'} top-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 rounded-full p-1 shadow-sm active:scale-90" title="Копировать">
                <i data-lucide="copy" class="w-3.5 h-3.5 text-gray-500 pointer-events-none"></i>
            </button>
        </div>
    `;

    // Копирование по нажатию на кнопку
    const copyBtn = wrapper.querySelector('.js-copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard?.writeText(message.content).then(() => {
                copyBtn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5 text-teal-500 pointer-events-none"></i>';
                lucide.createIcons();
                setTimeout(() => {
                    copyBtn.innerHTML = '<i data-lucide="copy" class="w-3.5 h-3.5 text-gray-500 pointer-events-none"></i>';
                    lucide.createIcons();
                }, 1500);
            });
        });
    }

    // Копирование по долгому нажатию (мобильные)
    let longPressTimer;
    const bubble = wrapper.querySelector(`.${bubbleClass.split(' ')[0]}`);
    if (bubble) {
        bubble.addEventListener('touchstart', () => {
            longPressTimer = setTimeout(() => {
                navigator.clipboard?.writeText(message.content).then(() => {
                    bubble.style.opacity = '0.6';
                    setTimeout(() => { bubble.style.opacity = ''; }, 400);
                });
            }, 600);
        });
        bubble.addEventListener('touchend', () => clearTimeout(longPressTimer));
        bubble.addEventListener('touchmove', () => clearTimeout(longPressTimer));
    }

    // Кнопка повтора при ошибке
    const retryBtn = wrapper.querySelector('.js-retry-btn');
    if (retryBtn) {
        const originalText = message.content;
        // Ищем исходное сообщение пользователя перед этой ошибкой
        const msgIndex = chatHistory.findIndex(m => m.time === message.time);
        const prevUserMsg = chatHistory.slice(0, msgIndex).reverse().find(m => m.role === 'user');
        if (prevUserMsg) {
            retryBtn.addEventListener('click', () => {
                chatHistory = chatHistory.filter(m => m.time !== message.time);
                saveChatHistory();
                wrapper.remove();
                // Повторяем запрос БЕЗ повторного добавления сообщения пользователя
                processAIRequest(prevUserMsg.content);
            });
        }
    }

    container.appendChild(wrapper);
    lucide.createIcons();
}

// Рендерим всю историю чата
function renderChatHistory() {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    container.innerHTML = '';

    if (chatHistory.length === 0) {
        container.innerHTML = `
            <div class="chat-placeholder text-center py-16 text-gray-500">
                <div class="text-5xl mb-4">✨</div>
                <p class="text-sm font-medium">Привет! Я ваш личный помощник.</p>
                <p class="text-xs mt-2 opacity-70">Спросите про план дня, цели или просто поговорим.</p>
            </div>
        `;
        return;
    }

    chatHistory.forEach(renderMessage);
    scrollChatToBottom();
}

// Скролл вниз
function scrollChatToBottom() {
    const container = document.getElementById('chatMessages');
    if (container) container.scrollTop = container.scrollHeight;
}

// Показываем индикатор печатания
function showTypingIndicator() {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    const indicator = document.createElement('div');
    indicator.id = 'typingIndicator';
    indicator.className = 'flex justify-start';
    indicator.innerHTML = `
        <div class="chat-bubble-ai">
            <div class="typing-indicator">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    container.appendChild(indicator);
    scrollChatToBottom();
}

// Убираем индикатор печатания
function hideTypingIndicator() {
    document.getElementById('typingIndicator')?.remove();
}

// Отправляет текст к ИИ и обрабатывает ответ — БЕЗ добавления сообщения пользователя.
// Используется и при обычной отправке, и при повторе после ошибки.
async function processAIRequest(text) {
    const statusEl = document.getElementById('aiStatusText');
    if (statusEl) statusEl.innerText = 'Думает...';
    showTypingIndicator();

    try {
        const recentHistory = chatHistory.slice(-10).map(m => ({ role: m.role, content: m.content }));
        const result = await sendToAI(text, recentHistory);
        hideTypingIndicator();

        const rawReply = result.reply || 'Не удалось получить ответ';
        const { text: replyText, actions } = parseAIResponse(rawReply);

        addMessage('assistant', replyText || rawReply);
        if (statusEl) statusEl.innerText = 'Готов помочь';

        const added = executeAIActions(actions);
        if (added.length > 0) {
            const lines = added.map(item => {
                if (item.type === 'task')       return `✅ В план на ${formatDateForUser(item.date)}: "${item.text}"`;
                if (item.type === 'note')       return `📝 В заметки (${item.folder}): "${item.text}"`;
                if (item.type === 'microtask')  return `🎯 Шаг в цель "${item.goalTitle}": "${item.text}"`;
                if (item.type === 'moved_task') return `📅 Перенесла "${item.text}" → ${formatDateForUser(item.to)}`;
                if (item.type === 'media')      return `🎬 В Полку досуга (${item.tabLabel}): "${item.title}"`;
                if (item.type === 'cleaned')    return `🧹 Удалила ${item.count} мусорных задач`;

                return '';
            }).filter(Boolean);
            if (lines.length) addMessage('assistant', lines.join('\n'));
            document.getElementById('suggestionsZone')?.classList.add('hidden');
        }

        if (isVoiceReplyEnabled) speakText(replyText || rawReply);

    } catch (err) {
        hideTypingIndicator();
        if (statusEl) statusEl.innerText = 'Ошибка соединения';
        addMessage('assistant', `Не удалось связаться с сервером: ${err.message}. Проверьте настройки подключения.`);
    }
}

// Отправка нового сообщения в чат
async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input?.value.trim();
    if (!text) return;

    const serverUrl = localStorage.getItem('server_url');
    if (!serverUrl) {
        showAppDialog({
            title: 'Сервер не настроен',
            message: 'Укажите адрес сервера в Настройках, чтобы использовать ИИ-помощника.',
            confirmText: 'Открыть настройки',
            onConfirm: () => openPanel('settingsPanel')
        });
        return;
    }

    input.value = '';
    addMessage('user', text);
    await processAIRequest(text);
}

// Парсим ответ ИИ — извлекаем текст и JSON-команды
function parseAIResponse(rawReply) {
    const actionsMatch = rawReply.match(/<ACTIONS>([\s\S]*?)<\/ACTIONS>/);
    const text = rawReply.replace(/<ACTIONS>[\s\S]*?<\/ACTIONS>/g, '').trim();
    let actions = [];

    if (actionsMatch) {
        try {
            actions = JSON.parse(actionsMatch[1].trim());
        } catch (e) {
            console.warn('Не удалось распарсить ACTIONS:', e);
        }
    }

    return { text, actions };
}

// Выполняем команды от ИИ
function executeAIActions(actions) {
    if (!actions || actions.length === 0) return [];
    const added = [];

    actions.forEach(action => {
        if (action.type === 'add_task' && action.text) {
            const date = action.date || activeDate;
            if (!AppData.tasksByDate[date]) AppData.tasksByDate[date] = [];
            AppData.tasksByDate[date].push({ id: createId(), text: action.text, done: false });
            added.push({ type: 'task', text: action.text, date });
        }

        if (action.type === 'add_note' && action.text) {
            // Ищем папку по названию (регистронезависимо)
            const folderName = action.folder || 'Дом';
            let folder = AppData.notesFolders.find(f =>
                f.name.toLowerCase() === folderName.toLowerCase()
            );
            // Если не нашли — берём первую папку
            if (!folder && AppData.notesFolders.length > 0) {
                folder = AppData.notesFolders[0];
            }
            if (folder) {
                folder.notes.push({
                    id: createId(),
                    title: action.title || action.text.slice(0, 30),
                    text: action.text,
                    done: false
                });
                added.push({ type: 'note', text: action.text, folder: folder.name });
            }
        }

        if (action.type === 'add_microtask' && action.text && action.goal) {
            const goalQuery = action.goal.toLowerCase();
            const goal = AppData.goals.find(g =>
                g.title.toLowerCase().includes(goalQuery) ||
                goalQuery.includes(g.title.toLowerCase())
            );
            if (goal) {
                if (!goal.microtasks) goal.microtasks = [];
                goal.microtasks.push({ id: createId(), text: action.text, done: false });
                recalculateGoalProgress(goal);
                added.push({ type: 'microtask', text: action.text, goalTitle: goal.title });
            }
        }

        if (action.type === 'clean_tasks') {
            // Удаляем задачи, которые не содержат ни одной буквы (мусор, случайные символы)
            const isJunk = (text) => {
                const letters = (text || '').match(/[а-яёa-zА-ЯЁA-Z]/g) || [];
                return letters.length < 2;
            };
            const dates = action.dates || [activeDate];
            let totalRemoved = 0;
            dates.forEach(date => {
                const before = (AppData.tasksByDate[date] || []).length;
                AppData.tasksByDate[date] = (AppData.tasksByDate[date] || []).filter(t => !isJunk(t.text));
                totalRemoved += before - AppData.tasksByDate[date].length;
            });
            if (totalRemoved > 0) added.push({ type: 'cleaned', count: totalRemoved });
        }

        if (action.type === 'add_media' && action.title) {
            const tabAliases = {
                'books': 'books', 'книги': 'books', 'книга': 'books',
                'movies': 'movies', 'фильмы': 'movies', 'фильм': 'movies',
                'series': 'series', 'сериалы': 'series', 'сериал': 'series'
            };
            const tab = tabAliases[(action.tab || '').toLowerCase()] || 'movies';
            if (!AppData.media[tab]) AppData.media[tab] = [];
            AppData.media[tab].push({ id: createId(), title: action.title });
            const tabNames = { books: 'Книги 📚', movies: 'Фильмы 🎬', series: 'Сериалы 🍿' };
            added.push({ type: 'media', title: action.title, tabLabel: tabNames[tab] || tab });
        }

        if (action.type === 'move_task' && action.text && action.to) {
            const fromDate = action.from || activeDate;
            const fromTasks = AppData.tasksByDate[fromDate] || [];
            const query = action.text.toLowerCase();
            const idx = fromTasks.findIndex(t =>
                t.text.toLowerCase().includes(query) || query.includes(t.text.toLowerCase())
            );
            if (idx !== -1) {
                const [task] = fromTasks.splice(idx, 1);
                if (!AppData.tasksByDate[action.to]) AppData.tasksByDate[action.to] = [];
                AppData.tasksByDate[action.to].push({ ...task, done: false });
                added.push({ type: 'moved_task', text: task.text, from: fromDate, to: action.to });
            }
        }
    });

    if (added.length > 0) {
        saveDb();
        renderDailyPlan();
        setupCalendar();
        renderNotes();
        renderGoalsWidget();
        renderMedia();
    }

    return added;
}

// Форматируем дату для отображения пользователю
function formatDateForUser(dateStr) {
    const date = parseDateString(dateStr);
    if (!date) return dateStr;
    const today = getTodayString();
    const tomorrow = formatDateLocal(new Date(Date.now() + 86400000));
    if (dateStr === today) return 'сегодня';
    if (dateStr === tomorrow) return 'завтра';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

// Показываем карточки предложений
function showSuggestions(suggestions) {
    pendingSuggestions = suggestions;
    const zone = document.getElementById('suggestionsZone');
    const list = document.getElementById('suggestionsList');
    if (!zone || !list) return;

    list.innerHTML = '';
    suggestions.forEach((text, index) => {
        const card = document.createElement('div');
        card.className = 'suggestion-card';
        card.id = `suggestion-${index}`;
        card.innerHTML = `
            <span class="text-sm text-gray-800 flex-1">${escapeHtml(text)}</span>
            <div class="flex gap-2 shrink-0">
                <button class="px-3 py-1 bg-teal-500/20 text-teal-700 rounded-full text-xs font-bold active:scale-90 transition-transform hover:bg-teal-500/30">
                    + В план
                </button>
                <button class="px-2 py-1 text-gray-400 rounded-full text-xs active:scale-90 transition-transform hover:text-gray-600">
                    ✕
                </button>
            </div>
        `;
        card.querySelector('button:first-of-type').addEventListener('click', () => acceptSuggestion(index, text));
        card.querySelector('button:last-of-type').addEventListener('click', () => dismissSuggestion(index));
        list.appendChild(card);
    });

    zone.classList.remove('hidden');
}

// Принять предложение — добавить в план дня
function acceptSuggestion(index, text) {
    if (!AppData.tasksByDate[activeDate]) AppData.tasksByDate[activeDate] = [];
    AppData.tasksByDate[activeDate].push({ id: createId(), text, done: false });
    saveDb();
    renderDailyPlan();
    setupCalendar();

    // Визуально помечаем карточку как принятую
    const card = document.getElementById(`suggestion-${index}`);
    if (card) {
        card.classList.add('accepted');
        card.querySelector('button:first-of-type').innerText = '✓ Добавлено';
    }

    // Сообщаем ИИ что задача принята
    addMessage('assistant', `✅ Добавила в план: "${text}"`);
}

// Отклонить предложение
function dismissSuggestion(index) {
    const card = document.getElementById(`suggestion-${index}`);
    if (card) card.remove();

    // Если все карточки убраны — скрываем зону
    const list = document.getElementById('suggestionsList');
    if (list && list.children.length === 0) {
        document.getElementById('suggestionsZone')?.classList.add('hidden');
    }
}

// Голосовой ответ ИИ (SpeechSynthesis)
function speakText(text) {
    if (!('speechSynthesis' in window)) return;
    if (isSpeaking) window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Пробуем найти русский голос
    const voices = window.speechSynthesis.getVoices();
    const ruVoice = voices.find(v => v.lang.startsWith('ru'));
    if (ruVoice) utterance.voice = ruVoice;

    utterance.onstart = () => { isSpeaking = true; };
    utterance.onend = () => { isSpeaking = false; };
    utterance.onerror = () => { isSpeaking = false; };

    window.speechSynthesis.speak(utterance);
}

// Переключатель голосового ответа
function toggleVoiceReply() {
    isVoiceReplyEnabled = !isVoiceReplyEnabled;
    const btn = document.getElementById('voiceReplyBtn');
    if (!btn) return;

    if (isVoiceReplyEnabled) {
        btn.innerHTML = '<i data-lucide="volume-2" class="w-5 h-5 text-teal-500"></i>';
        btn.title = 'Голосовой ответ включён';
    } else {
        btn.innerHTML = '<i data-lucide="volume-x" class="w-5 h-5"></i>';
        btn.title = 'Голосовой ответ выключен';
        if (isSpeaking) window.speechSynthesis.cancel();
    }
    lucide.createIcons();
}

// Открываем чат — загружаем историю и при первом открытии запрашиваем план
function openAiChat() {
    loadChatHistory();
    renderChatHistory();
    openPanel('aiChatPanel');

    // Если история пуста — приветствие с анализом целей
    if (chatHistory.length === 0) {
        setTimeout(() => greetUser(), 600);
    }

    // Фокус на поле ввода
    setTimeout(() => document.getElementById('chatInput')?.focus(), 400);
}

// Автоматическое приветствие при первом открытии
async function greetUser() {
    const serverUrl = localStorage.getItem('server_url');
    if (!serverUrl) {
        addMessage('assistant', 'Привет! 👋 Я ваш личный планировщик-помощник. Для начала работы укажите адрес сервера в Настройках — это займёт минуту.');
        return;
    }

    const statusEl = document.getElementById('aiStatusText');
    if (statusEl) statusEl.innerText = 'Анализирую ваши цели...';
    showTypingIndicator();

    try {
        const result = await sendToAI(
            'Поздоровайся и кратко проанализируй мои текущие цели и план на сегодня. Если есть задачи на сегодня — похвали за активность. Если плана нет — предложи 2-3 конкретных шага по ближайшей цели с дедлайном. Будь краткой и дружелюбной. Не добавляй задачи сама — только предлагай.',
            []
        );
        hideTypingIndicator();
        const rawReply = result.reply || 'Привет! Готова помочь с планированием.';
        const { text: replyText } = parseAIResponse(rawReply);
        addMessage('assistant', replyText || rawReply);
        if (statusEl) statusEl.innerText = 'Готов помочь';
        if (isVoiceReplyEnabled) speakText(replyText || rawReply);
    } catch {
        hideTypingIndicator();
        addMessage('assistant', 'Привет! 👋 Готова помочь с планированием. Что делаем сегодня?');
        if (statusEl) statusEl.innerText = 'Готов помочь';
    }
}

// Переопределяем старую функцию отправки ИИ-запроса —
// теперь она открывает чат вместо модала
sendAiRequest = function sendAiRequestNew() {
    const input = document.getElementById('aiTaskInput');
    const val = input?.value.trim();
    input && (input.value = '');
    collapseToMicOnly();
    openAiChat();

    // Если был текст — сразу отправляем его
    if (val) {
        setTimeout(() => {
            const chatInput = document.getElementById('chatInput');
            if (chatInput) {
                chatInput.value = val;
                sendChatMessage();
            }
        }, 400);
    }
}

// Enter в поле чата
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('chatInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
    });
});

/* ==============================================
   УПРАВЛЕНИЕ ПРОФИЛЯМИ ПОЛЬЗОВАТЕЛЕЙ
   ============================================== */
const PROFILE_EMOJIS = ['👩','👨','👧','👦','👵','👴','🧑','🐱','🦊','🌸','⭐','🎯','🌙','🎀','🎵'];
let selectedProfileEmoji = PROFILE_EMOJIS[0];
let isFirstTimeProfile    = false;

function updateProfileDisplay() {
    const profiles = loadProfiles();
    const pid      = getActiveProfileId();
    const profile  = profiles.find(p => p.id === pid);
    if (!profile) return;
    // Обновляем отображение активного профиля в панели профиля
    const upEmoji = document.getElementById('upEmoji');
    const upName  = document.getElementById('upName');
    if (upEmoji) upEmoji.innerText = profile.emoji;
    if (upName)  upName.innerText  = profile.name;
}

function showProfileSelector() {
    const profiles = loadProfiles();
    const pid      = getActiveProfileId();
    const list     = document.getElementById('profileList');
    list.innerHTML = '';

    profiles.forEach(p => {
        const card = document.createElement('div');
        card.className = `profile-card ${p.id === pid ? 'active-profile' : ''}`;
        card.innerHTML = `
            <div class="text-4xl mb-1">${p.emoji}</div>
            <div class="font-bold text-gray-800 text-xs truncate leading-snug">${escapeHtml(p.name)}</div>
            ${profiles.length > 1 ? `<button class="js-del-profile mt-1 text-[10px] text-red-400 active:scale-75 leading-none">✕</button>` : ''}
        `;
        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('js-del-profile')) return;
            switchToProfile(p.id);
        });
        card.querySelector('.js-del-profile')?.addEventListener('click', (e) => {
            e.stopPropagation();
            confirmDeleteProfile(p.id);
        });
        list.appendChild(card);
    });

    document.getElementById('profileSelectorModal').classList.remove('hidden');
}

function closeProfileSelector() {
    document.getElementById('profileSelectorModal').classList.add('hidden');
}

function switchToProfile(profileId) {
    if (profileId === getActiveProfileId()) { closeProfileSelector(); return; }
    closeProfileSelector();
    setActiveProfileId(profileId);
    applyActiveProfile();
    loadAppData();
    currentFolderId = AppData.notesFolders[0]?.id || '';
    applyInitialSettings();
    renderGoalsWidget();
    renderDailyPlan();
    setupCalendar();
    renderFolders();
    renderNotes();
    renderMedia();
    updateProfileDisplay();
    // Перезагружаем историю чата для нового профиля
    loadChatHistory();
}

function showProfileCreation(firstTime = false) {
    isFirstTimeProfile    = firstTime;
    selectedProfileEmoji  = PROFILE_EMOJIS[0];

    const cancelBtn = document.getElementById('profileCreationCancelBtn');
    if (cancelBtn) cancelBtn.classList.toggle('hidden', firstTime);

    const picker = document.getElementById('emojiPicker');
    picker.innerHTML = '';
    PROFILE_EMOJIS.forEach(emoji => {
        const btn = document.createElement('div');
        btn.className = `emoji-option ${emoji === selectedProfileEmoji ? 'selected' : ''}`;
        btn.innerText = emoji;
        btn.addEventListener('click', () => {
            selectedProfileEmoji = emoji;
            picker.querySelectorAll('.emoji-option').forEach(el => el.classList.remove('selected'));
            btn.classList.add('selected');
        });
        picker.appendChild(btn);
    });

    document.getElementById('profileNameInput').value = '';
    document.getElementById('profileCreationModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('profileNameInput').focus(), 100);
}

function cancelProfileCreation() {
    document.getElementById('profileCreationModal').classList.add('hidden');
    if (!isFirstTimeProfile) showProfileSelector();
}

function confirmCreateProfile() {
    const name = document.getElementById('profileNameInput').value.trim();
    if (!name) {
        const el = document.getElementById('profileNameInput');
        el.classList.add('voice-listening');
        setTimeout(() => el.classList.remove('voice-listening'), 450);
        return;
    }
    const profiles   = loadProfiles();
    const newProfile = { id: `p_${createId()}`, name, emoji: selectedProfileEmoji };
    profiles.push(newProfile);
    saveProfiles(profiles);
    document.getElementById('profileCreationModal').classList.add('hidden');
    setActiveProfileId(newProfile.id);

    if (isFirstTimeProfile) {
        initApp();
    } else {
        switchToProfile(newProfile.id);
    }
}

function confirmDeleteProfile(profileId) {
    const profiles = loadProfiles();
    const profile  = profiles.find(p => p.id === profileId);
    if (!profile) return;
    showAppDialog({
        title: 'Удалить профиль?',
        message: `Все данные профиля "${profile.name}" будут удалены без возможности восстановления.`,
        confirmText: 'Удалить',
        danger: true,
        onConfirm: () => {
            const updated = profiles.filter(p => p.id !== profileId);
            saveProfiles(updated);
            localStorage.removeItem(`smart_planner_db_${profileId}`);
            localStorage.removeItem(`smart_planner_chat_${profileId}`);
            if (profileId === getActiveProfileId() && updated.length > 0) {
                setActiveProfileId(updated[0].id);
                switchToProfile(updated[0].id);
            } else {
                closeProfileSelector();
                if (updated.length > 0) showProfileSelector();
            }
        }
    });
}

/* ==============================================
   ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ (данные для ИИ)
   ============================================== */
function openUserProfile() {
    // Показываем активный профиль (смена аккаунта)
    const profiles = loadProfiles();
    const pid      = getActiveProfileId();
    const profile  = profiles.find(p => p.id === pid);
    const upEmoji  = document.getElementById('upEmoji');
    const upName   = document.getElementById('upName');
    if (upEmoji) upEmoji.innerText = profile?.emoji || '👤';
    if (upName)  upName.innerText  = profile?.name  || '—';

    // Заполняем данные для ИИ
    const p = AppData.settings.userProfile || {};
    const nameEl    = document.getElementById('upNameInput');
    const ageEl     = document.getElementById('upAgeInput');
    const occupEl   = document.getElementById('upOccupationInput');
    const contextEl = document.getElementById('upContextInput');
    if (nameEl)    nameEl.value    = p.name       || '';
    if (ageEl)     ageEl.value     = p.age        || '';
    if (occupEl)   occupEl.value   = p.occupation || '';
    if (contextEl) contextEl.value = p.context    || '';
    openPanel('userProfilePanel');
}

function saveUserProfile() {
    const name     = document.getElementById('upNameInput')?.value.trim();
    const age      = document.getElementById('upAgeInput')?.value.trim();
    const occupEl  = document.getElementById('upOccupationInput');
    const ctxEl    = document.getElementById('upContextInput');

    if (!name || !age) {
        showAppDialog({
            title: 'Заполните обязательные поля',
            message: 'Имя и возраст обязательны — они помогают ИИ правильно к вам обращаться.',
            confirmText: 'Понятно',
            cancelText: null
        });
        return;
    }

    AppData.settings.userProfile = {
        name,
        age,
        occupation: occupEl?.value.trim() || '',
        context:    ctxEl?.value.trim()   || ''
    };
    saveDb();
    closePanel('userProfilePanel');
}
