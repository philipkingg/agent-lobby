import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  query as sdkQuery,
  type SDKMessage,
  type Options,
} from "@anthropic-ai/claude-agent-sdk";
import type { DatabaseSync } from "node:sqlite";
import type { Agent } from "./agents.js";
import type { Broadcast } from "./ws-events.js";

export type QueryFn = (params: {
  prompt: string;
  options?: Options;
}) => AsyncIterable<SDKMessage>;

const AGENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "agents");
const PIPELINE_JOB_TYPES = ["prioritizer", "planner", "implementer", "reviewer", "merger"] as const;

// ── Knowledge suggestion DB types and operations ──────────────────────────

export interface KnowledgeSuggestion {
  id: string;
  agentType: string;
  proposedContent: string;
  rationale: string;
  status: "pending" | "approved" | "rejected";
  auditAgentId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export function listKnowledgeSuggestions(db: DatabaseSync, status?: string): KnowledgeSuggestion[] {
  if (status) {
    return db
      .prepare(`SELECT * FROM knowledge_suggestions WHERE status = ? ORDER BY createdAt DESC`)
      .all(status) as unknown as KnowledgeSuggestion[];
  }
  return db
    .prepare(`SELECT * FROM knowledge_suggestions ORDER BY createdAt DESC`)
    .all() as unknown as KnowledgeSuggestion[];
}

function createKnowledgeSuggestion(
  db: DatabaseSync,
  input: { agentType: string; proposedContent: string; rationale: string; auditAgentId: string | null }
): KnowledgeSuggestion {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO knowledge_suggestions (id, agentType, proposedContent, rationale, status, auditAgentId, createdAt, resolvedAt)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL)`
  ).run(id, input.agentType, input.proposedContent, input.rationale, input.auditAgentId, now);
  return db
    .prepare(`SELECT * FROM knowledge_suggestions WHERE id = ?`)
    .get(id) as unknown as KnowledgeSuggestion;
}

export function resolveKnowledgeSuggestion(
  db: DatabaseSync,
  id: string,
  resolution: "approved" | "rejected"
): KnowledgeSuggestion | undefined {
  const suggestion = db
    .prepare(`SELECT * FROM knowledge_suggestions WHERE id = ?`)
    .get(id) as unknown as KnowledgeSuggestion | undefined;

  if (!suggestion || suggestion.status !== "pending") return undefined;

  if (resolution === "approved") {
    const filePath = path.join(AGENTS_DIR, `${suggestion.agentType}.md`);
    writeFileSync(filePath, suggestion.proposedContent, "utf-8");
  }

  db.prepare(
    `UPDATE knowledge_suggestions SET status = ?, resolvedAt = ? WHERE id = ?`
  ).run(resolution, new Date().toISOString(), id);

  return db
    .prepare(`SELECT * FROM knowledge_suggestions WHERE id = ?`)
    .get(id) as unknown as KnowledgeSuggestion;
}

// ── Audit prompt builder ───────────────────────────────────────────────────

function buildAuditPrompt(db: DatabaseSync): string {
  // Recent task performance
  const recentTasks = db
    .prepare(
      `SELECT t.id, t.title, t.priority, t.reviewLoopCount, t.status
       FROM tasks t
       WHERE t.status IN ('done', 'stuck', 'error', 'split')
       ORDER BY t.updatedAt DESC
       LIMIT 25`
    )
    .all() as Array<{ id: string; title: string; priority: number; reviewLoopCount: number; status: string }>;

  // Per-type stage stats
  const typeStats = db
    .prepare(
      `SELECT a.jobType,
              COUNT(ts.id) as total,
              SUM(CASE WHEN ts.status = 'done' THEN 1 ELSE 0 END) as done,
              SUM(CASE WHEN ts.status = 'failed' THEN 1 ELSE 0 END) as failed
       FROM task_stages ts
       JOIN agents a ON a.id = ts.agentId
       GROUP BY a.jobType`
    )
    .all() as Array<{ jobType: string; total: number; done: number; failed: number }>;

  // Tasks with review loops
  const loopyTasks = recentTasks.filter((t) => t.reviewLoopCount > 0);
  const stuckTasks = recentTasks.filter((t) => t.status === "stuck");

  const taskLines = recentTasks
    .map((t) => {
      const loops = t.reviewLoopCount > 0 ? ` — ${t.reviewLoopCount} review loop(s)` : "";
      const stuck = t.status === "stuck" ? " [STUCK]" : "";
      return `- "${t.title}" [${t.status}${stuck}${loops}]`;
    })
    .join("\n");

  const statsLines = typeStats
    .map((s) => `- ${s.jobType}: ${s.done}/${s.total} done, ${s.failed} failed`)
    .join("\n");

  // Current knowledge files
  const knowledgeSections = PIPELINE_JOB_TYPES.map((type) => {
    try {
      const content = readFileSync(path.join(AGENTS_DIR, `${type}.md`), "utf-8").trim();
      return `### agents/${type}.md\n\`\`\`\n${content}\n\`\`\``;
    } catch {
      return `### agents/${type}.md\n(file not found)`;
    }
  }).join("\n\n");

  const loopSummary =
    loopyTasks.length > 0
      ? loopyTasks
          .map((t) => `- "${t.title}": ${t.reviewLoopCount} loop(s), final status: ${t.status}`)
          .join("\n")
      : "(none)";

  const stuckSummary =
    stuckTasks.length > 0
      ? stuckTasks.map((t) => `- "${t.title}" (${t.reviewLoopCount} loops before stuck)`).join("\n")
      : "(none)";

  return `
You are an auditor reviewing AI agent performance in a software development pipeline.

## Pipeline
Tasks flow: prioritize → plan → implement → review → merge → done
Each stage is handled by a specialized agent. Each agent type has a knowledge file in agents/.

## Recent Completed Tasks (last 25)

${taskLines || "(no completed tasks yet)"}

## Stage Success Rates by Agent Type

${statsLines || "(no stage data yet)"}

## Tasks With Review Loops

${loopSummary}

## Stuck Tasks

${stuckSummary}

## Current Knowledge Files

${knowledgeSections}

---

Analyze the data above and identify patterns where agent knowledge files could be improved.

Examples of what to look for:
- Repeated review loops → implementer.md missing guidance on what reviewers care about
- Tasks getting stuck → likely a prompt format or workflow issue in that agent type's file
- High failure rates for a stage → knowledge file missing critical process steps
- Reviewer blocking on trivial issues → reviewer.md bar-setting needs tightening

For each knowledge file you want to update, output a block in EXACTLY this format (no deviations):

KNOWLEDGE_UPDATE: <agentType>
RATIONALE: <one sentence: why this change is needed, referencing specific data>
===BEGIN===
<complete new content of the file — copy ALL existing content and add your changes>
===END===

You may propose updates for multiple agent types in one response.
Only propose changes where you have clear evidence from the data. If performance looks healthy, say so and propose nothing.
`.trim();
}

