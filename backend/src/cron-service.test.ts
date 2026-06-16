import { describe, it, expect } from "vitest";
import { createDb } from "./db.js";
import { pollPrComments, ingestGithubIssues, type ExecFn } from "./cron-service.js";
import { listTasks, getTask } from "./tasks.js";
import type { WsEvent } from "./ws-events.js";

const PROJECT_ID = "proj-1";
const GITHUB_URL = "https://github.com/acme/repo";

function setupDb(withGithubUrl = true) {
  const db = createDb();
  db.prepare(
    `INSERT INTO projects (id, name, path, defaultBranch, worktreesRoot, githubUrl, autoMerge, createdAt)
     VALUES (?, 'repo', '/tmp/repo', 'main', '/tmp/repo-wt', ?, 1, ?)`
  ).run(PROJECT_ID, withGithubUrl ? GITHUB_URL : null, new Date().toISOString());
  return db;
}

function noop(): WsEvent[] {
  return [];
}

// ── pollPrComments ─────────────────────────────────────────────────────────

describe("pollPrComments", () => {
  it("creates a task for each new human comment", async () => {
    const db = setupDb();

    // Seed a task with a branch so the PR can be matched
    db.prepare(
      `INSERT INTO tasks (id, projectId, title, description, priority, stage, status,
        requiresHumanReview, reviewLoopCount, branch, source, createdAt, updatedAt)
       VALUES ('t1', ?, 'feat', 'feat', 3, 'queued:review', 'running', 0, 0, 'agent/feat-t1', 'human', ?, ?)`
    ).run(PROJECT_ID, new Date().toISOString(), new Date().toISOString());

    const fakeExec: ExecFn = (cmd, args) => {
      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
        return JSON.stringify([
          {
            number: 42,
            url: "https://github.com/acme/repo/pull/42",
            headRefName: "agent/feat-t1",
            baseRefName: "main",
            comments: [
              { id: 1, body: "Please fix the typo", author: { login: "humanuser" }, createdAt: "2026-01-01T00:00:00Z" },
            ],
          },
        ]);
      }
      return "[]";
    };

    const events: WsEvent[] = [];
    const result = await pollPrComments(db, (_ch, ev) => events.push(ev), fakeExec);

    expect(result.tasksCreated).toBe(1);
    const tasks = listTasks(db).filter((t) => t.source === "human" && t.id !== "t1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toContain("Please fix the typo");
    expect(tasks[0].priority).toBe(4);
  });

  it("does not create duplicate tasks for already-seen comments", async () => {
    const db = setupDb();
    db.prepare(
      `INSERT INTO tasks (id, projectId, title, description, priority, stage, status,
        requiresHumanReview, reviewLoopCount, branch, source, createdAt, updatedAt)
       VALUES ('t1', ?, 'feat', 'feat', 3, 'queued:review', 'running', 0, 0, 'agent/feat-t1', 'human', ?, ?)`
    ).run(PROJECT_ID, new Date().toISOString(), new Date().toISOString());

    // Mark comment 1 as already seen
    db.prepare(`INSERT INTO settings (key, value) VALUES ('pr_comment_seen:42', '1')`).run();

    const fakeExec: ExecFn = () =>
      JSON.stringify([
        {
          number: 42,
          headRefName: "agent/feat-t1",
          comments: [
            { id: 1, body: "already seen", author: { login: "human" }, createdAt: "" },
          ],
        },
      ]);

    const result = await pollPrComments(db, () => {}, fakeExec);
    expect(result.tasksCreated).toBe(0);
  });

  it("skips comments from github-actions bot", async () => {
    const db = setupDb();
    db.prepare(
      `INSERT INTO tasks (id, projectId, title, description, priority, stage, status,
        requiresHumanReview, reviewLoopCount, branch, source, createdAt, updatedAt)
       VALUES ('t1', ?, 'feat', 'feat', 3, 'queued:review', 'running', 0, 0, 'agent/feat-t1', 'human', ?, ?)`
    ).run(PROJECT_ID, new Date().toISOString(), new Date().toISOString());

    const fakeExec: ExecFn = () =>
      JSON.stringify([
        {
          number: 42,
          headRefName: "agent/feat-t1",
          comments: [
            { id: 99, body: "CI failed", author: { login: "github-actions[bot]" }, createdAt: "" },
          ],
        },
      ]);

    const result = await pollPrComments(db, () => {}, fakeExec);
    expect(result.tasksCreated).toBe(0);
  });

  it("skips projects with no githubUrl", async () => {
    const db = setupDb(false);
    const fakeExec: ExecFn = () => { throw new Error("should not call gh"); };
    const result = await pollPrComments(db, () => {}, fakeExec);
    expect(result.tasksCreated).toBe(0);
  });
});

