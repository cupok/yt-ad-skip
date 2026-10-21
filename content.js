(() => {
// Config
const FILL_GROWS = true; // cancellation countdown animation style
const FILL_COLOR = 'rgba(60,140,255,0.85)'; // elapsed countdown
const TRACK_COLOR = 'rgba(0,0,0,0.8)'; // remaining countdown
const settingsApi = globalThis.YtAdSkipSettings;
let settings = { ...settingsApi.DEFAULTS };

const BUTTON_STYLE = {
    position: 'absolute',
    bottom: '130px',
    right: '20px',
    zIndex: 69,
    padding: '16px 28px',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.4)',
    borderRadius: '4px',
    font: '500 16px/1 sans-serif',
    cursor: 'pointer',
    backgroundColor: TRACK_COLOR,
    backgroundImage: `linear-gradient(${FILL_COLOR}, ${FILL_COLOR})`,
    backgroundPosition: 'left center',
    backgroundRepeat: 'no-repeat',
};

// Debug
const LOG_TO_FILE = true;
const LOG_MESSAGE_TYPE = 'YT_AD_SKIP_LOG';
const LOG_CONSOLE_PREFIX = '[yt-ad-skip]';
const LOG_THROTTLE_MS = 10000;
const CHAT_OPEN_MAX_ATTEMPTS = 3;

/** @type {any} */
const chromeApi = globalThis['chrome'];

let logSequence = 0;
const logThrottleState = new Map();

function log(message, ...details) {
    writeLog('info', message, details);
}

function logWarn(message, ...details) {
    writeLog('warn', message, details);
}

function logError(message, ...details) {
    writeLog('error', message, details);
}

function writeLog(level, message, details) {
    const entry = buildLogEntry(level, message, details);

    if (settings.debug) {
        const method = level === 'error'
            ? 'error'
            : level === 'warn'
                ? 'warn'
                : 'log';

        console[method](LOG_CONSOLE_PREFIX, entry.message, {
            details: entry.details,
            state: entry.state,
            sequence: entry.sequence,
        });
    }

    if (!LOG_TO_FILE) {
        return;
    }

    sendLogEntry(entry);
}

function buildLogEntry(level, message, details) {
    const entry = {
        timestamp: new Date().toISOString(),
        sequence: ++logSequence,
        level,
        message: String(message),
        pageUrl: window.location.href,
        videoId: getPageVideoId(),
        details: serializeLogDetails(details),
    };

    if (shouldIncludeLogState(level)) {
        entry.state = getLogState();
    }

    return entry;
}

function shouldIncludeLogState(level) {
    return level === 'warn' || level === 'error';
}

function sendLogEntry(entry) {
    const runtimeApi = chromeApi?.['runtime'];

    if (
        !runtimeApi ||
        typeof runtimeApi['sendMessage'] !== 'function'
    ) {
        return;
    }

    try {
        runtimeApi['sendMessage']({
            type: LOG_MESSAGE_TYPE,
            entry,
        }, () => {
            try {
                const error = runtimeApi['lastError'];

                if (error && settings.debug) {
                    console.debug(LOG_CONSOLE_PREFIX, 'log delivery failed', error.message);
                }
            } catch (_error) {
                // The extension context can disappear during reload/navigation.
            }
        });
    } catch (error) {
        if (settings.debug) {
            console.debug(LOG_CONSOLE_PREFIX, 'log delivery threw', error);
        }
    }
}

function getLogState() {
    try {
        return {
            runId,
            started,
            currentVideoSrc,
            activePlayer: describeVideo(activePlayer),
            segments: segments.map((segment) => ({ ...segment })),
            lastSkipButtonSegmentKey,
            skipButton: describeSkipButton(),
            timers: {
                openChat: Boolean(openChatTimer),
                close: Boolean(closeTimer),
                answerObserver: Boolean(answerObserver),
                answerStable: Boolean(answerStableTimer),
                answerTimeout: Boolean(answerTimeout),
                autoSkip: Boolean(autoSkipTimer),
                videoObserver: Boolean(videoObserver),
            },
            autoSkip: {
                enabled: settings.autoSkipDelay > 0,
                delay: settings.autoSkipDelay,
                segmentKey: autoSkipSegmentKey,
                deadline: autoSkipDeadline,
                pausedAt: autoSkipPausedAt,
                canceledSegments: [...canceledAutoSkipSegments],
            },
            fullscreen: {
                active: Boolean(document.fullscreenElement),
                element: describeElement(document.fullscreenElement),
            },
        };
    } catch (error) {
        return {
            logStateError: serializeLogValue(error),
        };
    }
}

function describeSkipButton() {
    if (!skipButton) {
        return null;
    }

    return {
        connected: skipButton.isConnected,
        display: skipButton.style.display,
        text: skipButton.textContent,
        parent: describeElement(skipButton.parentElement),
    };
}

function getPageVideoId() {
    try {
        return new URL(window.location.href).searchParams.get('v');
    } catch (_error) {
        return null;
    }
}

function serializeLogDetails(details) {
    if (!details.length) {
        return null;
    }

    if (details.length === 1) {
        return serializeLogValue(details[0]);
    }

    return details.map((detail) => serializeLogValue(detail));
}

function serializeLogValue(value, depth = 0, seen = new WeakSet()) {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'undefined'
    ) {
        return value;
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (typeof value === 'function') {
        return `[Function ${value.name || 'anonymous'}]`;
    }

    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        };
    }

    if (value instanceof HTMLMediaElement) {
        return describeVideo(value);
    }

    if (value instanceof Element) {
        return describeElement(value);
    }

    if (value instanceof Event) {
        return {
            type: value.type,
            target: serializeLogValue(value.target, depth + 1, seen),
            currentTarget: serializeLogValue(value.currentTarget, depth + 1, seen),
        };
    }

    if (depth >= 3) {
        return '[MaxDepth]';
    }

    if (seen.has(value)) {
        return '[Circular]';
    }

    seen.add(value);

    if (Array.isArray(value)) {
        return value.slice(0, 30).map((item) => serializeLogValue(item, depth + 1, seen));
    }

    const output = {};

    Object.entries(value).slice(0, 40).forEach(([key, item]) => {
        output[key] = serializeLogValue(item, depth + 1, seen);
    });

    return output;
}

function describeElement(element) {
    if (!(element instanceof Element)) {
        return null;
    }

    const text = normalizeText(element.textContent || '');

    return {
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        classes: typeof element.className === 'string' ? element.className : null,
        role: element.getAttribute('role'),
        ariaLabel: element.getAttribute('aria-label'),
        dataTargetId: element.getAttribute('data-target-id'),
        connected: element.isConnected,
        text: text ? text.slice(0, 160) : null,
    };
}

