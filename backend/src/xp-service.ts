import type { DatabaseSync } from "node:sqlite";
import type { TaskStage } from "./tasks.js";
import { getAgent, addAgentXp } from "./agents.js";
import type { Broadcast } from "./ws-events.js";

// Base XP per stage (multiplied by priority multiplier)
export const STAGE_XP: Partial<Record<TaskStage, number>> = {
  "queued:prioritize": 5,
  "queued:plan": 20,
  "queued:implement": 50,
  "queued:review": 30,
  "queued:merge": 15,
};

// User XP level thresholds (total XP needed for each level)
const USER_LEVEL_THRESHOLDS = [0, 100, 250, 500, 1000, 2000, 5000, 10000];

export const USER_XP_PER_MERGE = 25;

export function awardStageXp(
  db: DatabaseSync,
  agentId: string,
  stage: TaskStage,
  priority: number,
  broadcast: Broadcast
): void {
  const base = STAGE_XP[stage] ?? 0;
  if (base === 0) return;

  // priority 1 → 0.6x, priority 5 → 1.0x
  const multiplier = 0.5 + priority * 0.1;
  const amount = Math.round(base * multiplier);

  const prevAgent = getAgent(db, agentId);
  if (!prevAgent) return;

  const updatedAgent = addAgentXp(db, agentId, amount);

  broadcast("global", {
    type: "agent:xp",
    agentId,
    xp: updatedAgent.xp,
    level: updatedAgent.level,
    leveledUp: updatedAgent.level > prevAgent.level,
  });
}

export function awardUserXp(db: DatabaseSync, amount: number, broadcast: Broadcast): void {
  db.prepare(`UPDATE user_profile SET xp = xp + ? WHERE id = 1`).run(amount);
  const profile = db.prepare(`SELECT level, xp FROM user_profile WHERE id = 1`).get() as {
    level: number;
    xp: number;
  };

  const newLevel = USER_LEVEL_THRESHOLDS.filter((t) => profile.xp >= t).length;
  const xpToNext = USER_LEVEL_THRESHOLDS[newLevel] ?? null;
  const leveledUp = newLevel > profile.level;

  if (leveledUp) {
    db.prepare(`UPDATE user_profile SET level = ? WHERE id = 1`).run(newLevel);
  }

  broadcast("global", { type: "user:xp", xp: profile.xp, level: newLevel, xpToNext: xpToNext ?? 0, leveledUp });
}
