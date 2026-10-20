import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));

export function isMain(url) {
    return Boolean(process.argv[1]) && fileURLToPath(url) === realpathSync(process.argv[1]);
}

export const RELEASE_FILES = Object.freeze([
    'manifest.json', 'background.js', 'content.js', 'settings.js',
    'settings-ui.js', 'settings.html', 'settings.css',
    'LICENSE', 'README.md', 'PRIVACY.md', 'SECURITY.md', 'CONTRIBUTING.md',
    'CHANGELOG.md', 'RELEASING.md',
]);

export function parseVersion(value) {
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
        throw new Error('Use a numeric MAJOR.MINOR.PATCH version, for example 1.0.1.');
    }
    const parts = value.split('.').map(Number);
    if (parts.some(part => part > 65535) || parts.every(part => part === 0)) {
        throw new Error('Chrome version parts must be at most 65535; 0.0.0 is not allowed.');
    }
    return parts;
}

export function readProject(root = ROOT) {
    const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    parseVersion(pkg.version);
    if (manifest.version !== pkg.version) {
        throw new Error('manifest.json and package.json must have the same version.');
    }
    return { manifest, pkg };
}

export function releaseNotes(changelog, version) {
    parseVersion(version);
    const heading = new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}[^\\n]*\\n`, 'm');
    const match = heading.exec(changelog);
    if (!match) throw new Error(`No dated changelog entry exists for ${version}. Run release:prepare first.`);
    const remaining = changelog.slice(match.index + match[0].length);
    const next = remaining.search(/^## /m);
    const notes = (next < 0 ? remaining : remaining.slice(0, next)).trim();
    if (!notes) throw new Error(`The changelog entry for ${version} is empty.`);
    return `${notes}\n`;
}
