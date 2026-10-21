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
    test(`cancel control is ${visible ? 'visible' : 'hidden'} at ${time} seconds`, () => {
        const h = setup();
        h.player.currentTime = time;
        h.extension.updateSkipButton(h.player);
        assert.equal(h.extension.button?.style.display === 'block', visible);
    });
}

test('the cancel button shows countdown progress and reuses the existing button', async () => {
    const h = setup();
    h.player.currentTime = 30;
    h.extension.updateSkipButton(h.player);
    const button = h.extension.button;
    const animation = button.animations[0];
    assert.equal(animation.keyframes[0].backgroundSize, '0% 100%');
    assert.equal(animation.keyframes[1].backgroundSize, '100% 100%');
    assert.equal(animation.options.duration, 5000);
    assert.equal(animation.options.easing, 'linear');
    await h.advance(2500);
    h.extension.updateSkipButton(h.player);
    assert.equal(h.extension.button, button);
    assert.equal(button.animations.length, 1);
    assert.equal(animation.playState, 'running');
    assert.equal(button.textContent, 'Cancel auto-skip (3s)');
    assert.equal(h.container.children.length, 1);
});

test('the alternate progress style fills the remaining part', () => {
    const h = setup({ fillGrows: false });
    h.player.currentTime = 30;
    h.extension.updateSkipButton(h.player);
    const animation = h.extension.button.animations[0];
    assert.equal(animation.keyframes[0].backgroundSize, '100% 100%');
    assert.equal(animation.keyframes[1].backgroundSize, '0% 100%');
});

test('pausing freezes the fill and exact remaining delay, then resumes without restarting', async () => {
    const h = setup();
    h.extension.bindPlayerEvents(h.player);
    h.extension.updateSkipButton(h.player);
    const animation = h.extension.button.animations[0];
    await h.advance(1250);
    const oldTick = [...h.timers.values()][0].callback;
    h.player.paused = true;
    h.player.dispatchEvent(new h.Event('pause'));
    assert.equal(animation.playState, 'paused');
    assert.equal(animation.currentTime, 1250);
    assert.equal(h.extension.button.textContent, 'Cancel auto-skip (4s)');
    assert.equal(h.timers.size, 0);
    await h.advance(10000);
    h.player.dispatchEvent(new h.Event('timeupdate'));
    assert.equal(h.player.currentTime, 45);
    assert.equal(animation.currentTime, 1250);
    assert.equal(h.extension.button.textContent, 'Cancel auto-skip (4s)');
    h.player.paused = false;
    h.player.dispatchEvent(new h.Event('play'));
    oldTick();
    assert.equal(animation.playState, 'running');
    assert.equal(animation.currentTime, 1250);
    assert.equal(h.extension.button.animations.length, 1);
    assert.equal(h.timers.size, 1);
    await h.advance(3749);
    assert.equal(h.player.currentTime, 45);
    await h.advance(1);
    assert.equal(h.player.currentTime, 60);
    assert.equal(animation.playState, 'idle');
    assert.equal(h.timers.size, 0);
});

test('a segment discovered while paused waits for playback before starting its countdown', async () => {
    const h = setup();
    h.extension.bindPlayerEvents(h.player);
    h.player.paused = true;
    h.extension.updateSkipButton(h.player);
    const animation = h.extension.button.animations[0];
    assert.equal(animation.playState, 'paused');
    assert.equal(animation.currentTime, 0);
    assert.equal(h.timers.size, 0);
    await h.advance(10000);
    assert.equal(h.player.currentTime, 45);
    h.player.paused = false;
    h.player.dispatchEvent(new h.Event('play'));
    await h.advance(4999);
    assert.equal(h.player.currentTime, 45);
    await h.advance(1);
    assert.equal(h.player.currentTime, 60);
});

