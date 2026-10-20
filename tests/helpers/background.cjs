const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createClock, flush } = require('./browser.cjs');

function loadBackground(initialStorage = {}) {
    const clock = createClock();
    const listeners = {};
    const downloads = [];
    const writes = [];
    const warnings = [];
    const stored = { ...initialStorage };
    const event = name => ({ addListener(callback) { listeners[name] = callback; } });
    let writeError;
    let downloadError;
    let holdWrites = false;
    let holdDownloads = false;
    const pendingWrites = [];
    const pendingDownloads = [];
    const chrome = {
        runtime: { onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup') },
        storage: { local: {
            get(defaults, callback) { callback({ ...defaults, ...stored }); },
            set(values, callback) {
                writes.push(values);
                const complete = () => {
                    if (!writeError) Object.assign(stored, values);
                    chrome.runtime.lastError = writeError;
                    try { callback(); } finally { delete chrome.runtime.lastError; }
                };
                if (holdWrites) pendingWrites.push(complete); else complete();
            },
        } },
        downloads: {
            download(options, callback) {
                downloads.push(options);
                const complete = () => {
                    chrome.runtime.lastError = downloadError;
                    try { callback(downloadError ? undefined : downloads.length); }
                    finally { delete chrome.runtime.lastError; }
                };
                if (holdDownloads) pendingDownloads.push(complete); else complete();
            },
        },
    };
    const filename = path.join(__dirname, '..', '..', 'background.js');
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        ...clock, chrome, Blob, Error,
        console: { warn: (...args) => warnings.push(args) },
    }, { filename });

    function message(payload) {
        let keepAlive;
        const response = new Promise(resolve => { keepAlive = listeners.message(payload, {}, resolve); });
        return { keepAlive, response };
    }
    return { ...clock, listeners, downloads, writes, warnings, stored, chrome, message, flush,
        failWrites(error) { writeError = error && new Error(error); },
        failDownloads(error) { downloadError = error && new Error(error); },
        holdWrites() { holdWrites = true; },
        releaseWrite() { pendingWrites.shift()?.(); },
        holdDownloads() { holdDownloads = true; },
        releaseDownload() { pendingDownloads.shift()?.(); },
    };
}

module.exports = { loadBackground };
