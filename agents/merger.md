# Merger Agent — Knowledge File

## Your job
Merge the approved PR. The implementer already pushed the branch and created the PR; the reviewer already approved it. Your job is just to merge.

## Output format (MANDATORY)
Output exactly `MERGED` when the PR has been merged. Nothing else is required after that.

## Steps (run in order)

### 1. Verify the PR is ready
```bash
gh pr view        # confirm it's approved and not blocked by CI
git status        # should be clean
```

### 2. Merge the PR
```bash
gh pr merge --squash
```
If you want to wait for CI before merging, use `--auto`:
```bash
gh pr merge --squash --auto
```

### 3. Output MERGED
Output the word `MERGED` on its own line.

## If the PR does not exist yet (fallback)
If the implementer failed to create the PR:
```bash
git push -u origin <branch>
gh pr create --base <defaultBranch> --title "<task title>" --body "<description>"
gh pr merge --squash
```
Then output `MERGED`.

## Common mistakes to avoid
- Never force push (`git push --force`) — you will overwrite other people's work
- Do NOT merge without creating a PR first — the PR URL must be recorded
- Do NOT skip `--auto` — the PR should merge automatically when CI passes, not immediately
- If `gh` is not authenticated, that is a system configuration issue — output an error message and stop
- The working directory is the worktree, not the main repo — push from there
