# Idea Honing — Agent Sims

## Q1: What are the agent job types, and how does a job shape what an agent does?

In The Sims, a job is a career track that determines what activity the sim spends most of its time doing. For this system:

- Should jobs be **code-role-based** (e.g. Backend Dev, Frontend Dev, QA Tester, DevOps, Architect) where each role gets a different *category* of tasks from the queue?
- Or **workflow-stage-based** (e.g. Planner, Implementer, Reviewer, Merger) where the same task flows through agents in sequence?
- Or something else entirely?

And: are job types fixed (you configure them up front), or can you create custom job roles on the fly?

**Answer:** B — workflow-stage-based pipeline. Different AI models excel at different stages, so job type maps to model choice.

## Q2: What are the pipeline stages, and which model runs each?

You said different models excel at different tasks. Proposed default pipeline:

1. **Planner** — breaks down a feature/bug into subtasks, writes a spec (good fit: Opus for deep reasoning)
2. **Implementer** — writes the actual code (good fit: Sonnet for code quality + speed)
3. **Reviewer** — reviews the diff, catches bugs, requests changes (good fit: Opus or Sonnet)
4. **Merger** — runs tests, resolves conflicts, pushes + opens PR (good fit: Haiku for mechanical steps)

Questions:
- Does this match your mental model of the pipeline stages?
- Should the pipeline be configurable per-project (some projects skip Planning, others need a dedicated Reviewer)?
- Any stages missing (e.g. a QA/Tester stage that actually runs the test suite)?

**Answer:** Good start. Pipeline stages approved as-is for now.

## Q3: Task handoff between stages — automatic or human-gated?

When Planner finishes its spec, the task moves to Implementer. How should that transition work?

- **A) Fully automatic** — Planner done → Implementer immediately picks it up, no human needed. Stays "autonomous" like real Sims.
- **B) Human-gated per stage** — each stage completion pauses for your approval before advancing (like approving a PR review before merge).
- **C) Configurable per stage** — some transitions auto (Implementer → Reviewer), others require approval (Reviewer → Merger).

Also: if Reviewer requests changes, does the task loop back to Implementer automatically, or does a human decide?

**Answer:** Fully automatic by default. Individual tickets can be flagged `requires-human-review` — those pause at each stage transition for approval. Reviewer → Implementer loops automatically, max 3 loops per task; after 3 loops task is marked `stuck` and surfaced for human attention.

## Q4: How are tasks created / where does work come from?

Agents need a queue to pull from. Where do tasks originate?

- **A) Human-created only** — you write task descriptions in the UI (like GitHub issues), agents pick them up
- **B) GitHub issues / repo scanning** — agents periodically scan registered repos for open issues/PRs and auto-generate tasks from them
- **C) Both** — human can manually queue tasks AND agents can ingest from GitHub issues
- **D) Agent-generated** — Planner agent proactively reads the repo and proposes tasks; you approve them before they enter the queue

Which source(s), and should there be a task priority/ordering system (so agents pick highest-priority first)?

**Answer:** C — both human-created tasks and GitHub issue ingestion. A dedicated "Prioritizer" agent role scans the queue and auto-assigns priority scores. Humans can also manually set priority when creating a ticket. Agents always pick highest-priority available task for their stage.

## Q5: What do agent personalities actually do mechanically?

You mentioned agents have personalities like Sims. In Sims, personality traits affect mood, speed, skill gain, and social interactions. For AI agents, what should personality change?

Options:
- **Prompt flavor only** — personality is injected into the agent's system prompt (e.g. "You are meticulous and cautious, always add tests") — changes how it writes/comments, not what it does
- **Behavioral traits** — personality affects concrete behaviors: a "cautious" agent writes more tests, a "fast" agent skips optional steps, a "social" agent leaves more PR comments
- **Work speed/stamina** — personality affects how long an agent "rests" before picking up next task (pure visual/Sims flavor)
- **All of the above** — personality bundle: prompt injection + behavioral modifiers + rest time

Also: do you hand-craft each agent's personality, or are they procedurally generated when you "hire" a new agent?

**Answer:** All of the above — personality bundle: system prompt injection + behavioral modifiers (test coverage, PR comment verbosity, etc.) + rest duration. Procedurally generated on hire (randomized trait set with a name/avatar assigned).

## Q6: Office stations — what does each station do mechanically?

You mentioned: planning board, work desk, relaxation area, "other office things." In Sims, stations are where sims go to perform specific actions. For agents:

- **Planning Board** — where Planner agents go when working. Visually: agent walks to board, writes notes. Mechanically: where planning tasks execute?
- **Work Desk** — where Implementer/Reviewer/Merger agents sit when coding. Mechanically: where code tasks execute?
- **Relaxation Area** (couch, coffee machine, etc.) — where agents go when idle/between tasks. Rest timer ticks down here before agent picks up next task?
- **PR Wall / Kanban** — visual board showing task pipeline stages. Clickable to inspect tasks?

