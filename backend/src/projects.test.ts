import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertGitRepo,
  getDefaultBranch,
  deriveWorktreesRoot,
  deriveClonePath,
  createProject,
  listProjects,
  getProject,
  deleteProject,
  InvalidProjectPathError,
  type GitExecFn,
} from "./projects.js";
import { createDb } from "./db.js";
import { createTask } from "./tasks.js";

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

  it("creates a project from a git URL by cloning it", () => {
    const db = createDb();
    const calls: { cwd: string; args: string[] }[] = [];
    const gitExec: GitExecFn = (cwd, args) => {
      calls.push({ cwd, args });
      if (args[0] === "clone") return "";
      if (args[0] === "branch") return "main";
      throw new Error("no origin remote");
    };

    const project = createProject(db, { source: "url", value: "https://github.com/acme/widgets.git" }, gitExec);

    expect(project.path).toBe(deriveClonePath("https://github.com/acme/widgets.git"));
    expect(project.name).toBe("widgets");
    expect(project.defaultBranch).toBe("main");
    expect(calls[0].args).toEqual(["clone", "https://github.com/acme/widgets.git", project.path]);
    expect(listProjects(db)).toEqual([project]);
  });

  it("wraps a clone failure in InvalidProjectPathError", () => {
    const db = createDb();
    const gitExec: GitExecFn = () => {
      throw new Error("network error");
    };

    expect(() => createProject(db, { source: "url", value: "https://github.com/acme/widgets.git" }, gitExec)).toThrow(
      InvalidProjectPathError
    );
  });
});

describe("deleteProject", () => {
  it("removes the project and its tasks", () => {
    const db = createDb();
    const project = createProject(db, { source: "path", value: repoDir });
    const task = createTask(db, project, { description: "do the thing", mode: "sdk" });

    deleteProject(db, project.id);

    expect(getProject(db, project.id)).toBeUndefined();
    expect(listProjects(db)).toEqual([]);
    expect(db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id)).toBeUndefined();

    rmSync(task.worktreePath, { recursive: true, force: true });
  });
});
