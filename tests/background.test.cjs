const assert = require('node:assert/strict');
const test = require('node:test');
const { loadBackground } = require('./helpers/background.cjs');

const LOG_KEY = 'ytAutoTimestampsLogLines';
const sendLog = (h, entry) => h.message({ type: 'YT_AD_SKIP_LOG', entry });

test('log messages are batched, formatted, persisted, and acknowledged after storage succeeds', async () => {
    const h = loadBackground({ [LOG_KEY]: ['previous log'] });
    const first = sendLog(h, { timestamp: '2026-01-01T00:00:00.000Z', level: 'warn', message: 'first', details: { value: 1 } });
    const second = sendLog(h, { message: 'second' });
    assert.equal(first.keepAlive, true);
    assert.equal(h.writes.length, 0);
    assert.equal(h.timers.size, 1);
    await h.advance(499);
    assert.equal(h.writes.length, 0);
    await h.advance(1);
    assert.equal((await first.response).ok, true);
    assert.equal((await second.response).ok, true);
    assert.equal(h.writes.length, 1);
    assert.equal(h.stored[LOG_KEY][0], 'previous log');
    assert.equal(h.stored[LOG_KEY][1], '2026-01-01T00:00:00.000Z WARN first {"details":{"value":1}}');
    assert.ok(h.stored[LOG_KEY][2].includes('INFO second'));
    assert.ok(h.stored.ytAutoTimestampsLogUpdatedAt);
    assert.equal(h.downloads.length, 0);
});

test('invalid payloads are normalized and malformed saved history is replaced', async () => {
    const h = loadBackground({ [LOG_KEY]: 'corrupted history' });
    const requests = [null, 'bad payload', {}].map(entry => sendLog(h, entry));
    await h.advance(500);
    await Promise.all(requests.map(request => request.response));
    assert.equal(h.stored[LOG_KEY].length, 3);
    assert.ok(h.stored[LOG_KEY][0].includes('WARN invalid log payload'));
    assert.ok(h.stored[LOG_KEY][1].includes('bad payload'));
    assert.ok(h.stored[LOG_KEY][2].includes('INFO log'));
});

test('log retention keeps the newest 1000 lines', async () => {
    const old = Array.from({ length: 1000 }, (_, i) => `old ${i}`);
    const h = loadBackground({ [LOG_KEY]: old });
    const request = sendLog(h, { message: 'newest' });
    await h.advance(500);
    await request.response;
    assert.equal(h.stored[LOG_KEY].length, 1000);
    assert.equal(h.stored[LOG_KEY][0], 'old 1');
    assert.ok(h.stored[LOG_KEY].at(-1).includes('newest'));
});

test('log retention enforces the byte cap using UTF-8 size', async () => {
    const old = Array.from({ length: 10 }, (_, i) => `${i} ${'я'.repeat(150000)}`);
    const h = loadBackground({ [LOG_KEY]: old });
    const request = sendLog(h, { message: 'newest' });
    await h.advance(500);
    await request.response;
    const lines = h.stored[LOG_KEY];
    assert.ok(new Blob([lines.join('\n'), '\n']).size <= 2 * 1024 * 1024);
    assert.equal(lines.length, 7);
    assert.ok(lines[0].startsWith('4 '));
    assert.ok(lines.at(-1).includes('newest'));
});

test('overlapping log batches serialize their writes without losing entries', async () => {
    const h = loadBackground();
    h.holdWrites();
    const first = sendLog(h, { message: 'first' });
    await h.advance(500);
    const second = sendLog(h, { message: 'second' });
    await h.advance(500);
    assert.equal(h.writes.length, 1);
    h.releaseWrite();
    await h.flush();
    assert.equal(h.writes.length, 2);
    h.releaseWrite();
    await Promise.all([first.response, second.response]);
    assert.equal(h.stored[LOG_KEY].length, 2);
    assert.ok(h.stored[LOG_KEY][0].includes('first'));
    assert.ok(h.stored[LOG_KEY][1].includes('second'));
});

test('write failures return an error and subsequent log batches recover', async () => {
    const h = loadBackground();
    h.failWrites('quota exceeded');
    const failed = sendLog(h, { message: 'failed entry' });
    await h.advance(500);
    const response = await failed.response;
    assert.equal(response.ok, false);
    assert.equal(response.error, 'quota exceeded');
    assert.equal(h.warnings.length, 1);
    h.failWrites(null);
    const recovered = sendLog(h, { message: 'recovered' });
    await h.advance(500);
    assert.equal((await recovered.response).ok, true);
    assert.ok(h.stored[LOG_KEY][0].includes('recovered'));
});

test('export flushes pending log entries before creating the file', async () => {
    const h = loadBackground();
    const log = sendLog(h, { message: 'pending log' });
    const exported = h.message({ type: 'YT_AD_SKIP_EXPORT_LOG' });
    assert.equal(exported.keepAlive, true);
    assert.equal((await exported.response).ok, true);
    assert.equal((await log.response).ok, true);
    assert.equal(h.timers.size, 0);
    assert.equal(h.downloads.length, 1);
    const download = h.downloads[0];
    assert.equal(download.filename, 'yt-ad-skip.log');
    assert.equal(download.conflictAction, 'overwrite');
    assert.equal(download.saveAs, false);
    assert.ok(download.url.startsWith('data:application/octet-stream;'));
    const body = decodeURIComponent(download.url);
    assert.ok(body.includes('# YT Ad Skip log'));
    assert.ok(body.includes('# Lines retained: 1/1000'));
    assert.ok(body.includes('pending log'));
});

test('export waits for a log write that is already in progress', async () => {
    const h = loadBackground();
    h.holdWrites();
    const log = sendLog(h, { message: 'in progress' });
    await h.advance(500);
    const exported = h.message({ type: 'YT_AD_SKIP_EXPORT_LOG' });
    await h.flush();
    assert.equal(h.downloads.length, 0);
    h.releaseWrite();
    await Promise.all([log.response, exported.response]);
    assert.ok(decodeURIComponent(h.downloads[0].url).includes('in progress'));
});

test('overlapping export requests create a single download', async () => {
    const h = loadBackground();
    h.holdDownloads();
    const first = h.message({ type: 'YT_AD_SKIP_EXPORT_LOG' });
    await h.flush();
    const second = h.message({ type: 'YT_AD_SKIP_EXPORT_LOG' });
    assert.equal((await second.response).ok, true);
    assert.equal(h.downloads.length, 1);
    h.releaseDownload();
    assert.equal((await first.response).ok, true);
});

test('failed downloads report failure and release the export lock for another attempt', async () => {
    const h = loadBackground();
    h.failDownloads('download blocked');
    assert.equal((await h.message({ type: 'YT_AD_SKIP_EXPORT_LOG' }).response).ok, false);
    assert.equal(h.warnings.length, 1);
    h.failDownloads(null);
    assert.equal((await h.message({ type: 'YT_AD_SKIP_EXPORT_LOG' }).response).ok, true);
    assert.equal(h.downloads.length, 2);
});

test('install and startup events add diagnostics without downloading a file', async () => {
    const h = loadBackground();
    h.listeners.installed({ reason: 'update' });
    h.listeners.startup();
    await h.advance(500);
    assert.equal(h.stored[LOG_KEY].length, 2);
    assert.ok(h.stored[LOG_KEY][0].includes('background installed'));
    assert.ok(h.stored[LOG_KEY][0].includes('update'));
    assert.ok(h.stored[LOG_KEY][1].includes('background startup'));
    assert.equal(h.downloads.length, 0);
});