test('repeated pause and play events preserve elapsed time across multiple pauses', async () => {
    const h = setup();
    h.extension.bindPlayerEvents(h.player);
    h.extension.updateSkipButton(h.player);
    for (let i = 0; i < 2; i++) {
        await h.advance(1500);
        h.player.paused = true;
        h.player.dispatchEvent(new h.Event('pause'));
        await h.advance(10000);
        h.player.dispatchEvent(new h.Event('pause'));
        h.player.dispatchEvent(new h.Event('timeupdate'));
        assert.equal(h.player.currentTime, 45);
        assert.equal(h.timers.size, 0);
        h.player.paused = false;
        h.player.dispatchEvent(new h.Event('play'));
        h.player.dispatchEvent(new h.Event('play'));
        assert.equal(h.timers.size, 1);
    }
    await h.advance(1999);
    assert.equal(h.player.currentTime, 45);
    await h.advance(1);
    assert.equal(h.player.currentTime, 60);
});

test('an expiring timer cannot skip a paused video even before its pause event arrives', async () => {
    const h = setup();
    h.extension.updateSkipButton(h.player);
    await h.advance(4999);
    h.player.paused = true;
    await h.advance(10001);
    assert.equal(h.player.currentTime, 45);
    assert.equal(h.extension.button.animations[0].playState, 'paused');
    assert.equal(h.timers.size, 0);
});

test('canceling while paused stays canceled after resuming', async () => {
    const h = setup();
    h.extension.bindPlayerEvents(h.player);
    h.extension.updateSkipButton(h.player);
    await h.advance(1500);
    h.player.paused = true;
    h.player.dispatchEvent(new h.Event('pause'));
    const animation = h.extension.button.animations[0];
    h.extension.button.click();
    assert.equal(animation.playState, 'idle');
    h.player.paused = false;
    h.player.dispatchEvent(new h.Event('play'));
    await h.advance(10000);
    assert.equal(h.player.currentTime, 45);
    assert.equal(h.extension.button.style.display, 'none');
    assert.equal(h.timers.size, 0);
});

test('seeking to another segment while paused starts a fresh frozen countdown', async () => {
    const h = setup();
    h.extension.bindPlayerEvents(h.player);
    h.extension.updateSkipButton(h.player);
    await h.advance(1500);
    const oldAnimation = h.extension.button.animations[0];
    h.player.paused = true;
    h.player.dispatchEvent(new h.Event('pause'));
    h.player.currentTime = 100;
    h.player.dispatchEvent(new h.Event('seeked'));
    const animation = h.extension.button.animations[1];
    assert.equal(oldAnimation.playState, 'idle');
    assert.equal(animation.playState, 'paused');
    assert.equal(animation.currentTime, 0);
    assert.equal(h.extension.button.textContent, 'Cancel auto-skip (5s)');
    await h.advance(10000);
    assert.equal(h.player.currentTime, 100);
    h.player.paused = false;
    h.player.dispatchEvent(new h.Event('play'));
    await h.advance(4999);
    assert.equal(h.player.currentTime, 100);
    await h.advance(1);
    assert.equal(h.player.currentTime, 120);
});

test('recreating a paused button preserves progress and cancels its old animation', async () => {
    const h = setup();
    h.extension.bindPlayerEvents(h.player);
    h.extension.updateSkipButton(h.player);
    await h.advance(1250);
    h.player.paused = true;
    h.player.dispatchEvent(new h.Event('pause'));
    const oldButton = h.extension.button;
    oldButton.remove();
    await h.advance(5000);
    h.extension.updateSkipButton(h.player);
    assert.equal(oldButton.animations[0].playState, 'idle');
    const animation = h.extension.button.animations[0];
    assert.equal(animation.playState, 'paused');
    assert.equal(animation.currentTime, 1250);
    assert.equal(h.timers.size, 0);
});

test('changing the duration while paused restarts the countdown but leaves it paused', async () => {
    const h = setup();
    h.extension.bindPlayerEvents(h.player);
    h.extension.bindSettingsChanges();
    h.extension.updateSkipButton(h.player);
    await h.advance(1500);
    h.player.paused = true;
    h.player.dispatchEvent(new h.Event('pause'));
    h.changeSettings({ autoSkipDelay: 7000 });
    const [oldAnimation, animation] = h.extension.button.animations;
    assert.equal(oldAnimation.playState, 'idle');
    assert.equal(animation.playState, 'paused');
    assert.equal(animation.options.duration, 7000);
    assert.equal(animation.currentTime, 0);
    assert.equal(h.extension.button.textContent, 'Cancel auto-skip (7s)');
    assert.equal(h.timers.size, 0);
    await h.advance(10000);
    assert.equal(h.player.currentTime, 45);
    h.player.paused = false;
    h.player.dispatchEvent(new h.Event('play'));
    await h.advance(6999);
    assert.equal(h.player.currentTime, 45);
    await h.advance(1);
    assert.equal(h.player.currentTime, 60);
});

