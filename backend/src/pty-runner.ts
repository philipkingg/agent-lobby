import * as ptyLib from "node-pty";
import type { DatabaseSync } from "node:sqlite";
import type { Task, TaskStatus } from "./tasks.js";
import { setTaskStatus } from "./tasks.js";
import type { Broadcast } from "./ws-events.js";

export interface PtyProcess {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type SpawnFn = (command: string, args: string[], cwd: string) => PtyProcess;

export const defaultSpawn: SpawnFn = (command, args, cwd) =>
  ptyLib.spawn(command, args, { name: "xterm-color", cols: 80, rows: 24, cwd });

/**
 * Runs a `mode: "pty"` task as an interactive process, multiplexing its
 * output to subscribers and accepting input/resize/stop from the browser.
 */
export class PtyManager {
  private sessions = new Map<string, PtyProcess>();

  constructor(
    private db: DatabaseSync,
    private broadcast: Broadcast,
    private spawnFn: SpawnFn = defaultSpawn
  ) {}

  start(task: Task, command = "claude", args: string[] = []): void {
    const proc = this.spawnFn(command, args, task.worktreePath);
    this.sessions.set(task.id, proc);

    proc.onData((data) => {
      this.broadcast(task.id, { type: "pty-data", data });
    });

    proc.onExit(({ exitCode }) => {
      this.sessions.delete(task.id);
      const status: TaskStatus = exitCode === 0 ? "done" : "error";
      setTaskStatus(this.db, task.id, status);
      this.broadcast(task.id, { type: "status", status });
    });
  }

  write(taskId: string, data: string): boolean {
    const proc = this.sessions.get(taskId);
    if (!proc) return false;
    proc.write(data);
    return true;
  }

  resize(taskId: string, cols: number, rows: number): boolean {
    const proc = this.sessions.get(taskId);
    if (!proc) return false;
    proc.resize(cols, rows);
    return true;
  }

  stop(taskId: string): boolean {
    const proc = this.sessions.get(taskId);
    if (!proc) return false;
    proc.kill();
    this.sessions.delete(taskId);
    setTaskStatus(this.db, taskId, "stopped");
    this.broadcast(taskId, { type: "status", status: "stopped" });
    return true;
  }

  isRunning(taskId: string): boolean {
    return this.sessions.has(taskId);
  }
}
