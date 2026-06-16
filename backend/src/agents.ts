import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type JobType = "prioritizer" | "planner" | "implementer" | "reviewer" | "merger";
export type Avatar = "Adam" | "Alex" | "Amelia" | "Bob";

export interface Trait {
  name: string;
  promptSnippet: string;
  modifiers: Record<string, unknown>;
  restDeltaSeconds: number;
}

export interface Personality {
  traits: Trait[];
  restSeconds: number;
}

export interface Agent {
  id: string;
  name: string;
  jobType: JobType;
  model: string;
  level: number;
  xp: number;
  avatar: Avatar;
  personality: string; // JSON Personality
  currentStation: string | null;
  currentTaskId: string | null;
  squadId: string | null;
  hiredAt: string;
  firedAt: string | null;
}

export interface HireAgentInput {
  jobType: JobType;
  model?: string;
}

const JOB_MODELS: Record<JobType, string> = {
  prioritizer: "claude-haiku-4-5-20251001",
  planner: "claude-opus-4-8",
  implementer: "claude-sonnet-4-6",
  reviewer: "claude-sonnet-4-6",
  merger: "claude-haiku-4-5-20251001",
};

const AVATARS: Avatar[] = ["Adam", "Alex", "Amelia", "Bob"];

const TRAIT_POOL: Trait[] = [
  {
    name: "cautious",
    promptSnippet: "Always add comprehensive tests. Verify edge cases before finishing.",
    modifiers: { testCoverage: "high" },
    restDeltaSeconds: 10,
  },
  {
    name: "swift",
    promptSnippet: "Work efficiently. Prioritize speed without sacrificing correctness.",
    modifiers: { pace: "fast" },
    restDeltaSeconds: -15,
  },
  {
    name: "thorough",
    promptSnippet: "Be thorough. Document your reasoning and leave no stone unturned.",
    modifiers: { verbosity: "high" },
    restDeltaSeconds: 20,
  },
  {
    name: "social",
    promptSnippet: "Write helpful PR comments and clear commit messages for your teammates.",
    modifiers: { prComments: "verbose" },
    restDeltaSeconds: 5,
  },
  {
    name: "workaholic",
    promptSnippet: "Stay intensely focused. Get it done.",
    modifiers: { focus: "max" },
    restDeltaSeconds: -20,
  },
  {
    name: "relaxed",
    promptSnippet: "Take your time. Make sure everything is right before moving on.",
    modifiers: { pace: "steady" },
    restDeltaSeconds: 30,
  },
  {
    name: "methodical",
    promptSnippet: "Plan before acting. Follow a systematic, step-by-step approach.",
    modifiers: { planFirst: true },
    restDeltaSeconds: 5,
  },
  {
    name: "creative",
    promptSnippet: "Think creatively. Consider non-obvious solutions.",
    modifiers: { creativity: "high" },
    restDeltaSeconds: 0,
  },
  {
    name: "perfectionist",
    promptSnippet: "Aim for clean, well-structured code. Refactor if needed to maintain quality.",
    modifiers: { refactor: true },
    restDeltaSeconds: 25,
  },
  {
    name: "pragmatic",
    promptSnippet: "Focus on what works. Ship working software.",
    modifiers: { pragmatic: true },
    restDeltaSeconds: -10,
  },
  {
    name: "defensive",
    promptSnippet: "Add input validation and robust error handling throughout.",
    modifiers: { errorHandling: "strict" },
    restDeltaSeconds: 15,
  },
  {
    name: "curious",
    promptSnippet: "Explore the codebase first. Understand context before making changes.",
    modifiers: { explore: true },
    restDeltaSeconds: 10,
  },
  {
    name: "focused",
    promptSnippet: "Stick strictly to the task scope. Do not touch unrelated code.",
    modifiers: { scope: "narrow" },
    restDeltaSeconds: -5,
  },
  {
    name: "collaborative",
    promptSnippet: "Consider impact on teammates. Keep changes backward-compatible where possible.",
    modifiers: { compat: true },
    restDeltaSeconds: 5,
  },
  {
    name: "detail-oriented",
    promptSnippet: "Pay close attention to naming, formatting, and consistency with existing code.",
    modifiers: { formatting: true },
    restDeltaSeconds: 10,
  },
  {
    name: "bold",
    promptSnippet:
      "Make decisive changes. If something needs refactoring to complete the task correctly, do it.",
    modifiers: { boldChanges: true },
    restDeltaSeconds: -10,
  },
  {
    name: "nocturnal",
    promptSnippet: "Does best work in long uninterrupted sessions.",
    modifiers: { sessionLength: "long" },
    restDeltaSeconds: -15,
  },
  {
    name: "verbose",
    promptSnippet: "Explain what you are doing as you go. Leave a clear trail.",
    modifiers: { logging: "high" },
    restDeltaSeconds: 5,
  },
  {
    name: "optimistic",
    promptSnippet: "Trust the system. Focus on the happy path and handle errors simply.",
    modifiers: { errorHandling: "minimal" },
    restDeltaSeconds: -10,
  },
  {
    name: "patient",
    promptSnippet: "Take time to fully understand the problem before writing any code.",
    modifiers: { analysis: "deep" },
    restDeltaSeconds: 15,
  },
];

