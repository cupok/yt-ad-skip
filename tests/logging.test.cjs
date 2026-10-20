const assert = require('node:assert/strict');
const test = require('node:test');
const { loadContent } = require('./helpers/content.cjs');

for (const debug of [false, true]) {
    for (const logToFile of [false, true]) {
        test(`logging respects debug=${debug} and LOG_TO_FILE=${logToFile} independently`, () => {
            const h = loadContent({ debug, logToFile });
            h.extension.log('information', { value: 1 });
            h.extension.logWarn('warning');
            h.extension.logError('failure');
            assert.deepEqual(h.logs.map(log => log.level), debug ? ['log', 'warn', 'error'] : []);
            assert.equal(h.deliveries.length, logToFile ? 3 : 0);
            if (debug) assert.ok(h.logs.every(log => log.args[0] === '[yt-ad-skip]'));
            if (logToFile) {
                assert.ok(h.deliveries.every(delivery => delivery.type === 'YT_AD_SKIP_LOG'));
                assert.deepEqual(h.deliveries.map(({ entry }) => entry.sequence), [1, 2, 3]);
                assert.deepEqual(h.deliveries.map(({ entry }) => entry.level), ['info', 'warn', 'error']);
                assert.equal(h.deliveries[0].entry.videoId, 'test');
                assert.equal(h.deliveries[0].entry.pageUrl, h.window.location.href);
                assert.equal(h.deliveries[0].entry.details.value, 1);
                assert.equal(h.deliveries[0].entry.state, undefined);
                assert.equal(h.deliveries[1].entry.state.runId, 0);
                assert.equal(h.deliveries[2].entry.state.runId, 0);
            }
        });
    }
}

for (const debug of [false, true]) {
    test(`saved debug=${debug} controls console logging after loading settings`, async () => {
        const h = loadContent({ debug: !debug, logToFile: true, storedSettings: { debug } });
        await h.extension.loadSettings();
        h.extension.log('after loading');
        assert.equal(h.extension.settings.debug, debug);
        assert.equal(h.logs.length, debug ? 1 : 0);
        assert.equal(h.deliveries.length, 1);
    });
}

test('debug toggles on open tabs without interrupting file logging', () => {
    const h = loadContent({ debug: true, logToFile: true });
    h.extension.bindSettingsChanges();
    h.extension.log('enabled');
    assert.equal(h.logs.length, 1);
    h.changeSettings({ debug: false });
    for (const method of ['log', 'logWarn', 'logError']) h.extension[method]('disabled');
    assert.equal(h.logs.length, 1);
    assert.equal(h.deliveries.length, 5);
    h.changeSettings({ debug: true });
    h.extension.log('enabled again');
    assert.equal(h.logs.at(-1).args[1], 'enabled again');
    assert.equal(h.deliveries.length, 7);
});

test('structured logs serialize errors, circular values, BigInt, functions, and depth limits', () => {
    const h = loadContent({ logToFile: true });
    const circular = { name: 'cycle' };
    circular.self = circular;
    h.extension.log('diagnostics', {
        error: new Error('failure'), circular, bigint: 42n, callback: function example() {},
        nested: { a: { b: { c: 'deep value' } } },
    });
    const details = h.deliveries[0].entry.details;
    assert.equal(details.error.message, 'failure');
    assert.equal(details.error.name, 'Error');
    assert.ok(details.error.stack.includes('failure'));
    assert.equal(details.circular.self, '[Circular]');
    assert.equal(details.bigint, '42');
    assert.equal(details.callback, '[Function example]');
    assert.equal(details.nested.a.b, '[MaxDepth]');
    assert.doesNotThrow(() => JSON.stringify(h.deliveries[0]));
});

test('logging limits array and object sizes and handles multiple details', () => {
    const h = loadContent({ logToFile: true });
    h.extension.log('large details', Array.from({ length: 100 }, (_, i) => i),
        Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`key${i}`, i])));
    assert.equal(h.deliveries[0].entry.details[0].length, 30);
    assert.equal(Object.keys(h.deliveries[0].entry.details[1]).length, 40);
});

test('DOM, media, and event details are captured as serializable snapshots', () => {
    const h = loadContent({ logToFile: true });
    const video = h.video({ currentTime: 12.34567, duration: 100.12345 });
    const element = new h.HTMLElement('button', ' Skip\n  segment ');
    const event = new h.Event('click', { target: element, currentTarget: video });
    h.extension.log('elements', video, element, event);
    const [media, button, snapshot] = h.deliveries[0].entry.details;
    assert.equal(media.currentTime, 12.346);
    assert.equal(media.duration, 100.123);
    assert.equal(button.tag, 'button');
    assert.equal(button.text, 'Skip segment');
    assert.equal(snapshot.type, 'click');
    assert.equal(snapshot.target.tag, 'button');
    assert.equal(snapshot.currentTarget.src, 'video:test');
});

test('log delivery failures do not interrupt extension execution', () => {
    for (const options of [{ deliveryError: 'worker unavailable' }, { deliveryThrows: 'context invalidated' }]) {
        const h = loadContent({ debug: true, logToFile: true, ...options });
        assert.doesNotThrow(() => h.extension.log('test'));
        assert.ok(h.logs.some(({ level }) => level === 'debug'));
    }
    const h = loadContent({ logToFile: true });
    delete h.chrome.runtime.sendMessage;
    assert.doesNotThrow(() => h.extension.log('no runtime available'));
    h.window.location.href = 'not a URL';
    h.chrome.runtime.sendMessage = (message, callback) => { h.deliveries.push(message); callback(); };
    h.extension.log('invalid page URL');
    assert.equal(h.deliveries[0].entry.videoId, null);
});

test('repeated log messages are throttled until their state or interval changes', async () => {
    const h = loadContent();
    assert.equal(h.extension.shouldLogThrottled('gate', 'a'), true);
    assert.equal(h.extension.shouldLogThrottled('gate', 'a'), false);
    await h.advance(9999);
    assert.equal(h.extension.shouldLogThrottled('gate', 'a'), false);
    await h.advance(1);
    assert.equal(h.extension.shouldLogThrottled('gate', 'a'), true);
    assert.equal(h.extension.shouldLogThrottled('gate', 'b'), true);
    assert.equal(h.extension.shouldLogThrottled('other gate', 'a'), true);
});

test('global error logging ignores ResizeObserver noise and records actual failures once', () => {
    const h = loadContent({ debug: true });
    h.extension.bindGlobalErrorLogging();
    h.extension.bindGlobalErrorLogging();
    for (const message of [
        'ResizeObserver loop completed with undelivered notifications.',
        'ResizeObserver loop limit exceeded',
    ]) h.window.dispatchEvent(new h.Event('error', { message }));
    assert.equal(h.logs.filter(log => log.level === 'error').length, 0);
    h.window.dispatchEvent(new h.Event('error', {
        message: 'real error', filename: 'content.js', lineno: 10, colno: 20, error: new Error('real error'),
    }));
    h.window.dispatchEvent(new h.Event('unhandledrejection', { reason: new Error('rejected') }));
    const errors = h.logs.filter(log => log.level === 'error');
    assert.equal(errors.length, 2);
    assert.equal(errors[0].args[2].details.message, 'real error');
    assert.equal(errors[1].args[2].details.reason.message, 'rejected');
    assert.equal(h.window.listeners.get('error').size, 1);
});
