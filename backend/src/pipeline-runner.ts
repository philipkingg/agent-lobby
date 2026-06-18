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
import { assignAgentTask, updateAgentStation } from "./agents.js";
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
  setTaskPriority,
  setTaskPrUrl,
  splitTask,
  setTaskWorktree,
} from "./tasks.js";
import { getProject } from "./projects.js";
import { createWorktree, branchName } from "./worktrees.js";
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
          updateAgentStation(this.db, agent.id, "meeting");
          this.broadcast("global", { type: "agent:update", agentId: agent.id, station: "meeting", taskId: task.id });
          this.broadcast(`task:${task.id}`, { type: "status", status: "blocked", pendingQuestion: question });

          await this.waitForAnswer(task.id);

          if (this.stopRequested.has(task.id)) break;

          // Walk back to work station after unblocking
          const workStation = this.db
            .prepare(`SELECT currentStation FROM agents WHERE id = ?`)
            .get(agent.id) as { currentStation: string | null } | undefined;
          const prevStation = workStation?.currentStation ?? null;
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
            updateAgentStation(this.db, agent.id, "relaxation");
            this.broadcast("global", { type: "agent:update", agentId: agent.id, station: "relaxation", taskId: null });
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

  private freeAgent(agentId: string, taskId: string): void {
    assignAgentTask(this.db, agentId, null);
    updateAgentStation(this.db, agentId, "relaxation");
    this.broadcast("global", { type: "agent:update", agentId, station: "relaxation", taskId: null });
  }

  private async onStageSuccess(
    task: Task,
    agent: Agent,
    stageId: string,
    resultText: string
  ): Promise<void> {
    // Re-fetch task to get latest state (e.g. requiresHumanReview may have changed)
    const freshTask = getTask(this.db, task.id) ?? task;

    // Merge stage: extract PR URL from result text
    if (freshTask.stage === "queued:merge") {
      const urlMatch = resultText.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/);
      if (urlMatch) setTaskPrUrl(this.db, freshTask.id, urlMatch[0]);
    }

    // Prioritize stage: parse PRIORITY: N from result and update task
    if (freshTask.stage === "queued:prioritize") {
      const match = resultText.match(/PRIORITY:\s*([1-5])/i);
      if (match) {
        setTaskPriority(this.db, freshTask.id, parseInt(match[1], 10));
      }
    }

    // Plan stage: planner may choose to split task into subtasks (epic split)
    if (freshTask.stage === "queued:plan") {
      const epicIdx = resultText.indexOf("SPLIT_EPIC:");
      if (epicIdx !== -1) {
        const afterKeyword = resultText.slice(epicIdx + "SPLIT_EPIC:".length).trimStart();
        const startBracket = afterKeyword.indexOf("[");
        if (startBracket !== -1) {
          let depth = 0;
          let endBracket = -1;
          for (let i = startBracket; i < afterKeyword.length; i++) {
            if (afterKeyword[i] === "[") depth++;
            else if (afterKeyword[i] === "]") {
              depth--;
              if (depth === 0) { endBracket = i; break; }
            }
          }
          if (endBracket !== -1) {
            try {
              const jsonStr = afterKeyword.slice(startBracket, endBracket + 1);
              const subtasks = JSON.parse(jsonStr) as { title: string; description: string }[];
              if (Array.isArray(subtasks) && subtasks.length >= 2) {
                awardStageXp(this.db, agent.id, freshTask.stage, freshTask.priority, this.broadcast);
                completeTaskStage(this.db, stageId, "done", 0);

                const children = splitTask(this.db, freshTask.id, subtasks);

                // Create a git worktree for each child task
                const project = getProject(this.db, freshTask.projectId);
                if (project) {
                  for (const child of children) {
                    try {
                      const wtPath = createWorktree(project, child.id, child.title);
                      const branch = branchName(child.id, child.title);
                      setTaskWorktree(this.db, child.id, wtPath, branch);
                    } catch {
                      // not a git repo or worktree failed — child still usable
                    }
                  }
                }

                this.broadcast(`task:${freshTask.id}`, { type: "status", status: "split", stage: "done" });
                this.freeAgent(agent.id, freshTask.id);
                return;
              }
            } catch {
              // JSON parse failed — fall through to normal plan advance
            }
          }
        }
      }
    }

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
        this.freeAgent(agent.id, freshTask.id);
        return;
      }
    }

    // Advance to next stage (or done)
    const advanced = advanceTaskStage(this.db, freshTask);
    this.freeAgent(agent.id, freshTask.id);

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
