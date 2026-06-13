import { describe, it, expect } from "vitest";
import { createDb } from "./db.js";
import { PtyManager, defaultSpawn } from "./pty-runner.js";
import { getTask } from "./tasks.js";
import type { Task } from "./tasks.js";
import type { WsEvent } from "./ws-events.js";

function makeTask(db: ReturnType<typeof createDb>, worktreePath: string): Task {
  db.prepare(
    `INSERT OR IGNORE INTO projects (id, name, path, defaultBranch, worktreesRoot, createdAt) VALUES (?, ?, ?, ?, ?, ?)`
  ).run("proj-1", "repo", "/tmp/repo", "main", "/tmp/repo-worktrees", new Date().toISOString());

  const task: Task = {
    id: "task-1",
    projectId: "proj-1",
    description: "interactive session",
    mode: "pty",
    status: "running",
    sessionId: null,
    branchName: "agent/task-1",
    worktreePath,
    prUrl: null,
    prError: null,
    error: null,
    worktreeRemoved: 0,
    deskIndex: null,
    pendingQuestion: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO tasks
      (id, projectId, description, mode, status, sessionId, branchName, worktreePath, prUrl, prError, error, deskIndex, pendingQuestion, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    task.id,
    task.projectId,
    task.description,
    task.mode,
    task.status,
    task.sessionId,
    task.branchName,
    task.worktreePath,
    task.prUrl,
    task.prError,
    task.error,
    task.deskIndex,
    task.pendingQuestion,
    task.createdAt,
    task.updatedAt
  );

  return task;
}

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("PtyManager", () => {
  it("multiplexes output, accepts stdin, and survives until stopped", async () => {
    const db = createDb();
    const task = makeTask(db, process.cwd());
    const events: WsEvent[] = [];

    const manager = new PtyManager(db, (taskId, event) => events.push(event), defaultSpawn);
    manager.start(task, "/bin/bash", ["-i"]);

    expect(manager.isRunning(task.id)).toBe(true);

    const wrote = manager.write(task.id, "echo hello-pty\n");
    expect(wrote).toBe(true);

    await waitFor(() =>
      events.some((e) => e.type === "pty-data" && e.data.includes("hello-pty"))
    );

    const stopped = manager.stop(task.id);
    expect(stopped).toBe(true);
    expect(manager.isRunning(task.id)).toBe(false);

    await waitFor(() => getTask(db, task.id)!.status === "stopped");
  });

  it("write/resize/stop return false for unknown tasks", () => {
    const db = createDb();
    const manager = new PtyManager(db, () => {});

    expect(manager.write("no-such-task", "x")).toBe(false);
    expect(manager.resize("no-such-task", 80, 24)).toBe(false);
    expect(manager.stop("no-such-task")).toBe(false);
  });

  it("sets task status to error when the process exits non-zero", async () => {
    const db = createDb();
    const task = makeTask(db, process.cwd());
    const events: WsEvent[] = [];

    const manager = new PtyManager(db, (taskId, event) => events.push(event), defaultSpawn);
    manager.start(task, "/bin/bash", ["-c", "exit 1"]);

    await waitFor(() => getTask(db, task.id)!.status === "error");
    expect(manager.isRunning(task.id)).toBe(false);
  });
});
