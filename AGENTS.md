# Release workflow preferences

- After a fix is merged and its new release is successfully published, automatically delete the local working branches used for that fix without asking again. Switch to the repository's default branch first, and use safe deletion (`git branch -d`) after confirming the branches are merged. Preserve the default branch, branches with unmerged work, and branches checked out in other worktrees.
