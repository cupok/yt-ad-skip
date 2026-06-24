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

const log = (...args) => {
    if (DEBUG) {
        console.log('[ext]', ...args);
    }
};

// Selectors
const chatSelector = '[data-target-id="youchat_messages_section"]';
const chatOpenButtonSelector = 'ytd-watch-flexy[fullscreen] .you-chat-entrypoint-button button';
const chatCloseButtonSelector = 'ytd-watch-flexy[fullscreen] #visibility-button button';
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
        return Promise.resolve(existing);
    }

    return new Promise((resolve) => {
        let resolved = false;

        const finish = (element) => {
            if (resolved) {
                return;
            }

            resolved = true;
            observer.disconnect();
            clearTimeout(timeoutTimer);
            resolve(element);
        };

        const observer = new MutationObserver(() => {
            if (!isCurrentRun(localRunId)) {
                finish(null);
                return;
            }

            const element = document.querySelector(selector);

            if (element) {
                finish(element);
            }
        });

        const timeoutTimer = setTimeout(() => {
            finish(null);
        }, timeout);

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    });
}

function clearTimers() {
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
        return lines;
    }

    chat.querySelectorAll('li, p').forEach((node) => {
        const text = normalizeText(node.textContent || '');

        if (isSponsorLine(text)) {
            lines.add(text);
        }
    });

    return lines;
}

function normalizeText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

function isSponsorLine(text) {
    return /^\s*-?\s*sponsor(?:\s+segment)?\s*:/i.test(text);
}

// Player events
function bindPlayerEvents(player) {
    if (!player || boundPlayers.has(player)) {
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

        if (
            event.type === 'emptied' &&
            currentVideoSrc &&
            videoSrc &&
            videoSrc !== currentVideoSrc
        ) {
            reset();
            return;
        }

        // Start only in fullscreen, same as original logic.
        // Number.isFinite() avoids live streams / Infinity duration.
        if (
            !started &&
            video.readyState >= 3 &&
            Number.isFinite(video.duration) &&
            video.duration >= 180 &&
            document.fullscreenElement
        ) {
            start(video);
        }

        // Do not require fullscreen here.
        // The button should remain usable after exiting fullscreen.
        if (segments.length) {
            updateSkipButton(video);
        }

        if (event.type !== 'timeupdate') {
            log(event.type);
        }
    };

    events.forEach((eventName) => {
        player.addEventListener(eventName, handleEvent);
    });

    log('player events bound');
}

// Chat flow
function timestamps() {
    const localRunId = runId;

    clearTimeout(openChatTimer);

    openChatTimer = setTimeout(() => {
        if (!isCurrentRun(localRunId)) {
            return;
        }

        // Save old sponsor lines before opening/sending.
        // This reduces the chance of parsing a previous answer.
        ignoredSponsorLines = collectExistingSponsorLines();

        const chatOpenButton = document.querySelector(chatOpenButtonSelector);

        if (!chatOpenButton) {
            log('chat open button not found');
            started = false;
            return;
        }

        chatOpenButton.click();

        void sendPrompt(localRunId).catch((error) => {
            log('send prompt failed', error);
        });
    }, CHAT_OPEN_DELAY);
}

async function sendPrompt(localRunId) {
    const textarea = await waitForElement(
        chatTextareaSelector,
        CHAT_TEXTAREA_TIMEOUT,
        localRunId
    );

    if (!isCurrentRun(localRunId)) {
        return;
    }

    if (!(textarea instanceof HTMLElement)) {
        log('chat textarea not found');
        started = false;
        return;
    }

    setTextInputValue(textarea, timestampPrompt);

    textarea.focus();

    textarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
    }));

    await watchForAnswer(localRunId);
}

function setTextInputValue(element, value) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.value = value;
    } else {
        element.textContent = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
}

