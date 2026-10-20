const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8');

function loadContent({ pageLanguage = '', languages = [], language = '', debug = false, storedSettings, storageError } = {}) {
    class Element {
        constructor(text = '') {
            this.textContent = text;
            this.tagName = 'DIV';
            this.style = {};
            this.isConnected = true;
        }
        getAttribute() { return null; }
        querySelectorAll() { return []; }
        appendChild(child) { child.parentElement = this; }
    }
    class HTMLElement extends Element {}
    class HTMLMediaElement extends HTMLElement {}

    const logs = [];
    const timers = new Map();
    const observers = [];
    const settingsListeners = [];
    let nextTimerId = 0;
    const container = new HTMLElement();
    const document = {
        documentElement: { lang: pageLanguage },
        fullscreenElement: null,
        chat: null,
        querySelector(selector) {
            return selector === '#player-container' ? container : this.chat;
        },
        createElement() { return new HTMLElement(); },
    };
    const context = {
        console: Object.fromEntries(['log', 'warn', 'error', 'debug'].map(level => [
            level, (...args) => logs.push({ level, args }),
        ])),
        document,
        navigator: { languages, language },
        chrome: {
            runtime: { lastError: storageError },
            storage: {
                local: {
                    get(defaults, callback) {
                        const key = Object.keys(defaults)[0];
                        callback(storedSettings === undefined ? defaults : { [key]: storedSettings });
                    },
                },
                onChanged: { addListener(listener) { settingsListeners.push(listener); } },
            },
        },
        window: { location: { href: 'https://www.youtube.com/watch?v=test' } },
        Element,
        HTMLElement,
        HTMLMediaElement,
        Event: class {},
        MutationObserver: class {
            constructor() { this.disconnected = false; observers.push(this); }
            observe() {}
            disconnect() { this.disconnected = true; }
        },
        URL,
        setTimeout(callback, delay) {
            const id = ++nextTimerId;
            timers.set(id, { callback, delay });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
    };
    const init = '\ninit();\n})();';
    assert.ok(source.includes(init), 'test harness must replace extension initialization');
    vm.createContext(context);
    vm.runInContext(settingsSource, context);
    vm.runInContext(source
        .replace('const DEBUG = true;', `const DEBUG = ${debug};`)
        .replace('const LOG_TO_FILE = true;', 'const LOG_TO_FILE = false;')
        .replace(init, `
globalThis.extension = {
    detectUserLanguage, getTranslations, getTimestampPrompt, isSponsorLine,
    parseSegments, collectExistingSponsorLines, updateSkipButton, watchForAnswer,
    loadSettings, bindSettingsChanges, timestamps, scheduleChatClose,
    get language() { return userLanguage; },
    get button() { return skipButton; },
    get settings() { return settings; },
    setSegments(value) { segments = value; },
    setActivePlayer(value) { activePlayer = value; },
    ignoreExistingLines() { ignoredSponsorLines = collectExistingSponsorLines(); },
};
})();`), context);

    function setChat(lines) {
        const nodes = lines.map(({ text, times }) => {
            const node = new Element(text);
            node.querySelectorAll = () => times.map(time => ({ getAttribute: () => String(time) }));
            return node;
        });
        const chat = new Element(lines.map(line => line.text).join(' '));
        chat.querySelectorAll = selector => selector === 'li, p'
            ? nodes
            : nodes.flatMap(node => node.querySelectorAll(selector));
        document.chat = chat;
    }

    function runTimers(delay) {
        for (const [id, timer] of [...timers]) {
            if (timer.delay === delay) {
                timers.delete(id);
                timer.callback();
            }
        }
    }

    function changeSettings(value, area = 'local') {
        const key = context.YtAutoTimestampsSettings.STORAGE_KEY;
        settingsListeners.forEach(listener => listener({ [key]: { newValue: value } }, area));
    }

    return { extension: context.extension, document, HTMLMediaElement, setChat, logs, timers, observers, runTimers, changeSettings };
}

test('YouTube language takes priority over browser preferences', () => {
    const { extension } = loadContent({ pageLanguage: 'uk-UA', languages: ['ru', 'en'] });
    assert.equal(extension.language, 'uk-UA');
    assert.equal(extension.getTranslations().skip, 'Пропустити сегмент');
});

test('language detection normalizes region tags and skips unsupported preferences', () => {
    const { extension } = loadContent({ pageLanguage: 'de', languages: ['fr', 'ru_RU', 'en'] });
    assert.equal(extension.language, 'ru-RU');
    assert.equal(extension.getTranslations().skip, 'Пропустить сегмент');
});

test('malformed and missing preferences fall back safely', () => {
    assert.equal(loadContent({ pageLanguage: 'not a locale', language: 'uk' }).extension.language, 'uk');
    assert.equal(loadContent({ pageLanguage: 'fr', languages: ['de'] }).extension.language, 'en');
    assert.equal(loadContent().extension.language, 'en');
});

test('detection reads updated YouTube language after navigation', () => {
    const { extension, document } = loadContent({ pageLanguage: 'en' });
    document.documentElement.lang = 'ru';
    assert.equal(extension.detectUserLanguage(), 'ru');
});

for (const [language, skip, sponsor] of [
    ['en-US', 'Skip segment', 'Sponsor segment'],
    ['uk-UA', 'Пропустити сегмент', 'Спонсорський сегмент'],
    ['ru-RU', 'Пропустить сегмент', 'Спонсорский сегмент'],
]) {
    test(`${language}: prompt requests user language with a stable sponsor marker`, () => {
        const { extension } = loadContent({ pageLanguage: language });
        const prompt = extension.getTimestampPrompt();
        assert.ok(prompt.includes(`"${language}"`));
        assert.ok(prompt.includes(`[SPONSOR] ${sponsor}: (START – END)`));
        assert.ok(prompt.includes('ASCII digits'));
    });

    test(`${language}: localized sponsor lines produce skippable ranges`, () => {
        const { extension, setChat } = loadContent({ pageLanguage: language });
        setChat([
            { text: `${sponsor}: (0:30 – 1:00)`, times: [30, 60] },
            { text: '[SPONSOR] (2:00 – 2:30)', times: [120, 150] },
            { text: 'Introduction (0:00 – 0:30)', times: [0, 30] },
            { text: `${sponsor}: invalid range`, times: [90, 60] },
            { text: `${sponsor}: incomplete range`, times: [30] },
        ]);
        assert.equal(JSON.stringify(extension.parseSegments()), JSON.stringify([
            { start: 30, end: 60 },
            { start: 120, end: 150 },
        ]));
    });

    test(`${language}: skip button uses the user's language and preserves seeking`, () => {
        const { extension, HTMLMediaElement } = loadContent({ pageLanguage: language });
        const video = new HTMLMediaElement();
        video.currentTime = 45;
        video.duration = 600;
        extension.setSegments([{ start: 30, end: 60 }]);
        extension.updateSkipButton(video);
        assert.equal(extension.button.textContent, `${skip} → 1:00`);
        assert.equal(extension.button.lang, language);
        assert.equal(extension.button.style.display, 'block');
        extension.button.onclick();
        assert.equal(video.currentTime, 60);
        assert.equal(extension.button.style.display, 'none');
    });
}

test('existing localized answers are ignored when parsing a new response', () => {
    const { extension, setChat } = loadContent({ pageLanguage: 'uk' });
    const oldLine = { text: 'Спонсорський сегмент: (0:30 – 1:00)', times: [30, 60] };
    setChat([oldLine]);
    extension.ignoreExistingLines();
    setChat([oldLine, { text: '[SPONSOR] Новий сегмент (2:00 – 2:30)', times: [120, 150] }]);
    assert.equal(JSON.stringify(extension.parseSegments()), JSON.stringify([{ start: 120, end: 150 }]));
});

test('sponsor labels respect Unicode word boundaries', () => {
    const { extension } = loadContent();
    assert.equal(extension.isSponsorLine('СПОНСОРСЬКИЙ СЕГМЕНТ: (0:30 – 1:00)'), true);
    assert.equal(extension.isSponsorLine('спонсорский сегмент: (0:30 – 1:00)'), true);
    assert.equal(extension.isSponsorLine('неспонсорський сегмент: (0:30 – 1:00)'), false);
    assert.equal(extension.isSponsorLine('неспонсорский сегмент: (0:30 – 1:00)'), false);
    assert.equal(extension.isSponsorLine('sponsorship discussion'), false);
});

test('an empty answer logs at info level and keeps watching for the response', async () => {
    const { extension, setChat, logs, observers, timers, runTimers } = loadContent({ debug: true });
    setChat([]);
    await extension.watchForAnswer(0);
    runTimers(1200);
    assert.ok(logs.some(({ level, args }) => level === 'log' && args[1] === 'answer parse produced no sponsor segments'));
    assert.equal(logs.some(({ level }) => level === 'warn' || level === 'error'), false);
    assert.equal(observers[0].disconnected, false);
    assert.ok([...timers.values()].some(({ delay }) => delay === 30000));
});

test('an answer without sponsors closes normally without warning', async () => {
    const { extension, setChat, logs, observers, timers, runTimers } = loadContent({ debug: true });
    setChat([{ text: 'Introduction (0:00)', times: [0] }]);
    await extension.watchForAnswer(0);
    runTimers(1200);
    assert.equal(logs.some(({ level }) => level === 'warn' || level === 'error'), false);
    assert.equal(observers[0].disconnected, true);
    assert.ok([...timers.values()].some(({ delay }) => delay === 10000));
    assert.equal([...timers.values()].some(({ delay }) => delay === 30000), false);
});

test('an answer timeout still reports a warning', async () => {
    const { extension, setChat, logs, runTimers } = loadContent({ debug: true });
    setChat([]);
    await extension.watchForAnswer(0);
    runTimers(30000);
    assert.ok(logs.some(({ level, args }) => level === 'warn' && args[1] === 'answer timeout'));
});

test('saved settings control chat opening, closing, and response timers', async () => {
    const { extension, timers, setChat } = loadContent({ storedSettings: {
        chatOpenDelay: 2500, closeDelay: 3000, answerStableDelay: 1600, answerTimeout: 45000,
    } });
    await extension.loadSettings();
    extension.timestamps();
    extension.scheduleChatClose(0, 'test');
    setChat([]);
    await extension.watchForAnswer(0);
    const delays = [...timers.values()].map(({ delay }) => delay);
    assert.deepEqual(delays.sort((a, b) => a - b), [1600, 2500, 3000, 45000]);
});

test('settings storage failures keep usable defaults', async () => {
    const { extension, logs } = loadContent({ debug: true, storageError: { message: 'storage unavailable' } });
    await extension.loadSettings();
    assert.equal(extension.settings.autoSkipDelay, 5000);
    assert.ok(logs.some(({ level, args }) => level === 'warn' && args[1] === 'could not load settings; using defaults'));
});

test('disabling auto-skip in settings cancels a pending skip on an open tab', () => {
    const { extension, HTMLMediaElement, timers, changeSettings } = loadContent();
    extension.bindSettingsChanges();
    const video = new HTMLMediaElement();
    video.currentTime = 45;
    video.duration = 600;
    extension.setActivePlayer(video);
    extension.setSegments([{ start: 30, end: 60 }]);
    extension.updateSkipButton(video);
    assert.ok([...timers.values()].some(({ delay }) => delay === 5000));
    changeSettings({ autoSkipDelay: 0 });
    assert.equal(timers.size, 0);
    assert.equal(video.currentTime, 45);
    assert.equal(extension.button.style.display, 'block');
    changeSettings({ autoSkipDelay: 3000 });
    assert.ok([...timers.values()].some(({ delay }) => delay === 3000));
});

test('changes use the local settings key and leave unrelated timers running', () => {
    const { extension, timers, changeSettings } = loadContent();
    extension.bindSettingsChanges();
    extension.timestamps();
    changeSettings({ closeDelay: 3000 }, 'sync');
    assert.equal(extension.settings.closeDelay, 10000);
    changeSettings({ closeDelay: 3000 });
    assert.equal(extension.settings.closeDelay, 3000);
    assert.ok([...timers.values()].some(({ delay }) => delay === 1000));
    changeSettings(undefined);
    assert.equal(extension.settings.closeDelay, 10000);
});
