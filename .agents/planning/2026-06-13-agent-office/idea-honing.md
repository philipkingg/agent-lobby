# Idea Honing

## Q1: Where do agent sessions run?
Will Claude Code sessions run on your local machine (web app talks to local processes), on a remote server/VM, or both (local now, remote later)?

**Answer:** Local now, design to expand to remote later.

## Q2: How should web app control/talk to each agent session?
Options:
- A) Claude Agent SDK headless mode (spawn programmatically, structured JSON I/O, easiest to parse status/questions)
- B) Wrap `claude` CLI in a PTY (real terminal session, can attach/view like tmux, but harder to parse "is it asking a question")
- C) Both — SDK for new "headless task" agents, PTY view for attaching to existing interactive sessions

Which fits your workflow best?

**Answer:** C) Both — SDK headless mode for new tasks, PTY attach for existing/interactive sessions.

## Q3: Visualization fidelity for the "office" theme
How fancy should the office/cubicle visualization be?
- A) Simple — cards/grid per agent w/ status icon + sprite (idle/working/blocked/done), minimal animation
- B) Game-like — 2D canvas (Phaser/PixiJS), little pixel-art people walking between desks, animated
- C) Skip visuals for v1 — focus on functional dashboard (list/table view), add office theme later as polish

Which level fits, given you said you want this for flexibility/your own build?

**Answer:** B) Game-like — 2D canvas (Phaser/PixiJS), animated pixel-art agents walking between desks.

## Q4: Office layout — how do desks map to projects/sessions?
Options:
- A) One desk per active session, all in one shared office floor (color/label shows which project)
- B) One "room" per project, each room has desks for that project's sessions — navigate between rooms
- C) One office per project (separate views), switch between offices via a building/floor selector

How do you want multiple projects represented spatially?

**Answer:** Start with A (one shared floor, desk per session, color/label by project), but design data model so B/C (rooms per project, separate offices) can be added later without rework.

## Q5: Agent states & question/notification handling
What states should an agent visually show (e.g. idle, working, blocked-on-question, error, done), and when an agent is "blocked on question" how should you be notified/respond?
- Notification options: visual badge on sprite (e.g. raised hand/thought bubble), browser push notification, sound, desktop notification
- Response options: click sprite opens a chat/terminal panel to answer inline, or jumps you straight into the PTY session

Any preferences, or should I propose a default set of states + a click-to-open-panel interaction?

**Answer:** Badge on sprite for notification (simple, v1). Clicking a desk/sprite opens a terminal panel on the right side of screen (shows PTY/session output, can type responses). States: idle, working, blocked-on-question (badge), error, done.

## Q6: Tech stack
Proposed default: Node/TypeScript backend (Express or Fastify) using `@anthropic-ai/claude-agent-sdk` for headless agents + `node-pty` for PTY sessions, WebSocket for live updates to browser, React + PixiJS frontend for the office canvas.

Any stack preferences/constraints (languages, frameworks you already use, want to avoid)?

**Answer:** Approved. All proposed tools are open-source/free (Node, Fastify, PixiJS, node-pty, React, WS) — no extra cost beyond Claude API tokens for SDK calls. Running locally = no infra cost.

## Q7: Task creation & git isolation
When you "hire" an agent for a task: pick project (local repo path) + write task description, agent starts working.

For running multiple agents on the SAME project concurrently — should each agent get its own git worktree (isolated branch/checkout) automatically, so they don't clobber each other's files? Or is one-agent-per-project-at-a-time fine for v1?

**Answer:** Yes, auto git worktree per agent task — each agent gets its own branch + worktree checkout. Agent opens a PR when done. Conflict resolution: PRs reviewed/merged by user (not fully automatic auto-merge) — design notes this as v1 scope, full auto-merge/conflict-bot is a stretch goal.

## Q8: Permission mode for unattended agents
Headless agents run on their own — Claude Code normally prompts for permission on risky tool calls (bash, file edits outside sandbox, etc). For "fire and forget" tasks, should agents run with elevated auto-accept (e.g. `bypassPermissions` / `acceptEdits` mode, since they're isolated in their own git worktree anyway), and only surface a question to you for things the agent itself decides need human input (per your original "unless it wants to ask a question" framing)?

**Answer:** Yes — full permission bypass (`bypassPermissions`), agents isolated in own worktree so it's safe. Agent only surfaces to user when it has a genuine question needing human input.

## Q9: Persistence & history
Should the app persist agent/task history (e.g. in SQLite) so you can see past tasks, transcripts, and PRs after restart — or is in-memory state (lost on server restart) fine for v1? Also: if server restarts while an agent is mid-task, should it be resumable (Claude Code supports session resume) or just marked failed/lost?

**Answer:** Yes — local SQLite for task/agent/transcript history. On restart, attempt to resume in-progress sessions via Claude Code session resume; if resume fails, mark as failed/needs-attention.

## Q10: Project registration & task completion flow
- How do you add a "project" to the app — paste a local repo path via UI, or scan a configured root directory for git repos?
- When agent finishes (opens PR), what happens visually — sprite walks to a "done" area / leaves office, and task moves to a "completed" list you can review?

**Answer:** Add project via UI — either a git URL (clone it) or local path. On task done (PR opened), agent stays at desk but plays an idle "slacking off" animation (e.g. leaning back, phone out) to visually signal done/idle; task also moves to a completed list for review.

## Q11: PR creation mechanism
Assume agents use `gh` CLI (already authenticated on your machine, since Claude Code can already use it) to push branch + open PR — same as how Claude Code already works for you. Confirm that's fine, and PRs target the project's default branch (e.g. `main`)?

**Answer:** Yes — `gh` CLI, push branch + open PR against project's default branch.

## Q12: Sprite/art assets
For pixel-art agents/office (Q3=B game-like), use a free/open-license asset pack (e.g. Kenney.nl, itch.io CC0 office/character tilesets) to start, vs custom-drawn assets later? Any preferred art style (16-bit RPG, modern flat, etc)?

**Answer:** Free CC0 asset pack now (e.g. Kenney.nl), custom art later. Style: simple, bright, colorful (not gritty/realistic) — e.g. Kenney "Tiny Town"/"Mini Characters" style packs.

## Q13 (from research): question detection, concurrency limit, worktree cleanup
1. Use custom `AskUser` tool the agent calls when it needs human input — gives unambiguous signal for "blocked" badge + notification.
2. Concurrent agent limit — default 4, configurable up to a hard cap of 10.
3. Worktree cleanup — manual via UI for v1 (no auto-remove on PR merge yet).

**Answer:** All agreed as stated.

