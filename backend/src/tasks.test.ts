import { describe, it, expect } from "vitest";
import { createDb } from "./db.js";
import {
  createTask,
  getTask,
  listTasks,
  deleteTask,
  advanceTaskStage,
  approveTaskStage,
  loopTaskToImplement,
  retryStuckTask,
  nextStage,
  jobTypeForStage,
  nextQueuedTaskForJobType,
} from "./tasks.js";

function freshDb() {
  const db = createDb();
  db.prepare(
    `INSERT INTO projects (id, name, path, defaultBranch, worktreesRoot, githubUrl, autoMerge, createdAt)
     VALUES ('proj-1', 'test', '/tmp/test', 'main', '/tmp/test-worktrees', NULL, 1, '2024-01-01T00:00:00.000Z')`
  ).run();
  return db;
}

describe("nextStage / jobTypeForStage", () => {
  it("returns correct next stage for each step", () => {
    expect(nextStage("queued:prioritize")).toBe("queued:plan");
    expect(nextStage("queued:plan")).toBe("queued:implement");
    expect(nextStage("queued:implement")).toBe("queued:review");
    expect(nextStage("queued:review")).toBe("queued:merge");
    expect(nextStage("queued:merge")).toBe("done");
    expect(nextStage("done")).toBeNull();
  });

  it("maps stages to correct job types", () => {
    expect(jobTypeForStage("queued:prioritize")).toBe("prioritizer");
    expect(jobTypeForStage("queued:plan")).toBe("planner");
    expect(jobTypeForStage("queued:implement")).toBe("implementer");
    expect(jobTypeForStage("queued:review")).toBe("reviewer");
    expect(jobTypeForStage("queued:merge")).toBe("merger");
    expect(jobTypeForStage("done")).toBeNull();
  });
});

describe("createTask", () => {
  it("creates task with defaults", () => {
    const db = freshDb();
    const task = createTask(db, {
      projectId: "proj-1",
      title: "Fix the bug",
      description: "Details here",
    });

    expect(task.title).toBe("Fix the bug");
    expect(task.description).toBe("Details here");
    expect(task.priority).toBe(3);
    expect(task.stage).toBe("queued:prioritize");
    expect(task.status).toBe("queued");
    expect(task.requiresHumanReview).toBe(0);
    expect(task.reviewLoopCount).toBe(0);
    expect(task.source).toBe("human");
    expect(task.worktreePath).toBeNull();
  });

  it("clamps priority to 1-5", () => {
    const db = freshDb();
    const t1 = createTask(db, { projectId: "proj-1", title: "t1", description: "d", priority: 0 });
    const t2 = createTask(db, { projectId: "proj-1", title: "t2", description: "d", priority: 99 });
    expect(t1.priority).toBe(1);
    expect(t2.priority).toBe(5);
  });

  it("stores requiresHumanReview as 1", () => {
    const db = freshDb();
    const task = createTask(db, {
      projectId: "proj-1",
      title: "t",
      description: "d",
      requiresHumanReview: true,
    });
    expect(task.requiresHumanReview).toBe(1);
  });
});

describe("listTasks", () => {
  it("returns tasks ordered by priority DESC then createdAt ASC", () => {
    const db = freshDb();
    createTask(db, { projectId: "proj-1", title: "low", description: "d", priority: 1 });
    createTask(db, { projectId: "proj-1", title: "high", description: "d", priority: 5 });
    createTask(db, { projectId: "proj-1", title: "mid", description: "d", priority: 3 });

    const tasks = listTasks(db);
    expect(tasks[0].title).toBe("high");
    expect(tasks[1].title).toBe("mid");
    expect(tasks[2].title).toBe("low");
  });

  it("filters by stage and status", () => {
    const db = freshDb();
    const t = createTask(db, { projectId: "proj-1", title: "t", description: "d" });
    db.prepare(`UPDATE tasks SET stage = 'queued:plan', status = 'running' WHERE id = ?`).run(t.id);

    const byStage = listTasks(db, { stage: "queued:plan" });
    expect(byStage).toHaveLength(1);

    const byStatus = listTasks(db, { status: "running" });
    expect(byStatus).toHaveLength(1);

    const wrongStage = listTasks(db, { stage: "queued:implement" });
    expect(wrongStage).toHaveLength(0);
  });
});

describe("advanceTaskStage", () => {
  it("auto-advances through all stages without human review", () => {
    const db = freshDb();
    let task = createTask(db, { projectId: "proj-1", title: "t", description: "d" });
    expect(task.stage).toBe("queued:prioritize");

    task = advanceTaskStage(db, task)!;
    expect(task.stage).toBe("queued:plan");
    expect(task.status).toBe("queued");

    task = advanceTaskStage(db, task)!;
    expect(task.stage).toBe("queued:implement");

    task = advanceTaskStage(db, task)!;
    expect(task.stage).toBe("queued:review");

    task = advanceTaskStage(db, task)!;
    expect(task.stage).toBe("queued:merge");

    task = advanceTaskStage(db, task)!;
    expect(task.stage).toBe("done");
    expect(task.status).toBe("done");
  });

  it("pauses at each transition when requiresHumanReview = 1", () => {
    const db = freshDb();
    let task = createTask(db, {
      projectId: "proj-1",
      title: "t",
      description: "d",
      requiresHumanReview: true,
    });

    task = advanceTaskStage(db, task)!;
    expect(task.stage).toBe("queued:plan");
    expect(task.status).toBe("awaiting_approval");
  });

  it("returns null when called on done task", () => {
    const db = freshDb();
    let task = createTask(db, { projectId: "proj-1", title: "t", description: "d" });
    db.prepare(`UPDATE tasks SET stage = 'done', status = 'done' WHERE id = ?`).run(task.id);
    task = getTask(db, task.id)!;

    const result = advanceTaskStage(db, task);
    expect(result).toBeNull();
  });
});

