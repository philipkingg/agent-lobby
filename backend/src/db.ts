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

  return db;
}
