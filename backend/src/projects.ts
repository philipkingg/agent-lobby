import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

export function assertGitRepo(repoPath: string): void {
  try {
    const inside = git(repoPath, ["rev-parse", "--is-inside-work-tree"]);
    if (inside !== "true") {
      throw new InvalidProjectPathError(`${repoPath} is not a git repository`);
    }
  } catch {
    throw new InvalidProjectPathError(`${repoPath} is not a git repository`);
  }
}

export function getDefaultBranch(repoPath: string): string {
  try {
    const ref = git(repoPath, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    return git(repoPath, ["branch", "--show-current"]);
  }
}

export function deriveWorktreesRoot(repoPath: string, name: string): string {
  return path.join(path.dirname(repoPath), `${name}-worktrees`);
}

export interface CreateProjectInput {
  source: "path";
  value: string;
}

export function createProject(db: DatabaseSync, input: CreateProjectInput): Project {
  const repoPath = path.resolve(input.value);
  assertGitRepo(repoPath);

  const name = path.basename(repoPath);
  const defaultBranch = getDefaultBranch(repoPath);
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