function describeVideo(video) {
    if (!(video instanceof HTMLMediaElement)) {
        return null;
    }

    return {
        src: getVideoSrc(video),
        currentTime: Number.isFinite(video.currentTime)
            ? Number(video.currentTime.toFixed(3))
            : null,
        duration: Number.isFinite(video.duration)
            ? Number(video.duration.toFixed(3))
            : video.duration,
        readyState: video.readyState,
        networkState: video.networkState,
        paused: video.paused,
        ended: video.ended,
        muted: video.muted,
        playbackRate: video.playbackRate,
        connected: video.isConnected,
    };
}

function shouldLogThrottled(key, signature, interval = LOG_THROTTLE_MS) {
    const now = Date.now();
    const previous = logThrottleState.get(key);

    if (
        !previous ||
        previous.signature !== signature ||
        now - previous.at >= interval
    ) {
        logThrottleState.set(key, { signature, at: now });
        return true;
    }

    return false;
}

// Selectors
const chatSelector = '[data-target-id="youchat_messages_section"]';
const watchFlexySelector = 'ytd-watch-flexy';
const watchFlexyFullscreenSelector = `${watchFlexySelector}[fullscreen]`;
const chatOpenButtonSelector = 'ytd-watch-flexy[fullscreen] .you-chat-entrypoint-button button';
const chatCloseButtonSelector = 'ytd-watch-flexy[fullscreen] #visibility-button button';
const chatTextareaSelector = '.chatInputViewModelChatInputForm .chatInputViewModelChatInput';
const chatTimestampItemSelector = '.ytwMarkdownDivTimestamp';

// Language follows YouTube's UI, then the browser's preferred language.
const SPONSOR_MARKER = '[SPONSOR]';
const FUNDRAISING_MARKER = '[FUNDRAISING]';
const TRANSLATIONS = {
    en: { cancelAutoSkip: 'Cancel auto-skip', secondsUnit: 's', sponsor: 'Sponsor segment', fundraising: 'Fundraising segment', topic: 'Topic' },
    uk: { cancelAutoSkip: 'Скасувати автопропуск', secondsUnit: ' с', sponsor: 'Спонсорський сегмент', fundraising: 'Збір коштів', topic: 'Тема' },
    ru: { cancelAutoSkip: 'Отменить автопропуск', secondsUnit: ' с', sponsor: 'Спонсорский сегмент', fundraising: 'Сбор средств', topic: 'Тема' },
};
const SPONSOR_LABEL_PATTERN = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(?:${Object.values(TRANSLATIONS).map(({ sponsor }) => sponsor).join('|')})(?=$|[^\\p{L}\\p{N}])`,
    'iu'
);
const FUNDRAISING_LABEL_PATTERN = new RegExp(
    `^(?:[-*•]\\s*)?(?:${Object.values(TRANSLATIONS).map(({ fundraising }) => fundraising).join('|')})(?=$|[^\\p{L}\\p{N}])`,
    'iu'
);

let userLanguage = detectUserLanguage();

function detectUserLanguage() {
    const candidates = [
        document.documentElement.lang,
        ...(navigator.languages || []),
        navigator.language,
    ];

    for (const candidate of candidates) {
        if (typeof candidate !== 'string' || !candidate.trim()) {
            continue;
        }

        try {
            const [language] = Intl.getCanonicalLocales(candidate.trim().replace(/_/g, '-'));

            if (language && Object.prototype.hasOwnProperty.call(TRANSLATIONS, language.split('-')[0])) {
                return language;
            }
        } catch (_error) {
            // Ignore malformed language tags and try the next preference.
        }
    }

    return 'en';
}

function getTranslations(language = userLanguage) {
    const baseLanguage = language.split('-')[0];

    return Object.prototype.hasOwnProperty.call(TRANSLATIONS, baseLanguage)
        ? TRANSLATIONS[baseLanguage]
        : TRANSLATIONS.en;
}

function getTimestampPrompt() {
    const { sponsor, fundraising, topic } = getTranslations();

    return `List the video's key timestamps. Write all topic descriptions in the language with BCP 47 tag "${userLanguage}", regardless of the video's language.
