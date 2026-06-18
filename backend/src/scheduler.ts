import type { DatabaseSync } from "node:sqlite";
import { listAgents, updateAgentStation } from "./agents.js";
import { nextQueuedTaskForJobType, setTaskStatus } from "./tasks.js";
import { getProject } from "./projects.js";
import { agentCanWorkOnProject } from "./squads.js";
import type { PipelineRunner } from "./pipeline-runner.js";
import type { Broadcast } from "./ws-events.js";

const STATION_FOR_JOB: Record<string, string> = {
  prioritizer: "planning",
  planner: "planning",
  implementer: "desks",
  reviewer: "pr-wall",
  merger: "pr-wall",
};

export class AgentScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private db: DatabaseSync,
    private runner: PipelineRunner,
    private broadcast: Broadcast,
    private intervalMs = 5000
  ) {}

  get isRunning(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const agents = listAgents(this.db);
      const idleAgents = agents.filter((a) => !a.currentTaskId && !a.firedAt);

      for (const agent of idleAgents) {
        // Determine project scope from squad
        const squadRow = agent.squadId
          ? (this.db
              .prepare(`SELECT projectIds FROM squads WHERE id = ?`)
              .get(agent.squadId) as { projectIds: string } | undefined)
          : undefined;

        const projectIds: string[] | undefined = squadRow?.projectIds
          ? JSON.parse(squadRow.projectIds)
          : undefined;

        const task = nextQueuedTaskForJobType(this.db, agent.jobType, projectIds);
        if (!task) continue;

        // Double-check squad eligibility
        if (!agentCanWorkOnProject(this.db, agent.id, task.projectId)) continue;

        const project = getProject(this.db, task.projectId);
        if (!project) continue;

        // Claim task + update station
        const station = STATION_FOR_JOB[agent.jobType] ?? "relaxation";
        this.db.prepare(`UPDATE tasks SET status = 'running', updatedAt = ? WHERE id = ?`).run(
          new Date().toISOString(),
          task.id
        );
        this.db.prepare(`UPDATE agents SET currentTaskId = ?, currentStation = ? WHERE id = ?`).run(
          task.id,
          station,
          agent.id
        );

        this.broadcast("global", { type: "agent:update", agentId: agent.id, station, taskId: task.id });
        this.broadcast(`task:${task.id}`, { type: "status", status: "running" });

        // Run stage async (fire-and-forget; task is claimed so scheduler won't re-pick)
        void this.runner.runStage(task, project, agent).catch((err) => {
          console.error(`[scheduler] runStage failed for task ${task.id}:`, err);
        });
      }
    } finally {
      this.running = false;
    }
  }
}
