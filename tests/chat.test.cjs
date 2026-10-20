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
    const h = loadContent({ debug: true });
    const promise = h.extension.waitForElement('#input', 1000, 0);
    await h.advance(1000);
    assert.equal(await promise, null);
    assert.equal(h.observers[0].disconnected, true);
    assert.equal(h.timers.size, 0);
    assert.ok(h.logs.some(({ level, args }) => level === 'warn'
        && args[1] === 'waitForElement resolved without element'
        && args[2].details.reason === 'timeout'));
});

for (const completion of ['mutation', 'timeout']) {
    test(`waiting for an element from a previous video ends quietly on ${completion}`, async () => {
        const h = loadContent({ debug: true });
        const promise = h.extension.waitForElement('#input', 1000, 0);
        h.extension.reset();
        if (completion === 'mutation') {
            h.mount('#input', new h.HTMLElement());
            h.observers[0].notify();
        } else {
            await h.advance(1000);
        }
        assert.equal(await promise, null);
        assert.equal(h.timers.size, 0);
        assert.equal(h.logs.some(({ level }) => level === 'warn' || level === 'error'), false);
    });
}

test('opening chat retries twice and then stops when the button is unavailable', async () => {
    const h = loadContent({ debug: true });
    h.fullscreen();
    h.extension.timestamps();
    await h.advance(5000);
    const warnings = h.logs.filter(({ args }) => args[1] === 'chat open button not found');
    assert.equal(warnings.length, 3);
    assert.ok(warnings.every(({ level }) => level === 'warn'));
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
    const h = loadContent({ debug: true });
    h.fullscreen();
    const button = h.mount(h.SELECTORS.open, new h.HTMLElement('button'));
    h.extension.timestamps();
    const callback = [...h.timers.values()][0].callback;
    h.extension.reset();
    callback();
    assert.equal(button.clickCount, 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.logs.some(({ level }) => level === 'warn' || level === 'error'), false);
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
    const h = loadContent({ debug: true });
    const input = h.mount(h.SELECTORS.input, new h.HTMLTextAreaElement());
    const promise = h.extension.sendPrompt(0);
    h.extension.reset();
    await promise;
    assert.equal(input.value, '');
    assert.equal(h.timers.size, 0);
    assert.equal(h.logs.some(({ level }) => level === 'warn' || level === 'error'), false);
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
    assert.equal(observer.disconnected, false);
    assert.deepEqual([...h.timers.values()].map(({ delay }) => delay), [10000]);
    await h.advance(10000);
    assert.equal(observer.disconnected, true);
});

test('reset prevents an already queued answer callback from restoring old segments', async () => {
    const h = loadContent({ debug: true });
    h.setChat([{ text: '[SPONSOR] (0:30 – 1:00)', times: [30, 60] }]);
    await h.extension.watchForAnswer(0);
    const callback = [...h.timers.values()].find(timer => timer.delay === 1200).callback;
    h.extension.reset();
    callback();
    assert.equal(h.extension.state.segments.length, 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.logs.some(({ level }) => level === 'warn' || level === 'error'), false);
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
    assert.equal(h.extension.button.textContent, 'Отменить автопропуск (5 с)');
    await h.advance(5000);
    assert.equal(video.currentTime, 60);
    assert.equal(h.extension.button.style.display, 'none');
    await h.advance(5000);
    assert.equal(close.clickCount, 1);
    assert.equal(h.timers.size, 0);
});