Questions:
- Does station = task execution location (agent must be at desk to work), or is it purely visual (agent walks there for flavor)?
- Any other stations you want — e.g. a "meeting room" where blocked agents wait, a "server room" for DevOps tasks?

**Answer:** Station = execution location. Agent must walk there before task starts (visual + mechanical gate). Meeting Room added for blocked/waiting-on-human agents. No server room.

Final station list:
- Planning Board — Planner agents
- Work Desk — Implementer/Reviewer/Merger agents
- Relaxation Area — idle agents between tasks
- Meeting Room — agents blocked on human input
- PR Wall / Kanban — visual pipeline display

## Q7: Git autonomy — how far can agents go without you?

You said agents look at repos, make branches, PRs, maintain them, merge them. How autonomous should the merge step be?

- **A) Full auto-merge** — Merger agent merges approved PRs to main automatically, no human needed
- **B) Auto-merge with conditions** — only merges if CI passes + Reviewer approved (no human click needed)
- **C) Propose only** — agents open the PR and mark it ready, but you manually click merge on GitHub
- **D) Configurable per repo** — some repos full-auto, others require human merge

Also: can agents respond to PR review comments from *humans* on GitHub (i.e. someone comments on the PR and the Implementer picks it back up to address feedback)?

**Answer:** B — auto-merge when CI passes + internal Reviewer approved. Agents respond to human PR comments. Listening mechanism: server-side cron job (not a dedicated agent) to poll GitHub for new comments on open PRs — token-efficient. Cron fires periodically, creates a new task for Implementer only if unresolved human comments found.

## Q8: Hiring — how do you add agents to the office?

In Sims you hire/create new sims. For this:

- How do you spawn a new agent? Button in UI ("Hire Agent"), pick job type (Planner/Implementer/Reviewer/Merger), system procedurally generates name + personality traits + avatar (one of Adam/Alex/Amelia/Bob sprites)?
- Do agents persist permanently (they exist even when not working — idle at lounge), or are they ephemeral (spawned per-task, despawn when done)?
- Can you "fire" an agent (remove from roster)?
- Max agents in office at once — any cap, or unlimited?

**Answer:** "Hire Agent" button → pick job type → procedural name + personality + avatar. Agents persistent (always in office, idle at lounge when no task). Agents have their own XP/level system from completing tasks. User also has a level — user XP earned from AI task completions, user level unlocks more office space/desk slots. Firing agents is supported. Office capacity upgrades with user level.

## Q9: XP and leveling — what do the numbers look like?

You introduced a great game loop. Let's nail the specifics:

**Agent XP:**
- Each completed task stage grants XP to the agent who did it (e.g. Planner gets XP when plan is approved, Implementer gets XP when code merges)
- Agent levels unlock what exactly? Stat boosts (faster rest recovery, better behavioral modifiers), cosmetic unlocks (new animations/outfits), or just a number on their profile card?

**User XP / Office level:**
- User gains XP per merged PR / completed task pipeline?
- What does each office level unlock — more desk slots, new room areas (e.g. level 5 unlocks the Meeting Room), new hire slots?
- Any rough idea of scale — e.g. level 1 = 2 desks, level 5 = 8 desks, level 10 = full office?

**Answer:** All approved, tune numbers later. Agent levels: stat boosts + cosmetics. User office level unlocks more desks/rooms/hire slots. Rough default: level 1 = 2 desks, scale from there.

## Q10: Existing codebase — what survives the rewrite?

Current repo has:
- **Backend modules:** worktree manager, task manager, agent runner (Claude SDK), PTY runner, PR service, WebSocket, SQLite schema, project registry
- **Frontend:** PixiJS office canvas, side panel, kanban board, PTY terminal (xterm.js)
- **Assets:** LimeZu Modern Interiors tiles + Adam/Alex/Amelia/Bob character sprites

New design has a pipeline-stage architecture, persistent agents, XP system, and station-based movement — the data model changes significantly.

Likely **keep:** worktree manager, PR service, PTY runner, agent runner core (SDK call), WebSocket gateway, asset files, PixiJS canvas skeleton
Likely **scrap/rewrite:** DB schema (agents table, XP, pipeline stages), task manager (queue logic changes), frontend UI (kanban → Sims office with stations), project registry (minor tweaks)

Does this rough split feel right, or is there anything specific you want preserved or definitely scrapped?

**Answer:** Split approved as stated.

## Q11: Agent roster composition — multiples of same role?

Can you hire multiple agents of the same job type — e.g. 3 Implementers + 1 Planner + 2 Reviewers — and they all pull from the same priority queue for their stage? Or is it 1 agent per role?

Also: the **Prioritizer** role from Q4 — is that a dedicated persistent agent in the office (sits at the Planning Board and periodically re-scores the queue), or a background cron job with no office presence?

**Answer:** Multiple agents per role allowed — they compete for the same stage queue in parallel. Agents can be grouped into **squads** that only pull tasks from specific projects. Prioritizer is a persistent agent with its own station (Planning Board).


