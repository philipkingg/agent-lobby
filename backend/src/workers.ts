import type { DatabaseSync } from "node:sqlite";

/** Cute first names handed out to agent "workers" as they take a desk. */
const CUTE_NAMES = [
  "Pip", "Mochi", "Biscuit", "Noodle", "Pebble", "Waffle", "Clover", "Peanut",
  "Marble", "Sprout", "Bramble", "Juniper", "Pixel", "Hazel", "Toffee", "Plum",
  "Acorn", "Sage", "Buttons", "Olive", "Wisp", "Fig", "Maple", "Pumpkin",
  "Inkblot", "Daisy", "Truffle", "Marshmallow", "Cricket", "Boba",
];

export interface Worker {
  deskIndex: number;
  name: string;
}

/** Returns this desk's worker name, assigning a random unused cute name on first use. */
export function getOrAssignWorkerName(db: DatabaseSync, deskIndex: number): string {
  const existing = db.prepare(`SELECT name FROM workers WHERE deskIndex = ?`).get(deskIndex) as
    | { name: string }
    | undefined;
  if (existing) return existing.name;

  const taken = new Set(
    (db.prepare(`SELECT name FROM workers`).all() as { name: string }[]).map((row) => row.name)
  );
  const available = CUTE_NAMES.filter((name) => !taken.has(name));
  const pool = available.length > 0 ? available : CUTE_NAMES;
  const name = pool[Math.floor(Math.random() * pool.length)];

  db.prepare(`INSERT INTO workers (deskIndex, name) VALUES (?, ?)`).run(deskIndex, name);
  return name;
}

/** Lists the `count` workers (desk 0..count-1), assigning names to any not seen before. */
export function listWorkers(db: DatabaseSync, count: number): Worker[] {
  const workers: Worker[] = [];
  for (let deskIndex = 0; deskIndex < count; deskIndex++) {
    workers.push({ deskIndex, name: getOrAssignWorkerName(db, deskIndex) });
  }
  return workers;
}
