const assert = require('node:assert/strict');
const test = require('node:test');
const { loadContent } = require('./helpers/content.cjs');

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
