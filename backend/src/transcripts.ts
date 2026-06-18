import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface TranscriptEntry {
  id: string;
  taskId: string;
  stageId: string | null;
  type: string;
  content: string;
  timestamp: string;
}

export function addTranscriptEntry(
  db: DatabaseSync,
  taskId: string,
  type: string,
  content: string,
  stageId?: string
): TranscriptEntry {
  const entry: TranscriptEntry = {
    id: randomUUID(),
    taskId,
    stageId: stageId ?? null,
    type,
    content,
    timestamp: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO transcript_entries (id, taskId, stageId, type, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(entry.id, entry.taskId, entry.stageId, entry.type, entry.content, entry.timestamp);

  return entry;
}

export function listTranscriptEntries(db: DatabaseSync, taskId: string): TranscriptEntry[] {
  return db
    .prepare(`SELECT * FROM transcript_entries WHERE taskId = ? ORDER BY timestamp ASC`)
    .all(taskId) as TranscriptEntry[];
}

export function listTranscriptEntriesByAgent(
  db: DatabaseSync,
  taskId: string,
  agentId: string
): TranscriptEntry[] {
  return db
    .prepare(
      `SELECT te.* FROM transcript_entries te
       JOIN task_stages ts ON te.stageId = ts.id
       WHERE te.taskId = ? AND ts.agentId = ?
       ORDER BY te.timestamp ASC`
    )
    .all(taskId, agentId) as unknown as TranscriptEntry[];
}

export function listStageTranscriptEntries(db: DatabaseSync, stageId: string): TranscriptEntry[] {
  return db
    .prepare(`SELECT * FROM transcript_entries WHERE stageId = ? ORDER BY timestamp ASC`)
    .all(stageId) as TranscriptEntry[];
}
