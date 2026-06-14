import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "./app.js";
import { createDb } from "./db.js";
import type { QueryFn } from "./agent-runner.js";
import type { SpawnFn, PtyProcess } from "./pty-runner.js";
import type { ExecFn } from "./pr-service.js";

// Resolves immediately with a successful result, triggering the "done" -> PR flow.
const successQuery: QueryFn = async function* () {
  yield {
    type: "result",
    subtype: "success",
    uuid: "u1",
    session_id: "sess-1",
  } as never;
};

// Never resolves, so sdk-mode tasks stay "running" without hitting the real SDK.
const neverQuery: QueryFn = async function* () {
  await new Promise(() => {});
};

// Reports a session id, then hangs - simulates a task still "running" at the moment of a server restart.
const hangAfterSessionQuery: QueryFn = async function* () {
  yield {
    type: "assistant",
    uuid: "u1",
    session_id: "sess-99",
    message: { content: [{ type: "text", text: "working" }] },
    parent_tool_use_id: null,
  } as never;
  await new Promise(() => {});
};

// A fake pty process that never exits on its own, so tests can drive it via stop().
function fakeSpawnFn(): SpawnFn {
  return () => {
    const proc: PtyProcess = {
      onData: () => {},
      onExit: () => {},
      write: () => {},
      resize: () => {},
      kill: () => {},
    };
    return proc;
  };
}

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
    expect(task.branchName).toBe(`agent/do-the-thing-${task.id.slice(0, 8)}`);
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

  it("creates a pty task and stops it via /tasks/:id/stop", async () => {
    const app = buildApp(undefined, neverQuery, fakeSpawnFn());

    const projectResponse = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { source: "path", value: repoDir },
    });
    const project = projectResponse.json();

    const taskResponse = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/tasks`,
      payload: { description: "interactive session", mode: "pty" },
    });
    expect(taskResponse.statusCode).toBe(201);
    const task = taskResponse.json();

    const stopResponse = await app.inject({ method: "POST", url: `/tasks/${task.id}/stop` });
    expect(stopResponse.statusCode).toBe(200);

    const getResponse = await app.inject({ method: "GET", url: `/tasks/${task.id}` });
    expect(getResponse.json().status).toBe("stopped");

    const secondStop = await app.inject({ method: "POST", url: `/tasks/${task.id}/stop` });
    expect(secondStop.statusCode).toBe(409);
  });

  it("opens a PR when a task completes successfully", async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const execFn: ExecFn = (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "gh") return "https://github.com/acme/repo/pull/7\n";
      return "";
    };

    const app = buildApp(undefined, successQuery, undefined, execFn);

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
    const task = taskResponse.json();

    let body: { status: string; prUrl: string | null } = { status: "running", prUrl: null };
    for (let i = 0; i < 50 && body.status !== "done"; i++) {
      const getResponse = await app.inject({ method: "GET", url: `/tasks/${task.id}` });
      body = getResponse.json();
      if (body.status !== "done") await new Promise((r) => setTimeout(r, 5));
    }

    expect(body.status).toBe("done");
    expect(body.prUrl).toBe("https://github.com/acme/repo/pull/7");
    expect(calls.map((c) => c.cmd)).toEqual(["git", "git", "gh"]);
  });

  it("resumes a running sdk task with its sessionId on restart", async () => {
    const db = createDb();
    const app = buildApp(db, hangAfterSessionQuery);

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
    const task = taskResponse.json();

    let body: { sessionId: string | null } = { sessionId: null };
    for (let i = 0; i < 50 && !body.sessionId; i++) {
      const getResponse = await app.inject({ method: "GET", url: `/tasks/${task.id}` });
      body = getResponse.json();
      if (!body.sessionId) await new Promise((r) => setTimeout(r, 5));
    }
    expect(body.sessionId).toBe("sess-99");

    // "Restart" by building a new app against the same db; it should resume the running task.
    let receivedResume: string | undefined;
    const resumeQuery: QueryFn = async function* (params) {
      receivedResume = params.options?.resume as string | undefined;
      yield { type: "result", subtype: "success", uuid: "u2", session_id: "sess-99" } as never;
    };

    const restarted = buildApp(db, resumeQuery);

    let status = "running";
    for (let i = 0; i < 50 && status !== "done"; i++) {
      const getResponse = await restarted.inject({ method: "GET", url: `/tasks/${task.id}` });
      status = getResponse.json().status;
      if (status !== "done") await new Promise((r) => setTimeout(r, 5));
    }

    expect(status).toBe("done");
    expect(receivedResume).toBe("sess-99");
  });

  it("marks a running pty task as failed on restart", async () => {
    const db = createDb();
    const app = buildApp(db, neverQuery, fakeSpawnFn());

    const projectResponse = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { source: "path", value: repoDir },
    });
    const project = projectResponse.json();

    const taskResponse = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/tasks`,
      payload: { description: "interactive session", mode: "pty" },
    });
    const task = taskResponse.json();
    expect(task.status).toBe("running");

    const restarted = buildApp(db, neverQuery, fakeSpawnFn());

    const getResponse = await restarted.inject({ method: "GET", url: `/tasks/${task.id}` });
    const restartedTask = getResponse.json();
    expect(restartedTask.status).toBe("failed");
    expect(restartedTask.error).toMatch(/cannot be resumed/);
  });

  it("removes a completed task's worktree via DELETE /tasks/:id/worktree", async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const execFn: ExecFn = (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "gh") return "https://github.com/acme/repo/pull/7\n";
      return "";
    };

    const app = buildApp(undefined, successQuery, undefined, execFn);

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
    const task = taskResponse.json();

    let body: { status: string } = { status: "running" };
    for (let i = 0; i < 50 && body.status !== "done"; i++) {
      const getResponse = await app.inject({ method: "GET", url: `/tasks/${task.id}` });
      body = getResponse.json();
      if (body.status !== "done") await new Promise((r) => setTimeout(r, 5));
    }
    expect(body.status).toBe("done");

    expect(existsSync(task.worktreePath)).toBe(true);

    const deleteResponse = await app.inject({ method: "DELETE", url: `/tasks/${task.id}/worktree` });
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json().worktreeRemoved).toBe(1);
    expect(existsSync(task.worktreePath)).toBe(false);
  });

  it("deletes a completed task and its worktree via DELETE /tasks/:id", async () => {
    const execFn: ExecFn = (cmd) => (cmd === "gh" ? "https://github.com/acme/repo/pull/7\n" : "");
    const app = buildApp(undefined, successQuery, undefined, execFn);

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
    const task = taskResponse.json();

    let body: { status: string } = { status: "running" };
    for (let i = 0; i < 50 && body.status !== "done"; i++) {
      const getResponse = await app.inject({ method: "GET", url: `/tasks/${task.id}` });
      body = getResponse.json();
      if (body.status !== "done") await new Promise((r) => setTimeout(r, 5));
    }
    expect(body.status).toBe("done");

    const deleteResponse = await app.inject({ method: "DELETE", url: `/tasks/${task.id}` });
    expect(deleteResponse.statusCode).toBe(200);
    expect(existsSync(task.worktreePath)).toBe(false);

    const getResponse = await app.inject({ method: "GET", url: `/tasks/${task.id}` });
    expect(getResponse.statusCode).toBe(404);
  });

  it("rejects deleting a running task", async () => {
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
    const task = taskResponse.json();

    const deleteResponse = await app.inject({ method: "DELETE", url: `/tasks/${task.id}` });
    expect(deleteResponse.statusCode).toBe(409);
  });

  it("rejects worktree removal for a running task", async () => {
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
    const task = taskResponse.json();

    const deleteResponse = await app.inject({ method: "DELETE", url: `/tasks/${task.id}/worktree` });
    expect(deleteResponse.statusCode).toBe(409);
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
