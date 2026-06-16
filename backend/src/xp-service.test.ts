import { describe, it, expect, vi } from "vitest";
import { createDb } from "./db.js";
import { hireAgent } from "./agents.js";
import { awardStageXp, awardUserXp, STAGE_XP } from "./xp-service.js";
import type { Broadcast } from "./ws-events.js";

function makeBroadcast() {
  const events: Parameters<Broadcast>[] = [];
  const broadcast: Broadcast = (ch, ev) => events.push([ch, ev]);
  return { broadcast, events };
}

describe("awardStageXp", () => {
  it("adds XP to agent and broadcasts agent:xp", () => {
    const db = createDb();
    const agent = hireAgent(db, { jobType: "implementer" });
    const { broadcast, events } = makeBroadcast();

    awardStageXp(db, agent.id, "queued:implement", 3, broadcast);

    const xpEvent = events.find(([, ev]) => ev.type === "agent:xp");
    expect(xpEvent).toBeDefined();
    const ev = xpEvent![1] as { type: "agent:xp"; agentId: string; xp: number };
    expect(ev.agentId).toBe(agent.id);
    // base=50, priority=3 → 50 * (0.5 + 0.3) = 40
    expect(ev.xp).toBeGreaterThan(0);
  });

  it("leveledUp is true when XP crosses threshold", () => {
    const db = createDb();
    // Give agent xp near level 2 threshold (100 xp needed for level 2 at level 1)
    db.prepare(`UPDATE agents SET xp = 98 WHERE id = (SELECT id FROM agents LIMIT 1)`);
    const agent = hireAgent(db, { jobType: "implementer" });
    // Force xp near threshold: level 1 needs 100 * 1^1.5 = 100 to level up
    db.prepare(`UPDATE agents SET xp = 95 WHERE id = ?`).run(agent.id);

    const { broadcast, events } = makeBroadcast();
    // implement at priority 5 → base=50, mult=1.0 → 50 XP → total=145 → level up
    awardStageXp(db, agent.id, "queued:implement", 5, broadcast);

    const xpEvent = events.find(([, ev]) => ev.type === "agent:xp")![1] as {
      leveledUp: boolean;
      level: number;
    };
    expect(xpEvent.leveledUp).toBe(true);
    expect(xpEvent.level).toBe(2);
  });

  it("no-ops for unknown stage", () => {
    const db = createDb();
    const agent = hireAgent(db, { jobType: "implementer" });
    const { events } = makeBroadcast();
    const noBroadcast: Broadcast = (ch, ev) => {};
    awardStageXp(db, agent.id, "done" as never, 3, noBroadcast);
    expect(events).toHaveLength(0);
  });

  it("STAGE_XP has entries for all active stages", () => {
    expect(STAGE_XP["queued:prioritize"]).toBeGreaterThan(0);
    expect(STAGE_XP["queued:plan"]).toBeGreaterThan(0);
    expect(STAGE_XP["queued:implement"]).toBeGreaterThan(0);
    expect(STAGE_XP["queued:review"]).toBeGreaterThan(0);
    expect(STAGE_XP["queued:merge"]).toBeGreaterThan(0);
  });
});

describe("awardUserXp", () => {
  it("adds XP to user_profile and broadcasts user:xp", () => {
    const db = createDb();
    const { broadcast, events } = makeBroadcast();

    awardUserXp(db, 50, broadcast);

    const xpEvent = events.find(([, ev]) => ev.type === "user:xp");
    expect(xpEvent).toBeDefined();
    const ev = xpEvent![1] as { type: "user:xp"; xp: number };
    expect(ev.xp).toBe(50);
  });

  it("leveledUp is true when threshold crossed", () => {
    const db = createDb();
    const { broadcast, events } = makeBroadcast();

    // First level threshold is 100 XP
    awardUserXp(db, 150, broadcast);

    const ev = events.find(([, e]) => e.type === "user:xp")![1] as {
      leveledUp: boolean;
      level: number;
    };
    expect(ev.leveledUp).toBe(true);
    expect(ev.level).toBeGreaterThan(1);
  });
});
