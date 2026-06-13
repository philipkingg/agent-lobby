import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "./app.js";

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
