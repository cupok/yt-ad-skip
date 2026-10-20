const assert = require('node:assert/strict');
const test = require('node:test');
const { loadSettingsUI } = require('./helpers/settings-ui.cjs');

for (const [language, title, firstLabel] of [
    ['en-GB', 'Settings', 'Open chat after'],
    ['uk-UA', 'Налаштування', 'Відкрити чат через'],
    ['ru-RU', 'Настройки', 'Открыть чат через'],
]) {
    test(`${language}: settings renders localized headings and all seven delay controls`, () => {
        const h = loadSettingsUI({ languages: [language] });
        assert.equal(h.document.documentElement.lang, language.slice(0, 2));
        assert.equal(h.document.title, `YT Ad Skip · ${title}`);
        const translated = h.document.querySelectorAll('[data-i18n]');
        assert.ok(translated.every(element => typeof element.textContent === 'string' && element.textContent.length > 0));
        assert.equal(h.mainFields.children.length, 3);
        assert.equal(h.advancedFields.children.length, 4);
        assert.equal(h.mainFields.children[0].querySelector('label').textContent, firstLabel);
        assert.equal(h.input('debug').type, 'checkbox');
        assert.equal(h.input('debug').checked, true);
        for (const [key, field] of Object.entries(h.settings.FIELDS)) {
            const input = h.input(key);
            assert.equal(input.value, String(Math.max(Math.ceil(field.min / 1000), Math.round(field.default / 1000))));
            assert.equal(input.min, String(Math.ceil(field.min / 1000)));
            assert.equal(input.max, String(field.max / 1000));
            assert.equal(input.step, '1');
            assert.equal(input.required, true);
            assert.equal(input.getAttribute('aria-describedby'), `${key}-hint`);
            assert.equal(input.parentElement.querySelector('label').htmlFor, key);
        }
    });
}

test('settings language uses the first supported preference and falls back to English', () => {
    assert.equal(loadSettingsUI({ languages: ['de', 'uk-UA', 'ru'] }).document.documentElement.lang, 'uk');
    assert.equal(loadSettingsUI({ languages: [], language: 'ru' }).document.documentElement.lang, 'ru');
    assert.equal(loadSettingsUI({ languages: ['fr'] }).document.documentElement.lang, 'en');
});

test('settings stay disabled until storage finishes loading', () => {
    const h = loadSettingsUI({ deferLoad: true, stored: { ytAutoTimestampsSettings: { closeDelay: 3500 } } });
    assert.equal(h.fields.disabled, true);
    h.finishLoad();
    assert.equal(h.fields.disabled, false);
    assert.equal(h.input('closeDelay').value, '4');
    assert.equal(h.input('autoSkipDelay').value, '5');
    assert.equal(h.writes.length, 0);
});

test('saving converts seconds to milliseconds and preserves a disabled auto-skip value', () => {
    const h = loadSettingsUI();
    h.input('chatOpenDelay').value = '2';
    h.input('autoSkipDelay').value = '0';
    const event = h.submit();
    assert.equal(event.defaultPrevented, true);
    const saved = h.storage[h.settings.STORAGE_KEY];
    assert.equal(saved.chatOpenDelay, 2000);
    assert.equal(saved.autoSkipDelay, 0);
    assert.equal(saved.answerStableDelay, 1000);
    assert.equal(h.writes.length, 1);
    assert.equal(h.status.dataset.error, 'false');
    assert.ok(h.status.textContent.startsWith('Saved.'));
});

test('saving disables controls until the write callback succeeds', () => {
    const h = loadSettingsUI({ deferSave: true });
    h.submit();
    assert.equal(h.fields.disabled, true);
    h.finishSave();
    assert.equal(h.fields.disabled, false);
    assert.equal(h.status.dataset.error, 'false');
});

