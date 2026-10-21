# Repository workflow preferences

- Make changes on a short-lived working branch and submit them through a pull request targeting the default branch. Do not commit or push directly to the default branch. Follow the signed commit and validation requirements in `CONTRIBUTING.md`.

- After a fix is merged and its new release is successfully published, automatically delete the local working branches used for that fix without asking again. Switch to the repository's default branch first, and use safe deletion (`git branch -d`) after confirming the branches are merged. Preserve the default branch, branches with unmerged work, and branches checked out in other worktrees.
