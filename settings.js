(() => {
    // Preserve the storage key so existing settings survive the rename.
    const STORAGE_KEY = 'ytAutoTimestampsSettings';
    const FIELDS = Object.freeze({
        chatOpenDelay: { default: 1000, min: 0, max: 600000 },
        closeDelay: { default: 10000, min: 0, max: 600000 },
        autoSkipDelay: { default: 5000, min: 0, max: 600000 },
        chatOpenRetryDelay: { default: 2000, min: 100, max: 600000 },
        chatTextareaTimeout: { default: 10000, min: 1000, max: 600000 },
        answerTimeout: { default: 30000, min: 1000, max: 600000 },
        answerStableDelay: { default: 1200, min: 100, max: 600000 },
    });
    const DEFAULTS = Object.freeze(Object.fromEntries(
        Object.entries(FIELDS).map(([key, field]) => [key, field.default])
    ));

    function normalize(value) {
        const input = value && typeof value === 'object' ? value : {};

        return Object.fromEntries(Object.entries(FIELDS).map(([key, field]) => {
            const number = input[key];
            const valid = typeof number === 'number' && Number.isFinite(number)
                && number >= field.min && number <= field.max;
            return [key, valid ? Math.round(number) : field.default];
        }));
    }

    globalThis.YtAdSkipSettings = Object.freeze({ STORAGE_KEY, FIELDS, DEFAULTS, normalize });
})();
