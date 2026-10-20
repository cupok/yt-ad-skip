const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const settingsSource = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(settingsSource, context);
const { DEFAULTS, FIELDS, normalize } = context.YtAdSkipSettings;

test('missing, malformed, and partial stored settings preserve existing defaults', () => {
    for (const input of [undefined, null, 'bad data', []]) {
        assert.equal(JSON.stringify(normalize(input)), JSON.stringify(DEFAULTS));
    }
    assert.equal(normalize({ closeDelay: 2500 }).closeDelay, 2500);
    assert.equal(normalize({ closeDelay: 2500 }).autoSkipDelay, 5000);
});

test('out-of-range and nonnumeric delay values cannot reach timers', () => {
    for (const [key, field] of Object.entries(FIELDS)) {
        for (const invalid of [-1, NaN, Infinity, '5000', null, field.max + 1]) {
            assert.equal(normalize({ [key]: invalid })[key], field.default);
        }
    }
    assert.equal(normalize({ unknown: 1 }).unknown, undefined);
    assert.equal(normalize({ autoSkipDelay: 0 }).autoSkipDelay, 0);
    assert.equal(normalize({ chatOpenDelay: 0 }).chatOpenDelay, 0);
    assert.equal(normalize({ closeDelay: 0 }).closeDelay, 0);
    assert.equal(normalize({ answerTimeout: 0 }).answerTimeout, DEFAULTS.answerTimeout);
});

test('debug settings preserve booleans and use the current default for old or malformed values', () => {
    assert.equal(DEFAULTS.debug, true);
    assert.equal(normalize({ debug: true }).debug, true);
    assert.equal(normalize({ debug: false }).debug, false);
    for (const debug of [undefined, null, 'false', 0, 1, {}]) {
        assert.equal(normalize({ debug }).debug, DEFAULTS.debug);
    }
    assert.equal(normalize({ closeDelay: 2500 }).debug, DEFAULTS.debug);
});

test('toolbar opens settings and shared configuration loads before the content script', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    assert.equal(manifest.action.default_popup, 'settings.html');
    assert.equal(manifest.options_ui.page, 'settings.html');
    assert.deepEqual(manifest.content_scripts[0].js, ['settings.js', 'content.js']);
    for (const name of ['settings.html', 'settings.css', 'settings-ui.js', ...manifest.content_scripts[0].js]) {
        assert.ok(fs.existsSync(path.join(root, name)), `${name} must be included in the extension`);
    }
});

test('logs are exported only after an explicit export request', async () => {
    const listeners = {};
    const downloads = [];
    const stored = { ytAutoTimestampsLogLines: ['test log line'] };
    const event = name => ({ addListener(callback) { listeners[name] = callback; } });
    vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), {
        chrome: {
            runtime: { onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup') },
            storage: { local: {
                get(defaults, callback) { callback({ ...defaults, ...stored }); },
                set(values, callback) { Object.assign(stored, values); callback(); },
            } },
            downloads: { download(options, callback) { downloads.push(options); callback(1); } },
        },
        Blob, console, setTimeout, clearTimeout,
    });
    assert.equal(downloads.length, 0);
    assert.equal(listeners.message({ type: 'unrelated' }, {}, () => {}), false);
    const response = await new Promise(resolve => {
        assert.equal(listeners.message({ type: 'YT_AD_SKIP_EXPORT_LOG' }, {}, resolve), true);
    });
    assert.equal(response.ok, true);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].filename, 'yt-ad-skip.log');
    assert.ok(decodeURIComponent(downloads[0].url).includes('test log line'));
});
