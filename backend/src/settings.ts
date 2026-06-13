import type { DatabaseSync } from "node:sqlite";

const MAX_CONCURRENT_AGENTS_KEY = "maxConcurrentAgents";
export const DEFAULT_MAX_CONCURRENT_AGENTS = 4;
export const MIN_CONCURRENT_AGENTS = 1;
export const MAX_CONCURRENT_AGENTS_LIMIT = 10;

export function getMaxConcurrentAgents(db: DatabaseSync): number {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(MAX_CONCURRENT_AGENTS_KEY) as
    | { value: string }
    | undefined;
  return row ? Number(row.value) : DEFAULT_MAX_CONCURRENT_AGENTS;
}

/** Clamps to [1, 10] and persists the new concurrency limit, returning the stored value. */
export function setMaxConcurrentAgents(db: DatabaseSync, value: number): number {
  const clamped = Math.min(MAX_CONCURRENT_AGENTS_LIMIT, Math.max(MIN_CONCURRENT_AGENTS, Math.round(value)));
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    MAX_CONCURRENT_AGENTS_KEY,
    String(clamped)
  );
  return clamped;
}
