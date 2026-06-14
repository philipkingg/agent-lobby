import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb } from "./db.js";
import { createDraftTask, startTask, setTaskStatus, getTask } from "./tasks.js";
import { MAX_DESKS } from "./desks.js";
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
    worktreesRoot: path.join(repoDir, "..", `${path.basename(repoDir)}-worktrees`),
    createdAt: new Date().toISOString(),
  };
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
  rmSync(project.worktreesRoot, { recursive: true, force: true });
});

function insertProject(db: ReturnType<typeof createDb>) {
  db.prepare(
    `INSERT INTO projects (id, name, path, defaultBranch, worktreesRoot, createdAt) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(project.id, project.name, project.path, project.defaultBranch, project.worktreesRoot, project.createdAt);
}

describe("startTask desk reuse", () => {
  it("hands an idle (done) agent's desk to the ticket being started, freeing the old one", () => {
    const db = createDb();
    insertProject(db);

    // An agent finishes a ticket and sits "done" in code review, holding desk 0.
    const draft1 = createDraftTask(db, project, { description: "first ticket", mode: "sdk" });
    const started1 = startTask(db, project, draft1);
    expect(started1.deskIndex).toBe(0);
    setTaskStatus(db, started1.id, "done");

    // A new ticket moves to Todo - it should reuse the idle agent's desk
    // rather than allocate a fresh one.
    const draft2 = createDraftTask(db, project, { description: "second ticket", mode: "sdk" });
    const started2 = startTask(db, project, draft2);
    expect(started2.deskIndex).toBe(0);

    // The first ticket is freed from its desk - it's no longer "occupying" an agent.
    const finished = getTask(db, started1.id);
    expect(finished?.deskIndex).toBeNull();
    expect(finished?.status).toBe("done");
  });

  it("allocates a fresh desk when no agent is idle", () => {
    const db = createDb();
    insertProject(db);

    const draft1 = createDraftTask(db, project, { description: "first ticket", mode: "sdk" });
    const started1 = startTask(db, project, draft1);
    expect(started1.deskIndex).toBe(0);
    // still "queued" - not done, so its desk isn't up for grabs.

    const draft2 = createDraftTask(db, project, { description: "second ticket", mode: "sdk" });
    const started2 = startTask(db, project, draft2);
    expect(started2.deskIndex).toBe(1);
    expect(started2.deskIndex).not.toBe(started1.deskIndex);
  });

  it("does not exceed MAX_DESKS even with many tickets, as long as agents finish", () => {
    const db = createDb();
    insertProject(db);

    for (let i = 0; i < MAX_DESKS + 3; i++) {
      const draft = createDraftTask(db, project, { description: `ticket ${i}`, mode: "sdk" });
      const started = startTask(db, project, draft);
      expect(started.deskIndex).not.toBeNull();
      expect(started.deskIndex!).toBeLessThan(MAX_DESKS);
      // Free up the agent immediately so the next ticket can reuse its desk.
      setTaskStatus(db, started.id, "done");
    }
  });
});
