/* global chrome */
(() => {

const LOG_MESSAGE_TYPE = 'YT_AUTO_TIMESTAMPS_LOG';
const LOG_STORAGE_KEY = 'ytAutoTimestampsLogLines';
const LOG_UPDATED_AT_KEY = 'ytAutoTimestampsLogUpdatedAt';
const LOG_FILE_NAME = 'yt-auto-timestamps.log';

const MAX_LOG_LINES = 1000;
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const LOG_FLUSH_DELAY_MS = 500;

/** @type {any} */
const chromeApi = chrome;

let writeQueue = Promise.resolve();
let flushInProgress = false;
let flushTimer = null;
let pendingLogEntries = [];
let pendingLogCallbacks = [];

function storageGet(defaults) {
    return new Promise((resolve) => {
        chromeApi['storage']['local']['get'](defaults, resolve);
    });
}

function storageSet(data) {
    return new Promise((resolve, reject) => {
        chromeApi['storage']['local']['set'](data, () => {
            const error = chromeApi['runtime']['lastError'];

            if (error) {
                reject(error);
                return;
            }

            resolve(undefined);
        });
    });
}

function downloadFile(options) {
    return new Promise((resolve, reject) => {
        chromeApi['downloads']['download'](options, (downloadId) => {
            const error = chromeApi['runtime']['lastError'];

            if (error) {
                reject(error);
                return;
            }

            resolve(downloadId);
        });
    });
}

function normalizeEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return {
            timestamp: new Date().toISOString(),
            level: 'warn',
            message: 'invalid log payload',
            details: entry,
        };
    }

    return {
        ...entry,
        timestamp: entry.timestamp || new Date().toISOString(),
        level: entry.level || 'info',
        message: entry.message || 'log',
    };
}

function formatLogLine(entry) {
    const normalized = normalizeEntry(entry);
    const { timestamp, level, message, ...metadata } = normalized;
    const suffix = Object.keys(metadata).length ? ` ${JSON.stringify(metadata)}` : '';

    return `${timestamp} ${String(level).toUpperCase()} ${message}${suffix}`;
}

function trimLogLines(lines) {
    const trimmed = lines.slice(-MAX_LOG_LINES);
    let totalBytes = 0;
    const output = [];

    for (let index = trimmed.length - 1; index >= 0; index--) {
        const line = trimmed[index];
        const lineBytes = new Blob([line, '\n']).size;

        if (output.length && totalBytes + lineBytes > MAX_LOG_BYTES) {
            break;
        }

        output.unshift(line);
        totalBytes += lineBytes;
    }

    return output;
}

async function appendLogEntries(entries) {
    if (!entries.length) {
        return;
    }

    const newLines = entries.map((entry) => formatLogLine(entry));
    const result = await storageGet({ [LOG_STORAGE_KEY]: [] });
    const existingLines = Array.isArray(result[LOG_STORAGE_KEY])
        ? result[LOG_STORAGE_KEY]
        : [];
    const lines = trimLogLines([...existingLines, ...newLines]);

    await storageSet({
        [LOG_STORAGE_KEY]: lines,
        [LOG_UPDATED_AT_KEY]: new Date().toISOString(),
    });
}

function scheduleLogFlush() {
    if (flushTimer) {
        return;
    }

    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushPendingLogs();
    }, LOG_FLUSH_DELAY_MS);
}

async function flushPendingLogs() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }

    if (!pendingLogEntries.length) {
        await writeQueue;
        return;
    }

    const entries = pendingLogEntries;
    const callbacks = pendingLogCallbacks;

    pendingLogEntries = [];
    pendingLogCallbacks = [];

    const writePromise = writeQueue.then(() => appendLogEntries(entries));
    writeQueue = writePromise.catch(() => undefined);

    try {
        await writePromise;
        callbacks.forEach(({ resolve }) => resolve(undefined));
    } catch (error) {
        console.warn('[yt-auto-timestamps:background] failed to write log', error);
        callbacks.forEach(({ reject }) => reject(error));
    }
}

function queueLog(entry) {
    const queued = new Promise((resolve, reject) => {
        pendingLogEntries.push(entry);
        pendingLogCallbacks.push({ resolve, reject });
        scheduleLogFlush();
    });

    return queued;
}

async function flushLogFile() {
    if (flushInProgress) {
        return;
    }

    flushInProgress = true;

    try {
        await flushPendingLogs();

        const result = await storageGet({
            [LOG_STORAGE_KEY]: [],
            [LOG_UPDATED_AT_KEY]: null,
        });
        const lines = Array.isArray(result[LOG_STORAGE_KEY])
            ? result[LOG_STORAGE_KEY]
            : [];
        const updatedAt = result[LOG_UPDATED_AT_KEY] || new Date().toISOString();
        const body = [
            '# YT Auto Timestamps log',
            `# Last updated: ${updatedAt}`,
            `# Lines retained: ${lines.length}/${MAX_LOG_LINES}`,
            `# Size cap: ${MAX_LOG_BYTES} bytes`,
            '',
            ...lines,
            '',
        ].join('\n');
        // Avoid Chrome inferring a .txt extension from text/plain.
        const url = `data:application/octet-stream;charset=utf-8,${encodeURIComponent(body)}`;

        await downloadFile({
            url,
            filename: LOG_FILE_NAME,
            conflictAction: 'overwrite',
            saveAs: false,
        });
    } finally {
        flushInProgress = false;
    }
}

chromeApi['runtime']['onMessage']['addListener']((message, _sender, sendResponse) => {
    if (message?.type === 'YT_AUTO_TIMESTAMPS_EXPORT_LOG') {
        flushLogFile()
            .then(() => sendResponse({ ok: true }))
            .catch((error) => {
                console.warn('[yt-auto-timestamps:background] failed to export log file', error);
                sendResponse({ ok: false });
            });
        return true;
    }

    if (message?.type !== LOG_MESSAGE_TYPE) {
        return false;
    }

    queueLog(message.entry)
        .then(() => {
            sendResponse({ ok: true });
        })
        .catch((error) => {
            sendResponse({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        });

    return true;
});

chromeApi['runtime']['onInstalled']['addListener']((details) => {
    void queueLog({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'background installed',
        details,
    });
});

chromeApi['runtime']['onStartup']['addListener'](() => {
    void queueLog({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'background startup',
    });
});

})();