for (const sponsor of [false, true]) {
    test(`old ${sponsor ? 'sponsor' : 'chapter'} timestamps cannot start the closing countdown`, async () => {
        const h = loadContent();
        h.fullscreen();
        const close = h.mount(h.SELECTORS.close, new h.HTMLElement('button'));
        h.mount(h.SELECTORS.input, new h.HTMLTextAreaElement());
        const old = { text: sponsor ? '[SPONSOR] Old answer (0:30 – 1:00)' : 'Old introduction (0:00)', times: sponsor ? [30, 60] : [0] };
        const chat = h.setChat([old]);
        await h.extension.sendPrompt(0);
        const observer = h.observers.find(item => item.target === chat);
        await h.advance(12000);
        assert.equal(close.clickCount, 0);
        assert.equal(h.extension.state.segments.length, 0);
        assert.equal(observer.disconnected, false);

        // Re-rendering history creates new DOM nodes with the same old content.
        h.setChat([old]);
        observer.notify([{ type: 'childList' }]);
        await h.advance(1200);
        assert.equal([...h.timers.values()].some(timer => timer.delay === 10000), false);

        h.setChat([old, { text: '[SPONSOR] New answer (2:00 – 2:30)', times: [120, 150] }]);
        observer.notify([{ type: 'childList' }]);
        await h.advance(1200);
        assert.equal(JSON.stringify(h.extension.state.segments), '[{"start":120,"end":150}]');
        await h.advance(9999);
        assert.equal(close.clickCount, 0);
        await h.advance(1);
        assert.equal(close.clickCount, 1);
        assert.equal(observer.disconnected, true);
    });
}

for (const sponsor of [false, true]) {
    test(`streaming resumes after a pause in ${sponsor ? 'sponsor' : 'chapter'} timestamps and restarts the close delay`, async () => {
        const h = loadContent();
        h.fullscreen();
        const close = h.mount(h.SELECTORS.close, new h.HTMLElement('button'));
        const first = { text: sponsor ? '[SPONSOR] (0:30 – 1:00)' : 'Introduction (0:00)', times: sponsor ? [30, 60] : [0] };
        const chat = h.setChat([first]);
        await h.extension.watchForAnswer(0);
        const observer = h.observers.find(item => item.target === chat);
        await h.advance(1200);
        await h.advance(9000);
        h.setChat([first, { text: '[SPONSOR] (2:00 – 2:30)', times: [120, 150] }]);
        observer.notify([{ type: 'childList' }]);
        await h.advance(1200);
        assert.equal(close.clickCount, 0);
        assert.equal(h.extension.state.segments.length, sponsor ? 2 : 1);
        await h.advance(9999);
        assert.equal(close.clickCount, 0);
        await h.advance(1);
        assert.equal(close.clickCount, 1);
        assert.equal(observer.disconnected, true);
    });
}

test('the configured close delay starts after a slow AI response settles', async () => {
    const h = loadContent({ storedSettings: { closeDelay: 3000 } });
    await h.extension.loadSettings();
    h.fullscreen();
    const close = h.mount(h.SELECTORS.close, new h.HTMLElement('button'));
    h.mount(h.SELECTORS.input, new h.HTMLTextAreaElement());
    const chat = h.setChat([]);
    await h.extension.sendPrompt(0);
    await h.advance(20000);
    assert.equal(close.clickCount, 0);
    h.setChat([{ text: 'Introduction (0:00)', times: [0] }]);
    h.observers.find(item => item.target === chat).notify([{ type: 'childList' }]);
    await h.advance(1200);
    await h.advance(2999);
    assert.equal(close.clickCount, 0);
    await h.advance(1);
    assert.equal(close.clickCount, 1);
});

test('response timeouts leave the chat open', async () => {
    const h = loadContent({ debug: true });
    h.fullscreen();
    const close = h.mount(h.SELECTORS.close, new h.HTMLElement('button'));
    h.setChat([]);
    await h.extension.watchForAnswer(0);
    await h.advance(30000);
    assert.equal(close.clickCount, 0);
    assert.equal(h.timers.size, 0);
    assert.ok(h.observers.every(observer => observer.disconnected));
    assert.ok(h.logs.some(({ args }) => args[1] === 'answer timeout' && args[2].details.chatLeftOpen));
});

test('a response arriving just before the wait timeout gets the full close delay', async () => {
    const h = loadContent();
    h.fullscreen();
    const close = h.mount(h.SELECTORS.close, new h.HTMLElement('button'));
    const chat = h.setChat([]);
    await h.extension.watchForAnswer(0);
    await h.advance(29999);
    h.setChat([{ text: 'Introduction (0:00)', times: [0] }]);
    h.observers.find(item => item.target === chat).notify([{ type: 'childList' }]);
    await h.advance(1200);
    assert.equal(close.clickCount, 0);
    await h.advance(9999);
    assert.equal(close.clickCount, 0);
    await h.advance(1);
    assert.equal(close.clickCount, 1);
});
