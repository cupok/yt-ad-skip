# Repository workflow preferences

- Make changes on a short-lived working branch and submit them through a pull request targeting the default branch. Do not commit or push directly to the default branch. Follow the signed commit and validation requirements in `CONTRIBUTING.md`.

- Complete the full workflow for requested repository changes: implement, validate, create signed Conventional Commits, push the working branch, open a PR, wait for required checks, resolve failures, squash-merge once repository requirements pass, sync the local default branch, and clean up merged working branches. Do not stop after opening a PR or ask for confirmation at each routine step. When the task includes a release, complete the documented release process and verify publication before cleanup. Stop only for a blocker that requires user input; do not bypass repository protections.

- After a fix is merged and its new release is successfully published, automatically delete the local working branches used for that fix without asking again. Switch to the repository's default branch first, and use safe deletion (`git branch -d`) after confirming the branches are merged. Preserve the default branch, branches with unmerged work, and branches checked out in other worktrees.

- For documentation-only or other changes that do not need a release, clean up the merged local working branches after the PR is merged and the local default branch is synced.
