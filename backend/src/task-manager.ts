import type { DatabaseSync } from "node:sqlite";
import { getProject, type Project } from "./projects.js";
import { createTask, createDraftTask, startTask, setTaskStatus, type CreateTaskInput, type Task } from "./tasks.js";
import { getMaxConcurrentAgents } from "./settings.js";

export type DispatchFn = (task: Task, project: Project) => void;

const RUNNING_STATUSES = ["running", "blocked"];

/**
 * Wraps task creation/dispatch with a concurrency limit: tasks beyond the
 * limit stay "queued" and are dispatched as running tasks finish.
 */
export class TaskManager {
  constructor(private db: DatabaseSync, private dispatch: DispatchFn) {}

  createTask(project: Project, input: CreateTaskInput): Task {
    const task = createTask(this.db, project, input);

    if (this.runningCount() > this.maxConcurrent()) {
      setTaskStatus(this.db, task.id, "queued");
      task.status = "queued";
    } else {
      this.dispatch(task, project);
    }

    return task;
  }

  /** Creates a "draft" ticket in the New column. No worktree/dispatch until it's started. */
  createDraft(project: Project, input: CreateTaskInput): Task {
    return createDraftTask(this.db, project, input);
  }

  /** Moves a draft ticket to Todo: creates its worktree, then runs it immediately if a slot is free. */
  startTicket(project: Project, task: Task): Task {
    const started = startTask(this.db, project, task);

    if (this.runningCount() >= this.maxConcurrent()) {
      return started;
    }

    setTaskStatus(this.db, started.id, "running");
    started.status = "running";
    this.dispatch(started, project);
    return started;
  }

  /** Call when a task reaches a terminal status (done/error/stopped/failed). */
  onTaskFinished(): void {
    if (this.runningCount() >= this.maxConcurrent()) return;

    const next = this.nextQueued();
    if (!next) return;

    const project = getProject(this.db, next.projectId);
    if (!project) return;

    setTaskStatus(this.db, next.id, "running");
    next.status = "running";
    this.dispatch(next, project);
  }

  private runningCount(): number {
    const placeholders = RUNNING_STATUSES.map(() => "?").join(", ");
    const row = this.db
      .prepare(`SELECT COUNT(*) as c FROM tasks WHERE status IN (${placeholders})`)
      .get(...RUNNING_STATUSES) as { c: number };
    return row.c;
  }

  private maxConcurrent(): number {
    return getMaxConcurrentAgents(this.db);
  }

  private nextQueued(): Task | undefined {
    return this.db.prepare(`SELECT * FROM tasks WHERE status = 'queued' ORDER BY createdAt ASC LIMIT 1`).get() as
      | Task
      | undefined;
  }
}
