import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Project } from "./projects.js";
import { branchName, createWorktree } from "./worktrees.js";
import { allocateDeskIndex } from "./desks.js";

export type TaskMode = "sdk" | "pty";
export type TaskStatus = "draft" | "queued" | "running" | "blocked" | "done" | "error" | "stopped" | "failed" | "closed";

export interface Task {
  id: string;
  projectId: string;
  description: string;
  mode: TaskMode;
  status: TaskStatus;
  sessionId: string | null;
  branchName: string;
  worktreePath: string;
  prUrl: string | null;
  prError: string | null;
  error: string | null;
  worktreeRemoved: number;
  deskIndex: number | null;
  pendingQuestion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  description: string;
  mode: TaskMode;
}

/**
 * Picks a desk for a newly-dispatched task. If `preferredDeskIndex` names an
 * idle worker (no task, or one parked "done" in code review), assign it
 * there - freeing the "done" task's desk if needed. Otherwise falls back to
 * the default allocation (reuse the oldest idle "done" desk, else first free).
 */
function resolveDeskIndex(db: DatabaseSync, preferredDeskIndex: number | null | undefined, now: string): number | null {
  const occupied = (
    db.prepare(`SELECT id, deskIndex, status FROM tasks WHERE deskIndex IS NOT NULL`).all() as {
      id: string;
      deskIndex: number;
      status: TaskStatus;
    }[]
  ).filter((row) => row.status !== "done");

  if (preferredDeskIndex !== undefined && preferredDeskIndex !== null) {
    const blocker = occupied.find((row) => row.deskIndex === preferredDeskIndex);
    if (!blocker) {
      // Free the desk if a "done" task is parked there - it's moving on.
      db.prepare(`UPDATE tasks SET deskIndex = NULL, updatedAt = ? WHERE deskIndex = ? AND status = 'done'`).run(
        now,
        preferredDeskIndex
      );
      return preferredDeskIndex;
    }
  }

  const idleAgent = db
    .prepare(`SELECT id, deskIndex FROM tasks WHERE status = 'done' AND deskIndex IS NOT NULL ORDER BY updatedAt ASC LIMIT 1`)
    .get() as { id: string; deskIndex: number } | undefined;

  if (idleAgent) {
    db.prepare(`UPDATE tasks SET deskIndex = NULL, updatedAt = ? WHERE id = ?`).run(now, idleAgent.id);
    return idleAgent.deskIndex;
  }

  const taken = occupied.map((row) => row.deskIndex);
  return allocateDeskIndex(taken);
}

