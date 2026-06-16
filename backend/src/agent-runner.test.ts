import { describe, it, expect } from "vitest";
import { createDb } from "./db.js";
import { AgentRunner, type AgentEvent, type QueryFn } from "./agent-runner.js";
import { getTask } from "./tasks.js";
import { listTranscriptEntries } from "./transcripts.js";
import type { Task } from "./tasks.js";
import type { Project } from "./projects.js";

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

function makeTask(db: ReturnType<typeof createDb>, overrides: Partial<Task> = {}): Task {
  db.prepare(
    `INSERT OR IGNORE INTO projects (id, name, path, defaultBranch, worktreesRoot, githubUrl, autoMerge, createdAt)
     VALUES (?, ?, ?, ?, ?, NULL, 1, ?)`
  ).run(project.id, project.name, project.path, project.defaultBranch, project.worktreesRoot, project.createdAt);

  const now = new Date().toISOString();
  const task: Task = {
    id: "task-1",
    projectId: project.id,
    title: "do the thing",
    description: "do the thing",
    priority: 3,
    stage: "queued:implement",
    status: "running",
    requiresHumanReview: 0,
    reviewLoopCount: 0,
    worktreePath: "/tmp/repo-worktrees/task-1",
    branch: "agent/task-1",
    prUrl: null,
    source: "human",
    githubIssueNumber: null,
    sessionId: null,
    pendingQuestion: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  db.prepare(
    `INSERT INTO tasks
      (id, projectId, title, description, priority, stage, status, requiresHumanReview, reviewLoopCount,
       worktreePath, branch, prUrl, source, githubIssueNumber, sessionId, pendingQuestion, error, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    task.id, task.projectId, task.title, task.description, task.priority, task.stage, task.status,
    task.requiresHumanReview, task.reviewLoopCount, task.worktreePath, task.branch,
    task.prUrl, task.source, task.githubIssueNumber, task.sessionId, task.pendingQuestion,
    task.error, task.createdAt, task.updatedAt
  );

  return task;
}

describe("AgentRunner.run", () => {
  it("persists transcript entries, session id, and marks the task done on success", async () => {
    const db = createDb();
    const task = makeTask(db);
    const events: AgentEvent[] = [];

    const fakeQuery: QueryFn = async function* () {
      yield {
        type: "assistant",
        uuid: "u1",
        session_id: "sess-123",
        message: { content: [{ type: "text", text: "working on it" }] },
        parent_tool_use_id: null,
      } as never;
      yield {
        type: "result",
        subtype: "success",
        uuid: "u2",
        session_id: "sess-123",
        result: "done!",
      } as never;
    };

    const runner = new AgentRunner(db, (taskId, event) => events.push(event), fakeQuery);
    await runner.run(task, project);

    const updated = getTask(db, task.id)!;
    expect(updated.status).toBe("done");
    expect(updated.sessionId).toBe("sess-123");

    const transcript = listTranscriptEntries(db, task.id);
    expect(transcript.map((e) => e.type)).toEqual(["assistant", "result"]);

    expect(events.filter((e) => e.type === "status")).toEqual([{ type: "status", status: "done" }]);
  });

  it("marks the task as error when the result subtype is an error", async () => {
    const db = createDb();
    const task = makeTask(db);

    const fakeQuery: QueryFn = async function* () {
      yield {
        type: "result",
        subtype: "error_during_execution",
        uuid: "u1",
        session_id: "sess-1",
      } as never;
    };

    const runner = new AgentRunner(db, () => {}, fakeQuery);
    await runner.run(task, project);

    expect(getTask(db, task.id)!.status).toBe("error");
  });

  it("blocks on AskUser, then resumes once respond() is called", async () => {
    const db = createDb();
    const task = makeTask(db);
    const events: AgentEvent[] = [];

    const fakeQuery: QueryFn = async function* () {
      yield {
        type: "assistant",
        uuid: "u1",
        session_id: "sess-1",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "AskUser", input: { question: "which branch?" } }],
        },
        parent_tool_use_id: null,
      } as never;
      yield {
        type: "result",
        subtype: "success",
        uuid: "u2",
        session_id: "sess-1",
      } as never;
    };

    const runner = new AgentRunner(db, (taskId, event) => events.push(event), fakeQuery);

    const runPromise = runner.run(task, project);

    // Wait until the runner has flipped the task to blocked.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getTask(db, task.id)!.status).toBe("blocked");
    expect(getTask(db, task.id)!.pendingQuestion).toBe("which branch?");

    const responded = runner.respond(task.id, "use main");
    expect(responded).toBe(true);

    await runPromise;

    expect(getTask(db, task.id)!.status).toBe("done");
    const statusEvents = events.filter((e) => e.type === "status");
    expect(statusEvents).toEqual([
      { type: "status", status: "blocked", pendingQuestion: "which branch?" },
      { type: "status", status: "running", pendingQuestion: null },
      { type: "status", status: "done" },
    ]);
  });

  it("respond() returns false when the task is not waiting", () => {
    const db = createDb();
    const runner = new AgentRunner(db, () => {});
    expect(runner.respond("no-such-task", "answer")).toBe(false);
  });

  it("passes resume: sessionId when the task already has a session id", async () => {
    const db = createDb();
    const task = makeTask(db, { sessionId: "sess-123" });

    let receivedResume: string | undefined;
    const fakeQuery: QueryFn = async function* (params) {
      receivedResume = params.options?.resume as string | undefined;
      yield {
        type: "result",
        subtype: "success",
        uuid: "u1",
        session_id: "sess-123",
      } as never;
    };

    const runner = new AgentRunner(db, () => {}, fakeQuery);
    await runner.run(task, project);

    expect(receivedResume).toBe("sess-123");
    expect(getTask(db, task.id)!.status).toBe("done");
  });

  it("stop() returns false when the task has no active run", () => {
    const db = createDb();
    const runner = new AgentRunner(db, () => {});
    expect(runner.stop("no-such-task")).toBe(false);
  });

  it("stop() aborts a running query and marks the task stopped", async () => {
    const db = createDb();
    const task = makeTask(db);
    const events: AgentEvent[] = [];

    const fakeQuery: QueryFn = async function* (params) {
      const signal = params.options?.abortController?.signal;
      yield {
        type: "assistant",
        uuid: "u1",
        session_id: "sess-1",
        message: { content: [{ type: "text", text: "working" }] },
        parent_tool_use_id: null,
      } as never;

      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    };

    const runner = new AgentRunner(db, (taskId, event) => events.push(event), fakeQuery);
    const runPromise = runner.run(task, project);

    // Wait until the runner has registered the abort controller.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(runner.stop(task.id)).toBe(true);
    await runPromise;

    expect(getTask(db, task.id)!.status).toBe("stopped");
    expect(events.filter((e) => e.type === "status")).toEqual([{ type: "status", status: "stopped" }]);

    // Calling stop() again has nothing to cancel.
    expect(runner.stop(task.id)).toBe(false);
  });

  it("stop() unblocks a task waiting on AskUser and marks it stopped", async () => {
    const db = createDb();
    const task = makeTask(db);
    const events: AgentEvent[] = [];

    const fakeQuery: QueryFn = async function* (params) {
      const signal = params.options?.abortController?.signal;
      yield {
        type: "assistant",
        uuid: "u1",
        session_id: "sess-1",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "AskUser", input: { question: "which branch?" } }],
        },
        parent_tool_use_id: null,
      } as never;

      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    };

    const runner = new AgentRunner(db, (taskId, event) => events.push(event), fakeQuery);
    const runPromise = runner.run(task, project);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getTask(db, task.id)!.status).toBe("blocked");

    expect(runner.stop(task.id)).toBe(true);
    await runPromise;

    expect(getTask(db, task.id)!.status).toBe("stopped");
  });

  it("marks a resumed task as failed (with error detail) if the resume throws", async () => {
    const db = createDb();
    const task = makeTask(db, { sessionId: "sess-123" });

    const fakeQuery: QueryFn = async function* () {
      throw new Error("resume not possible");
    };

    const events: AgentEvent[] = [];
    const runner = new AgentRunner(db, (taskId, event) => events.push(event), fakeQuery);
    await runner.run(task, project);

    const updated = getTask(db, task.id)!;
    expect(updated.status).toBe("error");
    expect(updated.error).toBe("resume not possible");
    expect(events.filter((e) => e.type === "status")).toEqual([{ type: "status", status: "failed" }]);
  });
});
