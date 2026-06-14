import { execFileSync } from "node:child_process";
import type { Task } from "./tasks.js";
import type { Project } from "./projects.js";

export type ExecFn = (cmd: string, args: string[], cwd: string) => string;

export const defaultExec: ExecFn = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf-8" });

export interface PrResult {
  prUrl?: string;
  error?: string;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Pushes the task's branch and opens a PR against the project's default branch via `gh`. */
export function createPullRequest(task: Task, project: Project, execFn: ExecFn = defaultExec): PrResult {
  try {
    execFn("git", ["push", "-u", "origin", task.branchName], task.worktreePath);
  } catch (err) {
    return { error: `git push failed: ${errorMessage(err)}` };
  }

  const body = buildPrBody(task, project, execFn);

  try {
    const out = execFn(
      "gh",
      ["pr", "create", "--base", project.defaultBranch, "--head", task.branchName, "--title", task.description, "--body", body],
      task.worktreePath
    );
    const prUrl = out.trim().split("\n").pop() ?? "";
    return { prUrl };
  } catch (err) {
    return { error: `gh pr create failed: ${errorMessage(err)}` };
  }
}

/** Builds a PR body from the task description plus the list of commits made on its branch. */
function buildPrBody(task: Task, project: Project, execFn: ExecFn): string {
  try {
    const log = execFn(
      "git",
      ["log", `${project.defaultBranch}..${task.branchName}`, "--pretty=format:- %s"],
      task.worktreePath
    ).trim();

    return log ? `${task.description}\n\n## Commits\n${log}` : task.description;
  } catch {
    return task.description;
  }
}
