const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDOM, createClock, flush } = require('./browser.cjs');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
const SELECTORS = {
    chat: '[data-target-id="youchat_messages_section"]',
    open: 'ytd-watch-flexy[fullscreen] .you-chat-entrypoint-button button',
    close: 'ytd-watch-flexy[fullscreen] #visibility-button button',
    input: '.chatInputViewModelChatInputForm .chatInputViewModelChatInput',
    timestamp: '.ytwMarkdownDivTimestamp',
};

function loadContent({ pageLanguage = '', languages = [], language = '', debug = false,
    logToFile = false, fillGrows = true, storedSettings, storageError, deliveryError, deliveryThrows } = {}) {
    const dom = createDOM();
    const clock = createClock();
    const { document, HTMLElement } = dom;
    document.documentElement.lang = pageLanguage;
    const container = new HTMLElement();
    document.queries.set('#player-container', [container]);
    const logs = [];
    const deliveries = [];
    const settingsListeners = [];
    const chrome = {
        runtime: {
            sendMessage(message, callback) {
                if (deliveryThrows) throw new Error(deliveryThrows);
                deliveries.push(message);
                chrome.runtime.lastError = deliveryError && { message: deliveryError };
                try { callback(); } finally { delete chrome.runtime.lastError; }
            },
        },
        storage: {
            local: {
                get(defaults, callback) {
                    const key = Object.keys(defaults)[0];
                    chrome.runtime.lastError = storageError;
                    try { callback(storedSettings === undefined ? defaults : { [key]: storedSettings }); }
                    finally { delete chrome.runtime.lastError; }
                },
            },
            onChanged: { addListener(listener) { settingsListeners.push(listener); } },
        },
    };
    const context = vm.createContext({ ...dom, ...clock, Error, URL, chrome,
        navigator: { languages, language },
        console: Object.fromEntries(['log', 'warn', 'error', 'debug'].map(level => [
            level, (...args) => logs.push({ level, args }),
        ])),
    });
    const init = '\ninit();\n})();';
    assert.ok(source.includes(init), 'test harness must replace extension initialization');
    vm.runInContext(settingsSource, context, { filename: path.join(root, 'settings.js') });
    vm.runInContext(source
        // Keep offsets identical across flag variants for V8 coverage merging.
        .replace('const LOG_TO_FILE = true;', `const LOG_TO_FILE = ${String(logToFile).padEnd(5)};`)
        .replace('const FILL_GROWS = true;', `const FILL_GROWS = ${String(fillGrows).padEnd(5)};`)
        .replace(init, `
globalThis.extension = {
    detectUserLanguage, getTranslations, getTimestampPrompt, isSponsorLine,
    parseSegments, collectExistingSponsorLines, updateSkipButton, watchForAnswer,
    loadSettings, bindSettingsChanges, timestamps, scheduleChatClose, closeChat,
    waitForElement, sendPrompt, setTextInputValue, getStartBlockReasons,
    bindPlayerEvents, bindCurrentOrFutureVideo, bindFullscreenChange,
    bindNavigationEvents, bindShortcuts, bindGlobalErrorLogging, reset, start, init,
    log, logWarn, logError, serializeLogValue, shouldLogThrottled, getLogState,
    get language() { return userLanguage; },
    get button() { return skipButton; },
    get settings() { return settings; },
    get state() { return { runId, started, currentVideoSrc, activePlayer, segments, chatOpenAttemptCount }; },
    setSegments(value) { segments = value; },
    setActivePlayer(value) { activePlayer = value; },
    ignoreExistingLines() { ignoredSponsorLines = collectExistingSponsorLines(); },
};
})();`), context, { filename: path.join(root, 'content.js') });
    context.extension.settings.debug = debug;

    function setChat(lines) {
        const nodes = lines.map(({ text, times = [] }) => {
            const node = new HTMLElement('li', text);
            node.queries.set(SELECTORS.timestamp, times.map(time => {
                const stamp = new HTMLElement('span');
                if (time !== null) stamp.setAttribute('data-time', time);
                return stamp;
            }));
            return node;
        });
        const chat = document.querySelector(SELECTORS.chat) || new HTMLElement();
        chat.textContent = lines.map(line => line.text).join(' ');
        chat.queries.set('li, p', nodes);
        chat.queries.set(SELECTORS.timestamp, nodes.flatMap(node => node.querySelectorAll(SELECTORS.timestamp)));
        document.queries.set(SELECTORS.chat, [chat]);
        return chat;
    }
    function changeSettings(value, area = 'local') {
        const key = context.YtAdSkipSettings.STORAGE_KEY;
        settingsListeners.forEach(listener => listener({ [key]: { newValue: value } }, area));
    }
    function mount(selector, element) { document.queries.set(selector, element ? [element] : []); return element; }
    function fullscreen() { return (document.fullscreenElement = new HTMLElement()); }
    function video(properties = {}) { return Object.assign(new dom.HTMLMediaElement(), properties); }
    return { ...dom, ...clock, extension: context.extension, context, chrome, container,
        setChat, changeSettings, mount, fullscreen, video, logs, deliveries, flush, SELECTORS };
}

module.exports = { loadContent };
