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
import type { Agent } from "./agents.js";
import { assignAgentTask } from "./agents.js";
import {
  setTaskStatus,
  setTaskSessionId,
  setTaskBlocked,
  clearTaskPendingQuestion,
  setTaskFailed,
  advanceTaskStage,
  loopTaskToImplement,
  createTaskStage,
  completeTaskStage,
  getTask,
} from "./tasks.js";
import { addTranscriptEntry } from "./transcripts.js";
import type { Broadcast } from "./ws-events.js";
import { buildStagePrompt, detectReviewOutcome } from "./stage-prompts.js";
import { awardStageXp } from "./xp-service.js";

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
 * Runs a single pipeline stage for a given agent.
 * Unlike AgentRunner, this handles stage advancement, XP awards, and
 * review-loop logic on completion rather than marking the task done.
 */
export class PipelineRunner {
  private pending = new Map<string, { promise: Promise<string>; resolve: (answer: string) => void }>();
  private controllers = new Map<string, AbortController>();
  private stopRequested = new Set<string>();

  constructor(
    private db: DatabaseSync,
    private broadcast: Broadcast,
    private queryFn: QueryFn = sdkQuery
  ) {}

  respond(taskId: string, answer: string): boolean {
    const pending = this.pending.get(taskId);
    if (!pending) return false;
    this.pending.delete(taskId);
    pending.resolve(answer);
    return true;
  }

  stop(taskId: string): boolean {
    const controller = this.controllers.get(taskId);
    const pending = this.pending.get(taskId);
    if (!controller && !pending) return false;

    this.stopRequested.add(taskId);

    if (pending) {
      this.pending.delete(taskId);
      pending.resolve("");
    }
    controller?.abort();

    setTaskStatus(this.db, taskId, "stopped");
    this.broadcast(`task:${taskId}`, { type: "status", status: "stopped" });
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

  async runStage(task: Task, project: Project, agent: Agent): Promise<void> {
    const stageRecord = createTaskStage(this.db, task.id, task.stage, agent.id, agent.model);

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
    const prompt = buildStagePrompt(task, project, agent);

    const cwd = task.worktreePath ?? project.path;
    const abortController = new AbortController();
    this.controllers.set(task.id, abortController);

    let resultText = "";

    try {
      const stream = this.queryFn({
        prompt,
        options: {
          cwd,
          model: agent.model,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          mcpServers: { "agent-office": server },
          abortController,
        } as Options,
      });

      for await (const msg of stream) {
        const entry = addTranscriptEntry(this.db, task.id, msg.type, JSON.stringify(msg), stageRecord.id);
        this.broadcast(`task:${task.id}`, { type: "transcript", entry });

        if ("session_id" in msg && msg.session_id) {
          setTaskSessionId(this.db, task.id, msg.session_id);
        }

        const question = findAskUserQuestion(msg);
        if (question) {
          setTaskBlocked(this.db, task.id, question);
          this.broadcast(`task:${task.id}`, { type: "status", status: "blocked", pendingQuestion: question });

          await this.waitForAnswer(task.id);

          if (this.stopRequested.has(task.id)) break;

          clearTaskPendingQuestion(this.db, task.id, "running");
          this.broadcast(`task:${task.id}`, { type: "status", status: "running", pendingQuestion: null });
        }

        if (msg.type === "result") {
          resultText = (msg as { result?: string }).result ?? "";

          if (msg.subtype !== "success") {
            completeTaskStage(this.db, stageRecord.id, "failed");
            setTaskStatus(this.db, task.id, "error");
            this.broadcast(`task:${task.id}`, { type: "status", status: "error" });
            assignAgentTask(this.db, agent.id, null);
            return;
          }
        }
      }

      if (this.stopRequested.has(task.id)) return;

      // Stage succeeded — handle stage-specific logic
      await this.onStageSuccess(task, agent, stageRecord.id, resultText);
    } catch (err) {
      if (!this.stopRequested.has(task.id)) {
        const message = err instanceof Error ? err.message : String(err);
        completeTaskStage(this.db, stageRecord.id, "failed");
        setTaskFailed(this.db, task.id, message);
        this.broadcast(`task:${task.id}`, { type: "status", status: "error" });
        assignAgentTask(this.db, agent.id, null);
      }
    } finally {
      this.controllers.delete(task.id);
      this.stopRequested.delete(task.id);
    }
  }

  private async onStageSuccess(
    task: Task,
    agent: Agent,
    stageId: string,
    resultText: string
  ): Promise<void> {
    // Re-fetch task to get latest state (e.g. requiresHumanReview may have changed)
    const freshTask = getTask(this.db, task.id) ?? task;

    // Award XP to the agent for completing this stage
    awardStageXp(this.db, agent.id, freshTask.stage, freshTask.priority, this.broadcast);
    completeTaskStage(this.db, stageId, "done", 0);

    // Reviewer: check for REQUEST_CHANGES
    if (freshTask.stage === "queued:review") {
      const outcome = detectReviewOutcome(resultText);
      if (outcome === "request_changes") {
        const looped = loopTaskToImplement(this.db, freshTask.id);
        if (looped?.status === "stuck") {
          this.broadcast(`task:${freshTask.id}`, { type: "task:stuck", taskId: freshTask.id, reviewLoopCount: looped.reviewLoopCount });
        } else {
          this.broadcast(`task:${freshTask.id}`, { type: "status", status: "queued", stage: "queued:implement" });
        }
        assignAgentTask(this.db, agent.id, null);
        return;
      }
    }

    // Advance to next stage (or done)
    const advanced = advanceTaskStage(this.db, freshTask);
    assignAgentTask(this.db, agent.id, null);

    if (!advanced) {
      setTaskStatus(this.db, freshTask.id, "done");
      this.broadcast(`task:${freshTask.id}`, { type: "status", status: "done" });
      return;
    }

    if (advanced.status === "awaiting_approval") {
      this.broadcast(`task:${freshTask.id}`, { type: "task:gate", taskId: freshTask.id, stage: advanced.stage });
    } else {
      this.broadcast(`task:${freshTask.id}`, { type: "status", status: "queued", stage: advanced.stage });
    }
  }
}
