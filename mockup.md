# Agent Lobby — UX Mockups

All views share a single-page layout. The office canvas is always visible. The right panel is context-sensitive — it swaps content based on what is selected (agent, task, or panel nav). The pixel-art office is the heart of the experience; everything else orbits it.

---

## 1. Main Layout (idle state — no selection)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  🏢 AGENT LOBBY                                      Lv 4  ████████░░░  820/1000 XP  │  ← User HUD
├─────────────────────────────────────────────────────────────────────┬──────────────────┤
│                                                                     │  [Agents]        │
│                                                                     │  [Tasks]         │
│              OFFICE CANVAS  (PixiJS — always visible)               │  [Squads]        │  ← Nav tabs
│                                                                     │  [Settings]      │
│                                                                     │                  │
│                                                                     │  ┌────────────┐  │
│                                                                     │  │  New Task  │  │
│                                                                     │  └────────────┘  │
│                                                                     │                  │
│                                                                     │  No selection.   │
│                                                                     │  Click an agent  │
│                                                                     │  or open a panel │
│                                                                     │  to get started. │
│                                                                     │                  │
└─────────────────────────────────────────────────────────────────────┴──────────────────┘
```

The canvas is ~75% of the viewport width. The right panel is always present. Nav tabs swap the panel content. Clicking anything on the canvas (agent, desk, station) also updates the right panel.

---

## 2. Office Canvas — Station Layout

The office is a fixed-size pixel-art room tiled with LimeZu Modern Interiors assets. Stations are labeled zones. Agents are 16×16 sprites that walk between them.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             AGENT LOBBY OFFICE                               │
│ ╔══════════════╗  ╔═══════════════════════════════╗  ╔═══════════════════╗  │
│ ║  PLANNING    ║  ║      WORK DESKS               ║  ║   MEETING ROOM    ║  │
│ ║  BOARD       ║  ║  ┌────┐  ┌────┐  ┌────┐      ║  ║  (blocked agents) ║  │
│ ║              ║  ║  │ 💻 │  │ 💻 │  │ 💻 │      ║  ║                   ║  │
│ ║  [Prioritize]║  ║  │    │  │    │  │    │      ║  ║  ≋ Amelia [?]     ║  │
│ ║              ║  ║  └────┘  └────┘  └────┘      ║  ║    "which API?"   ║  │
│ ║  ≋ Alex      ║  ║   desk1   desk2   desk3       ║  ║                   ║  │
│ ║  [working]   ║  ║  ≋ Adam   ≋ Bob  [empty]     ║  ╚═══════════════════╝  │
│ ╚══════════════╝  ╚═══════════════════════════════╝                          │
│                                                          ╔═════════════════╗ │
│ ╔═══════════════════════════════════════════════╗        ║   PR WALL       ║ │
│ ║  RELAXATION AREA  (idle agents lounge here)  ║        ║ #42 ✅ CI pass  ║ │
│ ║                                               ║        ║ agent/feat-abc  ║ │
│ ║    🛋                            🪴            ║        ║                 ║ │
│ ║          ≋ Bob        ≋ Olive                 ║        ║ #39 ⏳ CI run   ║ │
│ ║          [idle]       [idle]                  ║        ║ agent/fix-xyz   ║ │
│ ╚═══════════════════════════════════════════════╝        ╚═════════════════╝ │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Station → Job type mapping:**

| Station        | Agents who work here        | Animation            |
|----------------|-----------------------------|----------------------|
| Planning Board | Prioritizer, Planner        | sit2 (working pose)  |
| Work Desks     | Implementer                 | sit2 (working pose)  |
| Meeting Room   | Any blocked agent           | phone (waiting pose) |
| Relaxation     | All idle agents             | sit / idle_anim      |
| PR Wall        | Reviewer, Merger            | sit2 (working pose)  |

Desk slots are gated by user level (Lv 1 = 2 desks, Lv 2 = 3, etc.). Locked desks render as faded/grey.

---

## 3. Agent Walking — Transition State

When a task is claimed, the agent walks from their current station to the target station before starting work. The side panel shows the walk in progress.

```
Office canvas:

  RELAXATION                             WORK DESKS
  ╔══════════╗                           ╔══════════╗
  ║          ║                           ║  ┌────┐  ║
  ║          ║    ≋ Adam →→→→→→→→→→→→→  ║  │    │  ║
  ║  [empty] ║       (walking sprite)    ║  └────┘  ║
  ╚══════════╝                           ╚══════════╝

