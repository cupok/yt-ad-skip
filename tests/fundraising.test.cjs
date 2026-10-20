const assert = require('node:assert/strict');
const test = require('node:test');
const { loadContent } = require('./helpers/content.cjs');

for (const [language, sponsor, fundraising] of [
    ['en-US', 'Sponsor segment', 'Fundraising segment'],
    ['uk-UA', 'Спонсорський сегмент', 'Збір коштів'],
    ['ru-RU', 'Спонсорский сегмент', 'Сбор средств'],
]) {
    test(`${language}: prompt requests separate sponsor and fundraising ranges`, () => {
        const h = loadContent({ pageLanguage: language });
        const prompt = h.extension.getTimestampPrompt();
        assert.ok(prompt.includes(`"${language}"`));
        assert.ok(prompt.includes(`[SPONSOR] ${sponsor}: (START – END)`));
        assert.ok(prompt.includes(`[FUNDRAISING] ${fundraising}: (START – END)`));
        assert.ok(prompt.includes('explicit requests to donate or raise money'));
        assert.ok(prompt.includes('ordinary discussions of fundraising'));
    });

    test(`${language}: parsing accepts fundraising labels and markers alongside sponsors`, () => {
        const h = loadContent({ pageLanguage: language });
        h.setChat([
            { text: `${sponsor}: (0:30 – 1:00)`, times: [30, 60] },
            { text: `${fundraising}: (2:00 – 2:30)`, times: [120, 150] },
            { text: '[fundraising] (3:00 – 3:30)', times: [180, 210] },
            { text: 'Ordinary chapter (4:00 – 4:30)', times: [240, 270] },
        ]);
        assert.equal(JSON.stringify(h.extension.parseSegments()), JSON.stringify([
            { start: 30, end: 60 }, { start: 120, end: 150 }, { start: 180, end: 210 },
        ]));
    });

    test(`${language}: existing fundraising answers are excluded from a new run`, () => {
        const h = loadContent({ pageLanguage: language });
        const old = [
            { text: `${fundraising}: old appeal (0:30 – 1:00)`, times: [30, 60] },
            { text: '[FUNDRAISING] another old appeal (1:00 – 1:30)', times: [60, 90] },
        ];
        h.setChat(old);
        h.extension.ignoreExistingLines();
        h.setChat([...old, { text: '[FUNDRAISING] new appeal (2:00 – 2:30)', times: [120, 150] }]);
        assert.equal(JSON.stringify(h.extension.parseSegments()), '[{"start":120,"end":150}]');
    });

    test(`${language}: a new fundraising response drives skipping and delayed chat closure`, async () => {
        const h = loadContent({ pageLanguage: language });
        h.fullscreen();
        const close = h.mount(h.SELECTORS.close, new h.HTMLElement('button'));
        h.mount(h.SELECTORS.input, new h.HTMLTextAreaElement());
        const player = h.video({ currentTime: 125 });
        h.extension.setActivePlayer(player);
        const old = { text: `${fundraising}: old appeal (0:30 – 1:00)`, times: [30, 60] };
        const chat = h.setChat([old]);
        await h.extension.sendPrompt(0);
        await h.advance(12000);
        assert.equal(close.clickCount, 0);
        assert.equal(h.extension.state.segments.length, 0);
        h.setChat([old, { text: `[FUNDRAISING] ${fundraising}: (2:00 – 2:30)`, times: [120, 150] }]);
        h.observers.find(observer => observer.target === chat).notify([{ type: 'childList' }]);
        await h.advance(1200);
        assert.equal(JSON.stringify(h.extension.state.segments), '[{"start":120,"end":150}]');
        assert.equal(h.extension.button.style.display, 'block');
        await h.advance(5000);
        assert.equal(player.currentTime, 150);
        await h.advance(4999);
        assert.equal(close.clickCount, 0);
        await h.advance(1);
        assert.equal(close.clickCount, 1);
    });
}

test('unmarked discussions and negative statements about fundraising stay ordinary topics', () => {
    const h = loadContent();
    for (const text of [
        'How fundraising platforms work',
        'No fundraising segment in this video',
        'Discussion of a fundraising segment',
        'Fundraising segmentation techniques',
        'Не збір коштів',
        'Обговорення збору коштів',
        'Збір коштівник',
        'Не сбор средств',
        'Обсуждение сбора средств',
        'Сбор средствам',
    ]) assert.equal(h.extension.isSkippableLine(text), false, text);
    assert.equal(h.extension.isSkippableLine('- Fundraising segment: donate'), true);
    assert.equal(h.extension.isSkippableLine('ЗБІР КОШТІВ: допомога'), true);
    assert.equal(h.extension.isSkippableLine('СБОР СРЕДСТВ: помощь'), true);
});

test('fundraising still requires two valid timestamps in ascending order', () => {
    const h = loadContent();
    h.setChat([
        { text: '[FUNDRAISING] missing start or end', times: [30] },
        { text: '[FUNDRAISING] invalid timestamp values', times: ['NaN', null] },
        { text: '[FUNDRAISING] empty range', times: [30, 30] },
        { text: '[FUNDRAISING] reversed range', times: [60, 30] },
    ]);
    assert.equal(h.extension.parseSegments().length, 0);
});

for (const mode of ['button', 'automatic', 'keyboard shortcut']) {
    test(`fundraising segments can be skipped with the ${mode}`, async () => {
        const h = loadContent();
        const player = h.video({ currentTime: 45 });
        h.extension.setActivePlayer(player);
        h.setChat([{ text: '[FUNDRAISING] Donation drive (0:30 – 1:00)', times: [30, 60] }]);
        h.extension.setSegments(h.extension.parseSegments());
        h.extension.updateSkipButton(player);
        if (mode === 'button') h.extension.button.click();
        if (mode === 'automatic') await h.advance(5000);
        if (mode === 'keyboard shortcut') {
            h.extension.bindShortcuts();
            h.document.dispatchEvent(new h.Event('keydown', { altKey: true, code: 'ArrowRight' }));
        }
        assert.equal(player.currentTime, 60);
        assert.equal(h.extension.button.style.display, 'none');
        assert.equal(h.timers.size, 0);
    });
}
