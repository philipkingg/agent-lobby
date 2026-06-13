import type { DatabaseSync } from "node:sqlite";

const { DatabaseSync: DatabaseSyncImpl } = process.getBuiltinModule("node:sqlite") as {
  DatabaseSync: typeof DatabaseSync;
};

export function createDb(path: string = ":memory:"): DatabaseSync {
  const db = new DatabaseSyncImpl(path);

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      defaultBranch TEXT NOT NULL,
      worktreesRoot TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS transcript_entries (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL REFERENCES tasks(id),
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id),
      description TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      sessionId TEXT,
      branchName TEXT NOT NULL,
      worktreePath TEXT NOT NULL,
      prUrl TEXT,
      prError TEXT,
      error TEXT,
      worktreeRemoved INTEGER NOT NULL DEFAULT 0,
      deskIndex INTEGER,
      pendingQuestion TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  return db;
}
