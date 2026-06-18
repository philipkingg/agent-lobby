import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type TaskStage =
  | "queued:prioritize"
  | "queued:plan"
  | "queued:implement"
  | "queued:review"
  | "queued:merge"
  | "done";

export type TaskStatus = "queued" | "running" | "blocked" | "awaiting_approval" | "stuck" | "done" | "error" | "split";

export type TaskSource = "human" | "github_issue";

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  priority: number;
  stage: TaskStage;
  status: TaskStatus;
  requiresHumanReview: number; // SQLite stores booleans as integers
  reviewLoopCount: number;
  worktreePath: string | null;
  branch: string | null;
  prUrl: string | null;
  source: TaskSource;
  githubIssueNumber: number | null;
  // Legacy fields kept for AgentRunner compat until Phase 2 rewrite
  sessionId: string | null;
  pendingQuestion: string | null;
  error: string | null;
  parentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description: string;
  priority?: number;
  requiresHumanReview?: boolean;
  source?: TaskSource;
  githubIssueNumber?: number;
  parentTaskId?: string;
}

export interface TaskStageRecord {
  id: string;
  taskId: string;
  stage: string;
  agentId: string | null;
  model: string | null;
  status: "running" | "done" | "failed";
  sessionId: string | null;
  xpAwarded: number;
  startedAt: string;
  completedAt: string | null;
}

// Stage sequence for pipeline progression
const STAGE_SEQUENCE: TaskStage[] = [
  "queued:prioritize",
  "queued:plan",
  "queued:implement",
  "queued:review",
  "queued:merge",
  "done",
];

export function nextStage(current: TaskStage): TaskStage | null {
  const idx = STAGE_SEQUENCE.indexOf(current);
  if (idx === -1 || idx >= STAGE_SEQUENCE.length - 1) return null;
  return STAGE_SEQUENCE[idx + 1];
}

export function jobTypeForStage(stage: TaskStage): string | null {
  const map: Partial<Record<TaskStage, string>> = {
    "queued:prioritize": "prioritizer",
    "queued:plan": "planner",
    "queued:implement": "implementer",
    "queued:review": "reviewer",
    "queued:merge": "merger",
  };
  return map[stage] ?? null;
}