async function watchForAnswer(localRunId) {
    clearAnswerWatcher();

    const chat = await waitForElement(
        chatSelector,
        CHAT_TEXTAREA_TIMEOUT,
        localRunId
    );

    if (!isCurrentRun(localRunId)) {
        return;
    }

    if (!chat) {
        log('chat not found');
        return;
    }

    const scheduleParse = () => {
        if (!isCurrentRun(localRunId)) {
            clearAnswerWatcher();
            return;
        }

        if (answerStableTimer) {
            clearTimeout(answerStableTimer);
        }

        // Replaces setInterval polling.
        // YouChat streams the answer through DOM mutations, so we debounce parsing
        // until the DOM becomes quiet for a moment.
        answerStableTimer = setTimeout(() => {
            if (!isCurrentRun(localRunId)) {
                clearAnswerWatcher();
                return;
            }

            const found = parseSegments();

            log('found', found);

            if (!found.length) {
                return;
            }

            segments = found;
            clearAnswerWatcher();

            log('segments', segments);

            closeTimer = setTimeout(() => {
                if (!isCurrentRun(localRunId)) {
                    return;
                }

                const closeButton = document.querySelector(chatCloseButtonSelector);

                if (closeButton) {
                    closeButton.click();
                }
            }, CLOSE_DELAY);

            if (activePlayer) {
                updateSkipButton(activePlayer);
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
        log('answer timeout');
    }, ANSWER_TIMEOUT);

    // Parse once immediately in case the answer appears before the observer starts.
    scheduleParse();
}

// Parsing
function parseSegments() {
    const found = [];
    const chat = document.querySelector(chatSelector);

    if (!chat) {
        return [];
    }

    chat.querySelectorAll('li, p').forEach((node) => {
        const text = normalizeText(node.textContent || '');

        if (!isSponsorLine(text)) {
            return;
        }

        if (ignoredSponsorLines.has(text)) {
            return;
        }

        const times = [...node.querySelectorAll(chatTimestampItemSelector)]
            .map((timestamp) => parseInt(timestamp.getAttribute('data-time'), 10))
            .filter((number) => Number.isFinite(number));

        if (times.length < 2) {
            return;
        }

        const start = times[0];
        const end = times[1];

        if (end <= start) {
            return;
        }

        found.push({
            start,
            end,
        });
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
    const segment = segments.find((item) => {
        return video.currentTime >= item.start && video.currentTime < item.end;
    });

    if (!segment) {
        if (skipButton) {
            skipButton.style.display = 'none';
        }

        return;
    }

    if (!skipButton) {
        const videoContainer = document.querySelector('#player-container');

        if (!videoContainer) {
            log('player container not found');
            return;
        }

        skipButton = document.createElement('button');
        skipButton.type = 'button';

        Object.assign(skipButton.style, BUTTON_STYLE);

        videoContainer.appendChild(skipButton);
    }

    let progress = (video.currentTime - segment.start) / (segment.end - segment.start);
    progress = Math.min(1, Math.max(0, progress));

    const percent = (FILL_GROWS ? progress : 1 - progress) * 100;

    skipButton.style.background = `linear-gradient(to right, ${FILL_COLOR} ${percent}%, ${TRACK_COLOR} ${percent}%)`;
    skipButton.textContent = `Skip segment → ${format(segment.end)}`;
    skipButton.style.display = 'block';

    // Keep this simple: always use the currently visible segment.
    skipButton.onclick = () => {
        video.currentTime = segment.end;
        skipButton.style.display = 'none';
    };
}

// Shortcuts
function bindShortcuts() {
    if (shortcutsBound) {
        return;
    }

    shortcutsBound = true;

    document.addEventListener('keydown', (event) => {
        if (isEditableTarget(event.target)) {
            return;
        }

        // Skip segment: Mac = Opt+Right, Win = Ctrl+Alt+Right
        const isMacNext = event.altKey && !event.ctrlKey && event.code === 'ArrowRight';
        const isWinNext = event.ctrlKey && event.altKey && event.code === 'ArrowRight';

        if (!isMacNext && !isWinNext) {
            return;
        }

        if (!segments.length) {
            return;
        }

        const video = activePlayer || document.querySelector('video');

        if (!video) {
            return;
        }

        const segment = segments.find((item) => {
            return video.currentTime >= item.start && video.currentTime < item.end;
        });

        if (!segment) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        video.currentTime = segment.end;

        if (skipButton) {
            skipButton.style.display = 'none';
        }
    }, true);
}

// Reset / start
function reset() {
    runId++;

    started = false;
    segments = [];
    ignoredSponsorLines = new Set();

    clearTimers();

    if (skipButton) {
        skipButton.remove();
        skipButton = null;
    }

    log('reset', currentVideoSrc);
}

function start(video) {
    started = true;
    currentVideoSrc = getVideoSrc(video);
    activePlayer = video;

    timestamps();

    log('start', currentVideoSrc);
}

// Fullscreen / navigation
function bindFullscreenChange() {
    if (fullscreenChangeBound) {
        return;
    }

    fullscreenChangeBound = true;

    document.addEventListener('fullscreenchange', () => {
        const video = activePlayer || document.querySelector('video');

        if (!video) {
            return;
        }

        // Entering fullscreen can be the moment when we should start.
        if (
            !started &&
            video.readyState >= 3 &&
            Number.isFinite(video.duration) &&
            video.duration >= 180 &&
            document.fullscreenElement
        ) {
            start(video);
        }

        if (segments.length) {
            updateSkipButton(video);
        }
    });
}

function bindNavigationEvents() {
    if (navigationBound) {
        return;
    }

    navigationBound = true;

    // YouTube is an SPA. Reset old segments/timers when navigating to another video.
    window.addEventListener('yt-navigate-finish', () => {
        reset();
        bindCurrentOrFutureVideo();
    });
}

// Video detection
function bindCurrentOrFutureVideo() {
    if (videoObserver) {
        videoObserver.disconnect();
        videoObserver = null;
    }

    const existingPlayer = document.querySelector('video');

    if (existingPlayer) {
        bindPlayerEvents(existingPlayer);
        return;
    }

    videoObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) {
                    continue;
                }

                const player = node.matches('video')
                    ? node
                    : node.querySelector('video');

                if (player) {
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
function init() {
    bindShortcuts();
    bindFullscreenChange();
    bindNavigationEvents();
    bindCurrentOrFutureVideo();

    log('loaded');
}

init();