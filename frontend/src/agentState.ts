export type AgentState = 'idle' | 'working' | 'error' | 'done'
export type Badge = 'question' | 'error' | null
export type Animation = 'none' | 'bob' | 'pulse' | 'slack'

export interface AgentVisual {
  state: AgentState
  color: number
  badge: Badge
  animation: Animation
}

const VISUALS: Record<string, AgentVisual> = {
  queued: { state: 'idle', color: 0x90a4ae, badge: null, animation: 'none' },
  running: { state: 'working', color: 0x4caf50, badge: null, animation: 'bob' },
  blocked: { state: 'working', color: 0x4caf50, badge: 'question', animation: 'pulse' },
  done: { state: 'done', color: 0x42a5f5, badge: null, animation: 'slack' },
  stopped: { state: 'done', color: 0x90a4ae, badge: null, animation: 'none' },
  error: { state: 'error', color: 0xe53935, badge: 'error', animation: 'pulse' },
  failed: { state: 'error', color: 0xe53935, badge: 'error', animation: 'pulse' },
}

const DEFAULT_VISUAL: AgentVisual = { state: 'idle', color: 0x90a4ae, badge: null, animation: 'none' }

export function agentVisual(status: string): AgentVisual {
  return VISUALS[status] ?? DEFAULT_VISUAL
}

// Deterministic color for a project's desk accent stripe, derived from its id.
const PROJECT_COLORS = [0xef5350, 0xab47bc, 0x5c6bc0, 0x29b6f6, 0x66bb6a, 0xffa726, 0x8d6e63]

export function projectColor(projectId: string): number {
  let hash = 0
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) | 0
  }
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length]
}
