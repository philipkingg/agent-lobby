import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface TranscriptEntry {
  id: string;
  taskId: string;
  type: string;
  content: string;
  timestamp: string;
}

export function addTranscriptEntry(db: DatabaseSync, taskId: string, type: string, content: string): TranscriptEntry {
  const entry: TranscriptEntry = {
    id: randomUUID(),
    taskId,
    type,
    content,
    timestamp: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO transcript_entries (id, taskId, type, content, timestamp) VALUES (?, ?, ?, ?, ?)`
  ).run(entry.id, entry.taskId, entry.type, entry.content, entry.timestamp);

  return entry;
}

export function listTranscriptEntries(db: DatabaseSync, taskId: string): TranscriptEntry[] {
  const rows = db.prepare(`SELECT * FROM transcript_entries WHERE taskId = ? ORDER BY timestamp ASC`).all(taskId);
  return rows as unknown as TranscriptEntry[];
}
