import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, isMain, parseVersion, readProject, releaseNotes } from './project.mjs';

export function prepareRelease(root, version, date = new Date().toISOString().slice(0, 10)) {
    const target = parseVersion(version);
    const { manifest, pkg } = readProject(root);
    const current = parseVersion(pkg.version);
    const difference = target.map((part, i) => part - current[i]).find(part => part !== 0) || 0;
    if (difference < 0) throw new Error('Release versions cannot go backwards.');

    const changelogPath = resolve(root, 'CHANGELOG.md');
    const changelog = readFileSync(changelogPath, 'utf8');
    if (changelog.includes(`## [${version}]`)) throw new Error(`${version} already has a changelog entry; use a new version.`);
    const heading = /^## \[Unreleased\][ \t]*\r?\n/m.exec(changelog);
    if (!heading) throw new Error('CHANGELOG.md needs an ## [Unreleased] section.');
    const bodyStart = heading.index + heading[0].length;
    const remaining = changelog.slice(bodyStart);
    const nextHeading = remaining.search(/^## /m);
    const notes = (nextHeading < 0 ? remaining : remaining.slice(0, nextHeading)).trim();
    if (!/^- \S/m.test(notes)) throw new Error('Add user-facing release notes under Unreleased before preparing a release.');
    const older = nextHeading < 0 ? '' : remaining.slice(nextHeading).trimStart();
    const updated = `${changelog.slice(0, heading.index)}## [Unreleased]\n\n## [${version}] - ${date}\n\n${notes}\n${older ? `\n${older}` : ''}`;

    // Validate every input before writing any release metadata. The first release
    // can keep the existing 1.0.0 version; later releases must use a new number.
    manifest.version = version;
    pkg.version = version;
    writeFileSync(resolve(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(resolve(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    writeFileSync(changelogPath, updated.endsWith('\n') ? updated : `${updated}\n`);
    return version;
}

if (isMain(import.meta.url)) {
    try {
        const [command, value] = process.argv.slice(2);
        if (command === 'prepare') {
            const version = prepareRelease(ROOT, value);
            console.log(`Prepared ${version}. Review the changelog, run checks, and commit the release changes. No tag was created.`);
        } else if (command === 'notes') {
            const { pkg } = readProject();
            const version = value || pkg.version;
            process.stdout.write(releaseNotes(readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8'), version));
        } else {
            throw new Error('Usage: node scripts/release.mjs prepare VERSION | notes [VERSION]');
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
