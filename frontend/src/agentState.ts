export type AgentState = 'idle' | 'working' | 'error' | 'done'
export type Badge = 'question' | 'error' | null

export interface AgentVisual {
  state: AgentState
  color: number
  badge: Badge
}

const VISUALS: Record<string, AgentVisual> = {
  queued: { state: 'idle', color: 0x90a4ae, badge: null },
  running: { state: 'working', color: 0x4caf50, badge: null },
  blocked: { state: 'working', color: 0x4caf50, badge: 'question' },
  done: { state: 'done', color: 0x42a5f5, badge: null },
  stopped: { state: 'done', color: 0x90a4ae, badge: null },
  error: { state: 'error', color: 0xe53935, badge: 'error' },
  failed: { state: 'error', color: 0xe53935, badge: 'error' },
}

const DEFAULT_VISUAL: AgentVisual = { state: 'idle', color: 0x90a4ae, badge: null }

export function agentVisual(status: string): AgentVisual {
  return VISUALS[status] ?? DEFAULT_VISUAL
}
