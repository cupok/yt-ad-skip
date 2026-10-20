const assert = require('node:assert/strict');
const test = require('node:test');
const { loadContent } = require('./helpers/content.cjs');

test('waiting for an existing element resolves without a timer or observer', async () => {
    const h = loadContent();
    const element = h.mount('#input', new h.HTMLElement());
    assert.equal(await h.extension.waitForElement('#input', 1000, 0), element);
    assert.equal(h.timers.size, 0);
    assert.equal(h.observers.length, 0);
});

test('waiting detects an element inserted later and releases its observer and timeout', async () => {
    const h = loadContent();
    const promise = h.extension.waitForElement('#input', 1000, 0);
    const element = h.mount('#input', new h.HTMLElement());
    h.observers[0].notify();
    assert.equal(await promise, element);
    assert.equal(h.observers[0].disconnected, true);
    assert.equal(h.timers.size, 0);
});

test('waiting for a missing element times out and releases its observer', async () => {
    const h = loadContent();
    const promise = h.extension.waitForElement('#input', 1000, 0);
    await h.advance(1000);
    assert.equal(await promise, null);
    assert.equal(h.observers[0].disconnected, true);
    assert.equal(h.timers.size, 0);
});

test('waiting for an element cannot complete for a previous video', async () => {
    const h = loadContent();
    const promise = h.extension.waitForElement('#input', 1000, 0);
    h.extension.reset();
    h.mount('#input', new h.HTMLElement());
    h.observers[0].notify();
    assert.equal(await promise, null);
    assert.equal(h.timers.size, 0);
});

test('opening chat retries twice and then stops when the button is unavailable', async () => {
    const h = loadContent({ debug: true });
    h.fullscreen();
    h.extension.timestamps();
    await h.advance(5000);
    const warnings = h.logs.filter(({ args }) => args[1] === 'chat open button not found');
    assert.equal(warnings.length, 3);
    assert.equal(warnings[2].args[2].details.willRetry, false);
    assert.equal(h.timers.size, 0);
});

test('scheduled chat opening is cancelled when fullscreen is exited', async () => {
    const h = loadContent();
    const button = h.mount(h.SELECTORS.open, new h.HTMLElement('button'));
    h.fullscreen();
    h.extension.start(h.video());
    h.document.fullscreenElement = null;
    await h.advance(1000);
    assert.equal(button.clickCount, 0);
    assert.equal(h.extension.state.started, false);
    assert.equal(h.timers.size, 0);
});

test('a stale scheduled chat callback cannot open chat on the next video', () => {
    const h = loadContent();
    h.fullscreen();
    const button = h.mount(h.SELECTORS.open, new h.HTMLElement('button'));
    h.extension.timestamps();
    const callback = [...h.timers.values()][0].callback;
    h.extension.reset();
    callback();
    assert.equal(button.clickCount, 0);
    assert.equal(h.timers.size, 0);
});

for (const tag of ['input', 'textarea', 'div']) {
    test(`prompt submission supports ${tag} chat inputs`, async () => {
        const h = loadContent({ pageLanguage: 'uk' });
        const input = h.mount(h.SELECTORS.input, h.document.createElement(tag));
        let inputEvents = 0;
        const keyEvents = [];
        input.addEventListener('input', () => inputEvents++);
        input.addEventListener('keydown', event => keyEvents.push(event));
        h.setChat([]);
        await h.extension.sendPrompt(0);
        assert.equal(tag === 'div' ? input.textContent : input.value, h.extension.getTimestampPrompt());
        assert.equal(inputEvents, 1);
        assert.equal(h.document.activeElement, input);
        assert.equal(keyEvents.length, 1);
        assert.equal(keyEvents[0].key, 'Enter');
        assert.equal(keyEvents[0].bubbles, true);
        assert.equal(h.observers.length, 1);
    });
}

test('prompt submission stops when the textarea never appears', async () => {
    const h = loadContent({ debug: true });
    const promise = h.extension.sendPrompt(0);
    await h.advance(10000);
    await promise;
    assert.ok(h.logs.some(({ args }) => args[1] === 'chat textarea not found'));
    assert.equal(h.timers.size, 0);
});

test('prompt submission does not write to an input after navigation', async () => {
    const h = loadContent();
    const input = h.mount(h.SELECTORS.input, new h.HTMLTextAreaElement());
    const promise = h.extension.sendPrompt(0);
    h.extension.reset();
    await promise;
    assert.equal(input.value, '');
    assert.equal(h.timers.size, 0);
});

test('answer mutations debounce parsing until the configured pause', async () => {
    const h = loadContent();
    const chat = h.setChat([]);
    await h.extension.watchForAnswer(0);
    await h.advance(600);
    h.setChat([{ text: '[SPONSOR] (0:30 – 1:00)', times: [30, 60] }]);
    const observer = h.observers.find(item => item.target === chat);
    observer.notify([{ type: 'characterData' }]);
    await h.advance(1199);
    assert.equal(h.extension.state.segments.length, 0);
    await h.advance(1);
    assert.equal(JSON.stringify(h.extension.state.segments), '[{"start":30,"end":60}]');
    assert.equal(observer.disconnected, true);
    assert.deepEqual([...h.timers.values()].map(({ delay }) => delay), [10000]);
});

