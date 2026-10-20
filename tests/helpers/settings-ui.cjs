const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDOM } = require('./browser.cjs');

const root = path.join(__dirname, '..', '..');

function loadSettingsUI({ languages = ['en'], language = '', stored = {}, loadError,
    saveError, deferLoad = false, deferSave = false } = {}) {
    const dom = createDOM();
    const { document, HTMLElement } = dom;
    const form = new HTMLElement('form');
    const fields = new HTMLElement('fieldset');
    fields.disabled = true;
    const mainFields = new HTMLElement();
    const advanced = new HTMLElement('details');
    const advancedFields = new HTMLElement();
    advanced.append(advancedFields);
    const reset = new HTMLElement('button');
    const status = new HTMLElement('p');
    const exportButton = new HTMLElement('button');
    form.append(fields);
    fields.append(mainFields, advanced, reset);
    document.body.append(form, status, exportButton);
    for (const [id, element] of Object.entries({
        'settings-form': form, 'settings-fields': fields, 'main-fields': mainFields,
        'advanced-fields': advancedFields, reset, status, export: exportButton,
    })) {
        element.id = id;
    }

    // Static translated elements come from the real HTML. Input rows are created
    // by the actual UI script, including labels, hints, and validity constraints.
    const html = fs.readFileSync(path.join(root, 'settings.html'), 'utf8');
    for (const [, tag, key] of html.matchAll(/<([\w-]+)[^>]*\bdata-i18n="([^"]+)"[^>]*>/g)) {
        const element = new HTMLElement(tag);
        element.dataset.i18n = key;
        document.body.append(element);
    }
    form.valid = true;
    form.reportValidity = () => form.valid;
    form.elements = { namedItem: name => form.querySelectorAll('input').find(input => input.name === name) || null };
    const writes = [];
    const messages = [];
    const storage = { ...stored };
    const pendingLoads = [];
    const pendingSaves = [];
    const pendingMessages = [];
    const chrome = {
        runtime: {
            sendMessage(message, callback) { messages.push(message); pendingMessages.push(callback); },
        },
        storage: { local: {
            get(defaults, callback) {
                const complete = () => withError(loadError, () => callback({ ...defaults, ...storage }));
                if (deferLoad) pendingLoads.push(complete); else complete();
            },
            set(values, callback) {
                writes.push(values);
                const complete = () => withError(saveError, () => {
                    if (!saveError) Object.assign(storage, values);
                    callback();
                });
                if (deferSave) pendingSaves.push(complete); else complete();
            },
        } },
    };
    function withError(error, callback) {
        chrome.runtime.lastError = error && { message: error };
        try { callback(); } finally { delete chrome.runtime.lastError; }
    }
    const context = vm.createContext({ ...dom, navigator: { languages, language }, chrome });
    for (const file of ['settings.js', 'settings-ui.js']) {
        const filename = path.join(root, file);
        vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    }
    return { ...dom, form, fields, mainFields, advanced, advancedFields, reset, status, exportButton,
        writes, messages, storage, settings: context.YtAdSkipSettings,
        input: key => form.elements.namedItem(key),
        submit() { const event = new dom.Event('submit', { cancelable: true }); form.dispatchEvent(event); return event; },
        finishLoad() { pendingLoads.shift()?.(); },
        finishSave() { pendingSaves.shift()?.(); },
        finishExport(response, error) { withError(error, () => pendingMessages.shift()?.(response)); },
    };
}

module.exports = { loadSettingsUI };