const NAME_PREFIXES = [
  "Swift", "Steady", "Bold", "Sharp", "Keen", "Bright", "Quick", "Calm", "Deep", "Wise",
  "Iron", "Silver", "Golden", "Silent", "Clever", "Nimble", "Eager", "Fierce", "Cool", "Witty",
];
const NAME_SUFFIXES = [
  "Hawk", "Fox", "Oak", "River", "Stone", "Byte", "Stack", "Branch", "Merge", "Loop",
  "Node", "Gate", "Patch", "Fork", "Shift", "Query", "Cache", "Pipe", "Hook", "Fiber",
];

const BASE_REST_SECONDS = 60;

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickUniqueTraits(count: number): Trait[] {
  const shuffled = [...TRAIT_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export function generatePersonality(): Personality {
  const traitCount = 3 + Math.floor(Math.random() * 3); // 3-5 traits
  const traits = pickUniqueTraits(traitCount);
  const restDelta = traits.reduce((sum, t) => sum + t.restDeltaSeconds, 0);
  const restSeconds = Math.max(10, BASE_REST_SECONDS + restDelta);
  return { traits, restSeconds };
}

export function generateName(existingNames: string[]): string {
  const maxAttempts = 40;
  for (let i = 0; i < maxAttempts; i++) {
    const name = `${pickRandom(NAME_PREFIXES)} ${pickRandom(NAME_SUFFIXES)}`;
    if (!existingNames.includes(name)) return name;
  }
  // Fallback with UUID suffix
  return `${pickRandom(NAME_PREFIXES)} ${pickRandom(NAME_SUFFIXES)}-${randomUUID().slice(0, 4)}`;
}

export function hireAgent(db: DatabaseSync, input: HireAgentInput): Agent {
  const existing = listAgents(db).map((a) => a.name);
  const name = generateName(existing);
  const personality = generatePersonality();
  const avatar = pickRandom(AVATARS);
  const model = input.model ?? JOB_MODELS[input.jobType];
  const now = new Date().toISOString();

  const agent: Agent = {
    id: randomUUID(),
    name,
    jobType: input.jobType,
    model,
    level: 1,
    xp: 0,
    avatar,
    personality: JSON.stringify(personality),
    currentStation: null,
    currentTaskId: null,
    squadId: null,
    hiredAt: now,
    firedAt: null,
  };

  db.prepare(
    `INSERT INTO agents (id, name, jobType, model, level, xp, avatar, personality, currentStation, currentTaskId, squadId, hiredAt, firedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    agent.id,
    agent.name,
    agent.jobType,
    agent.model,
    agent.level,
    agent.xp,
    agent.avatar,
    agent.personality,
    agent.currentStation,
    agent.currentTaskId,
    agent.squadId,
    agent.hiredAt,
    agent.firedAt
  );

  return agent;
}

export function fireAgent(db: DatabaseSync, id: string): boolean {
  const agent = getAgent(db, id);
  if (!agent || agent.firedAt) return false;

  const now = new Date().toISOString();
  db.prepare(`UPDATE agents SET firedAt = ? WHERE id = ?`).run(now, id);

  // Stuck any in-progress task this agent owns
  if (agent.currentTaskId) {
    db.prepare(
      `UPDATE tasks SET status = 'stuck', updatedAt = ? WHERE id = ? AND status NOT IN ('done','error','stuck')`
    ).run(now, agent.currentTaskId);
    db.prepare(`UPDATE agents SET currentTaskId = NULL WHERE id = ?`).run(id);
  }

  db.prepare(`UPDATE agents SET firedAt = ? WHERE id = ?`).run(now, id);
  return true;
}

export function listAgents(db: DatabaseSync): Agent[] {
  return db.prepare(`SELECT * FROM agents WHERE firedAt IS NULL ORDER BY hiredAt ASC`).all() as Agent[];
}

export function getAgent(db: DatabaseSync, id: string): Agent | undefined {
  return db.prepare(`SELECT * FROM agents WHERE id = ?`).get(id) as Agent | undefined;
}

export function updateAgentStation(db: DatabaseSync, agentId: string, station: string | null): void {
  db.prepare(`UPDATE agents SET currentStation = ? WHERE id = ?`).run(station, agentId);
}

export function assignAgentTask(db: DatabaseSync, agentId: string, taskId: string | null): void {
  db.prepare(`UPDATE agents SET currentTaskId = ? WHERE id = ?`).run(taskId, agentId);
}

export function addAgentXp(db: DatabaseSync, agentId: string, amount: number): Agent {
  db.prepare(`UPDATE agents SET xp = xp + ? WHERE id = ?`).run(amount, agentId);
  const agent = getAgent(db, agentId)!;

  // Level threshold: 100 * level^1.5
  const xpToNext = Math.floor(100 * Math.pow(agent.level, 1.5));
  if (agent.xp >= xpToNext) {
    db.prepare(`UPDATE agents SET level = level + 1 WHERE id = ?`).run(agentId);
  }

  return getAgent(db, agentId)!;
}

export function getTraitPool(): Trait[] {
  return TRAIT_POOL;
}

export function parsePersonality(agent: Agent): Personality {
  return JSON.parse(agent.personality) as Personality;
}

export function buildPersonalityPrompt(personality: Personality): string {
  if (personality.traits.length === 0) return "";
  const snippets = personality.traits.map((t) => t.promptSnippet).join(" ");
  return `\n\nPersonality traits: ${snippets}`;
}
