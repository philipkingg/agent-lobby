import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Project } from "./projects.js";

export class WorktreeError extends Error {}

export function branchName(taskId: string): string {
  return `agent/${taskId}`;
}

export function worktreePath(project: Project, taskId: string): string {
  return path.join(project.worktreesRoot, taskId);
}

export function createWorktree(project: Project, taskId: string): string {
  const target = worktreePath(project, taskId);

  try {
    execFileSync(
      "git",
      ["worktree", "add", target, "-b", branchName(taskId), project.defaultBranch],
      { cwd: project.path, encoding: "utf-8" }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WorktreeError(`failed to create worktree for task ${taskId}: ${message}`);
  }

  return target;
}

export function removeWorktree(project: Project, taskId: string): void {
  const target = worktreePath(project, taskId);

  try {
    execFileSync("git", ["worktree", "remove", target], {
      cwd: project.path,
      encoding: "utf-8",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WorktreeError(`failed to remove worktree for task ${taskId}: ${message}`);
  }
}
