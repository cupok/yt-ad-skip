const assert = require('node:assert/strict');
const test = require('node:test');
const { loadContent } = require('./helpers/content.cjs');

for (const [name, properties, fullscreen, reason] of [
    ['outside fullscreen', {}, false, 'not-fullscreen'],
    ['a video that is not ready', { readyState: 2 }, true, 'ready-state-2'],
    ['a short video', { duration: 179 }, true, 'duration-too-short-179'],
    ['a live stream', { duration: Infinity }, true, 'duration-Infinity'],
    ['an unknown duration', { duration: NaN }, true, 'duration-NaN'],
]) {
    test(`player does not start for ${name}`, () => {
        const h = loadContent({ debug: true });
        if (fullscreen) h.fullscreen();
        const video = h.mount('video', h.video(properties));
        h.extension.bindPlayerEvents(video);
        video.dispatchEvent(new h.Event('play'));
        h.extension.bindFullscreenChange();
        h.document.dispatchEvent(new h.Event('fullscreenchange'));
        assert.equal(h.extension.state.started, false);
        assert.equal(h.timers.size, 0);
        const blocked = h.logs.filter(({ args }) => args[1].startsWith('start gate blocked'));
        assert.equal(blocked.length, 2);
        assert.ok(blocked.every(({ level, args }) => level === 'log' && args[2].details.reasons.includes(reason)));
        assert.equal(h.logs.some(({ level }) => level === 'warn' || level === 'error'), false);
    });
}

test('a video starts normally once its loading blockers clear', () => {
    const h = loadContent({ debug: true });
    h.fullscreen();
    const video = h.video({ readyState: 0, duration: NaN });
    h.extension.bindPlayerEvents(video);
    video.dispatchEvent(new h.Event('loadedmetadata'));
    assert.equal(h.extension.state.started, false);
    video.readyState = 3;
    video.duration = 600;
    video.dispatchEvent(new h.Event('durationchange'));
    assert.equal(h.extension.state.started, true);
    assert.equal(h.timers.size, 1);
    assert.equal(h.logs.some(({ level }) => level === 'warn' || level === 'error'), false);
});

test('startup diagnostics from time updates remain throttled', async () => {
    const h = loadContent({ debug: true });
    const video = h.video({ readyState: 2 });
    h.extension.bindPlayerEvents(video);
    for (let i = 0; i < 10; i++) video.dispatchEvent(new h.Event('timeupdate'));
    const blocked = () => h.logs.filter(({ args }) => args[1] === 'start gate blocked from player event');
    assert.equal(blocked().length, 1);
    await h.advance(10000);
    video.dispatchEvent(new h.Event('timeupdate'));
    assert.equal(blocked().length, 2);
    assert.equal(h.logs.some(({ level }) => level === 'warn' || level === 'error'), false);
});

for (const event of ['loadedmetadata', 'durationchange', 'play', 'timeupdate', 'seeking', 'seeked']) {
    test(`${event} starts an eligible video once`, () => {
        const h = loadContent();
        h.fullscreen();
        const video = h.video({ duration: 180, readyState: 3 });
        h.extension.bindPlayerEvents(video);
        h.extension.bindPlayerEvents(video);
        video.dispatchEvent(new h.Event(event));
        const timer = [...h.timers.keys()][0];
        video.dispatchEvent(new h.Event(event));
        assert.equal(h.extension.state.started, true);
        assert.equal(h.extension.state.currentVideoSrc, 'video:test');
        assert.deepEqual([...h.timers.keys()], [timer]);
        assert.equal(video.listeners.get(event).size, 1);
    });
}

test('video discovery binds an existing video without an observer', () => {
    const h = loadContent();
    const video = h.mount('video', h.video());
    h.extension.bindCurrentOrFutureVideo();
    assert.equal(h.extension.state.activePlayer, video);
    assert.equal(h.observers.length, 0);
    assert.equal(video.listeners.get('timeupdate').size, 1);
});

