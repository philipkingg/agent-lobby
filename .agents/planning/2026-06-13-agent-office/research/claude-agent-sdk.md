# Research: Claude Agent SDK (TypeScript)

Source: [Agent SDK reference - TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript)

## Package
`@anthropic-ai/claude-agent-sdk`

## Core API
`query({ prompt, options })` returns an `AsyncGenerator<SDKMessage>`. Headless usage:

```typescript
for await (const message of query({ prompt: "do task X", options: { cwd: worktreePath } })) {
  // handle message
}
```

## Session resume (maps to Q9 — resume on restart)
- `options.resume: "<session-uuid>"` — resume a specific session by id
- `options.continue: true` — continue most recent session in a dir
- `options.forkSession: true` (with `resume`) — branch into a new session id instead of continuing in place
- `options.resumeSessionAt: "<message-uuid>"` — resume from a specific point
- `listSessions({ dir, limit })` / `getSessionMessages(sessionId, { dir, limit })` — enumerate/inspect past sessions

**Implication for our app:** persist `session_id` + `cwd` (worktree path) per task in SQLite. On server restart, for any task in a "running" state, call `query()` again with `options.resume: session_id`. If that throws/fails (session not found, corrupted), mark task `failed/needs-attention`.

## Message types (drive the office sprite state machine)
- `SDKAssistantMessage` (`type: "assistant"`) — agent text/tool_use content
- `SDKUserMessage` — for multi-turn input (used when *we* send a reply to agent's question)
- `SDKResultMessage` (`type: "result"`) — final message; `subtype: "success" | "error_max_turns" | "error_during_execution"`, includes `total_cost_usd`, `usage`
- `SDKToolProgressMessage` (`type: "tool_progress"`) — agent actively running a tool → maps to **"working"** sprite state
- `SDKTaskProgressMessage` (`type: "task_progress"`) — background task updates
- `SDKSystemMessage`, `SDKPermissionDeniedMessage`

## Permission modes (maps to Q8)
```typescript
type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"  // requires allowDangerouslySkipPermissions: true
  | "plan"
  | "dontAsk"
  | "auto";
```
For headless worktree-isolated agents: `permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true`.

## Detecting "agent has a question" (maps to Q5 — blocked-on-question badge)
The SDK doesn't have an explicit "ask user" message type distinct from normal assistant text. Two viable signals:
1. **`canUseTool` callback** — fires when agent invokes a tool; if we want agent to be able to pause for *permission-style* questions, implement this callback and surface to UI when it's called (though with `bypassPermissions` this mostly won't fire).
2. **Agent text heuristic / explicit protocol** — since we control the prompt, instruct the agent (via system prompt / initial task framing) to use a specific convention when it needs human input — e.g. call a custom tool `ask_user(question: string)` (via `canUseTool`/custom MCP tool) or end its turn with a recognizable marker. The `result` message with no further tool calls + a trailing question in assistant text is the most practical v1 signal: when the turn ends (`result` message arrives) without the task being marked done, and the last assistant message contains a question, treat as "blocked-on-question" and surface the badge + open terminal panel.

**Recommendation for design doc:** define a small custom tool (e.g. `AskUser`) registered via the SDK's tool/MCP mechanism that the agent is instructed to call when it needs human input. This gives an unambiguous `tool_use` event we can detect server-side and flip the sprite to "blocked" + push a notification — much more reliable than text heuristics.

## Other notes
- Headless/SDK sessions use `TaskCreate/TaskUpdate/TaskGet/TaskList` tools (replacing TodoWrite) — useful for showing task progress/checklist in the UI per agent.
