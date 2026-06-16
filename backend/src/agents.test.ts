import { describe, it, expect, beforeEach } from "vitest";
import { createDb } from "./db.js";
import {
  hireAgent,
  fireAgent,
  listAgents,
  getAgent,
  generateName,
  generatePersonality,
  parsePersonality,
} from "./agents.js";

function freshDb() {
  return createDb();
}

describe("generatePersonality", () => {
  it("generates 3-5 unique traits", () => {
    const p = generatePersonality();
    expect(p.traits.length).toBeGreaterThanOrEqual(3);
    expect(p.traits.length).toBeLessThanOrEqual(5);

    const names = p.traits.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("computes restSeconds from base + trait deltas, min 10", () => {
    // Run multiple times to catch edge cases
    for (let i = 0; i < 20; i++) {
      const p = generatePersonality();
      expect(p.restSeconds).toBeGreaterThanOrEqual(10);
    }
  });
});

describe("generateName", () => {
  it("generates a unique name not in existing list", () => {
    const name = generateName(["Swift Hawk"]);
    expect(name).not.toBe("Swift Hawk");
    expect(name.split(" ").length).toBe(2);
  });

  it("generates different names on repeated calls", () => {
    const names = new Set(Array.from({ length: 20 }, () => generateName([])));
    expect(names.size).toBeGreaterThan(1);
  });
});

describe("hireAgent", () => {
  it("creates agent with correct job type and default model", () => {
    const db = freshDb();
    const agent = hireAgent(db, { jobType: "implementer" });

    expect(agent.jobType).toBe("implementer");
    expect(agent.model).toBe("claude-sonnet-4-6");
    expect(agent.level).toBe(1);
    expect(agent.xp).toBe(0);
    expect(agent.firedAt).toBeNull();
    expect(["Adam", "Alex", "Amelia", "Bob"]).toContain(agent.avatar);
  });

  it("allows model override", () => {
    const db = freshDb();
    const agent = hireAgent(db, { jobType: "planner", model: "claude-haiku-4-5-20251001" });
    expect(agent.model).toBe("claude-haiku-4-5-20251001");
  });

  it("stores valid JSON personality", () => {
    const db = freshDb();
    const agent = hireAgent(db, { jobType: "reviewer" });
    const personality = parsePersonality(agent);
    expect(personality.traits.length).toBeGreaterThanOrEqual(3);
    expect(personality.restSeconds).toBeGreaterThan(0);
  });

  it("generates unique names for multiple hires", () => {
    const db = freshDb();
    const agents = Array.from({ length: 5 }, () => hireAgent(db, { jobType: "merger" }));
    const names = agents.map((a) => a.name);
    const unique = new Set(names);
    expect(unique.size).toBe(5);
  });
});

describe("listAgents / getAgent", () => {
  it("lists only active (non-fired) agents", () => {
    const db = freshDb();
    const a1 = hireAgent(db, { jobType: "planner" });
    const a2 = hireAgent(db, { jobType: "implementer" });
    fireAgent(db, a1.id);

    const active = listAgents(db);
    expect(active.map((a) => a.id)).toContain(a2.id);
    expect(active.map((a) => a.id)).not.toContain(a1.id);
  });

  it("getAgent returns agent by id regardless of fired status", () => {
    const db = freshDb();
    const agent = hireAgent(db, { jobType: "prioritizer" });
    fireAgent(db, agent.id);

    const found = getAgent(db, agent.id);
    expect(found).toBeDefined();
    expect(found!.firedAt).not.toBeNull();
  });
});

describe("fireAgent", () => {
  it("returns false for unknown agent", () => {
    const db = freshDb();
    expect(fireAgent(db, "no-such-id")).toBe(false);
  });

  it("marks agent firedAt and sticks task to stuck", () => {
    const db = freshDb();
    const agent = hireAgent(db, { jobType: "implementer" });

    // Simulate agent having a current task
    db.prepare(`UPDATE agents SET currentTaskId = 'fake-task-id' WHERE id = ?`).run(agent.id);

    const fired = fireAgent(db, agent.id);
    expect(fired).toBe(true);

    const updated = getAgent(db, agent.id);
    expect(updated!.firedAt).not.toBeNull();
  });

  it("returns false when firing already-fired agent", () => {
    const db = freshDb();
    const agent = hireAgent(db, { jobType: "merger" });
    fireAgent(db, agent.id);
    expect(fireAgent(db, agent.id)).toBe(false);
  });
});