for (const nested of [false, true]) {
    test(`video discovery observes a future ${nested ? 'nested' : 'direct'} video`, () => {
        const h = loadContent();
        h.extension.bindCurrentOrFutureVideo();
        const oldObserver = h.observers[0];
        h.extension.bindCurrentOrFutureVideo();
        assert.equal(oldObserver.disconnected, true);
        const observer = h.observers[1];
        const video = h.video();
        const node = nested ? new h.HTMLElement() : video;
        if (nested) node.append(video);
        observer.notify([{ type: 'childList', addedNodes: [{ nodeType: 3 }, node] }]);
        assert.equal(h.extension.state.activePlayer, video);
        assert.equal(observer.disconnected, true);
        assert.equal(video.listeners.get('play').size, 1);
    });
}

test('entering fullscreen can start playback and listeners are bound once', () => {
    const h = loadContent();
    h.mount('video', h.video());
    h.extension.bindFullscreenChange();
    h.extension.bindFullscreenChange();
    h.document.dispatchEvent(new h.Event('fullscreenchange'));
    assert.equal(h.extension.state.started, false);
    h.fullscreen();
    h.document.dispatchEvent(new h.Event('fullscreenchange'));
    assert.equal(h.extension.state.started, true);
    assert.equal(h.document.listeners.get('fullscreenchange').size, 1);
});

test('skip controls remain usable after leaving fullscreen', () => {
    const h = loadContent();
    const video = h.video({ currentTime: 45 });
    h.extension.bindPlayerEvents(video);
    h.extension.bindFullscreenChange();
    h.extension.setSegments([{ start: 30, end: 60 }]);
    h.fullscreen();
    h.document.dispatchEvent(new h.Event('fullscreenchange'));
    h.document.fullscreenElement = null;
    h.document.dispatchEvent(new h.Event('fullscreenchange'));
    video.dispatchEvent(new h.Event('timeupdate'));
    h.extension.button.click();
    assert.equal(video.currentTime, 60);
});

test('source changes cancel old work and reset segments', () => {
    const h = loadContent();
    h.fullscreen();
    const video = h.video({ currentTime: 45 });
    h.extension.bindPlayerEvents(video);
    video.dispatchEvent(new h.Event('play'));
    h.extension.setSegments([{ start: 30, end: 60 }]);
    h.extension.updateSkipButton(video);
    const button = h.extension.button;
    video.currentSrc = 'video:next';
    video.dispatchEvent(new h.Event('emptied'));
    assert.equal(h.extension.state.runId, 1);
    assert.equal(h.extension.state.started, false);
    assert.equal(h.extension.state.segments.length, 0);
    assert.equal(button.isConnected, false);
    assert.equal(h.timers.size, 0);
});

test('YouTube navigation clears pending work and binds the next video', async () => {
    const h = loadContent();
    h.fullscreen();
    const video = h.mount('video', h.video({ currentTime: 45 }));
    h.extension.start(video);
    h.extension.setSegments([{ start: 30, end: 60 }]);
    h.extension.updateSkipButton(video);
    h.setChat([]);
    await h.extension.watchForAnswer(0);
    h.extension.scheduleChatClose(0, 'test');
    const button = h.extension.button;
    const next = h.mount('video', h.video({ currentSrc: 'video:next' }));
    h.extension.bindNavigationEvents();
    h.extension.bindNavigationEvents();
    h.window.dispatchEvent(new h.Event('yt-navigate-finish'));
    assert.equal(h.extension.state.runId, 1);
    assert.equal(h.extension.state.started, false);
    assert.equal(h.extension.state.segments.length, 0);
    assert.equal(h.extension.state.activePlayer, next);
    assert.equal(button.isConnected, false);
    assert.equal(h.timers.size, 0);
    assert.ok(h.observers.every(observer => observer.disconnected));
    assert.equal(h.window.listeners.get('yt-navigate-finish').size, 1);
});

test('initialization loads settings and installs all lifecycle listeners', async () => {
    const h = loadContent({ storedSettings: { chatOpenDelay: 2500 } });
    const video = h.mount('video', h.video());
    await h.extension.init();
    assert.equal(h.extension.settings.chatOpenDelay, 2500);
    assert.equal(h.extension.state.activePlayer, video);
    for (const type of ['keydown', 'fullscreenchange']) assert.equal(h.document.listeners.get(type).size, 1);
    for (const type of ['error', 'unhandledrejection', 'yt-navigate-finish']) assert.equal(h.window.listeners.get(type).size, 1);
});
