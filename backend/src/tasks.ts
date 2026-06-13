import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Project } from "./projects.js";
import { branchName, createWorktree } from "./worktrees.js";
import { allocateDeskIndex } from "./desks.js";

export type TaskMode = "sdk" | "pty";
export type TaskStatus = "queued" | "running" | "blocked" | "done" | "error" | "stopped" | "failed";

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
  deskIndex: number | null;
  pendingQuestion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  description: string;
  mode: TaskMode;
}

export function createTask(db: DatabaseSync, project: Project, input: CreateTaskInput): Task {
  const id = randomUUID();
  const path = createWorktree(project, id);
  const now = new Date().toISOString();

  const taken = (db.prepare(`SELECT deskIndex FROM tasks`).all() as { deskIndex: number | null }[]).map(
    (row) => row.deskIndex
  );

  const task: Task = {
    id,
    projectId: project.id,
    description: input.description,
    mode: input.mode,
    status: "running",
    sessionId: null,
    branchName: branchName(id),
    worktreePath: path,
    prUrl: null,
    deskIndex: allocateDeskIndex(taken),
    pendingQuestion: null,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO tasks
      (id, projectId, description, mode, status, sessionId, branchName, worktreePath, prUrl, deskIndex, pendingQuestion, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    task.deskIndex,
    task.pendingQuestion,
    task.createdAt,
    task.updatedAt
  );

  return task;
}

export function listTasks(db: DatabaseSync): Task[] {
  const rows = db.prepare(`SELECT * FROM tasks ORDER BY createdAt ASC`).all();
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

export function clearTaskPendingQuestion(db: DatabaseSync, id: string, status: TaskStatus): void {
  db.prepare(`UPDATE tasks SET status = ?, pendingQuestion = NULL, updatedAt = ? WHERE id = ?`).run(
    status,
    new Date().toISOString(),
    id
  );
}
