# Summary — Agent Sims PDD

## Artifacts
- `rough-idea.md` — original concept
- `idea-honing.md` — 11 Q&A decisions
- `design/detailed-design.md` — full architecture, data models, component interfaces
- `implementation/plan.md` — 30-step ticket series with checklist

## Design in Brief

**What it is:** Sims-like browser app. Persistent AI agents with procedurally generated personalities live in a pixel-art office, autonomously pulling tasks through a 5-stage pipeline (Prioritize → Plan → Implement → Review → Merge). Each stage runs a different Claude model. Agents walk between office stations. XP/leveling system ties real coding output to game progression.

**Stack:** Fastify + TypeScript backend, React + PixiJS frontend, SQLite, Claude SDK multi-model, git worktrees, `gh` CLI, node-cron, node-pty.

**Key decisions:**
- Pipeline is workflow-stage-based (not role-based) because different models excel at different stages
- Agents persistent (always in office, idle at lounge when no task)
- Squads scope agents to specific projects
- Auto-merge when CI passes + Reviewer approved
- 3-loop max on Reviewer → Implementer cycles before `stuck`
- Office capacity gated by user level (starts 2 desks, expands on level-up)

## Implementation Phases
| Phase | Steps | Focus |
|---|---|---|
| 1 | 1-4 | DB schema, agent/squad/task APIs |
| 2 | 5-9 | Pipeline execution, scheduler, XP |
| 3 | 10-13 | Git workflow, auto-merge, GitHub crons |
| 4 | 14-19 | Office canvas, sprites, walk animation |
| 5 | 20-24 | UI panels (roster, queue, squad, HUD, side) |
| 6 | 25-30 | Prioritizer, CHANGES.md, settings, PR wall, cosmetics |

## Next Steps
1. Review `design/detailed-design.md` and `implementation/plan.md`
2. Start with Step 1 (DB schema migration)
3. Work through steps sequentially — each step is demoable before moving on
4. Tune XP numbers / personality traits / model assignments as you go
