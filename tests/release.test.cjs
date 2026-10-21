const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { inflateRawSync } = require('node:zlib');

const projectModule = import('../scripts/project.mjs');
const releaseModule = import('../scripts/release.mjs');
const packageModule = import('../scripts/package.mjs');
const repository = path.join(__dirname, '..');

async function fixture(t) {
    const { RELEASE_FILES } = await projectModule;
    const root = mkdtempSync(path.join(tmpdir(), 'yt-ad-skip-release-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const file of [...RELEASE_FILES, 'package.json']) {
        cpSync(path.join(repository, file), path.join(root, file));
    }
    // Exercise releases from a fixed baseline, independent of the real version.
    for (const file of ['manifest.json', 'package.json']) {
        const filename = path.join(root, file);
        const metadata = JSON.parse(readFileSync(filename, 'utf8'));
        metadata.version = '1.0.0';
        writeFileSync(filename, `${JSON.stringify(metadata, null, 2)}\n`);
    }
    writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- A useful feature.\n');
    return root;
}

function git(root, args) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout;
}

async function commitFixture(root) {
    const { RELEASE_FILES } = await projectModule;
    git(root, ['init', '--quiet']);
    git(root, ['add', '--', ...RELEASE_FILES, 'package.json']);
    git(root, ['-c', 'user.name=Release test', '-c', 'user.email=release-test@example.invalid',
        '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null',
        'commit', '--quiet', '-m', 'test: create release fixture']);
}