Also identify sponsor segments, paid advertisements, and fundraising or donation appeals, with start and end timestamps for each.
Use strictly this format, keeping the markers ${SPONSOR_MARKER} and ${FUNDRAISING_MARKER} exactly as written:
- (TIME) ${topic}.
- ${SPONSOR_MARKER} ${sponsor}: (START – END) ${topic}.
- ${FUNDRAISING_MARKER} ${fundraising}: (START – END) ${topic}.
Only use ${SPONSOR_MARKER} for clear sponsor or paid advertisement segments. Do not use it for ordinary topics or statements that there are no sponsors.
Only use ${FUNDRAISING_MARKER} for explicit requests to donate or raise money, including charity appeals and donation drives. Do not use it for ordinary discussions of fundraising or statements that no donations are requested.
For sponsor and fundraising lines, put the marker first and include exactly one start/end range. Do not add a leading chapter timestamp or repeat the start timestamp before the marker.
Use timestamps with ASCII digits in M:SS or H:MM:SS format.`;
}

// State
let currentVideoSrc = null;
let activePlayer = null;

let started = false;
let skipButton = null;
let skipButtonAnimation = null;
let lastSkipButtonSegmentKey = null;
let segments = [];
let autoSkipTimer = null;
let autoSkipSegmentKey = null;
let autoSkipStartedAt = null;
let autoSkipDeadline = null;
let autoSkipPausedAt = null;
let autoSkipTick = null;
let autoSkipGeneration = 0;
const canceledAutoSkipSegments = new Set();

let openChatTimer = null;
let closeTimer = null;
let chatOpenAttemptCount = 0;

let answerObserver = null;
let answerStableTimer = null;
let answerTimeout = null;

let videoObserver = null;

let shortcutsBound = false;
let fullscreenChangeBound = false;
let navigationBound = false;
let globalErrorLoggingBound = false;

const boundPlayers = new WeakSet();

// Used to prevent old async work from affecting a new video.
let runId = 0;

// Stores skippable lines that existed before our prompt.
// This helps avoid parsing an old answer from a previous run.
let ignoredSkipLines = new Set();
let ignoredTimestampLines = new Set();

// Helpers
function getVideoSrc(video) {
    return video.currentSrc || video.src || null;
}

function isCurrentRun(localRunId) {
    return localRunId === runId;
}

function isEditableTarget(target) {
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
    );
}

/**
 * Waits for one element to appear in the DOM.
 *
 * Uses MutationObserver instead of requestAnimationFrame/polling.
 *
 * @param {string} selector
 * @param {number} timeout
 * @param {number} localRunId
 * @returns {Promise<Element|null>}
 */
function waitForElement(selector, timeout, localRunId) {
    const existing = document.querySelector(selector);

    if (existing) {
        log('waitForElement found existing element', {
            selector,
            localRunId,
            element: describeElement(existing),
        });
        return Promise.resolve(existing);
    }

    log('waitForElement started', {
        selector,
        timeout,
        localRunId,
    });

    return new Promise((resolve) => {
        let resolved = false;

        const finish = (element, reason) => {
            if (resolved) {
                return;
            }

            resolved = true;
            observer.disconnect();
            clearTimeout(timeoutTimer);

            if (element) {
                log('waitForElement resolved', {
                    selector,
                    localRunId,
                    reason,
                    element: describeElement(element),
                });
            } else {
                const report = isCurrentRun(localRunId) ? logWarn : log;
                report('waitForElement resolved without element', {
                    selector,
                    localRunId,
                    reason,
                    currentRunId: runId,
                });
            }

            resolve(element);
        };

        const observer = new MutationObserver(() => {
            if (!isCurrentRun(localRunId)) {
                finish(null, 'stale-run');
                return;
            }

            const element = document.querySelector(selector);

            if (element) {
                finish(element, 'mutation');
            }
        });

        const timeoutTimer = setTimeout(() => {
            finish(null, 'timeout');
        }, timeout);

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    });
}

function clearTimers() {
    const hadTimers = {
        openChat: Boolean(openChatTimer),
        close: Boolean(closeTimer),
        answerObserver: Boolean(answerObserver),
        answerStable: Boolean(answerStableTimer),
        answerTimeout: Boolean(answerTimeout),
        autoSkip: Boolean(autoSkipTimer),
    };

    if (Object.values(hadTimers).some(Boolean)) {
        log('clearing timers', hadTimers);
    }

    if (openChatTimer) {
        clearTimeout(openChatTimer);
        openChatTimer = null;
    }

    if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
    }

    cancelAutoSkip('clear-timers');

    clearAnswerWatcher();
}

function clearAnswerWatcher() {
    const hadWatcherState = {
        answerObserver: Boolean(answerObserver),
        answerStable: Boolean(answerStableTimer),
        answerTimeout: Boolean(answerTimeout),
    };

    if (Object.values(hadWatcherState).some(Boolean)) {
        log('clearing answer watcher', hadWatcherState);
    }

    if (answerObserver) {
        answerObserver.disconnect();
        answerObserver = null;
    }

    if (answerStableTimer) {
        clearTimeout(answerStableTimer);
        answerStableTimer = null;
    }

    if (answerTimeout) {
        clearTimeout(answerTimeout);
        answerTimeout = null;
    }
}

function collectExistingSkipLines() {
    const lines = new Set();
    const chat = document.querySelector(chatSelector);

    if (!chat) {
        log('collectExistingSkipLines skipped because chat is missing', {
            selector: chatSelector,
        });
        return lines;
    }

    chat.querySelectorAll('li, p').forEach((node) => {
        const text = normalizeText(node.textContent || '');

        if (isSkippableLine(text)) {
            lines.add(text);
        }
    });

    log('collected existing skippable lines', {
        count: lines.size,
        lines: [...lines],
    });

    return lines;
}

function normalizeText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

function getTimestampLineSignature(node) {
    return JSON.stringify([
        normalizeText(node.textContent || ''),
        [...node.querySelectorAll(chatTimestampItemSelector)].map((timestamp) => timestamp.getAttribute('data-time')),
    ]);
}

function collectExistingTimestampLines() {
    const chat = document.querySelector(chatSelector);
    return new Set(chat
        ? [...chat.querySelectorAll('li, p')].map(getTimestampLineSignature)
        : []);
}

function isSponsorLine(text) {
    if (/\[SPONSOR\]/i.test(text)) {
        return true;
    }

    // Keep recognizing existing answers that predate the fixed marker.
    if (/\bsponsor(?:\s+segment)?\b/i.test(text)) {
        return true;
    }

    return SPONSOR_LABEL_PATTERN.test(text);
}

function isSkippableLine(text) {
    return isSponsorLine(text) || /\[FUNDRAISING\]/i.test(text)
        || FUNDRAISING_LABEL_PATTERN.test(text.trim());
}

function getChatSnapshot(chat = document.querySelector(chatSelector)) {
    if (!(chat instanceof Element)) {
        return null;
    }

    const nodes = [...chat.querySelectorAll('li, p')];
    const texts = nodes
        .map((node) => normalizeText(node.textContent || ''))
        .filter(Boolean);
    const skipTexts = texts.filter((text) => isSkippableLine(text));

    return {
        element: describeElement(chat),
        itemCount: nodes.length,
        timestampCount: chat.querySelectorAll(chatTimestampItemSelector).length,
        newTimestampCount: nodes.reduce((count, node) => {
            return count + (ignoredTimestampLines.has(getTimestampLineSignature(node))
                ? 0 : node.querySelectorAll(chatTimestampItemSelector).length);
        }, 0),
        skippableCandidateCount: skipTexts.length,
        textSample: normalizeText(chat.textContent || '').slice(0, 500),
        skippableSamples: skipTexts.slice(0, 10),
    };
}

function hasTimestampAnswer(chatSnapshot) {
    return Boolean(chatSnapshot && chatSnapshot.newTimestampCount > 0);
}

function isVisibleElement(element) {
    if (!(element instanceof HTMLElement)) {
        return false;
    }

    const style = window.getComputedStyle(element);

    return (
        element.isConnected &&
        !element.hidden &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        element.getClientRects().length > 0
    );
}

/**
 * @returns {Array<Document|Element>}
 */
function getChatGlobalSearchRoots() {
    const roots = [];

    if (document.fullscreenElement) {
        roots.push(document.fullscreenElement);
    }

    roots.push(document);

    return [...new Set(roots)];
}

/**
 * @param {string[]} selectors
 * @param {Array<Document|Element>} roots
 * @returns {{ element: HTMLElement, selector: string, root: ReturnType<typeof describeElement> }|null}
 */
function findClickableElement(selectors, roots = [document]) {
    for (const root of roots) {
        for (const selector of selectors) {
            const elements = [...root.querySelectorAll(selector)];
            const element = elements.find((candidate) => {
                return isVisibleElement(candidate) && !candidate.hasAttribute('disabled');
            });

            if (element instanceof HTMLElement) {
                return {
                    element,
                    selector,
                    root: describeElement(root instanceof Element ? root : document.documentElement),
                };
            }
        }
    }

    return null;
}

function scheduleChatClose(localRunId, reason) {
    if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
    }

    log('chat close scheduled', {
        localRunId,
        reason,
        delay: settings.closeDelay,
    });

    closeTimer = setTimeout(() => {
        closeTimer = null;
        if (isCurrentRun(localRunId)) {
            clearAnswerWatcher();
        }
        closeChat(localRunId, reason);
    }, settings.closeDelay);
}

function closeChat(localRunId, reason) {
    if (!isCurrentRun(localRunId)) {
        log('chat close aborted because run is stale', {
            localRunId,
            currentRunId: runId,
            reason,
        });
        return false;
    }

    if (!document.fullscreenElement) {
        log('chat close skipped because fullscreen is inactive', {
            localRunId,
            reason,
            chat: getChatSnapshot(),
        });
        return false;
    }

    const globalRoots = getChatGlobalSearchRoots();
    const closeButton = findClickableElement([chatCloseButtonSelector], globalRoots);

    if (closeButton) {
        log('clicking chat close button', {
            reason,
            selector: closeButton.selector,
            root: closeButton.root,
            button: describeElement(closeButton.element),
        });
        closeButton.element.click();
        return true;
    }

    logWarn('chat close button not found', {
        reason,
        closeSelector: chatCloseButtonSelector,
        globalRoots: globalRoots.map((root) => {
            return describeElement(root instanceof Element ? root : document.documentElement);
        }),
        chat: getChatSnapshot(),
    });

    return false;
}

function findCurrentSegment(video) {
    if (!(video instanceof HTMLMediaElement)) {
        return null;
    }

    return segments.find((item) => {
        return video.currentTime >= item.start && video.currentTime < getSegmentEnd(item, video);
    }) || null;
}

function getSegmentEnd(segment, video) {
    if (
        video instanceof HTMLMediaElement &&
        Number.isFinite(video.duration)
    ) {
        return Math.min(segment.end, video.duration);
    }

    return segment.end;
}

function cancelAutoSkip(reason, details = {}) {
    const hadAutoSkip = Boolean(autoSkipTimer || autoSkipSegmentKey);
    autoSkipGeneration++;

    if (autoSkipTimer) {
        clearTimeout(autoSkipTimer);
        autoSkipTimer = null;
    }

    const segmentKey = autoSkipSegmentKey;
    autoSkipSegmentKey = null;
    autoSkipStartedAt = null;
    autoSkipDeadline = null;
    autoSkipPausedAt = null;
    autoSkipTick = null;
    if (skipButtonAnimation) {
        skipButtonAnimation.cancel();
        skipButtonAnimation = null;
    }
    if (skipButton) {
        skipButton.style.display = 'none';
    }
    lastSkipButtonSegmentKey = null;

    if (hadAutoSkip) {
        log('autoskip canceled', {
            reason,
            segmentKey,
            ...details,
        });
    }
}

function armAutoSkipTimer() {
    if (autoSkipTimer || autoSkipPausedAt !== null || !autoSkipTick) {
        return;
    }

    const tick = autoSkipTick;
    const timer = setTimeout(() => {
        // A callback already queued before pause/reset must not resume old work.
        if (autoSkipTimer !== timer) {
            return;
        }
        autoSkipTimer = null;
        tick();
    }, Math.min(1000, Math.max(0, autoSkipDeadline - Date.now())));
    autoSkipTimer = timer;
}

function syncAutoSkipPlayback(video) {
    const now = Date.now();
    if (video.paused) {
        if (autoSkipPausedAt === null) {
            autoSkipPausedAt = now;
        }
        if (autoSkipTimer) {
            clearTimeout(autoSkipTimer);
            autoSkipTimer = null;
        }
    } else if (autoSkipPausedAt !== null) {
        const pausedDuration = now - autoSkipPausedAt;
        autoSkipStartedAt += pausedDuration;
        autoSkipDeadline += pausedDuration;
        autoSkipPausedAt = null;
    }
    armAutoSkipTimer();
}

function scheduleAutoSkip(video, segment, segmentKey) {
    if (settings.autoSkipDelay <= 0 || canceledAutoSkipSegments.has(segmentKey)) {
        return;
    }

    if (autoSkipSegmentKey === segmentKey) {
        syncAutoSkipPlayback(video);
        return;
    }

    if (autoSkipSegmentKey) {
        cancelAutoSkip('segment-changed', {
            nextSegmentKey: segmentKey,
        });
    }

    const localRunId = runId;
    const generation = ++autoSkipGeneration;

    autoSkipSegmentKey = segmentKey;
    autoSkipStartedAt = Date.now();
    autoSkipDeadline = autoSkipStartedAt + settings.autoSkipDelay;

    log('autoskip scheduled', {
        localRunId,
        segment,
        segmentKey,
        delay: settings.autoSkipDelay,
        currentTime: video.currentTime,
    });

    autoSkipTick = () => {
        if (!isCurrentRun(localRunId) || generation !== autoSkipGeneration) {
            return;
        }
        const currentSegment = findCurrentSegment(video);
        const currentSegmentKey = currentSegment
            ? `${currentSegment.start}-${currentSegment.end}`
            : null;

        if (!(video instanceof HTMLMediaElement) || !video.isConnected) {
            cancelAutoSkip('video-unavailable', {
                localRunId,
                segment,
                segmentKey,
                video: describeVideo(video),
            });
            return;
        }

        if (currentSegmentKey !== segmentKey) {
            cancelAutoSkip('left-segment', {
                localRunId,
                segment,
                segmentKey,
                currentSegment,
                currentSegmentKey,
                currentTime: video.currentTime,
            });
            return;
        }

        const remaining = autoSkipDeadline - Date.now();
        if (remaining > 0 || video.paused) {
            updateSkipButton(video);
            return;
        }

        const segmentEnd = getSegmentEnd(segment, video);

        log('autoskip seeking to segment end', {
            localRunId,
            segment,
            segmentKey,
            segmentEnd,
            currentTimeBefore: video.currentTime,
        });

        cancelAutoSkip('completed');
        video.currentTime = segmentEnd;

        log('autoskip completed seek', {
            localRunId,
            segment,
            segmentKey,
            currentTimeAfter: video.currentTime,
        });
    };

    syncAutoSkipPlayback(video);
}

function getStartBlockReasons(video) {
    const reasons = [];

    if (started) {
        reasons.push('already-started');
    }

    if (!(video instanceof HTMLMediaElement)) {
        reasons.push('missing-video');
        return reasons;
    }

    if (video.readyState < 3) {
        reasons.push(`ready-state-${video.readyState}`);
    }

    if (!Number.isFinite(video.duration)) {
        reasons.push(`duration-${video.duration}`);
    } else if (video.duration < 180) {
        reasons.push(`duration-too-short-${Math.round(video.duration)}`);
    }

    if (!document.fullscreenElement) {
        reasons.push('not-fullscreen');
    }

    return reasons;
}

function getStartGateSnapshot(video, eventType) {
    return {
        eventType,
        reasons: getStartBlockReasons(video),
        video: describeVideo(video),
        fullscreenElement: describeElement(document.fullscreenElement),
    };
}

// Player events
function bindPlayerEvents(player) {
    if (!player) {
        logWarn('bindPlayerEvents called without player');
        activePlayer = player;
        return;
    }

    if (boundPlayers.has(player)) {
        log('bindPlayerEvents skipped because player is already bound', describeVideo(player));
        activePlayer = player;
        return;
    }

    boundPlayers.add(player);
    activePlayer = player;

    const events = [
        'emptied',
        'loadedmetadata',
        'durationchange',
        'play',
        'pause',
        'timeupdate',
        'seeking',
        'seeked',
    ];

    const handleEvent = (event) => {
        const video = event.currentTarget;
        activePlayer = video;

        const videoSrc = getVideoSrc(video);

        if (event.type !== 'timeupdate') {
            log('player event', {
                type: event.type,
                video: describeVideo(video),
            });
        }

        if (
            event.type === 'emptied' &&
            currentVideoSrc &&
            videoSrc &&
            videoSrc !== currentVideoSrc
        ) {
            cancelAutoSkip('video-src-changed', {
                previousSrc: currentVideoSrc,
                nextSrc: videoSrc,
            });
            // Replacing the media source is a normal player lifecycle event.
            log('player emptied with a different video src; resetting', {
                previousSrc: currentVideoSrc,
                nextSrc: videoSrc,
            });
            reset();
            return;
        }

        // Start only in fullscreen, same as original logic.
        // Number.isFinite() avoids live streams / Infinity duration.
        if (!started) {
            const startBlockReasons = getStartBlockReasons(video);

            if (!startBlockReasons.length) {
                log('start gate passed from player event', getStartGateSnapshot(video, event.type));
                start(video);
            } else if (
                event.type !== 'timeupdate' ||
                shouldLogThrottled(
                    'player-start-gate-blocked',
                    `${event.type}:${startBlockReasons.join('|')}`
                )
            ) {
                // Loading, unsupported durations, and windowed playback are
                // expected states, not extension failures.
                log('start gate blocked from player event', {
                    ...getStartGateSnapshot(video, event.type),
                    reasons: startBlockReasons,
                });
            }
        }

        // Do not require fullscreen here.
        // The button should remain usable after exiting fullscreen.
        if (segments.length) {
            updateSkipButton(video);
        } else if (
            started &&
            (
                event.type !== 'timeupdate' ||
                shouldLogThrottled('skip-update-no-segments', event.type)
            )
        ) {
            log('skip button update skipped because no segments are available', {
                eventType: event.type,
                video: describeVideo(video),
            });
        }
    };

    events.forEach((eventName) => {
        player.addEventListener(eventName, handleEvent);
    });

    log('player events bound', {
        video: describeVideo(player),
        events,
    });
}

// Chat flow
function timestamps(delay = settings.chatOpenDelay) {
    const localRunId = runId;

    log('timestamps flow scheduled', {
        localRunId,
        delay,
        nextAttempt: chatOpenAttemptCount + 1,
        maxAttempts: CHAT_OPEN_MAX_ATTEMPTS,
    });

    clearTimeout(openChatTimer);

    openChatTimer = setTimeout(() => {
        openChatTimer = null;

        if (!isCurrentRun(localRunId)) {
            log('timestamps flow aborted because run is stale', {
                localRunId,
                currentRunId: runId,
            });
            return;
        }

        if (!document.fullscreenElement) {
            started = false;
            chatOpenAttemptCount = 0;

            log('timestamps flow aborted because fullscreen is inactive', {
                localRunId,
                currentRunId: runId,
                video: describeVideo(activePlayer),
            });
            return;
        }

        log('timestamps flow started', { localRunId });

        // Save old skippable lines before opening/sending.
        // This reduces the chance of parsing a previous answer.
        ignoredSkipLines = document.querySelector(chatSelector)
            ? collectExistingSkipLines()
            : new Set();

        chatOpenAttemptCount++;
        const chatOpenButton = document.querySelector(chatOpenButtonSelector);

        if (!(chatOpenButton instanceof HTMLElement)) {
            const shouldRetry = chatOpenAttemptCount < CHAT_OPEN_MAX_ATTEMPTS;

            logWarn('chat open button not found', {
                selector: chatOpenButtonSelector,
                attempt: chatOpenAttemptCount,
                maxAttempts: CHAT_OPEN_MAX_ATTEMPTS,
                willRetry: shouldRetry,
                retryDelay: shouldRetry ? settings.chatOpenRetryDelay : null,
                fullscreenElement: describeElement(document.fullscreenElement),
                matchingWatchFlexyCount: document.querySelectorAll(watchFlexySelector).length,
                fullscreenWatchFlexyCount: document.querySelectorAll(watchFlexyFullscreenSelector).length,
            });

            if (shouldRetry) {
                timestamps(settings.chatOpenRetryDelay);
            }

            return;
        }

        chatOpenAttemptCount = 0;

        log('clicking chat open button', {
            button: describeElement(chatOpenButton),
        });
        chatOpenButton.click();

        void sendPrompt(localRunId).catch((error) => {
            logError('send prompt failed', error);
        });
    }, delay);
}

async function sendPrompt(localRunId) {
    log('sendPrompt waiting for textarea', {
        localRunId,
        selector: chatTextareaSelector,
        timeout: settings.chatTextareaTimeout,
    });

    const textarea = await waitForElement(
        chatTextareaSelector,
        settings.chatTextareaTimeout,
        localRunId
    );

    if (!isCurrentRun(localRunId)) {
        log('sendPrompt aborted because run is stale', {
            localRunId,
            currentRunId: runId,
        });
        return;
    }

    if (!(textarea instanceof HTMLElement)) {
        logWarn('chat textarea not found', {
            selector: chatTextareaSelector,
            localRunId,
        });
        return;
    }

    const timestampPrompt = getTimestampPrompt();
    // Chat history may appear only after opening the panel. Capture it just
    // before submission so old timestamps cannot start the closing countdown.
    ignoredSkipLines = collectExistingSkipLines();
    ignoredTimestampLines = collectExistingTimestampLines();

    log('chat textarea found; setting prompt', {
        textarea: describeElement(textarea),
        promptLength: timestampPrompt.length,
        language: userLanguage,
    });

    setTextInputValue(textarea, timestampPrompt);

    textarea.focus();

    log('dispatching Enter to submit prompt', {
        textarea: describeElement(textarea),
    });

    textarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
    }));

    log('prompt submitted; watching for answer', {
        localRunId,
    });

    await watchForAnswer(localRunId);
}

function setTextInputValue(element, value) {
    log('setTextInputValue called', {
        element: describeElement(element),
        valueLength: value.length,
    });

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.value = value;
    } else {
        element.textContent = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));

    log('input event dispatched', {
        element: describeElement(element),
        valueLength: value.length,
    });
}

async function watchForAnswer(localRunId) {
    log('watchForAnswer starting', {
        localRunId,
        chatSelector,
        timeout: settings.chatTextareaTimeout,
    });

    clearAnswerWatcher();

    const chat = await waitForElement(
        chatSelector,
        settings.chatTextareaTimeout,
        localRunId
    );

    if (!isCurrentRun(localRunId)) {
        log('watchForAnswer aborted because run is stale', {
            localRunId,
            currentRunId: runId,
        });
        return;
    }

    if (!chat) {
        logWarn('chat not found while watching for answer', {
            selector: chatSelector,
            localRunId,
        });
        return;
    }

    log('chat found; installing answer observer', {
        localRunId,
        chat: getChatSnapshot(chat),
    });

    let parseScheduleCount = 0;
    let observedMutationCount = 0;

    const scheduleParse = (mutations = []) => {
        parseScheduleCount++;
        observedMutationCount += mutations.length;

        if (!isCurrentRun(localRunId)) {
            log('answer parse schedule aborted because run is stale', {
                localRunId,
                currentRunId: runId,
                parseScheduleCount,
                observedMutationCount,
            });
            clearAnswerWatcher();
            return;
        }

        if (answerStableTimer) {
            clearTimeout(answerStableTimer);
        }

        // Keep the panel open while the response continues streaming, even if
        // an earlier pause already started a closing countdown.
        if (mutations.length && closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }

        if (hasTimestampAnswer(getChatSnapshot(chat)) && answerTimeout) {
            clearTimeout(answerTimeout);
            answerTimeout = null;
        }

        if (
            parseScheduleCount <= 3 ||
            shouldLogThrottled('answer-parse-scheduled', String(localRunId), 5000)
        ) {
            log('answer parse scheduled', {
                localRunId,
                parseScheduleCount,
                mutationBatchSize: mutations.length,
                observedMutationCount,
                chat: getChatSnapshot(chat),
            });
        }

        // Replaces setInterval polling.
        // YouChat streams the answer through DOM mutations, so we debounce parsing
        // until the DOM becomes quiet for a moment.
        answerStableTimer = setTimeout(() => {
            if (!isCurrentRun(localRunId)) {
                log('answer parse aborted because run is stale', {
                    localRunId,
                    currentRunId: runId,
                });
                clearAnswerWatcher();
                return;
            }

            const found = parseSegments();
            const chatSnapshot = getChatSnapshot(chat);

            log('answer parse completed', {
                localRunId,
                foundCount: found.length,
                found,
                chat: chatSnapshot,
            });

            if (!found.length) {
                log('answer parse produced no skippable segments', {
                    localRunId,
                    parseScheduleCount,
                    observedMutationCount,
                    chat: chatSnapshot,
                });

                if (hasTimestampAnswer(chatSnapshot)) {
                    log('answer has timestamps but no skippable segments; closing chat', {
                        localRunId,
                        chat: chatSnapshot,
                    });
                    scheduleChatClose(localRunId, 'answer-without-skippable-segments');
                }

                return;
            }

            segments = found;

            log('segments stored', {
                localRunId,
                segments,
            });

            scheduleChatClose(localRunId, 'segments-stored');

            if (activePlayer) {
                log('updating skip button after segments stored', {
                    video: describeVideo(activePlayer),
                });
                updateSkipButton(activePlayer);
            } else {
                logWarn('segments stored but active player is missing');
            }
        }, settings.answerStableDelay);
    };

    answerObserver = new MutationObserver(scheduleParse);

    answerObserver.observe(chat, {
        childList: true,
        subtree: true,
        characterData: true,
    });

    answerTimeout = setTimeout(() => {
        if (!isCurrentRun(localRunId)) {
            return;
        }
        clearAnswerWatcher();
        logWarn('answer timeout', {
            localRunId,
            parseScheduleCount,
            observedMutationCount,
            chat: getChatSnapshot(chat),
            chatLeftOpen: true,
        });
    }, settings.answerTimeout);

    // Parse once immediately in case the answer appears before the observer starts.
    scheduleParse();
}

// Parsing
function timestampTextToSeconds(timestamp) {
    const parts = timestamp.split(':').map(Number);
    if (parts.slice(1).some(part => part > 59)) {
        return NaN;
    }
    return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

function parseSegments() {
    const found = [];
    const chat = document.querySelector(chatSelector);

    if (!chat) {
        logWarn('parseSegments skipped because chat is missing', {
            selector: chatSelector,
        });
        return [];
    }

    /** @type {Array<Record<string, unknown>>} */
    const rejectedSamples = [];

    const stats = {
        itemCount: 0,
        nonSkippableLineCount: 0,
        skippableCandidateCount: 0,
        ignoredExistingCount: 0,
        missingTimestampCount: 0,
        invalidRangeCount: 0,
        acceptedCount: 0,
        rejectedSamples,
    };

    chat.querySelectorAll('li, p').forEach((node, index) => {
        stats.itemCount++;

        const text = normalizeText(node.textContent || '');

        if (!isSkippableLine(text)) {
            stats.nonSkippableLineCount++;
            return;
        }

        stats.skippableCandidateCount++;

        if (ignoredSkipLines.has(text)) {
            stats.ignoredExistingCount++;
            if (stats.rejectedSamples.length < 10) {
                stats.rejectedSamples.push({
                    index,
                    reason: 'ignored-existing-line',
                    text,
                });
            }
            return;
        }

        const timestamps = [...node.querySelectorAll(chatTimestampItemSelector)];
        const timestampAttributes = timestamps.map((timestamp) => {
            return timestamp.getAttribute('data-time') || '';
        });
        const times = timestampAttributes
            .map((value) => parseInt(String(value), 10))
            .filter((number) => Number.isFinite(number));

        if (times.length < 2) {
            stats.missingTimestampCount++;
            if (stats.rejectedSamples.length < 10) {
                stats.rejectedSamples.push({
                    index,
                    reason: 'missing-two-valid-timestamps',
                    text,
                    timestampAttributes,
                    parsedTimes: times,
                });
            }
            return;
        }

        let rangeOffset = 0;
        if (times.length === 3 && times[0] === times[1]) {
            // AI may prefix a range with its chapter time, e.g.
            // (19:07) [SPONSOR] Sponsor segment: (19:07 – 20:36).
            // Only discard that duplicate when the displayed range agrees with
            // the linked timestamps; an unrelated later link is not an endpoint.
            const repeatedRange = /^\((\d+:\d{2}(?::\d{2})?)\)\s+.*?\(\1\s*[–—-]\s*(\d+:\d{2}(?::\d{2})?)\)/.exec(text);
            if (repeatedRange
                && timestampTextToSeconds(repeatedRange[1]) === times[1]
                && timestampTextToSeconds(repeatedRange[2]) === times[2]) {
                rangeOffset = 1;
            }
        }
        const start = times[rangeOffset];
        const end = times[rangeOffset + 1];

        if (end <= start) {
            stats.invalidRangeCount++;
            if (stats.rejectedSamples.length < 10) {
                stats.rejectedSamples.push({
                    index,
                    reason: 'invalid-range',
                    text,
                    start,
                    end,
                });
            }
            return;
        }

        stats.acceptedCount++;
        found.push({
            start,
            end,
        });
    });

    log('parseSegments summary', {
        ...stats,
        found,
        chat: getChatSnapshot(chat),
    });

    return found;
}

// Auto-skip cancellation button
function updateSkipButton(video) {
    if (!(video instanceof HTMLMediaElement)) {
        logWarn('updateSkipButton called without a valid video', video);
        return;
    }

    if (skipButton && !skipButton.isConnected) {
        log('skip button reference is disconnected; recreating on next active segment', {
            button: describeSkipButton(),
            video: describeVideo(video),
        });
        skipButton = null;
        if (skipButtonAnimation) {
            skipButtonAnimation.cancel();
            skipButtonAnimation = null;
        }
        lastSkipButtonSegmentKey = null;
    }

    const segment = findCurrentSegment(video);

    if (!segment) {
        if (skipButton) {
            if (skipButton.style.display !== 'none') {
                log('hiding skip button because current time is outside skippable segments', {
                    currentTime: video.currentTime,
                    segments,
                });
            } else if (
                shouldLogThrottled(
                    'skip-button-no-current-segment',
                    `${Math.floor(video.currentTime)}:${segments.length}`
                )
            ) {
                log('skip button remains hidden outside skippable segments', {
                    currentTime: video.currentTime,
                    segments,
                });
            }

            skipButton.style.display = 'none';
        }

        cancelAutoSkip('left-segment', {
            currentTime: video.currentTime,
            video: describeVideo(video),
        });
        lastSkipButtonSegmentKey = null;
        return;
    }

    const segmentKey = `${segment.start}-${segment.end}`;
    if (settings.autoSkipDelay <= 0 || canceledAutoSkipSegments.has(segmentKey)) {
        cancelAutoSkip('disabled-or-canceled', { segmentKey });
        return;
    }
    scheduleAutoSkip(video, segment, segmentKey);

    if (!skipButton) {
        const videoContainer = document.querySelector('#player-container');

        if (!videoContainer) {
            logWarn('player container not found while creating skip button', {
                selector: '#player-container',
                segment,
                video: describeVideo(video),
            });
            return;
        }

        log('creating skip button', {
            videoContainer: describeElement(videoContainer),
            segment,
        });

        skipButton = document.createElement('button');
        skipButton.type = 'button';

        Object.assign(skipButton.style, BUTTON_STYLE);

        videoContainer.appendChild(skipButton);

        log('skip button appended', {
            button: describeSkipButton(),
        });
    }

    const countdownNow = autoSkipPausedAt ?? Date.now();
    const elapsed = Math.max(0, countdownNow - autoSkipStartedAt);
    const duration = autoSkipDeadline - autoSkipStartedAt;
    let progress = elapsed / duration;
    progress = Math.min(1, Math.max(0, progress));

    const percent = (FILL_GROWS ? progress : 1 - progress) * 100;

    if (!skipButtonAnimation) {
        // Animate a numeric background size: gradient stops themselves do not
        // interpolate smoothly when replaced by the once-per-second timer.
        skipButtonAnimation = skipButton.animate([
            { backgroundSize: `${FILL_GROWS ? 0 : 100}% 100%` },
            { backgroundSize: `${FILL_GROWS ? 100 : 0}% 100%` },
        ], { duration, easing: 'linear', fill: 'both' });
        skipButtonAnimation.currentTime = Math.min(duration, elapsed);
    }
    // Let the browser advance the fill between events. Only seek its animation
    // when playback pauses/resumes, rather than restarting it on every update.
    if (autoSkipPausedAt !== null) {
        skipButtonAnimation.pause();
        skipButtonAnimation.currentTime = Math.min(duration, elapsed);
    } else if (skipButtonAnimation.playState === 'paused') {
        skipButtonAnimation.currentTime = Math.min(duration, elapsed);
        skipButtonAnimation.play();
    }
    skipButton.lang = userLanguage;
    skipButton.dir = 'auto';
    const remainingSeconds = Math.max(0, Math.ceil((autoSkipDeadline - countdownNow) / 1000));
    const { cancelAutoSkip: cancelLabel, secondsUnit } = getTranslations();
    skipButton.textContent = `${cancelLabel} (${remainingSeconds}${secondsUnit})`;

    const previousDisplay = skipButton.style.display;
    skipButton.style.display = 'block';

    if (lastSkipButtonSegmentKey !== segmentKey || previousDisplay !== 'block') {
        log('skip button shown/updated for active segment', {
            segment,
            currentTime: video.currentTime,
            progress,
            percent,
            previousDisplay,
            button: describeSkipButton(),
        });
    }

    lastSkipButtonSegmentKey = segmentKey;

    const buttonRunId = runId;
    const buttonGeneration = autoSkipGeneration;
    skipButton.onclick = () => {
        if (!isCurrentRun(buttonRunId) || autoSkipSegmentKey !== segmentKey || buttonGeneration !== autoSkipGeneration) {
            return;
        }

        canceledAutoSkipSegments.add(segmentKey);
        cancelAutoSkip('user-canceled', {
            segment,
            segmentKey,
            currentTime: video.currentTime,
        });
    };
}

// Shortcuts
function bindShortcuts() {
    if (shortcutsBound) {
        log('bindShortcuts skipped because shortcuts are already bound');
        return;
    }

    shortcutsBound = true;
    log('binding keyboard shortcuts');

    document.addEventListener('keydown', (event) => {
        // Skip segment: Mac = Opt+Right, Win = Ctrl+Alt+Right
        const isMacNext = event.altKey && !event.ctrlKey && event.code === 'ArrowRight';
        const isWinNext = event.ctrlKey && event.altKey && event.code === 'ArrowRight';

        if (!isMacNext && !isWinNext) {
            return;
        }

        log('skip shortcut detected', {
            code: event.code,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
            target: describeElement(event.target),
        });

        if (isEditableTarget(event.target)) {
            log('skip shortcut ignored because focus is editable', {
                target: describeElement(event.target),
            });
            return;
        }

        if (!segments.length) {
            log('skip shortcut ignored because no segments are available');
            return;
        }

        const video = activePlayer || document.querySelector('video');

        if (!video) {
            log('skip shortcut ignored because video is missing');
            return;
        }

        const segment = findCurrentSegment(video);

        if (!segment) {
            log('skip shortcut ignored because current time is outside skippable segments', {
                currentTime: video.currentTime,
                segments,
            });
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const segmentEnd = getSegmentEnd(segment, video);

        log('skip shortcut seeking to segment end', {
            segment,
            segmentEnd,
            currentTimeBefore: video.currentTime,
        });

        cancelAutoSkip('skip-shortcut', {
            segment,
            segmentKey: `${segment.start}-${segment.end}`,
            currentTime: video.currentTime,
        });

        video.currentTime = segmentEnd;

        if (skipButton) {
            skipButton.style.display = 'none';
        }

        lastSkipButtonSegmentKey = null;

        log('skip shortcut completed seek', {
            segment,
            segmentEnd,
            currentTimeAfter: video.currentTime,
        });
    }, true);
}

// Reset / start
function reset() {
    log('reset started', {
        previousRunId: runId,
        previousVideoSrc: currentVideoSrc,
        previousSegments: segments,
        hadSkipButton: Boolean(skipButton),
    });

    runId++;

    started = false;
    segments = [];
    lastSkipButtonSegmentKey = null;
    chatOpenAttemptCount = 0;
    ignoredSkipLines = new Set();
    ignoredTimestampLines = new Set();

    clearTimers();
    canceledAutoSkipSegments.clear();

    if (skipButton) {
        log('removing skip button during reset', {
            button: describeSkipButton(),
        });
        skipButton.remove();
        skipButton = null;
    }

    log('reset completed', {
        runId,
        currentVideoSrc,
    });
}

function start(video) {
    const startBlockReasons = getStartBlockReasons(video);

    if (startBlockReasons.length) {
        logWarn('start called even though start gate has blockers', {
            reasons: startBlockReasons,
            video: describeVideo(video),
        });
    }

    userLanguage = detectUserLanguage();
    started = true;
    currentVideoSrc = getVideoSrc(video);
    activePlayer = video;
    chatOpenAttemptCount = 0;

    log('start completed; launching timestamps flow', {
        video: describeVideo(video),
        currentVideoSrc,
        language: userLanguage,
    });

    timestamps();
}

// Fullscreen / navigation
function bindFullscreenChange() {
    if (fullscreenChangeBound) {
        log('bindFullscreenChange skipped because listener is already bound');
        return;
    }

    fullscreenChangeBound = true;
    log('binding fullscreenchange listener');

    document.addEventListener('fullscreenchange', () => {
        const video = activePlayer || document.querySelector('video');

        if (!video) {
            log('fullscreenchange ignored because no video was found', {
                fullscreenElement: describeElement(document.fullscreenElement),
            });
            return;
        }

        log('fullscreenchange received', {
            video: describeVideo(video),
            fullscreenElement: describeElement(document.fullscreenElement),
        });

        // Entering fullscreen can be the moment when we should start.
        if (!started) {
            const startBlockReasons = getStartBlockReasons(video);

            if (!startBlockReasons.length) {
                log('start gate passed from fullscreenchange', getStartGateSnapshot(video, 'fullscreenchange'));
                start(video);
            } else {
                log('start gate blocked from fullscreenchange', {
                    ...getStartGateSnapshot(video, 'fullscreenchange'),
                    reasons: startBlockReasons,
                });
            }
        }

        if (segments.length) {
            log('updating skip button after fullscreenchange', {
                segmentCount: segments.length,
            });
            updateSkipButton(video);
        } else {
            log('fullscreenchange did not update skip button because no segments are available');
        }
    });
}

function bindNavigationEvents() {
    if (navigationBound) {
        log('bindNavigationEvents skipped because listener is already bound');
        return;
    }

    navigationBound = true;
    log('binding YouTube navigation listener');

    // YouTube is an SPA. Reset old segments/timers when navigating to another video.
    window.addEventListener('yt-navigate-finish', () => {
        log('yt-navigate-finish received', {
            pageUrl: window.location.href,
            videoId: getPageVideoId(),
        });
        reset();
        bindCurrentOrFutureVideo();
    });
}

// Video detection
function bindCurrentOrFutureVideo() {
    if (videoObserver) {
        log('disconnecting existing video observer before rebinding');
        videoObserver.disconnect();
        videoObserver = null;
    }

    const existingPlayer = document.querySelector('video');

    if (existingPlayer) {
        log('existing video found', {
            video: describeVideo(existingPlayer),
        });
        bindPlayerEvents(existingPlayer);
        return;
    }

    log('no existing video found; installing video observer');

    videoObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) {
                    continue;
                }

                const player = node.matches('video')
                    ? node
                    : node.querySelector('video');

                if (player) {
                    log('video found by mutation observer', {
                        mutationType: mutation.type,
                        addedNode: describeElement(node),
                        video: describeVideo(player),
                    });

                    videoObserver.disconnect();
                    videoObserver = null;

                    bindPlayerEvents(player);
                    return;
                }
            }
        }
    });

    videoObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });

    log('waiting for video');
}

// Init
function bindGlobalErrorLogging() {
    if (globalErrorLoggingBound) {
        log('bindGlobalErrorLogging skipped because listeners are already bound');
        return;
    }

    globalErrorLoggingBound = true;

    window.addEventListener('error', (event) => {
        if (isIgnoredWindowError(event.message)) {
            return;
        }

        logError('window error captured', {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            error: event.error,
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        logError('unhandled promise rejection captured', {
            reason: event.reason,
        });
    });

    log('global error logging bound');
}

function isIgnoredWindowError(message) {
    return (
        message === 'ResizeObserver loop completed with undelivered notifications.' ||
        message === 'ResizeObserver loop limit exceeded'
    );
}

async function loadSettings() {
    try {
        const result = await new Promise((resolve, reject) => {
            chromeApi.storage.local.get({ [settingsApi.STORAGE_KEY]: settingsApi.DEFAULTS }, (values) => {
                const error = chromeApi.runtime.lastError;
                if (error) {
                    reject(error);
                    return;
                }
                resolve(values);
            });
        });
        settings = settingsApi.normalize(result[settingsApi.STORAGE_KEY]);
    } catch (error) {
        logWarn('could not load settings; using defaults', error);
    }
}

function bindSettingsChanges() {
    chromeApi.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !Object.prototype.hasOwnProperty.call(changes, settingsApi.STORAGE_KEY)) {
            return;
        }
        const previousAutoSkipDelay = settings.autoSkipDelay;
        settings = settingsApi.normalize(changes[settingsApi.STORAGE_KEY].newValue);
        log('settings updated', settings);

        if (previousAutoSkipDelay !== settings.autoSkipDelay) {
            cancelAutoSkip('settings-changed');
            if (activePlayer && segments.length) {
                updateSkipButton(activePlayer);
            }
        }
    });
}

async function init() {
    await loadSettings();
    bindSettingsChanges();

    log('init started', {
        manifestHint: 'YT Ad Skip',
        pageUrl: window.location.href,
        readyState: document.readyState,
        language: userLanguage,
    });

    bindGlobalErrorLogging();
    bindShortcuts();
    bindFullscreenChange();
    bindNavigationEvents();
    bindCurrentOrFutureVideo();

    log('init completed');
}

init();
})();
