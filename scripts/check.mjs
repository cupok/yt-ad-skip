import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, RELEASE_FILES, readProject, releaseNotes } from './project.mjs';

try {
    const { manifest, pkg } = readProject();
    for (const file of RELEASE_FILES) {
        if (!existsSync(resolve(ROOT, file))) throw new Error(`Missing release file: ${file}`);
    }
    const references = [
        manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page,
        ...manifest.content_scripts.flatMap(script => script.js),
    ];
    for (const file of references) {
        if (!existsSync(resolve(ROOT, file))) throw new Error(`Manifest references a missing file: ${file}`);
    }
    function scripts(directory) {
        return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
            if (entry.name.startsWith('.') || ['node_modules', 'dist', 'coverage'].includes(entry.name)) return [];
            const filename = resolve(directory, entry.name);
            return entry.isDirectory() ? scripts(filename) : /\.(?:cjs|mjs|js)$/.test(entry.name) ? [filename] : [];
        });
    }
    for (const file of scripts(ROOT)) {
        const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
        if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
    }
    const args = process.argv.slice(2);
    if (args.length) {
        if (args.length !== 2 || args[0] !== '--tag' || args[1] !== `v${pkg.version}`) {
            throw new Error(`The release tag must be v${pkg.version}.`);
        }
        releaseNotes(readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8'), pkg.version);
    }
    console.log(`Checks passed: version ${pkg.version}, manifest files, release files, and JavaScript syntax.`);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
