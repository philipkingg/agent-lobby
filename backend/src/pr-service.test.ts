import { describe, it, expect } from "vitest";
import { createPullRequest, type ExecFn } from "./pr-service.js";
import type { Task } from "./tasks.js";
import type { Project } from "./projects.js";

const project: Project = {
  id: "proj-1",
  name: "repo",
  path: "/tmp/repo",
  defaultBranch: "main",
  worktreesRoot: "/tmp/repo-worktrees",
  createdAt: new Date().toISOString(),
};

const task: Task = {
  id: "task-1",
  projectId: project.id,
  description: "do the thing",
  mode: "sdk",
  status: "done",
  sessionId: null,
  branchName: "agent/task-1",
  worktreePath: "/tmp/repo-worktrees/task-1",
  prUrl: null,
  prError: null,
  error: null,
  worktreeRemoved: 0,
  deskIndex: 0,
  pendingQuestion: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("createPullRequest", () => {
  it("pushes the branch and returns the PR url from gh", () => {
    const calls: { cmd: string; args: string[]; cwd: string }[] = [];
    const execFn: ExecFn = (cmd, args, cwd) => {
      calls.push({ cmd, args, cwd });
      if (cmd === "gh") return "https://github.com/acme/repo/pull/42\n";
      return "";
    };

    const result = createPullRequest(task, project, execFn);

    expect(result).toEqual({ prUrl: "https://github.com/acme/repo/pull/42" });
    expect(calls[0]).toEqual({ cmd: "git", args: ["push", "-u", "origin", "agent/task-1"], cwd: task.worktreePath });
    expect(calls[1].cmd).toBe("gh");
    expect(calls[1].args).toContain("--base");
    expect(calls[1].args).toContain("main");
  });

  it("returns an error when git push fails", () => {
    const execFn: ExecFn = () => {
      throw new Error("remote rejected");
    };

    const result = createPullRequest(task, project, execFn);
    expect(result.error).toMatch(/git push failed/);
  });

  it("returns an error when gh pr create fails", () => {
    const execFn: ExecFn = (cmd) => {
      if (cmd === "git") return "";
      throw new Error("gh: not authenticated");
    };

    const result = createPullRequest(task, project, execFn);
    expect(result.error).toMatch(/gh pr create failed: .*not authenticated/);
  });
});