// ── Audit output parser ────────────────────────────────────────────────────

function parseKnowledgeUpdates(
  text: string
): Array<{ agentType: string; content: string; rationale: string }> {
  const results: Array<{ agentType: string; content: string; rationale: string }> = [];
  const regex =
    /KNOWLEDGE_UPDATE:\s*(\w+)\s*\nRATIONALE:\s*([^\n]+)\s*\n===BEGIN===\n([\s\S]*?)\n===END===/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const agentType = match[1].toLowerCase().trim();
    if ((PIPELINE_JOB_TYPES as readonly string[]).includes(agentType)) {
      results.push({
        agentType,
        rationale: match[2].trim(),
        content: match[3].trim(),
      });
    }
  }
  return results;
}

// ── Main audit session ─────────────────────────────────────────────────────

export async function runAuditSession(
  db: DatabaseSync,
  agent: Agent,
  broadcast: Broadcast,
  queryFn: QueryFn = sdkQuery as unknown as QueryFn
): Promise<{ suggestionsCreated: number }> {
  db.prepare(`UPDATE agents SET currentStation = 'planning' WHERE id = ?`).run(agent.id);
  broadcast("global", { type: "agent:update", agentId: agent.id, station: "planning", taskId: null });

  let suggestionsCreated = 0;

  try {
    const prompt = buildAuditPrompt(db);
    let resultText = "";

    const stream = queryFn({
      prompt,
      options: {
        model: agent.model,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      } as Options,
    });

    for await (const msg of stream) {
      if (msg.type === "result") {
        resultText = (msg as { result?: string }).result ?? "";
      }
    }

    const updates = parseKnowledgeUpdates(resultText);
    for (const update of updates) {
      createKnowledgeSuggestion(db, {
        agentType: update.agentType,
        proposedContent: update.content,
        rationale: update.rationale,
        auditAgentId: agent.id,
      });
      suggestionsCreated++;
    }

    if (suggestionsCreated > 0) {
      broadcast("global", { type: "audit:new-suggestions", count: suggestionsCreated });
    }

    return { suggestionsCreated };
  } finally {
    db.prepare(`UPDATE agents SET currentStation = 'relaxation' WHERE id = ?`).run(agent.id);
    broadcast("global", {
      type: "agent:update",
      agentId: agent.id,
      station: "relaxation",
      taskId: null,
    });
  }
}
