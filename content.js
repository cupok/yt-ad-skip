(() => {
// Config
const FILL_GROWS = true; // skip button animation style
const FILL_COLOR = 'rgba(60,140,255,0.85)'; // played portion
const TRACK_COLOR = 'rgba(0,0,0,0.8)'; // remaining portion
const CLOSE_DELAY = 10000; // chat panel closing delay

const CHAT_OPEN_DELAY = 1000;
const CHAT_TEXTAREA_TIMEOUT = 10000;
const ANSWER_TIMEOUT = 30000;
const ANSWER_STABLE_DELAY = 1200;

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
    transition: 'background 0.3s linear',
};

// Debug
const DEBUG = true;
const LOG_TO_FILE = true;
const LOG_MESSAGE_TYPE = 'YT_AUTO_TIMESTAMPS_LOG';
const LOG_CONSOLE_PREFIX = '[yt-auto-timestamps]';
const LOG_THROTTLE_MS = 10000;

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

    if (DEBUG) {
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
    return {
        timestamp: new Date().toISOString(),
        sequence: ++logSequence,
        level,
        message: String(message),
        pageUrl: window.location.href,
        videoId: getPageVideoId(),
        state: getLogState(),
        details: serializeLogDetails(details),
    };
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

                if (error && DEBUG) {
                    console.debug(LOG_CONSOLE_PREFIX, 'log delivery failed', error.message);
                }
            } catch (_error) {
                // The extension context can disappear during reload/navigation.
            }
        });
    } catch (error) {
        if (DEBUG) {
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
                videoObserver: Boolean(videoObserver),
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
const chatPanelContainerSelector = [
    'ytd-engagement-panel-section-list-renderer',
    'ytd-live-chat-frame',
].join(', ');
const watchFlexySelector = 'ytd-watch-flexy';
const watchFlexyFullscreenSelector = `${watchFlexySelector}[fullscreen]`;
const chatOpenButtonSelector = 'ytd-watch-flexy[fullscreen] .you-chat-entrypoint-button button';
const chatCloseButtonSelector = 'ytd-watch-flexy[fullscreen] #visibility-button button';
const chatGlobalCloseButtonSelectors = [
    chatCloseButtonSelector,
    '#visibility-button button',
];
const chatCloseButtonSelectors = [
    ...chatGlobalCloseButtonSelectors,
    'button[aria-label*="close" i]',
    'button[aria-label*="hide chat" i]',
    'button[aria-label*="close chat" i]',
    'button[title*="close" i]',
    'yt-icon-button[aria-label*="close" i]',
    'tp-yt-paper-icon-button[aria-label*="close" i]',
];
const chatToggleButtonSelectors = [
    chatOpenButtonSelector,
    '.you-chat-entrypoint-button button',
];
const chatTextareaSelector = '.chatInputViewModelChatInputForm .chatInputViewModelChatInput';
const chatTimestampItemSelector = '.ytwMarkdownDivTimestamp';

// Prompt
const timestampPrompt = `List the video's key timestamps strictly in this format:
- (TIME) Topic.
- Sponsor segment: (START – END) Topic.
Only label a segment "sponsor" if it clearly is one.`;

// State
let currentVideoSrc = null;
let activePlayer = null;

let started = false;
let skipButton = null;
let lastSkipButtonSegmentKey = null;
let segments = [];

let openChatTimer = null;
let closeTimer = null;

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

// Stores sponsor lines that existed before our prompt.
// This helps avoid parsing an old answer from a previous run.
let ignoredSponsorLines = new Set();

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
                logWarn('waitForElement resolved without element', {
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

function collectExistingSponsorLines() {
    const lines = new Set();
    const chat = document.querySelector(chatSelector);

    if (!chat) {
        logWarn('collectExistingSponsorLines skipped because chat is missing', {
            selector: chatSelector,
        });
        return lines;
    }

    chat.querySelectorAll('li, p').forEach((node) => {
        const text = normalizeText(node.textContent || '');

        if (isSponsorLine(text)) {
            lines.add(text);
        }
    });

    log('collected existing sponsor lines', {
        count: lines.size,
        lines: [...lines],
    });

    return lines;
}

function normalizeText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

function isSponsorLine(text) {
    return /^\s*-?\s*sponsor(?:\s+segment)?\s*:/i.test(text);
}

function getChatSnapshot(chat = document.querySelector(chatSelector)) {
    if (!(chat instanceof Element)) {
        return null;
    }

    const nodes = [...chat.querySelectorAll('li, p')];
    const texts = nodes
        .map((node) => normalizeText(node.textContent || ''))
        .filter(Boolean);
    const sponsorTexts = texts.filter((text) => isSponsorLine(text));

    return {
        element: describeElement(chat),
        itemCount: nodes.length,
        timestampCount: chat.querySelectorAll(chatTimestampItemSelector).length,
        sponsorCandidateCount: sponsorTexts.length,
        textSample: normalizeText(chat.textContent || '').slice(0, 500),
        sponsorSamples: sponsorTexts.slice(0, 10),
    };
}

function hasTimestampAnswer(chatSnapshot) {
    return Boolean(chatSnapshot && chatSnapshot.timestampCount > 0);
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
function getChatPanelSearchRoots() {
    const roots = [];
    const chat = document.querySelector(chatSelector);
    const chatPanel = chat?.closest(chatPanelContainerSelector);

    if (chatPanel) {
        roots.push(chatPanel);
    }

    if (chat) {
        roots.push(chat);
    }

    return [...new Set(roots)];
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
        delay: CLOSE_DELAY,
    });

    closeTimer = setTimeout(() => {
        closeTimer = null;
        closeChat(localRunId, reason);
    }, CLOSE_DELAY);
}

function closeChat(localRunId, reason) {
    if (!isCurrentRun(localRunId)) {
        logWarn('chat close aborted because run is stale', {
            localRunId,
            currentRunId: runId,
            reason,
        });
        return false;
    }

    const panelRoots = getChatPanelSearchRoots();
    const globalRoots = getChatGlobalSearchRoots();
    const closeButton =
        findClickableElement(chatCloseButtonSelectors, panelRoots) ||
        findClickableElement(chatGlobalCloseButtonSelectors, globalRoots);

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

    const toggleButton = findClickableElement(chatToggleButtonSelectors, globalRoots);

    if (toggleButton) {
        logWarn('chat close button not found; clicking chat toggle button', {
            reason,
            closeSelectors: chatCloseButtonSelectors,
            globalCloseSelectors: chatGlobalCloseButtonSelectors,
            toggleSelector: toggleButton.selector,
            root: toggleButton.root,
            button: describeElement(toggleButton.element),
            chat: getChatSnapshot(),
        });
        toggleButton.element.click();
        return true;
    }

    logWarn('no chat close or toggle button found', {
        reason,
        closeSelectors: chatCloseButtonSelectors,
        globalCloseSelectors: chatGlobalCloseButtonSelectors,
        toggleSelectors: chatToggleButtonSelectors,
        panelRoots: panelRoots.map((root) => {
            return describeElement(root instanceof Element ? root : document.documentElement);
        }),
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
        return video.currentTime >= item.start && video.currentTime < item.end;
    }) || null;
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
            logWarn('player emptied with a different video src; resetting', {
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
                logWarn('start gate blocked from player event', {
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
            logWarn('skip button update skipped because no segments are available', {
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
function timestamps() {
    const localRunId = runId;

    log('timestamps flow scheduled', {
        localRunId,
        delay: CHAT_OPEN_DELAY,
    });

    clearTimeout(openChatTimer);

    openChatTimer = setTimeout(() => {
        if (!isCurrentRun(localRunId)) {
            logWarn('timestamps flow aborted because run is stale', {
                localRunId,
                currentRunId: runId,
            });
            return;
        }

        log('timestamps flow started', { localRunId });

        // Save old sponsor lines before opening/sending.
        // This reduces the chance of parsing a previous answer.
        ignoredSponsorLines = collectExistingSponsorLines();

        const chatOpenButton = document.querySelector(chatOpenButtonSelector);

        if (!(chatOpenButton instanceof HTMLElement)) {
            logWarn('chat open button not found', {
                selector: chatOpenButtonSelector,
                fullscreenElement: describeElement(document.fullscreenElement),
                matchingWatchFlexyCount: document.querySelectorAll(watchFlexySelector).length,
                fullscreenWatchFlexyCount: document.querySelectorAll(watchFlexyFullscreenSelector).length,
            });
            started = false;
            return;
        }

        log('clicking chat open button', {
            button: describeElement(chatOpenButton),
        });
        chatOpenButton.click();

        void sendPrompt(localRunId).catch((error) => {
            logError('send prompt failed', error);
        });
    }, CHAT_OPEN_DELAY);
}

async function sendPrompt(localRunId) {
    log('sendPrompt waiting for textarea', {
        localRunId,
        selector: chatTextareaSelector,
        timeout: CHAT_TEXTAREA_TIMEOUT,
    });

    const textarea = await waitForElement(
        chatTextareaSelector,
        CHAT_TEXTAREA_TIMEOUT,
        localRunId
    );

    if (!isCurrentRun(localRunId)) {
        logWarn('sendPrompt aborted because run is stale', {
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
        started = false;
        return;
    }

    log('chat textarea found; setting prompt', {
        textarea: describeElement(textarea),
        promptLength: timestampPrompt.length,
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
        timeout: CHAT_TEXTAREA_TIMEOUT,
    });

    clearAnswerWatcher();

    const chat = await waitForElement(
        chatSelector,
        CHAT_TEXTAREA_TIMEOUT,
        localRunId
    );

    if (!isCurrentRun(localRunId)) {
        logWarn('watchForAnswer aborted because run is stale', {
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
            logWarn('answer parse schedule aborted because run is stale', {
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
                logWarn('answer parse aborted because run is stale', {
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
                logWarn('answer parse produced no sponsor segments', {
                    localRunId,
                    parseScheduleCount,
                    observedMutationCount,
                    chat: chatSnapshot,
                });

                if (hasTimestampAnswer(chatSnapshot)) {
                    clearAnswerWatcher();
                    log('answer has timestamps but no sponsor segments; closing chat', {
                        localRunId,
                        chat: chatSnapshot,
                    });
                    scheduleChatClose(localRunId, 'answer-without-sponsor-segments');
                }

                return;
            }

            segments = found;
            clearAnswerWatcher();

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
        }, ANSWER_STABLE_DELAY);
    };

    answerObserver = new MutationObserver(scheduleParse);

    answerObserver.observe(chat, {
        childList: true,
        subtree: true,
        characterData: true,
    });

    answerTimeout = setTimeout(() => {
        clearAnswerWatcher();
        logWarn('answer timeout', {
            localRunId,
            parseScheduleCount,
            observedMutationCount,
            chat: getChatSnapshot(chat),
        });
        closeChat(localRunId, 'answer-timeout');
    }, ANSWER_TIMEOUT);

    // Parse once immediately in case the answer appears before the observer starts.
    scheduleParse();
}

// Parsing
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
        nonSponsorLineCount: 0,
        sponsorCandidateCount: 0,
        ignoredExistingCount: 0,
        missingTimestampCount: 0,
        invalidRangeCount: 0,
        acceptedCount: 0,
        rejectedSamples,
    };

    chat.querySelectorAll('li, p').forEach((node, index) => {
        stats.itemCount++;

        const text = normalizeText(node.textContent || '');

        if (!isSponsorLine(text)) {
            stats.nonSponsorLineCount++;
            return;
        }

        stats.sponsorCandidateCount++;

        if (ignoredSponsorLines.has(text)) {
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

        const start = times[0];
        const end = times[1];

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

// Skip button
function format(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = String(Math.floor(seconds % 60)).padStart(2, '0');

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${secs}`;
    }

    return `${minutes}:${secs}`;
}

function updateSkipButton(video) {
    if (!(video instanceof HTMLMediaElement)) {
        logWarn('updateSkipButton called without a valid video', video);
        return;
    }

    if (skipButton && !skipButton.isConnected) {
        logWarn('skip button reference is disconnected; recreating on next active segment', {
            button: describeSkipButton(),
            video: describeVideo(video),
        });
        skipButton = null;
        lastSkipButtonSegmentKey = null;
    }

    const segment = findCurrentSegment(video);

    if (!segment) {
        if (skipButton) {
            if (skipButton.style.display !== 'none') {
                log('hiding skip button because current time is outside sponsor segments', {
                    currentTime: video.currentTime,
                    segments,
                });
            } else if (
                shouldLogThrottled(
                    'skip-button-no-current-segment',
                    `${Math.floor(video.currentTime)}:${segments.length}`
                )
            ) {
                log('skip button remains hidden outside sponsor segments', {
                    currentTime: video.currentTime,
                    segments,
                });
            }

            skipButton.style.display = 'none';
        }

        lastSkipButtonSegmentKey = null;
        return;
    }

    const segmentKey = `${segment.start}-${segment.end}`;

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

    let progress = (video.currentTime - segment.start) / (segment.end - segment.start);
    progress = Math.min(1, Math.max(0, progress));

    const percent = (FILL_GROWS ? progress : 1 - progress) * 100;

    skipButton.style.background = `linear-gradient(to right, ${FILL_COLOR} ${percent}%, ${TRACK_COLOR} ${percent}%)`;
    skipButton.textContent = `Skip segment → ${format(segment.end)}`;

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

    // Keep this simple: always use the currently visible segment.
    skipButton.onclick = () => {
        log('skip button clicked', {
            segment,
            currentTimeBefore: video.currentTime,
        });

        video.currentTime = segment.end;
        skipButton.style.display = 'none';
        lastSkipButtonSegmentKey = null;

        log('skip button completed seek', {
            segment,
            currentTimeAfter: video.currentTime,
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
            logWarn('skip shortcut ignored because focus is editable', {
                target: describeElement(event.target),
            });
            return;
        }

        if (!segments.length) {
            logWarn('skip shortcut ignored because no segments are available');
            return;
        }

        const video = activePlayer || document.querySelector('video');

        if (!video) {
            logWarn('skip shortcut ignored because video is missing');
            return;
        }

        const segment = findCurrentSegment(video);

        if (!segment) {
            logWarn('skip shortcut ignored because current time is outside sponsor segments', {
                currentTime: video.currentTime,
                segments,
            });
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        log('skip shortcut seeking to segment end', {
            segment,
            currentTimeBefore: video.currentTime,
        });

        video.currentTime = segment.end;

        if (skipButton) {
            skipButton.style.display = 'none';
        }

        lastSkipButtonSegmentKey = null;

        log('skip shortcut completed seek', {
            segment,
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
    ignoredSponsorLines = new Set();

    clearTimers();

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

    started = true;
    currentVideoSrc = getVideoSrc(video);
    activePlayer = video;

    log('start completed; launching timestamps flow', {
        video: describeVideo(video),
        currentVideoSrc,
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
            logWarn('fullscreenchange ignored because no video was found', {
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
                logWarn('start gate blocked from fullscreenchange', {
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
            logWarn('fullscreenchange did not update skip button because no segments are available');
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

    logWarn('no existing video found; installing video observer');

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

function init() {
    log('init started', {
        manifestHint: 'YT Auto Timestamps',
        pageUrl: window.location.href,
        readyState: document.readyState,
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