test('navigation cancels a frozen countdown and its animation without reviving old ticks', async () => {
    const h = setup();
    h.extension.bindPlayerEvents(h.player);
    h.extension.updateSkipButton(h.player);
    const oldTick = [...h.timers.values()][0].callback;
    const button = h.extension.button;
    await h.advance(1250);
    h.player.paused = true;
    h.player.dispatchEvent(new h.Event('pause'));
    h.extension.reset();
    oldTick();
    await h.advance(10000);
    assert.equal(h.player.currentTime, 45);
    assert.equal(button.isConnected, false);
    assert.equal(button.animations[0].playState, 'idle');
    assert.equal(h.timers.size, 0);
});

test('clicking cancel leaves the current segment playing and stops its countdown', async () => {
    const h = setup();
    h.extension.updateSkipButton(h.player);
    h.player.currentTime = 100;
    h.extension.updateSkipButton(h.player);
    h.extension.button.click();
    assert.equal(h.player.currentTime, 100);
    assert.equal(h.extension.button.style.display, 'none');
    assert.equal(h.timers.size, 0);
    h.extension.updateSkipButton(h.player);
    await h.advance(10000);
    assert.equal(h.player.currentTime, 100);
    assert.equal(h.extension.button.style.display, 'none');
});

test('automatic seeking is clamped to the video duration', async () => {
    const h = setup();
    h.player.duration = 50;
    h.extension.updateSkipButton(h.player);
    assert.equal(h.extension.button.textContent, 'Cancel auto-skip (5s)');
    await h.advance(5000);
    assert.equal(h.player.currentTime, 50);
});

test('cancel labels show the countdown rather than the segment end time', () => {
    const h = setup();
    h.player.duration = 7200;
    h.player.currentTime = 3600;
    h.extension.setSegments([{ start: 3500, end: 3665 }]);
    h.extension.updateSkipButton(h.player);
    assert.equal(h.extension.button.textContent, 'Cancel auto-skip (5s)');
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
        const h = setup({ debug: true });
        h.extension.bindShortcuts();
        const element = target === 'contenteditable' ? new h.HTMLElement() : h.document.createElement(target);
        if (target === 'contenteditable') element.isContentEditable = true;
        const event = new h.Event('keydown', { target: element, altKey: true, code: 'ArrowRight', cancelable: true });
        h.document.dispatchEvent(event);
        assert.equal(h.player.currentTime, 45);
        assert.equal(event.defaultPrevented, false);
        assert.equal(h.logs.some(({ level }) => level === 'warn' || level === 'error'), false);
    });
}