Right panel (while walking):
  ┌──────────────────────┐
  │ ≋ Adam               │
  │ Implementer  Lv 2    │
  │                      │
  │ 🚶 Walking to        │
  │    Work Desk 1...    │
  │                      │
  │ Task:                │
  │ "Add OAuth login"    │
  │ [queued:implement]   │
  └──────────────────────┘
```

Walk speed is influenced by the `swift` personality trait. Arrival triggers the `agent:arrived` WS event, which starts the Claude SDK call.

---

## 4. Agent Selected — Right Panel

Clicking any agent sprite opens their detail card in the right panel.

```
┌────────────────────────────────┐
│  ≋ Adam Byte           [✕]    │
│  Implementer  claude-sonnet    │
├────────────────────────────────┤
│  Level 3  ███████░░░  680 XP  │
│           70 XP to next level  │
├────────────────────────────────┤
│  Traits                        │
│  ⚡ swift      "works fast"    │
│  🔬 thorough   "no shortcuts"  │
│  🎯 focused    "scope: narrow" │
├────────────────────────────────┤
│  Status:  🟢 working           │
│  Task:    "Add OAuth login"    │
│  Stage:   implement            │
│  Branch:  agent/add-oauth-...  │
├────────────────────────────────┤
│  [ View Task Transcript ]      │
│  [ Fire Agent ]                │
└────────────────────────────────┘
```

XP bar fills toward the next level. Traits show the adjective, name, and their prompt modifier effect. "Fire Agent" pops a confirm dialog.

---

## 5. Agents Panel (nav tab)

Full roster of hired agents. Hire new ones here.

```
Right panel — [Agents] tab active:

┌────────────────────────────────┐
│  AGENTS                        │
│  4 hired  /  6 capacity        │
├────────────────────────────────┤
│  ≋ Adam Byte    Impl    Lv 3  │
│    🟢 working · "OAuth login"  │
│  ≋ Alex River   Plan    Lv 1  │
│    🟡 idle                     │
│  ≋ Amelia Oak   Rev     Lv 2  │
│    🔴 blocked · "which branch?"│
│  ≋ Bob Stack    Merge   Lv 1  │
│    🟡 idle                     │
├────────────────────────────────┤
│  [ + Hire New Agent ]          │
└────────────────────────────────┘
```

Clicking a row selects that agent and snaps the canvas camera to them. "Hire New Agent" opens the hire modal (see below).

---

## 6. Hire Agent Modal

```
┌──────────────────────────────────────────┐
│  Hire New Agent                    [✕]  │
├──────────────────────────────────────────┤
│                                          │
│  Job Type:                               │
│  ○ Prioritizer   (haiku — fast queue)   │
│  ● Implementer   (sonnet — coder)       │
│  ○ Planner       (opus  — architect)    │
│  ○ Reviewer      (sonnet — QA)          │
│  ○ Merger        (haiku — shipper)      │
│                                          │
│  ─────────────────────────────────────  │
│  Preview (generated on hire):            │
│                                          │
│    ≋ ??? ????                            │
│    Traits: swift · thorough · focused    │
│    Rest interval: ~45s                   │
│    Model: claude-sonnet-4-6              │
│                                          │
│  Personality is procedurally generated. │
│  You'll meet them when they join!        │
│                                          │
│  [    Cancel    ]  [ Hire Agent →  ]    │
└──────────────────────────────────────────┘
```

Personality is not previewed — it's revealed on hire for the "Sims moment" of discovery.

---

## 7. Tasks Panel (nav tab)

Pipeline column view. Each column is a stage. Drag not supported — tasks advance automatically.

```
Right panel — [Tasks] tab active, scrollable:

