# Research: Sprite/Tile Assets (CC0) and Git Worktree Automation

## Sprite & tile assets (Q12 — simple, bright, CC0, custom later)
Source: [Kenney.nl assets](https://kenney.nl/assets)

Candidate Kenney CC0 packs (all free, CC0 1.0 Universal — usable commercially with no attribution required):
- **Tiny Town** (130 assets) — small bright top-down/isometric town/building tiles; good base for an office floor layout (desks, walls, props).
- **Mini Characters** (25 assets) — simple bright character sprites, likely sufficient for v1 agent avatars (may need to check available animation frames — walk/idle).
- **Isometric Prototypes Tiles** — includes a character with 8 directions / 3 animations (idle/walk/etc.), CC0 — good fallback if Mini Characters lacks enough animation frames.
- **1-Bit Pack** — alternative minimalist style if "simple and bright" trends toward flat/monochrome later.

**Recommendation:** start with **Tiny Town** for office floor/desk tiles + **Mini Characters** (or **Isometric Prototypes** if more animation frames needed) for agent sprites. Exact frame availability (idle/working/blocked/done poses) should be verified by downloading the pack during implementation — if Mini Characters lacks a "sitting at desk working" pose, combine with Tiny Town's furniture sprites (desk + chair) and animate the character via simple bob/typing motion using available walk-cycle frames.

## Git worktree automation (Q7 — per-agent worktree + branch + PR)
Sources:
- [Multi-Agent AI Coding Workflow: Git Worktrees That Scale](https://blog.appxlab.io/2026/03/31/multi-agent-ai-coding-workflow-git-worktrees/)
- [How Git Worktrees Changed My AI Agent Workflow — Nx Blog](https://nx.dev/blog/git-worktrees-ai-agents)
- [Worktrunk](https://worktrunk.dev/)

## Pattern: one task → one branch → one worktree
Confirmed as the standard/recommended pattern for parallel AI agent workflows — gives true file-level isolation with zero networking overhead (each worktree is a separate checkout sharing the same `.git` object store).

## Implementation for our app
For each new task on project `P`:
1. `git -C P worktree add ../P-worktrees/<task-id> -b agent/<task-id> <default-branch>` — creates isolated checkout on a new branch.
2. Run the agent (SDK or PTY `claude`) with `cwd` = the new worktree path.
3. On completion: `git -C <worktree> push -u origin agent/<task-id>` then `gh pr create --base <default-branch> --head agent/<task-id> --title ... --body ...` (per Q11).
4. After PR is merged/closed (user action, possibly detected via `gh pr view --json state` polling or webhook later), clean up: `git -C P worktree remove ../P-worktrees/<task-id>` and optionally delete the branch.

## Open items for design
- Need a configured "worktrees root" per project (e.g. `<project>/../<project-name>-worktrees/`).
- Dependency installation per worktree (e.g. `npm install`) may be needed if the project requires `node_modules` — could be slow per-task; consider sharing via pnpm/symlink strategies later (flagged as v2 optimization, not blocking v1).
- Cleanup policy (auto-remove on PR merge vs manual) — default to manual removal via UI action for v1, simplicity over automation.