// Read the standard ZIP central directory independently of the Git packager.
function zipEntries(filename) {
    const zip = readFileSync(filename);
    const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(end >= 0, 'ZIP needs an end-of-central-directory record');
    const count = zip.readUInt16LE(end + 10);
    let offset = zip.readUInt32LE(end + 16);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
        assert.equal(zip.readUInt32LE(offset), 0x02014b50);
        const method = zip.readUInt16LE(offset + 10);
        const size = zip.readUInt32LE(offset + 20);
        const nameLength = zip.readUInt16LE(offset + 28);
        const extraLength = zip.readUInt16LE(offset + 30);
        const commentLength = zip.readUInt16LE(offset + 32);
        const local = zip.readUInt32LE(offset + 42);
        const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
        assert.equal(zip.readUInt32LE(local), 0x04034b50);
        const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
        const data = zip.subarray(dataStart, dataStart + size);
        assert.ok(method === 0 || method === 8, 'Git ZIP should use store or deflate compression');
        entries.set(name, method === 8 ? inflateRawSync(data) : data);
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

test('version validation accepts Chrome-compatible semantic versions', async () => {
    const { parseVersion } = await projectModule;
    assert.deepEqual(parseVersion('1.0.0'), [1, 0, 0]);
    assert.deepEqual(parseVersion('0.1.0'), [0, 1, 0]);
    assert.deepEqual(parseVersion('65535.65535.65535'), [65535, 65535, 65535]);
    for (const value of [undefined, '', '0.0.0', '1.0', 'v1.0.0', '01.0.0', '1.0.0-beta', '1.0.0+build', '65536.0.0', '1.0.0\n']) {
        assert.throws(() => parseVersion(value), undefined, String(value));
    }
});

test('metadata validation catches version drift between package and manifest', async t => {
    const root = await fixture(t);
    const { readProject } = await projectModule;
    const filename = path.join(root, 'manifest.json');
    const manifest = JSON.parse(readFileSync(filename, 'utf8'));
    manifest.version = '1.0.1';
    writeFileSync(filename, JSON.stringify(manifest));
    assert.throws(() => readProject(root), /same version/);
});

test('initial release preparation versions both files and dates the existing notes', async t => {
    const root = await fixture(t);
    const { prepareRelease } = await releaseModule;
    const { readProject, releaseNotes } = await projectModule;
    prepareRelease(root, '1.0.0', '2026-10-20');
    assert.equal(readProject(root).manifest.version, '1.0.0');
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    assert.ok(changelog.includes('## [Unreleased]\n\n## [1.0.0] - 2026-10-20'));
    assert.equal(releaseNotes(changelog, '1.0.0'), '### Added\n\n- A useful feature.\n');
});

test('a later release moves only Unreleased notes and retains previous release history', async t => {
    const root = await fixture(t);
    const { prepareRelease } = await releaseModule;
    const { readProject, releaseNotes } = await projectModule;
    prepareRelease(root, '1.0.0', '2026-10-20');
    const filename = path.join(root, 'CHANGELOG.md');
    writeFileSync(filename, readFileSync(filename, 'utf8').replace('## [Unreleased]\n', '## [Unreleased]\n\n### Fixed\n\n- A bug fix.\n'));
    prepareRelease(root, '1.0.1', '2026-10-21');
    const changelog = readFileSync(filename, 'utf8');
    assert.equal(readProject(root).pkg.version, '1.0.1');
    assert.equal(readProject(root).manifest.version, '1.0.1');
    assert.equal(releaseNotes(changelog, '1.0.1'), '### Fixed\n\n- A bug fix.\n');
    assert.equal(releaseNotes(changelog, '1.0.0'), '### Added\n\n- A useful feature.\n');
});

test('invalid, decreasing, repeated, and empty releases do not modify metadata', async t => {
    const root = await fixture(t);
    const { prepareRelease } = await releaseModule;
    const files = ['manifest.json', 'package.json', 'CHANGELOG.md'];
    const snapshot = () => files.map(file => readFileSync(path.join(root, file), 'utf8'));
    const initial = snapshot();
    for (const version of ['0.9.0', '1.0.0-beta', '1.0.0; echo unsafe']) {
        assert.throws(() => prepareRelease(root, version));
        assert.deepEqual(snapshot(), initial);
    }
    prepareRelease(root, '1.0.0');
    const released = snapshot();
    assert.throws(() => prepareRelease(root, '1.0.0'), /already has/);
    assert.throws(() => prepareRelease(root, '1.0.1'), /release notes/);
    assert.deepEqual(snapshot(), released);
});

test('release-note extraction rejects missing and empty dated entries', async () => {
    const { releaseNotes } = await projectModule;
    assert.throws(() => releaseNotes('## [Unreleased]\n\n- Change.\n', '1.0.0'), /No dated/);
    assert.throws(() => releaseNotes('## [1.0.0] - 2026-10-20\n\n', '1.0.0'), /empty/);
});

test('packaging includes only committed release files and creates a valid ZIP and checksum', async t => {
    const root = await fixture(t);
    const { packageRelease } = await packageModule;
    const { RELEASE_FILES } = await projectModule;
    await commitFixture(root);
    writeFileSync(path.join(root, '.env'), 'PRIVATE_TEST_VALUE=do-not-package\n');
    writeFileSync(path.join(root, 'private.log'), 'do not package logs');
    writeFileSync(path.join(root, '.DS_Store'), 'do not package editor files');
    const artifact = packageRelease(root);
    assert.equal(path.basename(artifact), 'yt-ad-skip-v1.0.0.zip');
    const entries = zipEntries(artifact);
    assert.deepEqual([...entries.keys()].sort(), [...RELEASE_FILES].sort());
    assert.equal(JSON.parse(entries.get('manifest.json').toString()).version, '1.0.0');
    assert.ok(entries.get('LICENSE').toString().startsWith('MIT License'));
    assert.equal(entries.has('.env'), false);
    assert.equal(entries.has('package.json'), false);
    const bytes = readFileSync(artifact);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    assert.equal(readFileSync(`${artifact}.sha256`, 'utf8'), `${checksum}  ${path.basename(artifact)}\n`);
    packageRelease(root);
    assert.deepEqual(readFileSync(artifact), bytes);
});

test('packaging rejects included files that have not been committed', async t => {
    const root = await fixture(t);
    const { packageRelease } = await packageModule;
    git(root, ['init', '--quiet']);
    assert.throws(() => packageRelease(root), /Commit all release files/);
    await commitFixture(root);
    const filename = path.join(root, 'content.js');
    writeFileSync(filename, `${readFileSync(filename, 'utf8')}\n// Uncommitted change\n`);
    assert.throws(() => packageRelease(root), /Commit all release files/);
});

test('release preparation CLI works on an isolated project without creating a tag', async t => {
    const root = await fixture(t);
    cpSync(path.join(repository, 'scripts'), path.join(root, 'scripts'), { recursive: true });
    git(root, ['init', '--quiet']);
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/release.mjs'), 'prepare', '1.1.0'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('Prepared 1.1.0'));
    assert.equal(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version, '1.1.0');
    assert.equal(git(root, ['tag', '--list']), '');
    const notes = spawnSync(process.execPath, [path.join(root, 'scripts/release.mjs'), 'notes'], { encoding: 'utf8' });
    assert.equal(notes.status, 0, notes.stderr);
    assert.equal(notes.stdout, '### Added\n\n- A useful feature.\n');
});

test('tag checks reject mismatches and undated releases before accepting a prepared release', async t => {
    const root = await fixture(t);
    cpSync(path.join(repository, 'scripts'), path.join(root, 'scripts'), { recursive: true });
    const check = tag => spawnSync(process.execPath, [path.join(root, 'scripts/check.mjs'), '--tag', tag], { encoding: 'utf8' });
    assert.equal(check('v1.0.1').status, 1);
    assert.equal(check('v1.0.0').status, 1);
    const { prepareRelease } = await releaseModule;
    prepareRelease(root, '1.0.0');
    const valid = check('v1.0.0');
    assert.equal(valid.status, 0, valid.stderr);
});

test('packaging CLI builds the committed temporary project', async t => {
    const root = await fixture(t);
    cpSync(path.join(repository, 'scripts'), path.join(root, 'scripts'), { recursive: true });
    await commitFixture(root);
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/package.mjs')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.trim().endsWith('yt-ad-skip-v1.0.0.zip'));
    assert.ok(zipEntries(result.stdout.trim()).has('manifest.json'));
});
