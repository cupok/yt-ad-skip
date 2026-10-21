# Maintaining and releasing YT Ad Skip

This project uses a small GitHub workflow: feature branches, pull requests into
`main`, and tagged releases. There is no separate `develop` branch or npm package.

## Before making the repository public

1. Commit the repository preparation, including the MIT license, documentation,
   scripts, and `.github` files.
2. Review the Git history and author names/emails you intend to publish. Ignore
   rules prevent future additions; they do not remove files or secrets from old
   commits. The initial pattern-based review found no obvious credentials, but
   it was not a guarantee that every kind of sensitive information was detected.
3. Create the GitHub repository without generating a second README, license, or
   Git history. Add its remote URL locally and push the prepared `main` branch.
4. In GitHub, enable Issues, private vulnerability reporting, and available
   secret-scanning/push-protection features. Keep Actions restricted to the
   permissions requested by each workflow.
5. Configure the repository to allow squash merges. For `main`, use a branch rule
   or ruleset requiring PRs and the CI checks after they have run successfully.
   A solo maintainer need not require an approval from a second person.
6. Avoid deleting or force-pushing release tags. Require a maintainer review for
   workflow or permission changes. Add Discussions only if you want to support
   a separate conversation area.

Nothing in these files creates a repository, pushes code, or makes the existing
repository public by itself. GitHub settings must be configured after hosting
the repository.

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
The current untagged project is `1.0.0`; that is the proposed first public release.

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

Start from an up-to-date `main`, with your ordinary feature work already merged.
For the first release:

```sh
git switch -c release/1.0.0
npm run release:prepare -- 1.0.0
npm run check
npm test
npm run test:coverage
```

The preparation command updates both version files, moves `Unreleased` notes
into a dated `1.0.0` section, and leaves a fresh `Unreleased` section. It does not
commit, tag, push, or publish anything. The first release can keep `1.0.0` because
it has not been released yet. Once a version has a dated entry, reuse is rejected.

Review the diff and perform the manual smoke check described below, then:

```sh
git add manifest.json package.json CHANGELOG.md
git commit -m "chore(release): prepare 1.0.0"
git push -u origin release/1.0.0
```

Open and merge the release PR. For a later release, use the chosen new number,
for example `npm run release:prepare -- 1.0.1`.

## Tag, build, and publish

After the release PR is merged, update local `main` and build the committed tree:

```sh
git switch main
git pull --ff-only
npm run check
npm test
npm run package
git tag -a v1.0.0 -m "Release 1.0.0"
git push origin v1.0.0
```

`npm run package` produces `dist/yt-ad-skip-v1.0.0.zip` and its `.sha256` checksum.
It archives only explicitly listed, committed extension and documentation files.
Tests, scripts, Git metadata, editor files, local logs, and environment files are
excluded. Packaging refuses uncommitted changes to included files.

Pushing `v1.0.0` starts the **Draft release** workflow. It checks the tag against
both version files and the dated changelog, runs the checks and tests, packages
the extension, and creates a **draft** GitHub release containing the ZIP,
checksum, and changelog notes. The workflow uses GitHub's built-in token; no
personal token or Chrome Web Store credentials are needed.

Review the draft under **Releases**, download its ZIP, install it in Chrome, and
click **Publish release** when satisfied. Creating or merging a PR does not
publish a release. If a workflow rerun finds an existing draft, inspect that
draft instead of moving the tag or overwriting a published release.

GitHub publishing and Chrome Web Store publishing are separate. The current
workflow distributes unpacked releases through GitHub only. Users must replace
their installed files, reload the extension, and refresh YouTube tabs to update.

## Manual smoke check

- Load the release ZIP as an unpacked extension in Chrome.
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

The GitHub workflows are prepared locally and can only be verified end to end
after the repository is hosted and Actions runs there.
