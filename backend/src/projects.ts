import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

export interface Project {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  worktreesRoot: string;
  createdAt: string;
}

export class InvalidProjectPathError extends Error {}

export type GitExecFn = (cwd: string, args: string[]) => string;

export const defaultGitExec: GitExecFn = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();

export function assertGitRepo(repoPath: string, gitExec: GitExecFn = defaultGitExec): void {
  try {
    const inside = gitExec(repoPath, ["rev-parse", "--is-inside-work-tree"]);
    if (inside !== "true") {
      throw new InvalidProjectPathError(`${repoPath} is not a git repository`);
    }
  } catch {
    throw new InvalidProjectPathError(`${repoPath} is not a git repository`);
  }
}

export function getDefaultBranch(repoPath: string, gitExec: GitExecFn = defaultGitExec): string {
  try {
    const ref = gitExec(repoPath, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    return gitExec(repoPath, ["branch", "--show-current"]);
  }
}

export function deriveWorktreesRoot(repoPath: string, name: string): string {
  return path.join(path.dirname(repoPath), `${name}-worktrees`);
}

export function deriveCloneName(url: string): string {
  const base = url.split("/").pop() ?? "project";
  return base.replace(/\.git$/, "");
}

export function deriveClonePath(url: string): string {
  return path.join(os.homedir(), ".agent-office", "projects", deriveCloneName(url));
}

export function cloneRepo(url: string, gitExec: GitExecFn = defaultGitExec): string {
  const dest = deriveClonePath(url);

  try {
    gitExec(os.homedir(), ["clone", url, dest]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new InvalidProjectPathError(`failed to clone ${url}: ${message}`);
  }

  return dest;
}

export interface CreateProjectInput {
  source: "path" | "url";
  value: string;
}

export function createProject(db: DatabaseSync, input: CreateProjectInput, gitExec: GitExecFn = defaultGitExec): Project {
  let repoPath: string;

  if (input.source === "url") {
    repoPath = cloneRepo(input.value, gitExec);
  } else {
    repoPath = path.resolve(input.value);
    assertGitRepo(repoPath, gitExec);
  }

  const name = path.basename(repoPath);
  const defaultBranch = getDefaultBranch(repoPath, gitExec);
  const worktreesRoot = deriveWorktreesRoot(repoPath, name);

  const project: Project = {
    id: randomUUID(),
    name,
    path: repoPath,
    defaultBranch,
    worktreesRoot,
    createdAt: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO projects (id, name, path, defaultBranch, worktreesRoot, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(project.id, project.name, project.path, project.defaultBranch, project.worktreesRoot, project.createdAt);

  return project;
}

export function listProjects(db: DatabaseSync): Project[] {
  const rows = db.prepare(`SELECT * FROM projects ORDER BY createdAt ASC`).all();
  return rows as unknown as Project[];
}

export function getProject(db: DatabaseSync, id: string): Project | undefined {
  const row = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
  return row as Project | undefined;
}
