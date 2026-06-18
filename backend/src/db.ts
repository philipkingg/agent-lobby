import type { DatabaseSync } from "node:sqlite";

const { DatabaseSync: DatabaseSyncImpl } = process.getBuiltinModule("node:sqlite") as {
  DatabaseSync: typeof DatabaseSync;
};

export const SCHEMA_VERSION = 4;

function getSchemaVersion(db: DatabaseSync): number {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("schemaVersion") as
      | { value: string }
      | undefined;
    return row ? Number(row.value) : 0;
  } catch {
    return 0;
  }
}

function setSchemaVersion(db: DatabaseSync, version: number): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run("schemaVersion", String(version));
}

function applyV2Schema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      defaultBranch TEXT NOT NULL,
      worktreesRoot TEXT NOT NULL,
      githubUrl TEXT,
      autoMerge INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      xpToNext INTEGER NOT NULL DEFAULT 100
    )
  `);

  db.exec(`INSERT OR IGNORE INTO user_profile (id, level, xp, xpToNext) VALUES (1, 1, 0, 100)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      jobType TEXT NOT NULL,
      model TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      avatar TEXT NOT NULL,
      personality TEXT NOT NULL,
      currentStation TEXT,
      currentTaskId TEXT,
      squadId TEXT,
      hiredAt TEXT NOT NULL,
      firedAt TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS squads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      projectIds TEXT NOT NULL DEFAULT '[]'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS squad_agents (
      squadId TEXT NOT NULL,
      agentId TEXT NOT NULL,
      PRIMARY KEY (squadId, agentId)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
      stage TEXT NOT NULL DEFAULT 'queued:prioritize',
      status TEXT NOT NULL DEFAULT 'queued',
      requiresHumanReview INTEGER NOT NULL DEFAULT 0,
      reviewLoopCount INTEGER NOT NULL DEFAULT 0,
      worktreePath TEXT,
      branch TEXT,
      prUrl TEXT,
      source TEXT NOT NULL DEFAULT 'human',
      githubIssueNumber INTEGER,
      sessionId TEXT,
      pendingQuestion TEXT,
      error TEXT,
      parentTaskId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_stages (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL REFERENCES tasks(id),
      stage TEXT NOT NULL,
      agentId TEXT,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      sessionId TEXT,
      xpAwarded INTEGER NOT NULL DEFAULT 0,
      startedAt TEXT NOT NULL,
      completedAt TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS transcript_entries (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      stageId TEXT,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS worktrees (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      path TEXT NOT NULL,
      branch TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      createdAt TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_suggestions (
      id TEXT PRIMARY KEY,
      agentType TEXT NOT NULL,
      proposedContent TEXT NOT NULL,
      rationale TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      auditAgentId TEXT,
      createdAt TEXT NOT NULL,
      resolvedAt TEXT
    )
  `);

  setSchemaVersion(db, SCHEMA_VERSION);
}

function migrateV1ToV2(db: DatabaseSync): void {
  // Drop old tables that changed shape
  db.exec(`DROP TABLE IF EXISTS transcript_entries`);
  db.exec(`DROP TABLE IF EXISTS tasks`);

  // Alter projects table to add new columns (SQLite doesn't support DROP COLUMN so we add only)
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN githubUrl TEXT`);
  } catch {
    // column already exists
  }
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN autoMerge INTEGER NOT NULL DEFAULT 1`);
  } catch {
    // column already exists
  }

  // Create all new/changed tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      xpToNext INTEGER NOT NULL DEFAULT 100
    )
  `);
  db.exec(`INSERT OR IGNORE INTO user_profile (id, level, xp, xpToNext) VALUES (1, 1, 0, 100)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      jobType TEXT NOT NULL,
      model TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      avatar TEXT NOT NULL,
      personality TEXT NOT NULL,
      currentStation TEXT,
      currentTaskId TEXT,
      squadId TEXT,
      hiredAt TEXT NOT NULL,
      firedAt TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS squads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      projectIds TEXT NOT NULL DEFAULT '[]'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS squad_agents (
      squadId TEXT NOT NULL,
      agentId TEXT NOT NULL,
      PRIMARY KEY (squadId, agentId)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
      stage TEXT NOT NULL DEFAULT 'queued:prioritize',
      status TEXT NOT NULL DEFAULT 'queued',
      requiresHumanReview INTEGER NOT NULL DEFAULT 0,
      reviewLoopCount INTEGER NOT NULL DEFAULT 0,
      worktreePath TEXT,
      branch TEXT,
      prUrl TEXT,
      source TEXT NOT NULL DEFAULT 'human',
      githubIssueNumber INTEGER,
      sessionId TEXT,
      pendingQuestion TEXT,
      error TEXT,
      parentTaskId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_stages (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL REFERENCES tasks(id),
      stage TEXT NOT NULL,
      agentId TEXT,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      sessionId TEXT,
      xpAwarded INTEGER NOT NULL DEFAULT 0,
      startedAt TEXT NOT NULL,
      completedAt TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS transcript_entries (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      stageId TEXT,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS worktrees (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      path TEXT NOT NULL,
      branch TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      createdAt TEXT NOT NULL
    )
  `);

  setSchemaVersion(db, SCHEMA_VERSION);
}

function migrateV2ToV3(db: DatabaseSync): void {
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN parentTaskId TEXT`);
  } catch {
    // column already exists
  }
  setSchemaVersion(db, 3);
}

function migrateV3ToV4(db: DatabaseSync): void {
  // Recreate agents table without the jobType CHECK constraint so 'auditor' can be inserted
  db.exec(`
    CREATE TABLE agents_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      jobType TEXT NOT NULL,
      model TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      avatar TEXT NOT NULL,
      personality TEXT NOT NULL,
      currentStation TEXT,
      currentTaskId TEXT,
      squadId TEXT,
      hiredAt TEXT NOT NULL,
      firedAt TEXT
    )
  `);
  db.exec(`INSERT INTO agents_new SELECT * FROM agents`);
  db.exec(`DROP TABLE agents`);
  db.exec(`ALTER TABLE agents_new RENAME TO agents`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_suggestions (
      id TEXT PRIMARY KEY,
      agentType TEXT NOT NULL,
      proposedContent TEXT NOT NULL,
      rationale TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      auditAgentId TEXT,
      createdAt TEXT NOT NULL,
      resolvedAt TEXT
    )
  `);

  setSchemaVersion(db, 4);
}

export function createDb(path: string = ":memory:"): DatabaseSync {
  const db = new DatabaseSyncImpl(path);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  const version = getSchemaVersion(db);

  if (version === 0) {
    applyV2Schema(db);
  } else if (version === 1) {
    migrateV1ToV2(db);
    migrateV2ToV3(db);
    migrateV3ToV4(db);
  } else if (version === 2) {
    migrateV2ToV3(db);
    migrateV3ToV4(db);
  } else if (version === 3) {
    migrateV3ToV4(db);
  }

  // Ensure tables that may be missing from partial historical migrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS transcript_entries (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      stageId TEXT,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS worktrees (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      path TEXT NOT NULL,
      branch TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      createdAt TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_suggestions (
      id TEXT PRIMARY KEY,
      agentType TEXT NOT NULL,
      proposedContent TEXT NOT NULL,
      rationale TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      auditAgentId TEXT,
      createdAt TEXT NOT NULL,
      resolvedAt TEXT
    )
  `);

  return db;
}
