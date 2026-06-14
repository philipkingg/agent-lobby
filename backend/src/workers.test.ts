import { describe, it, expect } from "vitest";
import { createDb } from "./db.js";
import { getOrAssignWorkerName, listWorkers } from "./workers.js";

describe("workers", () => {
  it("assigns a cute name on first lookup and remembers it on later lookups", () => {
    const db = createDb();
    const name = getOrAssignWorkerName(db, 0);
    expect(name).toMatch(/^[A-Za-z]+$/);
    expect(getOrAssignWorkerName(db, 0)).toBe(name);
  });

  it("gives different desks different names", () => {
    const db = createDb();
    const names = new Set(listWorkers(db, 6).map((w) => w.name));
    expect(names.size).toBe(6);
  });

  it("lists exactly `count` workers indexed from 0", () => {
    const db = createDb();
    const workers = listWorkers(db, 4);
    expect(workers.map((w) => w.deskIndex)).toEqual([0, 1, 2, 3]);
  });
});
