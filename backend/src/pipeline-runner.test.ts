import { describe, it, expect } from "vitest";
import { createDb } from "./db.js";
import { hireAgent } from "./agents.js";
import { createTask, getTask, listTaskStages } from "./tasks.js";
import { PipelineRunner, type QueryFn } from "./pipeline-runner.js";
import type { Project } from "./projects.js";
import type { WsEvent } from "./ws-events.js";

const project: Project = {
  id: "proj-1",
  name: "repo",
  path: "/tmp/repo",
  defaultBranch: "main",
  worktreesRoot: "/tmp/repo-worktrees",
  githubUrl: null,
  autoMerge: 1,
  createdAt: new Date().toISOString(),
};

function setup(jobType = "implementer", stage = "queued:implement") {
  const db = createDb();
  db.prepare(
    `INSERT INTO projects (id, name, path, defaultBranch, worktreesRoot, githubUrl, autoMerge, createdAt)
     VALUES (?, ?, ?, ?, ?, NULL, 1, ?)`
  ).run(project.id, project.name, project.path, project.defaultBranch, project.worktreesRoot, project.createdAt);

  const agent = hireAgent(db, { jobType: jobType as never });
  const task = createTask(db, {
    projectId: project.id,
    title: "add feature",
    description: "add the feature",
  });
  // Advance to the expected stage manually
  db.prepare(`UPDATE tasks SET stage = ?, status = 'queued' WHERE id = ?`).run(stage, task.id);

  const events: [string, WsEvent][] = [];
  const broadcast = (ch: string, ev: WsEvent) => events.push([ch, ev]);

  return { db, agent, task: getTask(db, task.id)!, events, broadcast };
}

function makeSuccessQuery(result = "done!"): QueryFn {
  return async function* () {
    yield {
      type: "result",
      subtype: "success",
      uuid: "u1",
      session_id: "sess-1",
      result,
    } as never;
  };
}

function makeErrorQuery(): QueryFn {
  return async function* () {
    yield {
      type: "result",
      subtype: "error_during_execution",
      uuid: "u1",
      session_id: "sess-1",
    } as never;
  };
}