export function createTask(
  db: DatabaseSync,
  project: Project,
  input: CreateTaskInput,
  preferredDeskIndex?: number | null
): Task {
  const id = randomUUID();
  const path = createWorktree(project, id, input.description);
  const now = new Date().toISOString();

  const deskIndex = resolveDeskIndex(db, preferredDeskIndex, now);

  const task: Task = {
    id,
    projectId: project.id,
    description: input.description,
    mode: input.mode,
    status: "running",
    sessionId: null,
    branchName: branchName(id, input.description),
    worktreePath: path,
    prUrl: null,
    prError: null,
    error: null,
    worktreeRemoved: 0,
    deskIndex,
    pendingQuestion: null,
    createdAt: now,
    updatedAt: now,
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

/** Creates a "draft" ticket: no worktree/branch/desk yet, just a record waiting in the "New" column. */
export function createDraftTask(db: DatabaseSync, project: Project, input: CreateTaskInput): Task {
  const id = randomUUID();
  const now = new Date().toISOString();

  const task: Task = {
    id,
    projectId: project.id,
    description: input.description,
    mode: input.mode,
    status: "draft",
    sessionId: null,
    branchName: "",
    worktreePath: "",
    prUrl: null,
    prError: null,
    error: null,
    worktreeRemoved: 0,
    deskIndex: null,
    pendingQuestion: null,
    createdAt: now,
    updatedAt: now,
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

/** Moves a draft ticket into the "Todo" column: creates its worktree/branch and allocates a desk. */
export function startTask(db: DatabaseSync, project: Project, task: Task, preferredDeskIndex?: number | null): Task {
  const path = createWorktree(project, task.id, task.description);
  const branch = branchName(task.id, task.description);
  const now = new Date().toISOString();

  // Prefer assigning to a requested worker's desk; otherwise prefer reusing
  // the desk of an idle agent (a "done" task waiting in code review) over
  // allocating a fresh one, so finished agents pick up new tickets instead
  // of every ticket spawning its own agent/desk.
  const deskIndex = resolveDeskIndex(db, preferredDeskIndex, now);

  db.prepare(`UPDATE tasks SET branchName = ?, worktreePath = ?, deskIndex = ?, status = 'queued', updatedAt = ? WHERE id = ?`).run(
    branch,
    path,
    deskIndex,
    now,
    task.id
  );

  return { ...task, branchName: branch, worktreePath: path, deskIndex, status: "queued", updatedAt: now };
}

/** Moves a "done" (in code review) ticket into the "Done" column. */
export function closeTask(db: DatabaseSync, id: string): void {
  db.prepare(`UPDATE tasks SET status = 'closed', updatedAt = ? WHERE id = ?`).run(new Date().toISOString(), id);
}

export function deleteTask(db: DatabaseSync, id: string): void {
  db.prepare(`DELETE FROM transcript_entries WHERE taskId = ?`).run(id);
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
}

export function listTasks(db: DatabaseSync): Task[] {
  const rows = db.prepare(`SELECT * FROM tasks ORDER BY createdAt ASC`).all();
  return rows as unknown as Task[];
}

export function listTasksByProject(db: DatabaseSync, projectId: string): Task[] {
  const rows = db.prepare(`SELECT * FROM tasks WHERE projectId = ? ORDER BY createdAt ASC`).all(projectId);
  return rows as unknown as Task[];
}

export function getTask(db: DatabaseSync, id: string): Task | undefined {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  return row as Task | undefined;
}

export function setTaskStatus(db: DatabaseSync, id: string, status: TaskStatus): void {
  db.prepare(`UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ?`).run(status, new Date().toISOString(), id);
}

export function setTaskSessionId(db: DatabaseSync, id: string, sessionId: string): void {
  db.prepare(`UPDATE tasks SET sessionId = ?, updatedAt = ? WHERE id = ?`).run(sessionId, new Date().toISOString(), id);
}

export function setTaskBlocked(db: DatabaseSync, id: string, question: string): void {
  db.prepare(`UPDATE tasks SET status = 'blocked', pendingQuestion = ?, updatedAt = ? WHERE id = ?`).run(
    question,
    new Date().toISOString(),
    id
  );
}

export function setTaskPrResult(db: DatabaseSync, id: string, result: { prUrl?: string; error?: string }): void {
  db.prepare(`UPDATE tasks SET prUrl = ?, prError = ?, updatedAt = ? WHERE id = ?`).run(
    result.prUrl ?? null,
    result.error ?? null,
    new Date().toISOString(),
    id
  );
}

export function setTaskFailed(db: DatabaseSync, id: string, error: string): void {
  db.prepare(`UPDATE tasks SET status = 'failed', error = ?, updatedAt = ? WHERE id = ?`).run(
    error,
    new Date().toISOString(),
    id
  );
}

export function setTaskWorktreeRemoved(db: DatabaseSync, id: string): void {
  db.prepare(`UPDATE tasks SET worktreeRemoved = 1, updatedAt = ? WHERE id = ?`).run(new Date().toISOString(), id);
}

export function clearTaskPendingQuestion(db: DatabaseSync, id: string, status: TaskStatus): void {
  db.prepare(`UPDATE tasks SET status = ?, pendingQuestion = NULL, updatedAt = ? WHERE id = ?`).run(
    status,
    new Date().toISOString(),
    id
  );
}
