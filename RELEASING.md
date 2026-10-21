# Maintaining and releasing YT Ad Skip

This project uses a small GitHub workflow: feature branches, pull requests into
`main`, and tagged releases. There is no separate `develop` branch or npm package.

## Publication and repository settings

The repository is public. The first release,
[v1.0.0](https://github.com/cupok/yt-ad-skip/releases/tag/v1.0.0), was published on
2026-10-21. CI and the draft-release workflow were verified for that release.
Future releases use new versions and tags; do not recreate `v1.0.0`.

Repository settings checked on 2026-10-21:

- The active default-branch ruleset requires a PR, verified signed commits,
  resolved review conversations, a passing `Node 24` check from GitHub Actions,
  and an up-to-date branch. It requires zero approving reviews and has no bypass
  actors, so a solo maintainer can merge their own PR after the other checks pass.
- Squash merging is the only allowed merge method. The default commit message
  uses the PR title and description. Merged head branches are deleted automatically
  in this repository; local and fork branches need separate cleanup.
- Issues, private vulnerability reporting, secret scanning, and secret-scanning
  push protection are enabled. Auto-merge is off.

Keep these settings under review in GitHub. Markdown and workflow files do not
configure repository rules or visibility by themselves. Do not delete or move
published release tags, and review workflow or permission changes carefully.
The current ruleset protects the default branch, not release tags.

For terminology and the reasons behind this process, read the
[release workflow explanation](https://github.com/cupok/yt-ad-skip/blob/main/docs/RELEASE-WORKFLOW.md)
in the source repository.

## Everyday contributions

Users report problems in Issues. Contributors normally fork the repository,
create a branch, and open a PR. They cannot push to your `main` branch unless you
grant access. You decide what to merge and what to release.

Use short-lived branches such as `fix/chat-timeout`. CI checks syntax, metadata,
and tests on Node 24. Review behavior and run a manual Chrome smoke check
when the change touches the YouTube integration or settings layout. Merge a
focused PR with **Squash and merge**, using a Conventional Commit title.

Add user-visible changes to the appropriate `Unreleased` section in
`CHANGELOG.md`: Added, Changed, Deprecated, Removed, Fixed, or Security. Write
notes for people using the extension. Keep refactors and test details in commit
and PR descriptions unless users need to know about them.

You do not need a release for every commit. `main` can contain several accepted
changes before you decide to publish a new version.

## Choose a version

Use the same numeric `MAJOR.MINOR.PATCH` in `manifest.json` and `package.json`.
`1.0.0` has already been released. Choose a new version for each future release.

| Change | Example next version |
| --- | --- |
| Compatible bug fix | `1.0.0` → `1.0.1` |
| Compatible new feature | `1.0.1` → `1.1.0` |
| Breaking change to supported behavior or settings compatibility | `1.1.0` → `2.0.0` |

For this extension, compatibility means the documented user-facing behavior,
settings, and supported integration; there is no exported library API. Use
judgment for UI improvements rather than treating every label change as breaking.

Chrome requires numeric version components. The helper accepts three components
from 0 to 65535, without leading zeros, and rejects `0.0.0` and prerelease suffixes
such as `-beta`. Keep beta testing on a branch until a separate prerelease
numbering policy is needed. See [Chrome's version rules](https://developer.chrome.com/docs/extensions/reference/manifest/version)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Prepare a release

Start from an up-to-date `main`, with ordinary feature work and its user-facing
`Unreleased` changelog notes already merged. The following commands use `1.0.1`
as an example next patch release; choose the version appropriate to the changes.
The helper rejects an empty `Unreleased` section, so wait until there are release
notes to publish.

```sh
git switch main
git pull --ff-only
git switch -c release/1.0.1
npm run release:prepare -- 1.0.1
npm run check -- --tag v1.0.1
npm test
npm run test:coverage
```

The preparation command updates both version files, moves `Unreleased` notes
into a dated `1.0.1` section, and leaves a fresh `Unreleased` section. It does not
commit, tag, push, or publish anything. Once a version has a dated entry, reuse is
rejected. The `check -- --tag` command validates the proposed tag name and release
metadata without creating a tag.

Review the version numbers and changelog diff, then commit the preparation:

```sh
git add manifest.json package.json CHANGELOG.md
git commit -m "chore(release): prepare 1.0.1"
git push -u origin release/1.0.1
```

Open a PR against `main`. Wait for the required checks and resolve review
conversations, then squash merge with a Conventional Commit title. Local commits
must have signatures GitHub can verify, as required by the ruleset.

## Build, test, tag, and publish

After the release PR is merged, update local `main` and build the committed tree:

```sh
git switch main
git pull --ff-only
npm run check -- --tag v1.0.1
npm test
npm run package
```

For version `1.0.1`, `npm run package` produces `dist/yt-ad-skip-v1.0.1.zip` and
its `.sha256` checksum. It archives only explicitly listed, committed extension
and documentation files. Tests, scripts, Git metadata, editor files, local logs,
and environment files are excluded. Packaging refuses uncommitted changes to
included files.

Extract the ZIP and run the manual smoke check below. Disable other unpacked
copies before testing, and refresh YouTube tabs. Once the packaged build passes,
tag that tested commit from the repository:

```sh
git tag -a v1.0.1 -m "Release 1.0.1"
git push origin v1.0.1
```

Pushing `v1.0.1` starts the **Draft release** workflow. It checks the tag against
both version files and the dated changelog, runs the checks and tests, packages
the extension, and creates a **draft** GitHub release containing the ZIP,
checksum, and changelog notes. The workflow uses GitHub's built-in token; no
personal token or Chrome Web Store credentials are needed.

Review the draft under **Releases** and download both its ZIP and checksum.
From their download directory, verify the ZIP:

```sh
shasum -a 256 -c yt-ad-skip-v1.0.1.zip.sha256
```

Confirm the uploaded archive contains the tested files, install it in Chrome,
and click **Publish release** when satisfied. Separately built ZIPs can have
different metadata or compression, so compare extracted file contents if their
archive hashes differ; verify each ZIP against its own supplied checksum.
Creating or merging a PR does not publish a release. If a workflow rerun finds
an existing draft, inspect that draft instead of moving the tag or overwriting
a published release.

GitHub publishing and Chrome Web Store publishing are separate. The current
workflow distributes unpacked releases through GitHub only. Users must replace
their installed files, reload the extension, and refresh YouTube tabs to update.

## Manual smoke check

- Extract the release ZIP and load its folder as an unpacked extension in Chrome.
- Open settings, change a whole-second delay, save it, and reopen the popup.
- Check the English, Ukrainian, and Russian interfaces where practical.
- On an eligible video, enter fullscreen and verify that the submitted prompt
  includes both `[SPONSOR]` and `[FUNDRAISING]`.
- Confirm the close delay begins after a new response settles and old chat
  history cannot trigger it. A timeout should leave chat open.
- Confirm the cancellation countdown updates and auto-skip occurs on expiry.
- Confirm the fill animates smoothly. Pause partway through the countdown, wait
  longer than the remaining delay, and confirm neither the countdown nor playback
  advances. Resume and confirm skipping waits for the remaining delay.
- Check a fresh profile or reset defaults: chat closure defaults to 5 seconds,
  and console debug logging is off.
- Cancel one segment, seek back into it, and confirm it stays canceled. Other
  segments should still auto-skip. Check the keyboard shortcut as well.
- Toggle console debug. Export logs only with the explicit button.

## Fix a released bug

Open a fix PR, add a regression test and an `Unreleased` changelog entry, then
prepare a patch release. Never amend an already published release commit or
reuse its tag for different code. If a release must be withdrawn, explain the
problem in its notes and publish a new version with the fix.

Check the PR, `main`, and tag-triggered workflow results for each future release.
Passing local checks alone does not verify GitHub's workflow execution or the
uploaded release assets.
