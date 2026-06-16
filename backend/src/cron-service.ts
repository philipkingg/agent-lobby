import { execFileSync } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import { createTask, listTasks } from "./tasks.js";
import { listProjects } from "./projects.js";
import type { Broadcast } from "./ws-events.js";

export type ExecFn = (cmd: string, args: string[], cwd?: string) => string;

export const defaultExec: ExecFn = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf-8" });

// ── PR comment poller (Step 12) ──────────────────────────────────────────────

interface GhComment {
  id: number;
  body: string;
  author: { login: string };
  createdAt: string;
}

interface GhPr {
  number: number;
  url: string;
  headRefName: string;
  baseRefName: string;
  comments: GhComment[];
}

/**
 * Polls open agent PRs for new human comments (not made by the github-actions bot).
 * Creates a new Implementer task for each unseen comment.
 */
export async function pollPrComments(
  db: DatabaseSync,
  broadcast: Broadcast,
  execFn: ExecFn = defaultExec
): Promise<{ tasksCreated: number }> {
  const projects = listProjects(db).filter((p) => p.githubUrl);
  let tasksCreated = 0;

  for (const project of projects) {
    const repoArg = githubRepoArg(project.githubUrl!);
    if (!repoArg) continue;

    let prs: GhPr[];
    try {
      const out = execFn("gh", [
        "pr", "list",
        "--repo", repoArg,
        "--state", "open",
        "--json", "number,url,headRefName,baseRefName,comments",
        "--search", "head:agent/",
      ]);
      prs = JSON.parse(out) as GhPr[];
    } catch {
      continue;
    }

    for (const pr of prs) {
      const task = (db
        .prepare(`SELECT * FROM tasks WHERE branch = ? AND projectId = ?`)
        .get(pr.headRefName, project.id)) as { id: string } | undefined;
      if (!task) continue;

      const lastSeenKey = `pr_comment_seen:${pr.number}`;
      const lastSeen = (db
        .prepare(`SELECT value FROM settings WHERE key = ?`)
        .get(lastSeenKey)) as { value: string } | undefined;
      const lastSeenId = lastSeen ? Number(lastSeen.value) : 0;

      const newComments = pr.comments.filter(
        (c) => c.id > lastSeenId && c.author.login !== "github-actions[bot]"
      );

      for (const comment of newComments) {
        createTask(db, {
          projectId: project.id,
          title: `Address PR comment on "${pr.headRefName}"`,
          description: `Address this PR review comment:\n\n${comment.body}`,
          priority: 4,
          source: "human",
        });
        tasksCreated++;
      }

      if (newComments.length > 0) {
        const maxId = Math.max(...newComments.map((c) => c.id));
        db.prepare(
          `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        ).run(lastSeenKey, String(maxId));
      }
    }
  }

  return { tasksCreated };
}

// ── Issue ingestion (Step 13) ─────────────────────────────────────────────────

interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: { name: string }[];
}

const LABEL_PRIORITY: Record<string, number> = {
  "priority:critical": 5,
  "priority:high": 4,
  "priority:low": 2,
  "priority:trivial": 1,
};

function issuePriority(labels: { name: string }[]): number {
  for (const label of labels) {
    const p = LABEL_PRIORITY[label.name.toLowerCase()];
    if (p !== undefined) return p;
  }
  return 3;
}

/**
 * Ingests open GitHub issues as queued tasks (skips already-imported ones).
 */
export async function ingestGithubIssues(
  db: DatabaseSync,
  execFn: ExecFn = defaultExec
): Promise<{ tasksCreated: number }> {
  const projects = listProjects(db).filter((p) => p.githubUrl);
  let tasksCreated = 0;

  for (const project of projects) {
    const repoArg = githubRepoArg(project.githubUrl!);
    if (!repoArg) continue;

    let issues: GhIssue[];
    try {
      const out = execFn("gh", [
        "issue", "list",
        "--repo", repoArg,
        "--state", "open",
        "--json", "number,title,body,labels",
        "--limit", "100",
      ]);
      issues = JSON.parse(out) as GhIssue[];
    } catch {
      continue;
    }

    // Get already-imported issue numbers for this project
    const imported = new Set(
      (db
        .prepare(`SELECT githubIssueNumber FROM tasks WHERE projectId = ? AND githubIssueNumber IS NOT NULL`)
        .all(project.id) as { githubIssueNumber: number }[])
        .map((r) => r.githubIssueNumber)
    );

    for (const issue of issues) {
      if (imported.has(issue.number)) continue;

      createTask(db, {
        projectId: project.id,
        title: issue.title,
        description: issue.body || issue.title,
        priority: issuePriority(issue.labels),
        source: "github_issue",
        githubIssueNumber: issue.number,
      });
      tasksCreated++;
    }
  }

  return { tasksCreated };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function githubRepoArg(githubUrl: string): string | null {
  // https://github.com/owner/repo  →  owner/repo
  const match = githubUrl.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

// ── Interval-based cron manager ───────────────────────────────────────────────

export class CronService {
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private db: DatabaseSync,
    private broadcast: Broadcast,
    private execFn: ExecFn = defaultExec
  ) {}

  start(opts: { prPollIntervalMs?: number; issueIngestIntervalMs?: number } = {}): void {
    const { prPollIntervalMs = 5 * 60 * 1000, issueIngestIntervalMs = 15 * 60 * 1000 } = opts;

    this.timers.push(
      setInterval(() => {
        void pollPrComments(this.db, this.broadcast, this.execFn).catch(console.error);
      }, prPollIntervalMs)
    );

    this.timers.push(
      setInterval(() => {
        void ingestGithubIssues(this.db, this.execFn).catch(console.error);
      }, issueIngestIntervalMs)
    );
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}