export function createTask(db: DatabaseSync, input: CreateTaskInput): Task {
  const id = randomUUID();
  const now = new Date().toISOString();
  const priority = Math.min(5, Math.max(1, input.priority ?? 3));

  const task: Task = {
    id,
    projectId: input.projectId,
    title: input.title,
    description: input.description,
    priority,
    stage: "queued:prioritize",
    status: "queued",
    requiresHumanReview: input.requiresHumanReview ? 1 : 0,
    reviewLoopCount: 0,
    worktreePath: null,
    branch: null,
    prUrl: null,
    source: input.source ?? "human",
    githubIssueNumber: input.githubIssueNumber ?? null,
    sessionId: null,
    pendingQuestion: null,
    error: null,
    parentTaskId: input.parentTaskId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO tasks (id, projectId, title, description, priority, stage, status, requiresHumanReview, reviewLoopCount, worktreePath, branch, prUrl, source, githubIssueNumber, sessionId, pendingQuestion, error, parentTaskId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    task.id,
    task.projectId,
    task.title,
    task.description,
    task.priority,
    task.stage,
    task.status,
    task.requiresHumanReview,
    task.reviewLoopCount,
    task.worktreePath,
    task.branch,
    task.prUrl,
    task.source,
    task.githubIssueNumber,
    task.sessionId,
    task.pendingQuestion,
    task.error,
    task.parentTaskId,
    task.createdAt,
    task.updatedAt
  );

  return task;
}

export function getTask(db: DatabaseSync, id: string): Task | undefined {
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Task | undefined;
}

export function listTasks(
  db: DatabaseSync,
  filters?: { stage?: string; status?: string; projectId?: string }
): Task[] {
  let sql = `SELECT * FROM tasks WHERE 1=1`;
  const params: unknown[] = [];

  if (filters?.stage) {
    sql += ` AND stage = ?`;
    params.push(filters.stage);
  }
  if (filters?.status) {
    sql += ` AND status = ?`;
    params.push(filters.status);
  }
  if (filters?.projectId) {
    sql += ` AND projectId = ?`;
    params.push(filters.projectId);
  }

  sql += ` ORDER BY priority DESC, createdAt ASC`;

  return db.prepare(sql).all(...params) as Task[];
}

export function setTaskStatus(db: DatabaseSync, id: string, status: TaskStatus): void {
  db.prepare(`UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ?`).run(
    status,
    new Date().toISOString(),
    id
  );
}

export function setTaskStage(db: DatabaseSync, id: string, stage: TaskStage, status: TaskStatus = "queued"): void {
  const now = new Date().toISOString();
  db.prepare(`UPDATE tasks SET stage = ?, status = ?, updatedAt = ? WHERE id = ?`).run(
    stage,
    status,
    now,
    id
  );
}

export function setTaskWorktree(db: DatabaseSync, id: string, worktreePath: string, branch: string): void {
  db.prepare(`UPDATE tasks SET worktreePath = ?, branch = ?, updatedAt = ? WHERE id = ?`).run(
    worktreePath,
    branch,
    new Date().toISOString(),
    id
  );
}

export function setTaskPrUrl(db: DatabaseSync, id: string, prUrl: string): void {
  db.prepare(`UPDATE tasks SET prUrl = ?, updatedAt = ? WHERE id = ?`).run(
    prUrl,
    new Date().toISOString(),
    id
  );
}

export function setTaskPriority(db: DatabaseSync, id: string, priority: number): void {
  const clamped = Math.min(5, Math.max(1, Math.round(priority)));
  db.prepare(`UPDATE tasks SET priority = ?, updatedAt = ? WHERE id = ?`).run(
    clamped,
    new Date().toISOString(),
    id
  );
}

export function advanceTaskStage(db: DatabaseSync, task: Task): Task | null {
  const next = nextStage(task.stage);
  if (!next) return null;

  const now = new Date().toISOString();

  if (next === "done") {
    db.prepare(`UPDATE tasks SET stage = 'done', status = 'done', updatedAt = ? WHERE id = ?`).run(
      now,
      task.id
    );
    return getTask(db, task.id)!;
  }

  // If requires human review, pause at gate
  const newStatus: TaskStatus = task.requiresHumanReview ? "awaiting_approval" : "queued";
  db.prepare(`UPDATE tasks SET stage = ?, status = ?, updatedAt = ? WHERE id = ?`).run(
    next,
    newStatus,
    now,
    task.id
  );

  return getTask(db, task.id)!;
}

export function approveTaskStage(db: DatabaseSync, id: string): Task | null {
  const task = getTask(db, id);
  if (!task || task.status !== "awaiting_approval") return null;

  db.prepare(`UPDATE tasks SET status = 'queued', updatedAt = ? WHERE id = ?`).run(
    new Date().toISOString(),
    id
  );
  return getTask(db, id)!;
}

export function loopTaskToImplement(db: DatabaseSync, id: string): Task | null {
  const task = getTask(db, id);
  if (!task) return null;

  const maxLoops = 3;
  const newLoopCount = task.reviewLoopCount + 1;

  if (newLoopCount > maxLoops) {
    db.prepare(`UPDATE tasks SET status = 'stuck', reviewLoopCount = ?, updatedAt = ? WHERE id = ?`).run(
      newLoopCount,
      new Date().toISOString(),
      id
    );
    return getTask(db, id)!;
  }

  db.prepare(
    `UPDATE tasks SET stage = 'queued:implement', status = 'queued', reviewLoopCount = ?, updatedAt = ? WHERE id = ?`
  ).run(newLoopCount, new Date().toISOString(), id);
  return getTask(db, id)!;
}

export function retryStuckTask(db: DatabaseSync, id: string): Task | null {
  const task = getTask(db, id);
  if (!task || task.status !== "stuck") return null;

  db.prepare(
    `UPDATE tasks SET status = 'queued', reviewLoopCount = 0, updatedAt = ? WHERE id = ?`
  ).run(new Date().toISOString(), id);
  return getTask(db, id)!;
}

export function restartTask(db: DatabaseSync, id: string): Task | null {
  const task = getTask(db, id);
  if (!task) return null;
  db.prepare(
    `UPDATE tasks SET stage = 'queued:prioritize', status = 'queued', reviewLoopCount = 0,
     pendingQuestion = NULL, error = NULL, updatedAt = ? WHERE id = ?`
  ).run(new Date().toISOString(), id);
  // Clear task from any agent, and move that agent to relaxation
  db.prepare(
    `UPDATE agents SET currentTaskId = NULL, currentStation = 'relaxation' WHERE currentTaskId = ?`
  ).run(id);
  return getTask(db, id)!;
}

export function deleteTask(db: DatabaseSync, id: string): void {
  // Cascade delete child tasks (requires schema v3 parentTaskId column)
  try {
    const children = db.prepare(`SELECT id FROM tasks WHERE parentTaskId = ?`).all(id) as { id: string }[];
    for (const child of children) {
      deleteTask(db, child.id);
    }
  } catch {
    // parentTaskId column may not exist on older schema — safe to skip cascade
  }
  db.prepare(`DELETE FROM transcript_entries WHERE taskId = ?`).run(id);
  db.prepare(`DELETE FROM task_stages WHERE taskId = ?`).run(id);
  db.prepare(`UPDATE agents SET currentTaskId = NULL WHERE currentTaskId = ?`).run(id);
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
}

export function listChildTasks(db: DatabaseSync, parentTaskId: string): Task[] {
  return db
    .prepare(`SELECT * FROM tasks WHERE parentTaskId = ? ORDER BY createdAt ASC`)
    .all(parentTaskId) as Task[];
}

export function splitTask(
  db: DatabaseSync,
  parentId: string,
  subtasks: { title: string; description: string }[]
): Task[] {
  const parent = getTask(db, parentId);
  if (!parent) return [];

  const now = new Date().toISOString();
  const children: Task[] = [];

  for (const sub of subtasks) {
    const child = createTask(db, {
      projectId: parent.projectId,
      title: sub.title,
      description: sub.description,
      priority: parent.priority,
      source: parent.source,
      parentTaskId: parentId,
    });
    children.push(child);
  }

  db.prepare(`UPDATE tasks SET status = 'split', stage = 'done', updatedAt = ? WHERE id = ?`).run(now, parentId);
  return children;
}

// --- Task stages ---

export function createTaskStage(
  db: DatabaseSync,
  taskId: string,
  stage: string,
  agentId?: string,
  model?: string
): TaskStageRecord {
  const id = randomUUID();
  const now = new Date().toISOString();

  const record: TaskStageRecord = {
    id,
    taskId,
    stage,
    agentId: agentId ?? null,
    model: model ?? null,
    status: "running",
    sessionId: null,
    xpAwarded: 0,
    startedAt: now,
    completedAt: null,
  };

  db.prepare(
    `INSERT INTO task_stages (id, taskId, stage, agentId, model, status, sessionId, xpAwarded, startedAt, completedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.taskId,
    record.stage,
    record.agentId,
    record.model,
    record.status,
    record.sessionId,
    record.xpAwarded,
    record.startedAt,
    record.completedAt
  );

  return record;
}

export function completeTaskStage(
  db: DatabaseSync,
  stageId: string,
  status: "done" | "failed",
  xpAwarded = 0
): void {
  db.prepare(
    `UPDATE task_stages SET status = ?, xpAwarded = ?, completedAt = ? WHERE id = ?`
  ).run(status, xpAwarded, new Date().toISOString(), stageId);
}

export function setTaskStageSessionId(db: DatabaseSync, stageId: string, sessionId: string): void {
  db.prepare(`UPDATE task_stages SET sessionId = ? WHERE id = ?`).run(sessionId, stageId);
}

export function listTaskStages(db: DatabaseSync, taskId: string): TaskStageRecord[] {
  return db
    .prepare(`SELECT * FROM task_stages WHERE taskId = ? ORDER BY startedAt ASC`)
    .all(taskId) as TaskStageRecord[];
}

// Map job type → queued stage name (job type "prioritizer" → stage "queued:prioritize")
const JOB_TYPE_TO_STAGE: Record<string, TaskStage> = {
  prioritizer: "queued:prioritize",
  planner: "queued:plan",
  implementer: "queued:implement",
  reviewer: "queued:review",
  merger: "queued:merge",
};

// Next queued task for a given job type + optional project scope
export function nextQueuedTaskForJobType(
  db: DatabaseSync,
  jobType: string,
  projectIds?: string[]
): Task | undefined {
  const stage = JOB_TYPE_TO_STAGE[jobType];
  if (!stage) return undefined;

  if (!projectIds || projectIds.length === 0) {
    return db
      .prepare(
        `SELECT * FROM tasks WHERE stage = ? AND status = 'queued' ORDER BY priority DESC, createdAt ASC LIMIT 1`
      )
      .get(stage) as Task | undefined;
  }

  const placeholders = projectIds.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT * FROM tasks WHERE stage = ? AND status = 'queued' AND projectId IN (${placeholders}) ORDER BY priority DESC, createdAt ASC LIMIT 1`
    )
    .get(stage, ...projectIds) as Task | undefined;
}

// ── Legacy helpers (kept for AgentRunner compat until Phase 2 rewrite) ──────

export function setTaskSessionId(db: DatabaseSync, id: string, sessionId: string): void {
  db.prepare(`UPDATE tasks SET sessionId = ?, updatedAt = ? WHERE id = ?`).run(
    sessionId,
    new Date().toISOString(),
    id
  );
}

export function setTaskBlocked(db: DatabaseSync, id: string, question: string): void {
  db.prepare(
    `UPDATE tasks SET status = 'blocked', pendingQuestion = ?, updatedAt = ? WHERE id = ?`
  ).run(question, new Date().toISOString(), id);
}

export function clearTaskPendingQuestion(db: DatabaseSync, id: string, status: TaskStatus): void {
  db.prepare(`UPDATE tasks SET status = ?, pendingQuestion = NULL, updatedAt = ? WHERE id = ?`).run(
    status,
    new Date().toISOString(),
    id
  );
}

export function setTaskFailed(db: DatabaseSync, id: string, error: string): void {
  db.prepare(`UPDATE tasks SET status = 'error', error = ?, updatedAt = ? WHERE id = ?`).run(
    error,
    new Date().toISOString(),
    id
  );
}