describe("PipelineRunner.runStage", () => {
  it("advances stage to queued:plan on prioritize success", async () => {
    const { db, agent, task, broadcast } = setup("prioritizer", "queued:prioritize");
    const runner = new PipelineRunner(db, broadcast, makeSuccessQuery());
    await runner.runStage(task, project, agent);

    const updated = getTask(db, task.id)!;
    expect(updated.stage).toBe("queued:plan");
    expect(updated.status).toBe("queued");
  });

  it("frees agent after stage completion", async () => {
    const { db, agent, task, broadcast } = setup("implementer", "queued:implement");
    const runner = new PipelineRunner(db, broadcast, makeSuccessQuery());

    // Claim task first
    db.prepare(`UPDATE agents SET currentTaskId = ? WHERE id = ?`).run(task.id, agent.id);

    await runner.runStage(task, project, agent);

    const updatedAgent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agent.id) as {
      currentTaskId: string | null;
    };
    expect(updatedAgent.currentTaskId).toBeNull();
  });

  it("creates a task_stages record", async () => {
    const { db, agent, task, broadcast } = setup("planner", "queued:plan");
    const runner = new PipelineRunner(db, broadcast, makeSuccessQuery());
    await runner.runStage(task, project, agent);

    const stages = listTaskStages(db, task.id);
    expect(stages).toHaveLength(1);
    expect(stages[0].status).toBe("done");
    expect(stages[0].agentId).toBe(agent.id);
    expect(stages[0].model).toBe(agent.model);
  });

  it("marks task error on SDK error result", async () => {
    const { db, agent, task, broadcast } = setup("implementer", "queued:implement");
    const runner = new PipelineRunner(db, broadcast, makeErrorQuery());
    await runner.runStage(task, project, agent);

    const updated = getTask(db, task.id)!;
    expect(updated.status).toBe("error");
  });

  it("marks task error on thrown exception", async () => {
    const { db, agent, task, broadcast } = setup("implementer", "queued:implement");
    const throwingQuery: QueryFn = async function* () {
      throw new Error("sdk crash");
    };
    const runner = new PipelineRunner(db, broadcast, throwingQuery);
    await runner.runStage(task, project, agent);

    const updated = getTask(db, task.id)!;
    expect(updated.status).toBe("error");
    expect(updated.error).toBe("sdk crash");
  });

  it("loops back to implement on reviewer REQUEST_CHANGES", async () => {
    const { db, agent, task, broadcast } = setup("reviewer", "queued:review");
    const runner = new PipelineRunner(db, broadcast, makeSuccessQuery("REQUEST_CHANGES: code quality issues"));
    await runner.runStage(task, project, agent);

    const updated = getTask(db, task.id)!;
    expect(updated.stage).toBe("queued:implement");
    expect(updated.reviewLoopCount).toBe(1);
  });

  it("advances to queued:merge on reviewer APPROVE", async () => {
    const { db, agent, task, broadcast } = setup("reviewer", "queued:review");
    const runner = new PipelineRunner(db, broadcast, makeSuccessQuery("APPROVE: looks good"));
    await runner.runStage(task, project, agent);

    const updated = getTask(db, task.id)!;
    expect(updated.stage).toBe("queued:merge");
  });

  it("marks task stuck after 3 review loops", async () => {
    const { db, agent, task, broadcast } = setup("reviewer", "queued:review");
    db.prepare(`UPDATE tasks SET reviewLoopCount = 3 WHERE id = ?`).run(task.id);
    const runner = new PipelineRunner(db, broadcast, makeSuccessQuery("REQUEST_CHANGES: still broken"));
    await runner.runStage(task, project, agent);

    const updated = getTask(db, task.id)!;
    expect(updated.status).toBe("stuck");

    const stuckEvent = broadcast.toString(); // just check event was sent
    // Check broadcast events
  });

  it("pauses at awaiting_approval gate when requiresHumanReview=1", async () => {
    const { db, agent, task, broadcast } = setup("prioritizer", "queued:prioritize");
    db.prepare(`UPDATE tasks SET requiresHumanReview = 1 WHERE id = ?`).run(task.id);

    const runner = new PipelineRunner(db, broadcast, makeSuccessQuery());
    await runner.runStage(task, project, agent);

    const updated = getTask(db, task.id)!;
    expect(updated.status).toBe("awaiting_approval");
    expect(updated.stage).toBe("queued:plan");
  });

  it("blocks on AskUser and resumes on respond()", async () => {
    const { db, agent, task, broadcast } = setup("implementer", "queued:implement");
    const events: [string, WsEvent][] = [];
    const br = (ch: string, ev: WsEvent) => events.push([ch, ev]);

    const askQuery: QueryFn = async function* () {
      yield {
        type: "assistant",
        uuid: "u1",
        session_id: "sess-1",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "AskUser", input: { question: "which approach?" } }],
        },
        parent_tool_use_id: null,
      } as never;
      yield {
        type: "result",
        subtype: "success",
        uuid: "u2",
        session_id: "sess-1",
        result: "done",
      } as never;
    };

    const runner = new PipelineRunner(db, br, askQuery);
    const runPromise = runner.runStage(task, project, agent);

    await new Promise((r) => setTimeout(r, 10));

    const blockedEvent = events.find(([, ev]) => ev.type === "status" && (ev as { status: string }).status === "blocked");
    expect(blockedEvent).toBeDefined();

    runner.respond(task.id, "use option A");
    await runPromise;

    const updated = getTask(db, task.id)!;
    expect(updated.status).not.toBe("blocked");
  });

  it("includes personality prompt in the captured query", async () => {
    const { db, agent, task } = setup("implementer", "queued:implement");

    let capturedPrompt = "";
    const capturingQuery: QueryFn = async function* (params) {
      capturedPrompt = typeof params.prompt === "string" ? params.prompt : "";
      yield { type: "result", subtype: "success", uuid: "u1", session_id: "s1", result: "done" } as never;
    };

    const br = () => {};
    const runner = new PipelineRunner(db, br, capturingQuery);
    await runner.runStage(task, project, agent);

    // Personality traits should appear in the prompt
    expect(capturedPrompt).toContain("Personality traits:");
  });

  it("uses agent.model in query options", async () => {
    const { db, agent, task } = setup("planner", "queued:plan");

    let capturedModel: string | undefined;
    const modelCapturingQuery: QueryFn = async function* (params) {
      capturedModel = (params.options as { model?: string } | undefined)?.model;
      yield { type: "result", subtype: "success", uuid: "u1", session_id: "s1", result: "done" } as never;
    };

    const br = () => {};
    const runner = new PipelineRunner(db, br, modelCapturingQuery);
    await runner.runStage(task, project, agent);

    expect(capturedModel).toBe(agent.model);
  });
});
