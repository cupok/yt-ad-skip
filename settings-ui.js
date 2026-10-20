/* global chrome */
(() => {
    const { STORAGE_KEY, FIELDS, DEFAULTS, normalize } = globalThis.YtAutoTimestampsSettings;
    const TRANSLATIONS = {
        en: {
            title: 'Settings', intro: 'Adjust the timing. All values are in seconds.',
            advanced: 'Advanced timing', save: 'Save settings', reset: 'Reset defaults',
            logs: 'Troubleshooting', export: 'Export logs',
            saved: 'Saved. New timers will use these settings.',
            restored: 'Default settings restored.', loadError: 'Could not load settings. Reopen this window to try again.',
            saveError: 'Could not save settings. Please try again.',
            exported: 'Log export requested.', exportError: 'Could not export logs. Please try again.',
            chatOpenDelay: ['Open chat after', 'Wait before opening the timestamp chat.'],
            closeDelay: ['Close chat after', 'Wait after timestamps are found before closing the chat.'],
            autoSkipDelay: ['Automatically skip after', 'Set to 0 to turn off automatic skipping.'],
            chatOpenRetryDelay: ['Retry opening chat after', 'Wait before trying again if the chat button is unavailable.'],
            chatTextareaTimeout: ['Wait for chat input', 'Maximum wait for the chat input or answer panel to appear.'],
            answerTimeout: ['Wait for an answer', 'Maximum wait for timestamp results.'],
            answerStableDelay: ['Answer settling delay', 'Wait for a pause in the response before reading timestamps.'],
        },
        uk: {
            title: 'Налаштування', intro: 'Налаштуйте затримки. Усі значення в секундах.',
            advanced: 'Додаткові затримки', save: 'Зберегти', reset: 'Відновити типові',
            logs: 'Діагностика', export: 'Експортувати журнал',
            saved: 'Збережено. Нові таймери використовуватимуть ці налаштування.',
            restored: 'Типові налаштування відновлено.', loadError: 'Не вдалося завантажити налаштування. Відкрийте це вікно знову.',
            saveError: 'Не вдалося зберегти налаштування. Спробуйте ще раз.',
            exported: 'Експорт журналу запитано.', exportError: 'Не вдалося експортувати журнал. Спробуйте ще раз.',
            chatOpenDelay: ['Відкрити чат через', 'Затримка перед відкриттям чату з часовими мітками.'],
            closeDelay: ['Закрити чат через', 'Затримка після отримання часових міток перед закриттям чату.'],
            autoSkipDelay: ['Автоматично пропустити через', 'Установіть 0, щоб вимкнути автоматичне пропускання.'],
            chatOpenRetryDelay: ['Повторити відкриття через', 'Затримка перед повторною спробою, якщо кнопка чату недоступна.'],
            chatTextareaTimeout: ['Очікування поля чату', 'Максимальний час очікування поля введення або панелі відповіді.'],
            answerTimeout: ['Очікування відповіді', 'Максимальний час очікування часових міток.'],
            answerStableDelay: ['Пауза перед обробкою', 'Очікування паузи у відповіді перед зчитуванням часових міток.'],
        },
        ru: {
            title: 'Настройки', intro: 'Настройте задержки. Все значения в секундах.',
            advanced: 'Дополнительные задержки', save: 'Сохранить', reset: 'Сбросить настройки',
            logs: 'Диагностика', export: 'Экспортировать журнал',
            saved: 'Сохранено. Новые таймеры будут использовать эти настройки.',
            restored: 'Настройки по умолчанию восстановлены.', loadError: 'Не удалось загрузить настройки. Откройте это окно снова.',
            saveError: 'Не удалось сохранить настройки. Попробуйте ещё раз.',
            exported: 'Экспорт журнала запрошен.', exportError: 'Не удалось экспортировать журнал. Попробуйте ещё раз.',
            chatOpenDelay: ['Открыть чат через', 'Задержка перед открытием чата с временными метками.'],
            closeDelay: ['Закрыть чат через', 'Задержка после получения временных меток перед закрытием чата.'],
            autoSkipDelay: ['Автоматически пропустить через', 'Установите 0, чтобы отключить автоматический пропуск.'],
            chatOpenRetryDelay: ['Повторить открытие через', 'Задержка перед повторной попыткой, если кнопка чата недоступна.'],
            chatTextareaTimeout: ['Ожидание поля чата', 'Максимальное время ожидания поля ввода или панели ответа.'],
            answerTimeout: ['Ожидание ответа', 'Максимальное время ожидания временных меток.'],
            answerStableDelay: ['Пауза перед обработкой', 'Ожидание паузы в ответе перед чтением временных меток.'],
        },
    };
    const language = [...(navigator.languages || []), navigator.language]
        .map(value => String(value || '').toLowerCase().split(/[-_]/)[0])
        .find(value => Object.prototype.hasOwnProperty.call(TRANSLATIONS, value)) || 'en';
    const messages = TRANSLATIONS[language];
    const form = document.querySelector('#settings-form');
    const fields = document.querySelector('#settings-fields');
    const status = document.querySelector('#status');
    const exportButton = document.querySelector('#export');

    document.documentElement.lang = language;
    document.title = `YT Auto Timestamps · ${messages.title}`;
    document.querySelectorAll('[data-i18n]').forEach(element => {
        element.textContent = messages[element.dataset.i18n];
    });

    for (const [key, field] of Object.entries(FIELDS)) {
        const row = document.createElement('div');
        row.className = 'field';
        const text = document.createElement('div');
        const label = document.createElement('label');
        label.htmlFor = key;
        label.textContent = messages[key][0];
        const hint = document.createElement('p');
        hint.id = `${key}-hint`;
        hint.textContent = messages[key][1];
        text.append(label, hint);
        const input = document.createElement('input');
        input.id = key;
        input.name = key;
        input.type = 'number';
        input.min = String(field.min / 1000);
        input.max = String(field.max / 1000);
        input.step = '0.1';
        input.required = true;
        input.setAttribute('aria-describedby', hint.id);
        row.append(text, input);
        document.querySelector(['chatOpenDelay', 'closeDelay', 'autoSkipDelay'].includes(key)
            ? '#main-fields' : '#advanced-fields').append(row);
    }

    function showStatus(message, error = false) {
        status.textContent = message;
        status.dataset.error = String(error);
    }

    function populate(values) {
        for (const key of Object.keys(FIELDS)) {
            form.elements.namedItem(key).value = String(values[key] / 1000);
        }
    }

    function save(values, message) {
        fields.disabled = true;
        chrome.storage.local.set({ [STORAGE_KEY]: values }, () => {
            const error = chrome.runtime.lastError;
            fields.disabled = false;
            if (error) {
                showStatus(messages.saveError, true);
                return;
            }
            populate(values);
            showStatus(message);
        });
    }

    form.addEventListener('input', () => showStatus(''));
    form.addEventListener('invalid', event => {
        const advanced = event.target.closest('details');
        if (advanced) {
            advanced.open = true;
        }
    }, true);
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity()) {
            return;
        }
        const values = Object.fromEntries(Object.keys(FIELDS).map(key => [
            key, Math.round(Number(form.elements.namedItem(key).value) * 1000),
        ]));
        save(normalize(values), messages.saved);
    });
    document.querySelector('#reset').addEventListener('click', () => save({ ...DEFAULTS }, messages.restored));
    exportButton.addEventListener('click', () => {
        exportButton.disabled = true;
        chrome.runtime.sendMessage({ type: 'YT_AUTO_TIMESTAMPS_EXPORT_LOG' }, response => {
            const error = chrome.runtime.lastError;
            exportButton.disabled = false;
            showStatus(error || !response?.ok ? messages.exportError : messages.exported, Boolean(error || !response?.ok));
        });
    });

    populate(DEFAULTS);
    chrome.storage.local.get({ [STORAGE_KEY]: DEFAULTS }, result => {
        const error = chrome.runtime.lastError;
        if (error) {
            showStatus(messages.loadError, true);
            return;
        }
        populate(normalize(result[STORAGE_KEY]));
        fields.disabled = false;
    });
})();
