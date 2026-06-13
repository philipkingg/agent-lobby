import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb } from "./db.js";
import { TaskManager } from "./task-manager.js";
import { setTaskStatus, type Task } from "./tasks.js";
import { setMaxConcurrentAgents } from "./settings.js";
import type { Project } from "./projects.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t.com",
};

let repoDir: string;
let project: Project;

beforeEach(() => {
  repoDir = mkdtempSync(path.join(tmpdir(), "agent-office-repo-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["commit", "--allow-empty", "-m", "init", "--no-gpg-sign"], { cwd: repoDir, env: GIT_ENV });

  project = {
    id: "proj-1",
    name: "repo",
    path: repoDir,
    defaultBranch: "main",
    worktreesRoot: path.join(repoDir, "..", `${path.basename(repoDir)}-worktrees`),
    createdAt: new Date().toISOString(),
  };
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
  rmSync(project.worktreesRoot, { recursive: true, force: true });
});

describe("TaskManager", () => {
  it("queues tasks beyond the concurrency limit and dispatches as slots free up", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO projects (id, name, path, defaultBranch, worktreesRoot, createdAt) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(project.id, project.name, project.path, project.defaultBranch, project.worktreesRoot, project.createdAt);

    setMaxConcurrentAgents(db, 2);

    const dispatched: Task[] = [];
    const manager = new TaskManager(db, (task) => dispatched.push(task));

    const tasks = [1, 2, 3, 4].map((n) => manager.createTask(project, { description: `task ${n}`, mode: "sdk" }));

    expect(tasks.map((t) => t.status)).toEqual(["running", "running", "queued", "queued"]);
    expect(dispatched.map((t) => t.id)).toEqual([tasks[0].id, tasks[1].id]);

    // Task 1 finishes; task 3 should be dispatched and flip to running.
    setTaskStatus(db, tasks[0].id, "done");
    manager.onTaskFinished();

    expect(dispatched.map((t) => t.id)).toEqual([tasks[0].id, tasks[1].id, tasks[2].id]);

    const refreshedTask3 = db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(tasks[2].id) as { status: string };
    expect(refreshedTask3.status).toBe("running");

    const refreshedTask4 = db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(tasks[3].id) as { status: string };
    expect(refreshedTask4.status).toBe("queued");
  });

  it("does not dispatch when no slots are free", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO projects (id, name, path, defaultBranch, worktreesRoot, createdAt) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(project.id, project.name, project.path, project.defaultBranch, project.worktreesRoot, project.createdAt);

    setMaxConcurrentAgents(db, 1);

    const dispatched: Task[] = [];
    const manager = new TaskManager(db, (task) => dispatched.push(task));

    const tasks = [1, 2].map((n) => manager.createTask(project, { description: `task ${n}`, mode: "sdk" }));
    expect(tasks.map((t) => t.status)).toEqual(["running", "queued"]);

    // Task 1 is still running - nothing should be dispatched.
    manager.onTaskFinished();
    expect(dispatched.map((t) => t.id)).toEqual([tasks[0].id]);
  });
});
