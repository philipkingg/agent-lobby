import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "./app.js";
import { createDb, SCHEMA_VERSION } from "./db.js";
type DbType = ReturnType<typeof createDb>;

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t.com",
};

function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "agent-sims-repo-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["commit", "--allow-empty", "-m", "init", "--no-gpg-sign"], {
    cwd: dir,
    env: GIT_ENV,
  });
  return dir;
}

describe("GET /health", () => {
  it("returns ok + schema version", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", schemaVersion: SCHEMA_VERSION });
  });
});

describe("/projects", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("POST creates a project, GET lists it", async () => {
    const app = buildApp();
    const post = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { source: "path", value: repoDir },
    });
    expect(post.statusCode).toBe(201);
    const created = post.json();
    expect(created.path).toBe(repoDir);
    expect(created.defaultBranch).toBe("main");
    expect(created.autoMerge).toBe(1);
    expect(created.githubUrl).toBeNull();

    const get = await app.inject({ method: "GET", url: "/projects" });
    expect(get.json()).toEqual([created]);
  });

  it("POST rejects non-git path", async () => {
    const app = buildApp();
    const plain = mkdtempSync(path.join(tmpdir(), "plain-"));
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { source: "path", value: plain },
    });
    expect(res.statusCode).toBe(400);
    rmSync(plain, { recursive: true, force: true });
  });

  it("DELETE removes project", async () => {
    const app = buildApp();
    const post = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { source: "path", value: repoDir },
    });
    const project = post.json();

    const del = await app.inject({ method: "DELETE", url: `/projects/${project.id}` });
    expect(del.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: "/projects" });
    expect(get.json()).toEqual([]);
  });
});

describe("/agents", () => {
  it("POST hires an agent with generated personality", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/agents",
      payload: { jobType: "implementer" },
    });
    expect(res.statusCode).toBe(201);
    const agent = res.json();
    expect(agent.jobType).toBe("implementer");
    expect(agent.model).toBe("claude-sonnet-4-6");
    expect(agent.level).toBe(1);
    expect(["Adam", "Alex", "Amelia", "Bob"]).toContain(agent.avatar);
    expect(typeof agent.personality).toBe("string");
    const p = JSON.parse(agent.personality);
    expect(p.traits.length).toBeGreaterThanOrEqual(3);
  });

  it("POST rejects invalid job type", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/agents",
      payload: { jobType: "hacker" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET lists hired agents", async () => {
    const app = buildApp();
    await app.inject({ method: "POST", url: "/agents", payload: { jobType: "planner" } });
    await app.inject({ method: "POST", url: "/agents", payload: { jobType: "reviewer" } });

    const res = await app.inject({ method: "GET", url: "/agents" });
    expect(res.json()).toHaveLength(2);
  });

  it("DELETE fires agent, removes from GET list", async () => {
    const app = buildApp();
    const hire = await app.inject({ method: "POST", url: "/agents", payload: { jobType: "merger" } });
    const agent = hire.json();

    const fire = await app.inject({ method: "DELETE", url: `/agents/${agent.id}` });
    expect(fire.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/agents" });
    expect(list.json()).toHaveLength(0);
  });

  it("DELETE returns 404 for unknown agent", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "DELETE", url: "/agents/no-such" });
    expect(res.statusCode).toBe(404);
  });
});

