const assert = require('node:assert/strict');
const test = require('node:test');
const { loadContent } = require('./helpers/content.cjs');

function setup(options) {
    const h = loadContent(options);
    h.player = h.video({ currentTime: 45 });
    h.extension.setActivePlayer(h.player);
    h.extension.setSegments([{ start: 30, end: 60 }, { start: 90, end: 120 }]);
    return h;
}

for (const [time, visible] of [[29.99, false], [30, true], [59.99, true], [60, false], [90, true], [120, false]]) {
    test(`skip control is ${visible ? 'visible' : 'hidden'} at ${time} seconds`, () => {
        const h = setup();
        h.player.currentTime = time;
        h.extension.updateSkipButton(h.player);
        assert.equal(h.extension.button?.style.display === 'block', visible);
    });
}

test('the skip button updates progress and reuses the existing button', () => {
    const h = setup();
    h.player.currentTime = 30;
    h.extension.updateSkipButton(h.player);
    const button = h.extension.button;
    assert.ok(button.style.background.includes('0%'));
    h.player.currentTime = 45;
    h.extension.updateSkipButton(h.player);
    assert.equal(h.extension.button, button);
    assert.ok(button.style.background.includes('50%'));
    assert.equal(h.container.children.length, 1);
});

test('the alternate progress style fills the remaining part', () => {
    const h = setup({ fillGrows: false });
    h.player.currentTime = 30;
    h.extension.updateSkipButton(h.player);
    assert.ok(h.extension.button.style.background.includes('100%'));
});

test('manual skipping cancels auto-skip and uses the currently visible segment', () => {
    const h = setup();
    h.extension.updateSkipButton(h.player);
    h.player.currentTime = 100;
    h.extension.updateSkipButton(h.player);
    h.extension.button.click();
    assert.equal(h.player.currentTime, 120);
    assert.equal(h.extension.button.style.display, 'none');
    assert.equal(h.timers.size, 0);
});

test('seeking is clamped to the video duration', () => {
    const h = setup();
    h.player.duration = 50;
    h.extension.updateSkipButton(h.player);
    assert.equal(h.extension.button.textContent, 'Skip segment → 0:50');
    h.extension.button.click();
    assert.equal(h.player.currentTime, 50);
});

test('long segment labels format hours and zero-padded minutes and seconds', () => {
    const h = setup();
    h.player.duration = 7200;
    h.player.currentTime = 3600;
    h.extension.setSegments([{ start: 3500, end: 3665 }]);
    h.extension.updateSkipButton(h.player);
    assert.equal(h.extension.button.textContent, 'Skip segment → 1:01:05');
});

test('a disconnected button is recreated and missing player containers are tolerated', () => {
    const h = setup();
    h.extension.updateSkipButton(h.player);
    const old = h.extension.button;
    old.remove();
    h.mount('#player-container', null);
    h.extension.updateSkipButton(h.player);
    assert.equal(h.extension.button, null);
    h.mount('#player-container', h.container);
    h.extension.updateSkipButton(h.player);
    assert.notEqual(h.extension.button, old);
    assert.equal(h.extension.button.isConnected, true);
});

test('auto-skip waits for its delay and time updates do not restart it', async () => {
    const h = setup();
    h.extension.updateSkipButton(h.player);
    await h.advance(3000);
    h.player.currentTime = 48;
    h.extension.updateSkipButton(h.player);
    assert.equal(h.timers.size, 1);
    await h.advance(1999);
    assert.equal(h.player.currentTime, 48);
    await h.advance(1);
    assert.equal(h.player.currentTime, 60);
    assert.equal(h.extension.button.style.display, 'none');
});

for (const reason of ['left segment', 'disconnected video', 'navigation']) {
    test(`auto-skip does not seek after ${reason}`, () => {
        const h = setup();
        h.extension.updateSkipButton(h.player);
        const callback = [...h.timers.values()][0].callback;
        if (reason === 'left segment') h.player.currentTime = 75;
        if (reason === 'disconnected video') h.player.isConnected = false;
        if (reason === 'navigation') h.extension.reset();
        const before = h.player.currentTime;
        callback();
        assert.equal(h.player.currentTime, before);
    });
}

test('leaving a sponsor segment hides the button and cancels its timer', () => {
    const h = setup();
    h.extension.updateSkipButton(h.player);
    h.player.currentTime = 75;
    h.extension.updateSkipButton(h.player);
    assert.equal(h.extension.button.style.display, 'none');
    assert.equal(h.timers.size, 0);
});

test('entering another sponsor segment replaces the previous auto-skip timer', async () => {
    const h = setup();
    h.extension.updateSkipButton(h.player);
    await h.advance(3000);
    h.player.currentTime = 100;
    h.extension.updateSkipButton(h.player);
    await h.advance(2000);
    assert.equal(h.player.currentTime, 100);
    await h.advance(3000);
    assert.equal(h.player.currentTime, 120);
});

for (const ctrlKey of [false, true]) {
    test(`${ctrlKey ? 'Ctrl+Alt' : 'Option'}+Right skips and consumes the keyboard event`, () => {
        const h = setup();
        h.extension.bindShortcuts();
        h.extension.bindShortcuts();
        h.extension.updateSkipButton(h.player);
        const event = new h.Event('keydown', { altKey: true, ctrlKey, code: 'ArrowRight', cancelable: true });
        h.document.dispatchEvent(event);
        assert.equal(h.player.currentTime, 60);
        assert.equal(event.defaultPrevented, true);
        assert.equal(event.propagationStopped, true);
        assert.equal(h.timers.size, 0);
        assert.equal(h.document.listeners.get('keydown').size, 1);
    });
}

for (const target of ['input', 'textarea', 'contenteditable']) {
    test(`skip shortcuts leave ${target} editing alone`, () => {
        const h = setup();
        h.extension.bindShortcuts();
        const element = target === 'contenteditable' ? new h.HTMLElement() : h.document.createElement(target);
        if (target === 'contenteditable') element.isContentEditable = true;
        const event = new h.Event('keydown', { target: element, altKey: true, code: 'ArrowRight', cancelable: true });
        h.document.dispatchEvent(event);
        assert.equal(h.player.currentTime, 45);
        assert.equal(event.defaultPrevented, false);
    });
}

for (const condition of ['unrelated key', 'outside segment', 'no segments', 'no video']) {
    test(`skip shortcuts do nothing with ${condition}`, () => {
        const h = setup();
        h.extension.bindShortcuts();
        if (condition === 'outside segment') h.player.currentTime = 75;
        if (condition === 'no segments') h.extension.setSegments([]);
        if (condition === 'no video') h.extension.setActivePlayer(null);
        const event = new h.Event('keydown', {
            altKey: true, code: condition === 'unrelated key' ? 'ArrowLeft' : 'ArrowRight', cancelable: true,
        });
        const before = h.player.currentTime;
        h.document.dispatchEvent(event);
        assert.equal(h.player.currentTime, before);
        assert.equal(event.defaultPrevented, false);
    });
}

test('shortcuts can find the current video when no active player is cached', () => {
    const h = setup();
    h.extension.setActivePlayer(null);
    h.mount('video', h.player);
    h.extension.bindShortcuts();
    h.document.dispatchEvent(new h.Event('keydown', { altKey: true, code: 'ArrowRight' }));
    assert.equal(h.player.currentTime, 60);
});
