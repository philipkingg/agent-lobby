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
    const ghCall = calls.find((c) => c.cmd === "gh");
    expect(ghCall?.args).toContain("--base");
    expect(ghCall?.args).toContain("main");
  });

  it("includes the branch's commit log in the PR body", () => {
    const execFn: ExecFn = (cmd, args) => {
      if (cmd === "git" && args[0] === "log") return "- did the first thing\n- did the second thing";
      if (cmd === "gh") return "https://github.com/acme/repo/pull/42\n";
      return "";
    };

    const calls: { cmd: string; args: string[] }[] = [];
    const recordingExecFn: ExecFn = (cmd, args, cwd) => {
      calls.push({ cmd, args });
      return execFn(cmd, args, cwd);
    };

    createPullRequest(task, project, recordingExecFn);

    const ghCall = calls.find((c) => c.cmd === "gh")!;
    const bodyIndex = ghCall.args.indexOf("--body");
    expect(ghCall.args[bodyIndex + 1]).toBe(
      "do the thing\n\n## Commits\n- did the first thing\n- did the second thing"
    );
  });

  it("enables auto-merge on the PR after creating it", () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const execFn: ExecFn = (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "gh" && args[0] === "pr" && args[1] === "create") return "https://github.com/acme/repo/pull/42\n";
      return "";
    };

    const result = createPullRequest(task, project, execFn);

    expect(result).toEqual({ prUrl: "https://github.com/acme/repo/pull/42" });
    const mergeCall = calls.find((c) => c.cmd === "gh" && c.args[0] === "pr" && c.args[1] === "merge");
    expect(mergeCall?.args).toEqual(["pr", "merge", "agent/task-1", "--auto", "--squash"]);
  });

  it("still returns the PR url if enabling auto-merge fails", () => {
    const execFn: ExecFn = (cmd, args) => {
      if (cmd === "gh" && args[0] === "pr" && args[1] === "create") return "https://github.com/acme/repo/pull/42\n";
      if (cmd === "gh" && args[0] === "pr" && args[1] === "merge") throw new Error("auto-merge is not allowed");
      return "";
    };

    const result = createPullRequest(task, project, execFn);
    expect(result).toEqual({ prUrl: "https://github.com/acme/repo/pull/42" });
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