test('invalid form values are not written and advanced validation opens its section', () => {
    const h = loadSettingsUI();
    h.form.valid = false;
    h.submit();
    assert.equal(h.writes.length, 0);
    const target = h.input('answerTimeout');
    h.form.dispatchEvent(new h.Event('invalid', { target }));
    assert.equal(h.advanced.open, true);
});

test('reset restores and saves every default value', () => {
    const h = loadSettingsUI({ stored: { ytAutoTimestampsSettings: { closeDelay: 2500, autoSkipDelay: 0 } } });
    h.reset.click();
    assert.equal(JSON.stringify(h.storage[h.settings.STORAGE_KEY]), JSON.stringify(h.settings.DEFAULTS));
    for (const key of Object.keys(h.settings.FIELDS)) assert.equal(h.input(key).value, String(Math.round(h.settings.DEFAULTS[key] / 1000)));
    assert.equal(h.input('debug').checked, h.settings.DEFAULTS.debug);
    assert.equal(h.status.textContent, 'Default settings restored.');
});

test('storage load errors do not silently enable editing or overwrite saved values', () => {
    const h = loadSettingsUI({ loadError: 'storage unavailable' });
    assert.equal(h.fields.disabled, true);
    assert.equal(h.writes.length, 0);
    assert.equal(h.status.dataset.error, 'true');
    assert.ok(h.status.textContent.startsWith('Could not load settings.'));
});

test('storage write errors retain user input and re-enable controls', () => {
    const h = loadSettingsUI({ saveError: 'quota exceeded' });
    h.input('closeDelay').value = '3';
    h.input('debug').checked = false;
    h.submit();
    assert.equal(h.fields.disabled, false);
    assert.equal(h.input('closeDelay').value, '3');
    assert.equal(h.input('debug').checked, false);
    assert.equal(h.storage[h.settings.STORAGE_KEY], undefined);
    assert.equal(h.status.dataset.error, 'true');
    assert.ok(h.status.textContent.startsWith('Could not save settings.'));
});

test('debug can be saved off, restored on reopening, and reset to its default', () => {
    const h = loadSettingsUI({ stored: { ytAutoTimestampsSettings: { closeDelay: 2500 } } });
    assert.equal(h.input('debug').checked, true);
    h.input('debug').checked = false;
    h.submit();
    const saved = h.storage[h.settings.STORAGE_KEY];
    assert.equal(saved.debug, false);
    assert.equal(saved.closeDelay, 3000);
    const reopened = loadSettingsUI({ stored: h.storage });
    assert.equal(reopened.input('debug').checked, false);
    reopened.reset.click();
    assert.equal(reopened.input('debug').checked, true);
    assert.equal(reopened.storage[h.settings.STORAGE_KEY].debug, true);
});

test('editing a value clears previous save status', () => {
    const h = loadSettingsUI();
    h.submit();
    assert.ok(h.status.textContent.length > 0);
    h.form.dispatchEvent(new h.Event('input'));
    assert.equal(h.status.textContent, '');
});

test('opening settings does not export logs and export waits for an explicit click', () => {
    const h = loadSettingsUI();
    assert.equal(h.messages.length, 0);
    h.exportButton.click();
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].type, 'YT_AD_SKIP_EXPORT_LOG');
    assert.equal(h.exportButton.disabled, true);
    h.finishExport({ ok: true });
    assert.equal(h.exportButton.disabled, false);
    assert.equal(h.status.textContent, 'Log export requested.');
    assert.equal(h.status.dataset.error, 'false');
});

for (const [response, error] of [[{ ok: false }, undefined], [undefined, 'background unavailable'], [undefined, undefined]]) {
    test(`log export reports ${error || (response ? 'a failed download' : 'a missing response')}`, () => {
        const h = loadSettingsUI();
        h.exportButton.click();
        h.finishExport(response, error);
        assert.equal(h.exportButton.disabled, false);
        assert.equal(h.status.dataset.error, 'true');
        assert.ok(h.status.textContent.startsWith('Could not export logs.'));
    });
}
