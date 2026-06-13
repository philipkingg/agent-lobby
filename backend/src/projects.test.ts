import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertGitRepo,
  getDefaultBranch,
  deriveWorktreesRoot,
  createProject,
  listProjects,
  InvalidProjectPathError,
} from "./projects.js";
import { createDb } from "./db.js";

let repoDir: string;
let plainDir: string;

beforeEach(() => {
  repoDir = mkdtempSync(path.join(tmpdir(), "agent-office-repo-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["commit", "--allow-empty", "-m", "init", "--no-gpg-sign"], {
    cwd: repoDir,
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.com" },
  });

  plainDir = mkdtempSync(path.join(tmpdir(), "agent-office-plain-"));
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
  rmSync(plainDir, { recursive: true, force: true });
});

describe("assertGitRepo", () => {
  it("does not throw for a git repo", () => {
    expect(() => assertGitRepo(repoDir)).not.toThrow();
  });

  it("throws InvalidProjectPathError for a non-git directory", () => {
    expect(() => assertGitRepo(plainDir)).toThrow(InvalidProjectPathError);
  });
});

describe("getDefaultBranch", () => {
  it("falls back to the current branch when there is no origin remote", () => {
    expect(getDefaultBranch(repoDir)).toBe("main");
  });
});

describe("deriveWorktreesRoot", () => {
  it("derives a sibling directory named <name>-worktrees", () => {
    const result = deriveWorktreesRoot("/foo/bar/my-repo", "my-repo");
    expect(result).toBe("/foo/bar/my-repo-worktrees");
  });
});

describe("createProject / listProjects", () => {
  it("creates and persists a project from a local path", () => {
    const db = createDb();
    const project = createProject(db, { source: "path", value: repoDir });

    expect(project.path).toBe(repoDir);
    expect(project.defaultBranch).toBe("main");
    expect(project.worktreesRoot).toBe(deriveWorktreesRoot(repoDir, project.name));

    expect(listProjects(db)).toEqual([project]);
  });

  it("rejects a non-git path", () => {
    const db = createDb();
    expect(() => createProject(db, { source: "path", value: plainDir })).toThrow(InvalidProjectPathError);
  });
});
