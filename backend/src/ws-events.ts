import type { TranscriptEntry } from "./transcripts.js";
import type { TaskStatus } from "./tasks.js";

export type WsEvent =
  | { type: "transcript"; entry: TranscriptEntry }
  | { type: "status"; status: TaskStatus; pendingQuestion?: string | null }
  | { type: "pty-data"; data: string };

export type Broadcast = (taskId: string, event: WsEvent) => void;
