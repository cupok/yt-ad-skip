const { setImmediate } = require('node:timers/promises');

// Deliberately small browser doubles. Selectors are registered by fixtures rather
// than reimplementing a browser's CSS selector engine or YouTube's DOM.
function createDOM() {
    class Event {
        constructor(type, options = {}) {
            Object.assign(this, { type, bubbles: false, cancelable: false, defaultPrevented: false }, options);
        }
        preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
        stopPropagation() { this.propagationStopped = true; }
    }
    class Target {
        constructor() { this.listeners = new Map(); }
        addEventListener(type, listener) {
            if (!this.listeners.has(type)) this.listeners.set(type, new Set());
            this.listeners.get(type).add(listener);
        }
        dispatchEvent(event) {
            event.target ||= this;
            event.currentTarget = this;
            for (const listener of this.listeners.get(event.type) || []) listener(event);
            return !event.defaultPrevented;
        }
    }
    class Element extends Target {
        constructor(tag = 'div', text = '') {
            super();
            this.tagName = tag.toUpperCase();
            this.textContent = text;
            this.style = {};
            this.dataset = {};
            this.attributes = new Map();
            this.queries = new Map();
            this.children = [];
            this.isConnected = true;
            this.hidden = false;
            this.isContentEditable = false;
            this.rects = [{}];
            this.clickCount = 0;
            this.value = '';
            this.animations = [];
        }
        animate(keyframes, options) {
            const animation = {
                keyframes, options, currentTime: 0, playState: 'running',
                pause() { this.playState = 'paused'; },
                play() { this.playState = 'running'; },
                cancel() { this.playState = 'idle'; },
            };
            this.animations.push(animation);
            return animation;
        }
        setAttribute(key, value) { this.attributes.set(key, String(value)); }
        getAttribute(key) { return this.attributes.get(key) ?? null; }
        hasAttribute(key) { return this.attributes.has(key); }
        querySelectorAll(selector) {
            if (this.queries.has(selector)) return this.queries.get(selector);
            return this.children.flatMap(child => [
                ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
            ]);
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        matches(selector) {
            if (selector === '[data-i18n]') return Boolean(this.dataset.i18n);
            return selector.startsWith('#') ? this.id === selector.slice(1) : this.tagName.toLowerCase() === selector;
        }
        closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
        append(...children) {
            for (const child of children) {
                child.parentElement = this;
                child.isConnected = true;
                this.children.push(child);
            }
        }
        appendChild(child) { this.append(child); return child; }
        remove() {
            this.isConnected = false;
            if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
            this.parentElement = null;
        }
        getClientRects() { return this.rects; }
        focus() { document.activeElement = this; }
        click() {
            this.clickCount++;
            this.onclick?.();
            this.dispatchEvent(new Event('click'));
        }
    }
    class HTMLElement extends Element {}
    class HTMLInputElement extends HTMLElement { constructor() { super('input'); } }
    class HTMLTextAreaElement extends HTMLElement { constructor() { super('textarea'); } }
    class HTMLMediaElement extends HTMLElement {
        constructor() {
            super('video');
            Object.assign(this, { currentTime: 0, duration: 600, readyState: 4, currentSrc: 'video:test', src: '', paused: false });
        }
    }
    class Document extends Target {
        constructor() {
            super();
            this.documentElement = new HTMLElement('html');
            this.body = new HTMLElement('body');
            this.documentElement.append(this.body);
            this.queries = new Map();
            this.fullscreenElement = null;
            this.readyState = 'complete';
        }
        querySelectorAll(selector) { return this.queries.get(selector) || this.documentElement.querySelectorAll(selector); }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        createElement(tag) {
            if (tag === 'input') return new HTMLInputElement();
            if (tag === 'textarea') return new HTMLTextAreaElement();
            return new HTMLElement(tag);
        }
    }
    const document = new Document();
    const window = new Target();
    window.location = { href: 'https://www.youtube.com/watch?v=test' };
    window.getComputedStyle = element => ({ display: 'block', visibility: 'visible', ...element.style });
    const observers = [];
    class MutationObserver {
        constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
        observe(target, options) { this.target = target; this.options = options; }
        disconnect() { this.disconnected = true; }
        notify(mutations = []) { if (!this.disconnected) this.callback(mutations); }
    }
    return { document, window, observers, MutationObserver, Event, KeyboardEvent: Event,
        Element, HTMLElement, HTMLInputElement, HTMLTextAreaElement, HTMLMediaElement };
}

function createClock() {
    const timers = new Map();
    let nextId = 0;
    let now = 0;
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    return {
        timers, Date: ClockDate,
        setTimeout(callback, delay = 0) {
            const id = ++nextId;
            timers.set(id, { callback, delay, at: now + delay });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
        runTimers(delay) {
            for (const [id, timer] of [...timers]) {
                if (timer.delay === delay && timers.has(id)) {
                    timers.delete(id);
                    timer.callback();
                }
            }
        },
        async advance(ms) {
            const end = now + ms;
            for (let count = 0; count < 10000; count++) {
                const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) { now = end; return; }
                const [id, timer] = next;
                now = timer.at;
                timers.delete(id);
                timer.callback();
                await setImmediate();
            }
            throw new Error('Timer loop exceeded 10,000 callbacks');
        },
    };
}

module.exports = { createDOM, createClock, flush: () => setImmediate() };
