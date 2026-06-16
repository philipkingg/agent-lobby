import type { TranscriptEntry } from "./transcripts.js";
import type { TaskStatus, TaskStage } from "./tasks.js";

export type WsEvent =
  | { type: "transcript"; entry: TranscriptEntry }
  | { type: "status"; status: TaskStatus; stage?: TaskStage; pendingQuestion?: string | null }
  | { type: "pty-data"; data: string }
  | { type: "agent:update"; agentId: string; station: string | null; taskId: string | null }
  | { type: "agent:walk"; agentId: string; x: number; y: number; direction: "left" | "right" }
  | { type: "agent:arrived"; agentId: string; station: string }
  | { type: "agent:xp"; agentId: string; xp: number; level: number; leveledUp: boolean }
  | { type: "user:xp"; xp: number; level: number; xpToNext: number; leveledUp: boolean }
  | { type: "task:gate"; taskId: string; stage: TaskStage }
  | { type: "task:stuck"; taskId: string; reviewLoopCount: number };

export type Broadcast = (channel: string, event: WsEvent) => void;