for (const condition of ['unrelated key', 'outside segment', 'no segments', 'no video']) {
    test(`skip shortcuts do nothing with ${condition}`, () => {
        const h = setup({ debug: true });
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
        assert.equal(h.logs.some(({ level }) => level === 'warn' || level === 'error'), false);
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

test('countdown text updates every second without player events and expires into a skip', async () => {
    const h = setup();
    h.extension.updateSkipButton(h.player);
    assert.equal(h.extension.button.textContent, 'Cancel auto-skip (5s)');
    await h.advance(999);
    assert.equal(h.extension.button.textContent, 'Cancel auto-skip (5s)');
    await h.advance(1);
    assert.equal(h.extension.button.textContent, 'Cancel auto-skip (4s)');
    for (const remaining of [3, 2, 1]) {
        await h.advance(1000);
        assert.equal(h.extension.button.textContent, `Cancel auto-skip (${remaining}s)`);
        assert.equal(h.player.currentTime, 45);
    }
    await h.advance(1000);
    assert.equal(h.player.currentTime, 60);
    assert.equal(h.extension.button.style.display, 'none');
    assert.equal(h.timers.size, 0);
});

test('the saved cancellation duration controls how long the button is shown', async () => {
    const h = setup({ storedSettings: { autoSkipDelay: 7000 } });
    await h.extension.loadSettings();
    h.extension.updateSkipButton(h.player);
    assert.equal(h.extension.button.textContent, 'Cancel auto-skip (7s)');
    await h.advance(6999);
    assert.equal(h.extension.button.textContent, 'Cancel auto-skip (1s)');
    assert.equal(h.extension.button.style.display, 'block');
    assert.equal(h.player.currentTime, 45);
    await h.advance(1);
    assert.equal(h.extension.button.style.display, 'none');
    assert.equal(h.player.currentTime, 60);
});

test('zero duration disables auto-skip and does not create a cancel button', async () => {
    const h = setup({ storedSettings: { autoSkipDelay: 0 } });
    await h.extension.loadSettings();
    h.extension.updateSkipButton(h.player);
    assert.equal(h.extension.button, null);
    assert.equal(h.timers.size, 0);
    await h.advance(10000);
    assert.equal(h.player.currentTime, 45);
});

test('canceling remains effective through player events and re-entering the same segment', async () => {
    const h = setup();
    h.extension.bindPlayerEvents(h.player);
    h.extension.updateSkipButton(h.player);
    h.extension.button.click();
    for (let i = 0; i < 10; i++) h.player.dispatchEvent(new h.Event('timeupdate'));
    h.player.currentTime = 75;
    h.player.dispatchEvent(new h.Event('seeking'));
    h.player.currentTime = 45;
    h.player.dispatchEvent(new h.Event('seeked'));
    await h.advance(10000);
    assert.equal(h.player.currentTime, 45);
    assert.equal(h.extension.button.style.display, 'none');
    assert.equal(h.timers.size, 0);
});

test('canceling one segment does not prevent auto-skipping another segment', async () => {
    const h = setup();
    h.extension.updateSkipButton(h.player);
    h.extension.button.click();
    h.player.currentTime = 100;
    h.extension.updateSkipButton(h.player);
    assert.equal(h.extension.button.textContent, 'Cancel auto-skip (5s)');
    assert.equal(h.extension.button.style.display, 'block');
    await h.advance(5000);
    assert.equal(h.player.currentTime, 120);
});

test('navigation clears per-video cancellation choices', async () => {
    const h = setup();
    h.extension.updateSkipButton(h.player);
    h.extension.button.click();
    h.extension.reset();
    h.extension.setSegments([{ start: 30, end: 60 }]);
    h.extension.updateSkipButton(h.player);
    assert.equal(h.extension.button.style.display, 'block');
    await h.advance(5000);
    assert.equal(h.player.currentTime, 60);
});

test('changing duration does not undo a user cancellation', async () => {
    const h = setup();
    h.extension.bindSettingsChanges();
    h.extension.updateSkipButton(h.player);
    h.extension.button.click();
    h.changeSettings({ autoSkipDelay: 7000 });
    assert.equal(h.extension.button.style.display, 'none');
    assert.equal(h.timers.size, 0);
    await h.advance(7000);
    assert.equal(h.player.currentTime, 45);
});

test('stale ticks and button handlers cannot affect a replacement countdown', async () => {
    const h = setup();
    h.extension.bindSettingsChanges();
    h.extension.updateSkipButton(h.player);
    const oldTick = [...h.timers.values()][0].callback;
    const oldClick = h.extension.button.onclick;
    h.changeSettings({ autoSkipDelay: 7000 });
    oldTick();
    oldClick();
    assert.equal(h.extension.button.textContent, 'Cancel auto-skip (7s)');
    assert.equal(h.timers.size, 1);
    await h.advance(7000);
    assert.equal(h.player.currentTime, 60);
});

test('keyboard shortcuts can still skip a segment after its auto-skip was canceled', () => {
    const h = setup();
    h.extension.bindShortcuts();
    h.extension.updateSkipButton(h.player);
    h.extension.button.click();
    h.document.dispatchEvent(new h.Event('keydown', { altKey: true, code: 'ArrowRight' }));
    assert.equal(h.player.currentTime, 60);
    assert.equal(h.timers.size, 0);
});