// ── ingestGithubIssues ────────────────────────────────────────────────────

describe("ingestGithubIssues", () => {
  it("creates tasks from open github issues", async () => {
    const db = setupDb();

    const fakeExec: ExecFn = () =>
      JSON.stringify([
        { number: 1, title: "Bug: crash on login", body: "Detailed description", labels: [] },
        { number: 2, title: "Feature: dark mode", body: "Users want it", labels: [{ name: "priority:high" }] },
      ]);

    const result = await ingestGithubIssues(db, fakeExec);
    expect(result.tasksCreated).toBe(2);

    const tasks = listTasks(db);
    expect(tasks).toHaveLength(2);

    const bug = tasks.find((t) => t.githubIssueNumber === 1)!;
    expect(bug.source).toBe("github_issue");
    expect(bug.priority).toBe(3); // default

    const feat = tasks.find((t) => t.githubIssueNumber === 2)!;
    expect(feat.priority).toBe(4); // priority:high
  });

  it("does not reimport already-imported issues", async () => {
    const db = setupDb();

    // Pre-import issue 1
    db.prepare(
      `INSERT INTO tasks (id, projectId, title, description, priority, stage, status,
        requiresHumanReview, reviewLoopCount, source, githubIssueNumber, createdAt, updatedAt)
       VALUES ('t1', ?, 'Bug', 'desc', 3, 'queued:prioritize', 'queued', 0, 0, 'github_issue', 1, ?, ?)`
    ).run(PROJECT_ID, new Date().toISOString(), new Date().toISOString());

    const fakeExec: ExecFn = () =>
      JSON.stringify([
        { number: 1, title: "Bug: already imported", body: "body", labels: [] },
        { number: 3, title: "New issue", body: "body", labels: [] },
      ]);

    const result = await ingestGithubIssues(db, fakeExec);
    expect(result.tasksCreated).toBe(1);
    expect(listTasks(db)).toHaveLength(2); // 1 pre-existing + 1 new
  });

  it("maps priority labels correctly", async () => {
    const db = setupDb();

    const fakeExec: ExecFn = () =>
      JSON.stringify([
        { number: 1, title: "Critical", body: "", labels: [{ name: "priority:critical" }] },
        { number: 2, title: "Low", body: "", labels: [{ name: "priority:low" }] },
        { number: 3, title: "Trivial", body: "", labels: [{ name: "priority:trivial" }] },
      ]);

    await ingestGithubIssues(db, fakeExec);
    const tasks = listTasks(db);

    expect(tasks.find((t) => t.githubIssueNumber === 1)!.priority).toBe(5);
    expect(tasks.find((t) => t.githubIssueNumber === 2)!.priority).toBe(2);
    expect(tasks.find((t) => t.githubIssueNumber === 3)!.priority).toBe(1);
  });

  it("skips projects with no githubUrl", async () => {
    const db = setupDb(false);
    const fakeExec: ExecFn = () => { throw new Error("should not call gh"); };
    const result = await ingestGithubIssues(db, fakeExec);
    expect(result.tasksCreated).toBe(0);
  });
});