┌────────────────────────────────┐
│  TASK QUEUE        [ + New ]  │
├───────┬───────┬────────────────┤
│PRIORIT│ PLAN  │ IMPLEMENT      │  ← columns
├───────┼───────┼────────────────┤
│ #003  │ #001  │ #002           │
│ OAuth │ Dark  │ Fix crash      │
│ login │ mode  │ on login       │
│ P:4   │ P:5   │ P:3            │
│       │       │ ≋ Adam         │
│       │       │ 🟢 running     │
├───────┴───────┴────────────────┤
│ REVIEW │ MERGE │ DONE          │
├────────┼───────┼───────────────┤
│        │ #004  │ #000          │
│        │ Auth  │ Init setup    │
│        │ P:5   │ ✅            │
│        │⏳ CI  │               │
└────────┴───────┴───────────────┘
```

Clicking any task card selects it and shows details in panel. Tasks with `awaiting_approval` show a 🚩 gate badge. Stuck tasks show ⚠.

---

## 8. New Task Form

Appears inline in the Tasks panel when "New" is clicked, or as a modal.

```
┌────────────────────────────────┐
│  New Task                [✕]  │
├────────────────────────────────┤
│  Project:                      │
│  ┌──────────────────────────┐ │
│  │ agent-lobby ▾            │ │
│  └──────────────────────────┘ │
│                                │
│  Title:                        │
│  ┌──────────────────────────┐ │
│  │ Add dark mode toggle     │ │
│  └──────────────────────────┘ │
│                                │
│  Description:                  │
│  ┌──────────────────────────┐ │
│  │ Add a dark/light mode    │ │
│  │ toggle to the settings   │ │
│  │ panel. Persist in        │ │
│  │ localStorage.            │ │
│  └──────────────────────────┘ │
│                                │
│  Priority:  ○1 ○2 ●3 ○4 ○5   │
│                                │
│  ☐ Requires my review         │
│    (pauses at each stage gate) │
│                                │
│  [ Cancel ]  [ Create Task → ] │
└────────────────────────────────┘
```

---

## 9. Blocked Agent — Meeting Room + Right Panel

When an agent calls `AskUser`, they walk to the Meeting Room and the panel shows the question.

```
Office canvas — Meeting Room:

  ╔═══════════════════════════╗
  ║  MEETING ROOM             ║
  ║                           ║
  ║   [  table  ]             ║
  ║                           ║
  ║   ≋ Amelia    [?]         ║  ← sprite + thought bubble badge
  ║                           ║
  ╚═══════════════════════════╝

Right panel (auto-opens when agent blocked):

┌────────────────────────────────┐
│  ≋ Amelia Oak needs input [✕] │
├────────────────────────────────┤
│  Task: "Fix OAuth crash"       │
│  Stage: implement              │
├────────────────────────────────┤
│  💬 "Should I use the         │
│  existing session token or     │
│  create a new one? The         │
│  current flow looks buggy."    │
├────────────────────────────────┤
│  Your answer:                  │
│  ┌──────────────────────────┐ │
│  │ Use the existing token   │ │
│  │ but add a validity check │ │
│  └──────────────────────────┘ │
│                                │
│  [ Send Answer → ]             │
│                                │
│  ─────────────────────────── │
│  [ ■ Stop Agent ]              │
└────────────────────────────────┘
```

Sending the answer triggers `POST /tasks/:id/respond`, the agent walks back to their desk, and the SDK resumes.

---

## 10. Stage Gate — Awaiting Approval

When `requiresHumanReview=true`, a task pauses between stages. A flag badge appears on the task card (PR Wall or Task panel).

```
Right panel — task selected, awaiting_approval:

┌────────────────────────────────┐
│  Task: "Add OAuth login"  [✕] │
│  🚩 Awaiting your approval     │
├────────────────────────────────┤
│  Stage: queued:implement       │
│  (prioritize stage complete)   │
│                                │
│  Planner output:               │
│  ┌──────────────────────────┐ │
│  │ Plan:                    │ │
│  │ 1. Add /auth/callback    │ │
│  │ 2. Store token in session│ │
│  │ 3. Add logout endpoint   │ │
│  └──────────────────────────┘ │
│                                │
│  [ ✓ Approve — Start Impl ] ] │
│  [ ✕ Reject — Mark Stuck   ] │
└────────────────────────────────┘
```

---

## 11. Squads Panel (nav tab)

```
Right panel — [Squads] tab:

┌────────────────────────────────┐
│  SQUADS              [ + New ] │
├────────────────────────────────┤
│  Frontend Team                 │
│  Projects: agent-lobby         │
│  Agents:   ≋ Adam, ≋ Amelia   │
│  [ Edit ]                      │
├────────────────────────────────┤
│  Backend Team                  │
│  Projects: api-server          │
│  Agents:   ≋ Alex, ≋ Bob      │
│  [ Edit ]                      │
└────────────────────────────────┘

Edit squad inline:

