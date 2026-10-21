# Contributing

Thanks for helping improve YT Ad Skip. Small fixes and clear bug reports are
useful contributions; you do not need to start with a large feature.

## Report a bug

Search existing issues, then use the bug report form. Include the extension
version, Chrome version, interface language, reproduction steps, and expected
versus actual behavior. A public video URL and approximate time range can help
when the problem concerns detection. Confirm whether video AI chat is available.

Logs are optional. Read [PRIVACY.md](PRIVACY.md) and redact them before attaching.
Security vulnerabilities belong in a private report; see [SECURITY.md](SECURITY.md).

## Propose a feature

Open an issue before starting a substantial behavior change, new dependency,
permission, or service integration. Explain the problem first. A proposal does
not reserve implementation work or guarantee it will be accepted.

## Make a change

1. Fork the repository, clone your fork, and create a short-lived branch from
   `main`, such as `fix/chat-timeout` or `feat/new-language`.
2. Use Node.js 24 (`.nvmrc`). No `npm install` is needed.
3. Keep the change focused and follow the existing plain JavaScript style.
4. Add regression tests for behavior changes. Put test utilities in
   `tests/helpers`; production scripts should not expose test-only APIs.
5. Run `npm run check`, `npm test`, and any relevant manual Chrome checks.
6. Add an entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) for a
   user-visible change. Describe the result for users rather than implementation
   details. Documentation-only and test-only work usually needs no entry.
7. Open a pull request against `main` with a summary and validation results.

The active `main` ruleset requires a PR, verified signed commits, a passing
`Node 24` check from GitHub Actions, and an up-to-date branch. Set up commit
signing before creating commits; unsigned commits on a PR branch can block a
squash merge even if the final squash commit would be signed by GitHub.
See [GitHub's signing requirements](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-signed-commits).

Changing extension files requires reloading the extension in `chrome://extensions`
and refreshing existing YouTube tabs before testing the updated behavior.

Use Conventional Commits for commit messages and PR titles, for example:

```text
fix(chat): keep the panel open while the answer is streaming
feat(settings): add another supported language
docs: clarify installation requirements
test(skipping): cover cancellation after seeking back
```

Use `!` for a breaking change, with migration information in the description.
The maintainer can help adjust a PR title before merging. Contributors normally
leave version numbers alone; release preparation updates them separately.

## Review and expectations

CI runs on pull requests. The maintainer reviews the proposed behavior, tests,
permissions, and privacy impact, and may request changes. A passing test suite
does not guarantee a merge. Please keep discussions respectful and specific.

The allowed merge method is **Squash and merge**, using the final Conventional
Commit PR title and PR description as the default commit message. Resolve review
conversations before merging. No separate approving review is required by the
current ruleset, but the maintainer still decides which changes to accept.
GitHub automatically deletes merged head branches in this repository; contributors
manage local branches and branches in their own forks separately.

Maintainers should not amend or force-push published release commits or tags.
Work is voluntary; response and release times are not guaranteed.

By contributing, you agree that your contribution is provided under this
repository's [MIT license](LICENSE). You retain copyright in your contributions.
No contributor license agreement or sign-off is currently required.
