import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, RELEASE_FILES, isMain, readProject } from './project.mjs';

export function packageRelease(root = ROOT) {
    const { pkg } = readProject(root);
    const runGit = args => {
        const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
        if (result.error || result.status !== 0) {
            throw new Error('Commit all release files and metadata before packaging. Git must be installed.');
        }
        return result.stdout;
    };
    runGit(['ls-files', '--error-unmatch', '--', ...RELEASE_FILES]);
    runGit(['diff', '--quiet', 'HEAD', '--', ...RELEASE_FILES]);
    mkdirSync(resolve(root, 'dist'), { recursive: true });
    const artifact = resolve(root, 'dist', `yt-ad-skip-v${pkg.version}.zip`);
    // Archive only committed, explicitly listed runtime and documentation files.
    // Local logs, credentials, test fixtures, and node_modules cannot enter it.
    runGit(['archive', '--format=zip', `--output=${artifact}`, 'HEAD', '--', ...RELEASE_FILES]);
    const sha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex');
    writeFileSync(`${artifact}.sha256`, `${sha256}  ${basename(artifact)}\n`);
    return artifact;
}

if (isMain(import.meta.url)) {
    try {
        console.log(packageRelease());
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