describe("/squads", () => {
  it("POST creates squad, GET lists it", async () => {
    const app = buildApp();
    const post = await app.inject({
      method: "POST",
      url: "/squads",
      payload: { name: "Frontend Team" },
    });
    expect(post.statusCode).toBe(201);
    const squad = post.json();
    expect(squad.name).toBe("Frontend Team");

    const get = await app.inject({ method: "GET", url: "/squads" });
    expect(get.json()).toHaveLength(1);
  });

  it("POST rejects missing name", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/squads", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("PUT updates squad name and projects", async () => {
    const app = buildApp();
    const post = await app.inject({
      method: "POST",
      url: "/squads",
      payload: { name: "Old Name" },
    });
    const squad = post.json();

    const put = await app.inject({
      method: "PUT",
      url: `/squads/${squad.id}`,
      payload: { name: "New Name", projectIds: ["proj-abc"] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().name).toBe("New Name");
    expect(JSON.parse(put.json().projectIds)).toContain("proj-abc");
  });

  it("agents can be added to and removed from squads", async () => {
    const app = buildApp();
    const squad = (
      await app.inject({ method: "POST", url: "/squads", payload: { name: "Squad A" } })
    ).json();
    const agent = (
      await app.inject({ method: "POST", url: "/agents", payload: { jobType: "implementer" } })
    ).json();

    const add = await app.inject({
      method: "POST",
      url: `/squads/${squad.id}/agents`,
      payload: { agentId: agent.id },
    });
    expect(add.statusCode).toBe(200);

    const agentGet = await app.inject({ method: "GET", url: `/agents/${agent.id}` });
    expect(agentGet.json().squadId).toBe(squad.id);

    const remove = await app.inject({
      method: "DELETE",
      url: `/squads/${squad.id}/agents/${agent.id}`,
    });
    expect(remove.statusCode).toBe(200);

    const agentAfter = await app.inject({ method: "GET", url: `/agents/${agent.id}` });
    expect(agentAfter.json().squadId).toBeNull();
  });
});

describe("/tasks", () => {
  let repoDir: string;
  let projectId: string;
  let sharedDb: DbType;

  beforeEach(async () => {
    repoDir = makeRepo();
    sharedDb = createDb();
    const app = buildApp(sharedDb);
    const proj = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { source: "path", value: repoDir },
    });
    projectId = proj.json().id;
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("POST creates task at queued:prioritize", async () => {
    const app = buildApp(sharedDb);
    const post = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { projectId, title: "Add login", description: "OAuth login flow" },
    });
    expect(post.statusCode).toBe(201);
    const task = post.json();
    expect(task.stage).toBe("queued:prioritize");
    expect(task.status).toBe("queued");
    expect(task.priority).toBe(3);
    expect(task.requiresHumanReview).toBe(0);
  });

  it("POST tasks are returned priority-ordered", async () => {
    const app = buildApp(sharedDb);
    await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { projectId, title: "low", description: "d", priority: 1 },
    });
    await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { projectId, title: "high", description: "d", priority: 5 },
    });

    const get = await app.inject({ method: "GET", url: "/tasks" });
    const tasks = get.json();
    expect(tasks[0].title).toBe("high");
    expect(tasks[1].title).toBe("low");
  });

  it("POST rejects invalid priority", async () => {
    const app = buildApp(sharedDb);
    const res = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { projectId, title: "t", description: "d", priority: 10 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /tasks/:id/approve advances awaiting_approval task", async () => {
    const db = sharedDb;
    const app = buildApp(db);
    const post = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { projectId, title: "t", description: "d", requiresHumanReview: true },
    });
    const task = post.json();

    // Manually advance to awaiting_approval
    db.prepare(
      `UPDATE tasks SET stage = 'queued:plan', status = 'awaiting_approval' WHERE id = ?`
    ).run(task.id);

    const approve = await app.inject({ method: "POST", url: `/tasks/${task.id}/approve` });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().status).toBe("queued");
  });

  it("POST /tasks/:id/retry re-queues stuck task", async () => {
    const db = sharedDb;
    const app = buildApp(db);
    const post = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { projectId, title: "t", description: "d" },
    });
    const task = post.json();
    db.prepare(`UPDATE tasks SET status = 'stuck' WHERE id = ?`).run(task.id);

    const retry = await app.inject({ method: "POST", url: `/tasks/${task.id}/retry` });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().status).toBe("queued");
  });

  it("DELETE /tasks/:id removes task", async () => {
    const app = buildApp(sharedDb);
    const post = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { projectId, title: "t", description: "d" },
    });
    const task = post.json();

    const del = await app.inject({ method: "DELETE", url: `/tasks/${task.id}` });
    expect(del.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: `/tasks/${task.id}` });
    expect(get.statusCode).toBe(404);
  });

  it("returns 404 for unknown project on task creation", async () => {
    const app = buildApp(sharedDb);
    const res = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { projectId: "no-such-project", title: "t", description: "d" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DB schema migration", () => {
  it("fresh DB gets schema version 2", () => {
    const db = createDb();
    const row = db
      .prepare(`SELECT value FROM settings WHERE key = 'schemaVersion'`)
      .get() as { value: string };
    expect(Number(row.value)).toBe(SCHEMA_VERSION);
  });

  it("user_profile seeded with level 1", () => {
    const db = createDb();
    const profile = db.prepare(`SELECT * FROM user_profile WHERE id = 1`).get() as {
      level: number;
      xp: number;
    };
    expect(profile.level).toBe(1);
    expect(profile.xp).toBe(0);
  });
});
