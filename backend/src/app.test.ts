import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "./app.js";
import type { QueryFn } from "./agent-runner.js";

// Never resolves, so sdk-mode tasks stay "running" without hitting the real SDK.
const neverQuery: QueryFn = async function* () {
  await new Promise(() => {});
};

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t.com",
};

describe("GET /health", () => {
  it("returns ok status", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

describe("/projects", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(path.join(tmpdir(), "agent-office-repo-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
    execFileSync("git", ["commit", "--allow-empty", "-m", "init", "--no-gpg-sign"], {
      cwd: repoDir,
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.com" },
    });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("POST creates a project, GET lists it", async () => {
    const app = buildApp();

    const postResponse = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { source: "path", value: repoDir },
    });
    expect(postResponse.statusCode).toBe(201);
    const created = postResponse.json();
    expect(created.path).toBe(repoDir);
    expect(created.defaultBranch).toBe("main");

    const getResponse = await app.inject({ method: "GET", url: "/projects" });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual([created]);
  });

  it("POST rejects a non-git path", async () => {
    const app = buildApp();
    const nonGit = mkdtempSync(path.join(tmpdir(), "agent-office-plain-"));

    const response = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { source: "path", value: nonGit },
    });

    expect(response.statusCode).toBe(400);
    rmSync(nonGit, { recursive: true, force: true });
  });
});

describe("/projects/:id/tasks", () => {
  let repoDir: string;
  let worktreesRoot: string;

  beforeEach(() => {
    repoDir = mkdtempSync(path.join(tmpdir(), "agent-office-repo-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
    execFileSync("git", ["commit", "--allow-empty", "-m", "init", "--no-gpg-sign"], { cwd: repoDir, env: GIT_ENV });
    worktreesRoot = path.join(repoDir, "..", `${path.basename(repoDir)}-worktrees`);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(worktreesRoot, { recursive: true, force: true });
  });

  it("creates a task with an isolated worktree, and lists/fetches it", async () => {
    const app = buildApp(undefined, neverQuery);

    const projectResponse = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { source: "path", value: repoDir },
    });
    const project = projectResponse.json();

    const taskResponse = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/tasks`,
      payload: { description: "do the thing", mode: "sdk" },
    });

    expect(taskResponse.statusCode).toBe(201);
    const task = taskResponse.json();
    expect(task.status).toBe("running");
    expect(task.branchName).toBe(`agent/${task.id}`);
    expect(existsSync(task.worktreePath)).toBe(true);

    const listResponse = await app.inject({ method: "GET", url: "/tasks" });
    expect(listResponse.json()).toEqual([task]);

    const getResponse = await app.inject({ method: "GET", url: `/tasks/${task.id}` });
    expect(getResponse.json()).toEqual(task);
  });

  it("returns 404 for an unknown project", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/projects/no-such-project/tasks",
      payload: { description: "do the thing", mode: "sdk" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 400 for an invalid mode", async () => {
    const app = buildApp();

    const projectResponse = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { source: "path", value: repoDir },
    });
    const project = projectResponse.json();

    const response = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/tasks`,
      payload: { description: "do the thing", mode: "bogus" },
    });

    expect(response.statusCode).toBe(400);
  });
});