describe("approveTaskStage", () => {
  it("clears awaiting_approval → queued", () => {
    const db = freshDb();
    let task = createTask(db, {
      projectId: "proj-1",
      title: "t",
      description: "d",
      requiresHumanReview: true,
    });
    task = advanceTaskStage(db, task)!;
    expect(task.status).toBe("awaiting_approval");

    task = approveTaskStage(db, task.id)!;
    expect(task.status).toBe("queued");
  });

  it("returns null when task is not awaiting approval", () => {
    const db = freshDb();
    const task = createTask(db, { projectId: "proj-1", title: "t", description: "d" });
    expect(approveTaskStage(db, task.id)).toBeNull();
  });
});

describe("loopTaskToImplement", () => {
  it("increments reviewLoopCount and re-queues implement on review request", () => {
    const db = freshDb();
    let task = createTask(db, { projectId: "proj-1", title: "t", description: "d" });
    db.prepare(`UPDATE tasks SET stage = 'queued:review', status = 'running' WHERE id = ?`).run(task.id);
    task = getTask(db, task.id)!;

    task = loopTaskToImplement(db, task.id)!;
    expect(task.reviewLoopCount).toBe(1);
    expect(task.stage).toBe("queued:implement");
    expect(task.status).toBe("queued");
  });

  it("marks stuck after exceeding max loops (3)", () => {
    const db = freshDb();
    const task = createTask(db, { projectId: "proj-1", title: "t", description: "d" });
    db.prepare(`UPDATE tasks SET reviewLoopCount = 3 WHERE id = ?`).run(task.id);

    const result = loopTaskToImplement(db, task.id)!;
    expect(result.status).toBe("stuck");
    expect(result.reviewLoopCount).toBe(4);
  });
});

describe("retryStuckTask", () => {
  it("resets loop count and re-queues", () => {
    const db = freshDb();
    const task = createTask(db, { projectId: "proj-1", title: "t", description: "d" });
    db.prepare(
      `UPDATE tasks SET status = 'stuck', reviewLoopCount = 4, stage = 'queued:implement' WHERE id = ?`
    ).run(task.id);

    const retried = retryStuckTask(db, task.id)!;
    expect(retried.status).toBe("queued");
    expect(retried.reviewLoopCount).toBe(0);
  });

  it("returns null when task is not stuck", () => {
    const db = freshDb();
    const task = createTask(db, { projectId: "proj-1", title: "t", description: "d" });
    expect(retryStuckTask(db, task.id)).toBeNull();
  });
});

describe("nextQueuedTaskForJobType", () => {
  it("returns highest-priority task for job type", () => {
    const db = freshDb();
    createTask(db, { projectId: "proj-1", title: "low", description: "d", priority: 1 });
    const t2 = createTask(db, { projectId: "proj-1", title: "high", description: "d", priority: 5 });

    const next = nextQueuedTaskForJobType(db, "prioritizer");
    expect(next!.id).toBe(t2.id);
  });

  it("filters by project when projectIds provided", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO projects (id, name, path, defaultBranch, worktreesRoot, githubUrl, autoMerge, createdAt)
       VALUES ('proj-2', 'other', '/tmp/other', 'main', '/tmp/other-worktrees', NULL, 1, '2024-01-01T00:00:00.000Z')`
    ).run();

    createTask(db, { projectId: "proj-2", title: "other-project", description: "d", priority: 5 });
    const myTask = createTask(db, { projectId: "proj-1", title: "my-project", description: "d", priority: 3 });

    const next = nextQueuedTaskForJobType(db, "prioritizer", ["proj-1"]);
    expect(next!.id).toBe(myTask.id);
  });

  it("returns undefined when no queued tasks for job type", () => {
    const db = freshDb();
    const next = nextQueuedTaskForJobType(db, "implementer");
    expect(next).toBeUndefined();
  });
});

describe("deleteTask", () => {
  it("removes task and cleans up related records", () => {
    const db = freshDb();
    const task = createTask(db, { projectId: "proj-1", title: "t", description: "d" });

    db.prepare(
      `INSERT INTO transcript_entries (id, taskId, stageId, type, content, timestamp)
       VALUES ('te-1', ?, NULL, 'assistant', 'hello', '2024-01-01T00:00:00.000Z')`
    ).run(task.id);

    deleteTask(db, task.id);

    expect(getTask(db, task.id)).toBeUndefined();
    const entries = db.prepare(`SELECT * FROM transcript_entries WHERE taskId = ?`).all(task.id);
    expect(entries).toHaveLength(0);
  });
});
