import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorktree, removeWorktree, branchName, worktreePath, WorktreeError } from "./worktrees.js";
import type { Project } from "./projects.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t.com",
};

let repoDir: string;
let project: Project;

beforeEach(() => {
  repoDir = mkdtempSync(path.join(tmpdir(), "agent-office-repo-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["commit", "--allow-empty", "-m", "init", "--no-gpg-sign"], { cwd: repoDir, env: GIT_ENV });

  project = {
    id: "proj-1",
    name: "repo",
    path: repoDir,
    defaultBranch: "main",
    worktreesRoot: path.join(repoDir, "..", "repo-worktrees"),
    createdAt: new Date().toISOString(),
  };
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
  rmSync(project.worktreesRoot, { recursive: true, force: true });
});

describe("createWorktree / removeWorktree", () => {
  it("creates a worktree on a new branch and removes it", () => {
    const taskId = "task-1";
    const target = createWorktree(project, taskId);

    expect(target).toBe(worktreePath(project, taskId));
    expect(existsSync(target)).toBe(true);

    const branches = execFileSync("git", ["branch", "--list", branchName(taskId)], {
      cwd: repoDir,
      encoding: "utf-8",
    });
    expect(branches).toContain(branchName(taskId));

    removeWorktree(project, taskId);
    expect(existsSync(target)).toBe(false);
  });

  it("throws WorktreeError on branch name collision", () => {
    const taskId = "task-2";
    createWorktree(project, taskId);

    expect(() => createWorktree(project, taskId)).toThrow(WorktreeError);
  });

  it("throws WorktreeError when removing a non-existent worktree", () => {
    expect(() => removeWorktree(project, "no-such-task")).toThrow(WorktreeError);
  });
});
