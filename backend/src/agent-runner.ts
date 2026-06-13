import {
  query as sdkQuery,
  tool,
  createSdkMcpServer,
  type SDKMessage,
  type SDKUserMessage,
  type Options,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import type { Project } from "./projects.js";
import type { Task, TaskStatus } from "./tasks.js";
import { setTaskStatus, setTaskSessionId, setTaskBlocked, setTaskFailed, clearTaskPendingQuestion } from "./tasks.js";
import { addTranscriptEntry } from "./transcripts.js";
import type { WsEvent, Broadcast } from "./ws-events.js";

export type AgentEvent = WsEvent;
export type { Broadcast };

export type QueryFn = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => AsyncIterable<SDKMessage>;

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

function findAskUserQuestion(msg: SDKMessage): string | undefined {
  if (msg.type !== "assistant") return undefined;
  const content = (msg.message?.content ?? []) as unknown[];
  for (const block of content) {
    const b = block as Partial<ToolUseBlock>;
    if (b.type === "tool_use" && b.name === "AskUser") {
      return (b.input as { question?: string } | undefined)?.question;
    }
  }
  return undefined;
}

/**
 * Runs a single SDK task: streams messages, persists the transcript, derives
 * task status, and pauses for `AskUser` until `respond()` is called.
 */
export class AgentRunner {
  private pending = new Map<string, { promise: Promise<string>; resolve: (answer: string) => void }>();

  constructor(
    private db: DatabaseSync,
    private broadcast: Broadcast,
    private queryFn: QueryFn = sdkQuery
  ) {}

  /** Resumes a task blocked on AskUser. Returns false if it wasn't waiting. */
  respond(taskId: string, answer: string): boolean {
    const pending = this.pending.get(taskId);
    if (!pending) return false;
    this.pending.delete(taskId);
    pending.resolve(answer);
    return true;
  }

  private waitForAnswer(taskId: string): Promise<string> {
    let pending = this.pending.get(taskId);
    if (!pending) {
      let resolve!: (answer: string) => void;
      const promise = new Promise<string>((r) => (resolve = r));
      pending = { promise, resolve };
      this.pending.set(taskId, pending);
    }
    return pending.promise;
  }

  async run(task: Task, project: Project): Promise<void> {
    const askUserTool = tool(
      "AskUser",
      "Ask the human user a question when you are genuinely blocked and need their input to proceed.",
      { question: z.string() },
      async ({ question }) => {
        void question;
        const answer = await this.waitForAnswer(task.id);
        return { content: [{ type: "text" as const, text: answer }] };
      }
    );

    const server = createSdkMcpServer({ name: "agent-office", tools: [askUserTool] });

    const stream = this.queryFn({
      prompt: task.description,
      options: {
        cwd: task.worktreePath,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        mcpServers: { "agent-office": server },
        ...(task.sessionId ? { resume: task.sessionId } : {}),
      },
    });

    try {
      for await (const msg of stream) {
        const entry = addTranscriptEntry(this.db, task.id, msg.type, JSON.stringify(msg));
        this.broadcast(task.id, { type: "transcript", entry });

        if ("session_id" in msg && msg.session_id) {
          setTaskSessionId(this.db, task.id, msg.session_id);
        }

        const question = findAskUserQuestion(msg);
        if (question) {
          setTaskBlocked(this.db, task.id, question);
          this.broadcast(task.id, { type: "status", status: "blocked", pendingQuestion: question });

          await this.waitForAnswer(task.id);

          clearTaskPendingQuestion(this.db, task.id, "running");
          this.broadcast(task.id, { type: "status", status: "running", pendingQuestion: null });
        }

        if (msg.type === "result") {
          const status: TaskStatus = msg.subtype === "success" ? "done" : "error";
          setTaskStatus(this.db, task.id, status);
          this.broadcast(task.id, { type: "status", status });
        }
      }
    } catch (err) {
      if (!task.sessionId) throw err;
      const message = err instanceof Error ? err.message : String(err);
      setTaskFailed(this.db, task.id, message);
      this.broadcast(task.id, { type: "status", status: "failed" });
    }
  }
}
