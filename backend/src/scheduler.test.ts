import { describe, it, expect, vi } from "vitest";
import { createDb } from "./db.js";
import { hireAgent, getAgent } from "./agents.js";
import { createTask, getTask, nextQueuedTaskForJobType } from "./tasks.js";
import { createSquad, addAgentToSquad } from "./squads.js";
import { AgentScheduler } from "./scheduler.js";
import type { PipelineRunner } from "./pipeline-runner.js";
import type { WsEvent } from "./ws-events.js";

const PROJECT_ID = "proj-1";

function setupDb() {
  const db = createDb();
  db.prepare(
    `INSERT INTO projects (id, name, path, defaultBranch, worktreesRoot, githubUrl, autoMerge, createdAt)
     VALUES (?, 'repo', '/tmp/repo', 'main', '/tmp/repo-wt', NULL, 1, ?)`
  ).run(PROJECT_ID, new Date().toISOString());
  return db;
}

function makeTask(db: ReturnType<typeof createDb>, stage: string, priority = 3) {
  const task = createTask(db, { projectId: PROJECT_ID, title: "task", description: "do it", priority });
  db.prepare(`UPDATE tasks SET stage = ?, status = 'queued' WHERE id = ?`).run(stage, task.id);
  return getTask(db, task.id)!;
}

function makeMockRunner(runFn?: () => Promise<void>): PipelineRunner {
  return {
    runStage: vi.fn().mockImplementation(runFn ?? (() => Promise.resolve())),
    respond: vi.fn(),
    stop: vi.fn(),
  } as unknown as PipelineRunner;
}

describe("AgentScheduler.tick", () => {
  it("claims task and dispatches to runner for idle agent", async () => {
    const db = setupDb();
    const agent = hireAgent(db, { jobType: "implementer" });
    makeTask(db, "queued:implement");

    const runner = makeMockRunner();
    const events: [string, WsEvent][] = [];
    const scheduler = new AgentScheduler(db, runner, (ch, ev) => events.push([ch, ev]));

    await scheduler.tick();

    expect(runner.runStage).toHaveBeenCalledTimes(1);

    const updatedAgent = getAgent(db, agent.id)!;
    expect(updatedAgent.currentTaskId).not.toBeNull();
  });

  it("does not dispatch to agent with existing task", async () => {
    const db = setupDb();
    const agent = hireAgent(db, { jobType: "implementer" });
    makeTask(db, "queued:implement");
    // Agent already has a task
    db.prepare(`UPDATE agents SET currentTaskId = 'some-other-task' WHERE id = ?`).run(agent.id);

    const runner = makeMockRunner();
    const scheduler = new AgentScheduler(db, runner, () => {});

    await scheduler.tick();
    expect(runner.runStage).not.toHaveBeenCalled();
  });

  it("dispatches highest-priority task first with multiple tasks", async () => {
    const db = setupDb();
    hireAgent(db, { jobType: "implementer" });

    const low = makeTask(db, "queued:implement", 1);
    const high = makeTask(db, "queued:implement", 5);

    let claimedTaskId: string | undefined;
    const runner = makeMockRunner(async () => {});
    (runner.runStage as ReturnType<typeof vi.fn>).mockImplementation(
      (task: { id: string }) => { claimedTaskId = task.id; return Promise.resolve(); }
    );

    const scheduler = new AgentScheduler(db, runner, () => {});
    await scheduler.tick();

    expect(claimedTaskId).toBe(high.id);
  });

  it("multiple idle agents each claim one task", async () => {
    const db = setupDb();
    hireAgent(db, { jobType: "implementer" });
    hireAgent(db, { jobType: "implementer" });

    makeTask(db, "queued:implement", 5);
    makeTask(db, "queued:implement", 3);
    makeTask(db, "queued:implement", 1);

    const runner = makeMockRunner();
    const scheduler = new AgentScheduler(db, runner, () => {});

    await scheduler.tick();
    expect(runner.runStage).toHaveBeenCalledTimes(2);

    // Third task still queued
    const remaining = nextQueuedTaskForJobType(db, "implementer");
    expect(remaining).toBeDefined();
  });

  it("respects squad project scoping", async () => {
    const db = setupDb();
    // Add a second project
    db.prepare(
      `INSERT INTO projects (id, name, path, defaultBranch, worktreesRoot, githubUrl, autoMerge, createdAt)
       VALUES ('proj-2', 'other', '/tmp/other', 'main', '/tmp/other-wt', NULL, 1, ?)`
    ).run(new Date().toISOString());

    const agent = hireAgent(db, { jobType: "implementer" });
    const squad = createSquad(db, { name: "backend" });
    // Scope squad to proj-2 only
    db.prepare(`UPDATE squads SET projectIds = ? WHERE id = ?`).run(JSON.stringify(["proj-2"]), squad.id);
    addAgentToSquad(db, squad.id, agent.id);

    // Task in proj-1 (not in agent's squad scope)
    makeTask(db, "queued:implement");

    const runner = makeMockRunner();
    const scheduler = new AgentScheduler(db, runner, () => {});

    await scheduler.tick();
    // Agent should not pick up proj-1 task
    expect(runner.runStage).not.toHaveBeenCalled();
  });

  it("does not run concurrently (skips tick if previous still running)", async () => {
    const db = setupDb();
    hireAgent(db, { jobType: "implementer" });
    makeTask(db, "queued:implement");

    let slowResolve!: () => void;
    const slowRunner = makeMockRunner(
      () => new Promise<void>((r) => { slowResolve = r; })
    );

    const scheduler = new AgentScheduler(db, slowRunner, () => {});

    // Start two ticks simultaneously
    const t1 = scheduler.tick();
    const t2 = scheduler.tick(); // should be a no-op (running = true)
    await t2;
    slowResolve();
    await t1;

    expect(slowRunner.runStage).toHaveBeenCalledTimes(1);
  });
});