┌────────────────────────────────┐
│  Edit: Frontend Team     [✕]  │
├────────────────────────────────┤
│  Name: [Frontend Team        ] │
│                                │
│  Projects:                     │
│  ☑ agent-lobby                 │
│  ☐ api-server                  │
│                                │
│  Agents:                       │
│  ☑ ≋ Adam Byte  (Impl)         │
│  ☐ ≋ Alex River (Plan)         │
│  ☑ ≋ Amelia Oak (Rev)          │
│  ☐ ≋ Bob Stack  (Merge)        │
│                                │
│  [ Save Changes ]              │
└────────────────────────────────┘
```

---

## 12. Agent State Badges (sprite overlays)

Small icon overlaid in the top-right of an agent sprite:

```
  ≋ 💬  →  blocked (AskUser / meeting room)
  ≋ 🚩  →  awaiting_approval (stage gate)
  ≋ ⚠   →  stuck (max review loops hit)
  ≋ ✅  →  just finished a task (fades after 3s)
  ≋ ⬆   →  just leveled up (particle burst, then fades)
  ≋      →  idle (no badge)
  ≋ 🏃  →  walking to station (motion lines)
```

---

## 13. User HUD — Level Up

When the user gains enough XP (from merged PRs), the top bar pulses and a banner drops in.

```
┌────────────────────────────────────────────────────────────────────────────┐
│  🏢 AGENT LOBBY                ⬆  LEVEL UP!  You are now Level 5!         │
│                                   New desk slot unlocked (6 desks total)   │
│                                              [  OK  ]                       │
└────────────────────────────────────────────────────────────────────────────┘
```

After OK, the HUD updates and a new desk slot appears in the canvas with a sparkle animation.

---

## 14. Settings Panel (nav tab)

```
Right panel — [Settings] tab:

┌────────────────────────────────┐
│  SETTINGS                      │
├────────────────────────────────┤
│  Projects                      │
│  ┌──────────────────────────┐ │
│  │ agent-lobby  /dev/agent  │ │
│  │                  [✕ rm] │ │
│  └──────────────────────────┘ │
│  + Add project path            │
│  [/path/to/repo     ] [Add]   │
├────────────────────────────────┤
│  Scheduler                     │
│  Auto-tick:  ● On   ○ Off     │
│  Interval:   [5] seconds       │
├────────────────────────────────┤
│  GitHub Cron                   │
│  PR poll:    every [5] min     │
│  Issue sync: every [15] min    │
│  [ Run now: Poll PRs ]         │
│  [ Run now: Sync Issues ]      │
├────────────────────────────────┤
│  Model overrides               │
│  Prioritizer: [haiku ▾]        │
│  Planner:     [opus  ▾]        │
│  Implementer: [sonnet▾]        │
│  Reviewer:    [sonnet▾]        │
│  Merger:      [haiku ▾]        │
└────────────────────────────────┘
```

---

## 15. Task Transcript (side panel)

When an agent is working (or after completion), clicking "View Transcript" shows the live SDK stream.

```
┌────────────────────────────────┐
│  Task: "Add OAuth login"  [✕] │
│  ≋ Adam · implement stage      │
│  🟢 running                   │
├────────────────────────────────┤
│  TRANSCRIPT                    │
│  ┌──────────────────────────┐ │
│  │ > Reading src/auth.ts... │ │
│  │                          │ │
│  │ > I'll add the callback  │ │
│  │   endpoint first. Let me │ │
│  │   check the existing     │ │
│  │   session middleware...  │ │
│  │                          │ │
│  │ > git add src/auth.ts    │ │
│  │   git commit -m "add     │ │
│  │   OAuth callback"        │ │
│  │                          │ │
│  │   [1 file changed]       │ │
│  │                          │ │  ← live streaming
│  │ > Merging origin/main... │ │
│  │   ▌                      │ │  ← cursor blinks
│  └──────────────────────────┘ │
│                                │
│  Branch: agent/add-oauth-a1b2  │
│  PR: (pending merge stage)     │
│                                │
│  [ ■ Stop Agent ]              │
└────────────────────────────────┘
```

---

## Interaction Flow Summary

```
User creates task
      │
      ▼
[queued:prioritize] ──→ Prioritizer agent walks to Planning Board
                              │ sets priority, done
                              ▼
                    [queued:plan] ──→ Planner walks to Planning Board
                              │ writes plan, done
                              ▼
                    [queued:implement] ──→ Implementer walks to Work Desk
                              │ codes, commits, done
                              ▼
                    [queued:review] ──→ Reviewer walks to PR Wall
                         │         │
                    APPROVE      REQUEST_CHANGES (→ loop back to implement, max 3)
                         │
                         ▼
                    [queued:merge] ──→ Merger walks to PR Wall
                              │ gh pr create + auto-merge, done
                              ▼
                           [done] ──→ User earns XP
                                      Agent earns XP
                                      Agent walks to Relaxation Area
```

Human waits for `requiresHumanReview` gates (🚩) or `AskUser` blocks (💬). All other transitions are automatic.
