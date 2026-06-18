import { execFileSync } from "node:child_process";
import { rmSync, existsSync } from "node:fs";
import path from "node:path";
import type { Project } from "./projects.js";

export class WorktreeError extends Error {}

/** Derives a readable branch name from the task description, falling back to a plain task-id slug. */
export function branchName(taskId: string, description?: string): string {
  const slug = (description ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

  const shortId = taskId.slice(0, 8);
  return slug ? `agent/${slug}-${shortId}` : `agent/${taskId}`;
}

export function worktreePath(project: Project, taskId: string): string {
  return path.join(project.worktreesRoot, taskId);
}

export function createWorktree(project: Project, taskId: string, description?: string): string {
  const target = worktreePath(project, taskId);

  try {
    execFileSync(
      "git",
      ["worktree", "add", target, "-b", branchName(taskId, description), project.defaultBranch],
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
    execFileSync("git", ["worktree", "remove", "--force", target], {
      cwd: project.path,
      encoding: "utf-8",
    });
  } catch {
    // Worktree may not be registered with git (e.g. directory exists but not tracked).
    // Fall back to pruning stale refs and removing the directory directly.
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: project.path, encoding: "utf-8" });
    } catch { /* ignore */ }
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
  }
}