test('reset prevents an already queued answer callback from restoring old segments', async () => {
    const h = loadContent();
    h.setChat([{ text: '[SPONSOR] (0:30 – 1:00)', times: [30, 60] }]);
    await h.extension.watchForAnswer(0);
    const callback = [...h.timers.values()].find(timer => timer.delay === 1200).callback;
    h.extension.reset();
    callback();
    assert.equal(h.extension.state.segments.length, 0);
    assert.equal(h.timers.size, 0);
});

test('missing chat panels and malformed timestamp ranges do not create segments', () => {
    const h = loadContent();
    assert.equal(h.extension.parseSegments().length, 0);
    h.setChat([
        { text: '[SPONSOR] missing timestamp attributes', times: [null, null] },
        { text: '[SPONSOR] invalid timestamp values', times: ['NaN', 'oops'] },
        { text: '[SPONSOR] equal endpoints', times: [30, 30] },
        { text: '[SPONSOR] reversed endpoints', times: [60, 30] },
        { text: 'Regular chapter (0:30 – 1:00)', times: [30, 60] },
    ]);
    assert.equal(h.extension.parseSegments().length, 0);
});

test('parsing normalizes whitespace and keeps multiple valid sponsor ranges', () => {
    const h = loadContent();
    h.setChat([
        { text: ' Sponsor\n segment: (0:30 – 1:00) ', times: [30, 60] },
        { text: '[SPONSOR] (2:00 – 2:30)', times: [120, 150] },
    ]);
    assert.equal(JSON.stringify(h.extension.parseSegments()), '[{"start":30,"end":60},{"start":120,"end":150}]');
});

test('chat closing skips hidden and disabled buttons and finds a usable button', () => {
    const h = loadContent();
    const root = h.fullscreen();
    const hidden = new h.HTMLElement('button');
    hidden.style.display = 'none';
    const disabled = new h.HTMLElement('button');
    disabled.setAttribute('disabled', '');
    const visible = new h.HTMLElement('button');
    root.queries.set(h.SELECTORS.close, [hidden, disabled, visible]);
    assert.equal(h.extension.closeChat(0, 'test'), true);
    assert.equal(visible.clickCount, 1);
    assert.equal(hidden.clickCount, 0);
    assert.equal(disabled.clickCount, 0);
});

test('closing chat tolerates absent buttons, stale runs, and leaving fullscreen', () => {
    const h = loadContent();
    assert.equal(h.extension.closeChat(0, 'test'), false);
    h.fullscreen();
    assert.equal(h.extension.closeChat(0, 'test'), false);
    const button = h.mount(h.SELECTORS.close, new h.HTMLElement('button'));
    h.extension.reset();
    assert.equal(h.extension.closeChat(0, 'test'), false);
    assert.equal(button.clickCount, 0);
});

test('rescheduling chat close replaces the previous countdown', async () => {
    const h = loadContent();
    h.fullscreen();
    const button = h.mount(h.SELECTORS.close, new h.HTMLElement('button'));
    h.extension.scheduleChatClose(0, 'first');
    await h.advance(5000);
    h.extension.scheduleChatClose(0, 'second');
    await h.advance(5000);
    assert.equal(button.clickCount, 0);
    await h.advance(5000);
    assert.equal(button.clickCount, 1);
});

test('playback can open chat, submit a prompt, parse a streamed answer, skip, and close chat', async () => {
    const h = loadContent({ pageLanguage: 'ru' });
    h.fullscreen();
    const open = h.mount(h.SELECTORS.open, new h.HTMLElement('button'));
    const close = h.mount(h.SELECTORS.close, new h.HTMLElement('button'));
    const input = h.mount(h.SELECTORS.input, new h.HTMLTextAreaElement());
    const chat = h.setChat([]);
    const video = h.mount('video', h.video({ currentTime: 45 }));
    await h.extension.init();
    video.dispatchEvent(new h.Event('play'));
    await h.advance(1000);
    assert.equal(open.clickCount, 1);
    assert.ok(input.value.includes('"ru"'));
    h.setChat([{ text: '[SPONSOR] Спонсорский сегмент: (0:30 – 1:00)', times: [30, 60] }]);
    h.observers.find(observer => observer.target === chat).notify([{ type: 'childList' }]);
    await h.advance(1200);
    assert.equal(h.extension.button.textContent, 'Пропустить сегмент → 1:00');
    await h.advance(5000);
    assert.equal(video.currentTime, 60);
    assert.equal(h.extension.button.style.display, 'none');
    await h.advance(5000);
    assert.equal(close.clickCount, 1);
    assert.equal(h.timers.size, 0);
});
