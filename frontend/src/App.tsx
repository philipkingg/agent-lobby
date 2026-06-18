import { useState, useEffect } from 'react'
import './App.css'
import OfficeCanvas from './OfficeCanvas'
import { useGameState } from './useGameState'
import type { GameAgent, GameTask, Project, Squad, KnowledgeSuggestion } from './useGameState'

type Tab = 'agents' | 'tasks' | 'squads' | 'pr-wall' | 'settings' | 'audit'

const STAGE_LABELS: Record<string, string> = {
  'queued:prioritize': 'Prioritize',
  'queued:plan': 'Plan',
  'queued:implement': 'Implement',
  'queued:review': 'Review',
  'queued:merge': 'Merge',
  done: 'Done',
}

const STATUS_COLOR: Record<string, string> = {
  queued: '#90a4ae',
  running: '#4caf50',
  blocked: '#ffc107',
  awaiting_approval: '#ff9800',
  done: '#42a5f5',
  stuck: '#ef5350',
  error: '#ef5350',
  split: '#9c27b0',
}

function XpBar({ xp, level, maxXp }: { xp: number; level: number; maxXp: number }) {
  const pct = Math.min(100, Math.round((xp / maxXp) * 100))
  return (
    <div className="xp-bar-wrap">
      <span className="xp-level">Lv {level}</span>
      <div className="xp-bar">
        <div className="xp-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="xp-label">{xp}/{maxXp} XP</span>
    </div>
  )
}

function xpToNextLevel(level: number): number {
  return Math.round(100 * Math.pow(level, 1.5))
}

function AgentRow({ agent, task, squadName, onClick }: { agent: GameAgent; task: GameTask | null; squadName?: string; onClick: () => void }) {
  const stationLabel = agent.currentStation
    ? agent.currentStation.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Idle'
  return (
    <button className="agent-row" onClick={onClick} type="button">
      <span className="agent-row-name">{agent.name}</span>
      <span className="agent-row-job">{agent.jobType}</span>
      <span className="agent-row-station" style={{ color: agent.currentStation ? '#4caf50' : '#666' }}>
        {stationLabel}
      </span>
      {task && (
        <span className="agent-row-task" title={task.title}>
          {task.title.length > 24 ? task.title.slice(0, 24) + '…' : task.title}
        </span>
      )}
      {squadName && (
        <span style={{ fontSize: '0.65rem', color: '#9c27b0', background: 'rgba(156,39,176,0.12)', borderRadius: 3, padding: '1px 4px' }}>
          {squadName}
        </span>
      )}
      <span className="agent-row-level">Lv{agent.level}</span>
    </button>
  )
}

function TaskRow({ task, onClick }: { task: GameTask; onClick: () => void }) {
  const color = STATUS_COLOR[task.status] ?? '#666'
  const isEpic = task.status === 'split'
  const isChild = !!task.parentTaskId
  return (
    <button className="task-row" onClick={onClick} type="button">
      <span className="task-row-title" title={task.title}>
        {isEpic && <span style={{ color: '#9c27b0', fontSize: '0.7rem', fontWeight: 700, marginRight: '0.3rem' }}>EPIC</span>}
        {isChild && <span style={{ color: '#666', fontSize: '0.7rem', marginRight: '0.25rem' }}>↳</span>}
        {task.title.length > 28 ? task.title.slice(0, 28) + '…' : task.title}
      </span>
      <span className="task-row-stage">{isEpic ? 'Split' : (STAGE_LABELS[task.stage] ?? task.stage)}</span>
      <span className="task-row-status" style={{ color }}>{task.status}</span>
    </button>
  )
}

function HireAgentPanel({ onHired }: { onHired: () => void }) {
  const [jobType, setJobType] = useState('implementer')
  const [loading, setLoading] = useState(false)

  const hire = async () => {
    setLoading(true)
    await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobType }),
    })
    setLoading(false)
    onHired()
  }

  return (
    <div className="hire-panel">
      <select value={jobType} onChange={(e) => setJobType(e.target.value)}>
        <option value="prioritizer">Prioritizer</option>
        <option value="planner">Planner</option>
        <option value="implementer">Implementer</option>
        <option value="reviewer">Reviewer</option>
        <option value="merger">Merger</option>
      </select>
      <button className="btn-primary" onClick={hire} disabled={loading}>
        {loading ? 'Hiring…' : 'Hire Agent'}
      </button>
    </div>
  )
}

function NewTaskPanel({ projects, onCreated }: { projects: Project[]; onCreated: () => void }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectId) { setError('No project'); return }
    if (!title.trim()) { setError('Title required'); return }
    setError(null)
    setLoading(true)
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: title.trim(), description: description.trim() }),
    })
    setLoading(false)
    if (!res.ok) {
      const body = await res.json() as { error?: string }
      setError(body.error ?? 'Failed')
      return
    }
    setTitle('')
    setDescription('')
    onCreated()
  }

  return (
    <form className="new-task-panel" onSubmit={submit}>
      <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input
        type="text"
        placeholder="Task title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
      />
      {error && <p className="error">{error}</p>}
      <button className="btn-primary" type="submit" disabled={loading}>
        {loading ? 'Creating…' : 'Create Task'}
      </button>
    </form>
  )
}

// ── Transcript helpers ──────────────────────────────────────────────────────

interface TranscriptEntry { id: string; type: string; content: string; timestamp: string }

function extractText(entry: TranscriptEntry): string | null {
  try {
    const msg = JSON.parse(entry.content) as Record<string, unknown>
    if (entry.type === 'assistant') {
      const message = msg.message as { content?: Array<{ type: string; text?: string }> } | undefined
      const texts = (message?.content ?? [])
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text!)
      return texts.join('\n').trim() || null
    }
    if (entry.type === 'result') {
      const result = (msg.result as string | undefined) ?? ''
      return result.trim() || null
    }
    return null
  } catch {
    return null
  }
}

function TranscriptView({ taskId }: { taskId: string }) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([])

  useEffect(() => {
    fetch(`/api/tasks/${taskId}/transcript`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setEntries)
      .catch(() => {})
  }, [taskId])

  const lines = entries.map((e) => ({ text: extractText(e), type: e.type })).filter((l) => l.text)

  if (lines.length === 0) return <p className="dim" style={{ fontSize: '0.75rem' }}>No transcript yet.</p>

  return (
    <div className="transcript">
      {lines.map((l, i) => (
        <div key={i} className={`transcript-line transcript-${l.type}`}>
          <span className="transcript-tag">{l.type === 'result' ? 'DONE' : 'AI'}</span>
          <span className="transcript-text">{l.text}</span>
        </div>
      ))}
    </div>
  )
}

// ── Agent detail with transcript ─────────────────────────────────────────────

function parseTraits(personalityJson: string): string[] {
  try {
    const p = JSON.parse(personalityJson) as { traits?: Array<{ name: string }> }
    return p.traits?.map((t) => t.name) ?? []
  } catch {
    return []
  }
}

const LEVEL_TITLES = ['Rookie', 'Junior', 'Mid', 'Senior', 'Staff', 'Principal', 'Legend']

function AgentDetailPanel({ agent, task, onFire, onClose }: {
  agent: GameAgent
  task: GameTask | null
  onFire: () => void
  onClose: () => void
}) {
  const [showTranscript, setShowTranscript] = useState(false)
  const [firing, setFiring] = useState(false)
  const traits = parseTraits(agent.personality)
  const levelTitle = LEVEL_TITLES[Math.min(agent.level - 1, LEVEL_TITLES.length - 1)]

  const fire = async () => {
    if (!confirm(`Fire ${agent.name}?`)) return
    setFiring(true)
    await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' })
    setFiring(false)
    onFire()
    onClose()
  }

  return (
    <div className="agent-detail">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
        <div style={{ flex: 1 }}>
          <h4>{agent.name}</h4>
          <p className="dim" style={{ fontSize: '0.75rem' }}>{agent.jobType} · {levelTitle} (Lv {agent.level})</p>
        </div>
        <button
          onClick={fire}
          disabled={firing}
          style={{ fontSize: '0.7rem', color: 'var(--danger)', borderColor: 'var(--danger)', padding: '2px 8px' }}
        >
          {firing ? '…' : 'Fire'}
        </button>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>
      <XpBar xp={agent.xp} level={agent.level} maxXp={xpToNextLevel(agent.level)} />
      {traits.length > 0 && (
        <div className="trait-list">
          {traits.map((t) => <span key={t} className="trait-pill">{t}</span>)}
        </div>
      )}
      {task && (
        <div className="agent-task-info">
          <span className="dim">Working on:</span>
          <span>{task.title}</span>
          <span className="dim">{STAGE_LABELS[task.stage] ?? task.stage}</span>
        </div>
      )}
      {!task && <p className="dim" style={{ fontSize: '0.78rem' }}>Idle</p>}
      {task && (
        <button
          style={{ fontSize: '0.72rem', padding: '3px 8px', marginTop: '0.25rem' }}
          onClick={() => setShowTranscript((p) => !p)}
        >
          {showTranscript ? 'Hide' : 'Show'} transcript
        </button>
      )}
      {showTranscript && task && <TranscriptView taskId={task.id} />}
    </div>
  )
}

// ── PR Wall ───────────────────────────────────────────────────────────────────

function PrWallTab({ tasks }: { tasks: GameTask[] }) {
  const merged = tasks.filter((t) => t.status === 'done' && (t as GameTask & { prUrl?: string | null }).prUrl)
  const done = tasks.filter((t) => t.status === 'done')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {merged.length === 0 && done.length === 0 && <p className="dim">No completed tasks yet.</p>}
      {merged.length === 0 && done.length > 0 && <p className="dim">No PRs merged yet.</p>}
      {merged.map((t) => {
        const prUrl = (t as GameTask & { prUrl: string }).prUrl
        return (
          <div key={t.id} className="pr-card">
            <span className="pr-title">{t.title}</span>
            <a href={prUrl} target="_blank" rel="noopener noreferrer" className="pr-link">View PR →</a>
          </div>
        )
      })}
      {done.length > 0 && (
        <>
          <p className="list-header">All done ({done.length})</p>
          {done.map((t) => (
            <div key={t.id} className="pr-card pr-card-done">
              <span className="pr-title">{t.title}</span>
              <span className="dim" style={{ fontSize: '0.7rem' }}>{STAGE_LABELS[t.stage] ?? t.stage}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

interface TaskStage {
  id: string; taskId: string; stage: string; agentId: string; model: string
  status: string; startedAt: string; completedAt: string | null
}

function TaskDetailPanel({ task, onClose, onRefresh, onSelectTask }: {
  task: GameTask
  onClose: () => void
  onRefresh: () => void
  onSelectTask?: (id: string) => void
}) {
  const [stages, setStages] = useState<TaskStage[]>([])
  const [children, setChildren] = useState<GameTask[]>([])
  const [parentTask, setParentTask] = useState<GameTask | null>(null)
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch(`/api/tasks/${task.id}/stages`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setStages)
      .catch(() => {})
  }, [task.id, task.updatedAt])

  useEffect(() => {
    if (task.status === 'split') {
      fetch(`/api/tasks/${task.id}/children`)
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then(setChildren)
        .catch(() => {})
    }
    if (task.parentTaskId) {
      fetch(`/api/tasks/${task.parentTaskId}`)
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then(setParentTask)
        .catch(() => {})
    }
  }, [task.id, task.updatedAt, task.parentTaskId])

  const respond = async () => {
    if (!answer.trim()) return
    setLoading(true)
    await fetch(`/api/tasks/${task.id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer }),
    })
    setAnswer('')
    setLoading(false)
    onRefresh()
  }

  const approve = async () => {
    setLoading(true)
    await fetch(`/api/tasks/${task.id}/approve`, { method: 'POST' })
    setLoading(false)
    onRefresh()
  }

  const retry = async () => {
    setLoading(true)
    await fetch(`/api/tasks/${task.id}/retry`, { method: 'POST' })
    setLoading(false)
    onRefresh()
  }

  const restart = async () => {
    if (!confirm(`Restart "${task.title}" from the beginning?`)) return
    setLoading(true)
    const res = await fetch(`/api/tasks/${task.id}/restart`, { method: 'POST' })
    if (!res.ok) {
      const body = await res.json() as { error?: string }
      alert(body.error ?? 'Restart failed')
      setLoading(false)
      return
    }
    setLoading(false)
    onRefresh()
    onClose()
  }

  const deleteTask = async () => {
    if (!confirm(`Delete "${task.title}"?`)) return
    setLoading(true)
    const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
    setLoading(false)
    if (!res.ok) {
      const body = await res.json() as { error?: string }
      alert(body.error ?? 'Delete failed')
      return
    }
    onRefresh()
    onClose()
  }

  const color = STATUS_COLOR[task.status] ?? '#666'
  const isEpic = task.status === 'split'

  return (
    <div className="task-detail">
      <div className="task-detail-header">
        <span className="task-detail-title">
          {isEpic && <span style={{ color: '#9c27b0', fontSize: '0.72rem', fontWeight: 700, marginRight: '0.4rem' }}>EPIC</span>}
          {task.title}
        </span>
        <button
          onClick={deleteTask}
          disabled={loading}
          style={{ fontSize: '0.7rem', color: 'var(--danger)', borderColor: 'var(--danger)', padding: '2px 8px' }}
        >
          Delete
        </button>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>
      <div className="task-detail-meta">
        <span style={{ color }}>{task.status}</span>
        <span className="dim">{isEpic ? 'Split into subtasks' : (STAGE_LABELS[task.stage] ?? task.stage)}</span>
        <span className="dim">P{task.priority}</span>
      </div>

      {parentTask && (
        <div style={{ padding: '0.3rem 0', borderBottom: '1px solid var(--border)' }}>
          <span className="dim" style={{ fontSize: '0.72rem' }}>Part of epic: </span>
          <button
            style={{ fontSize: '0.72rem', textDecoration: 'underline', color: '#9c27b0', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            onClick={() => onSelectTask?.(parentTask.id)}
          >
            {parentTask.title}
          </button>
        </div>
      )}

      {isEpic && children.length > 0 && (
        <div style={{ marginBottom: '0.5rem' }}>
          <p className="list-header" style={{ margin: '0.4rem 0 0.25rem' }}>Subtasks ({children.length})</p>
          {children.map((child) => {
            const childColor = STATUS_COLOR[child.status] ?? '#666'
            return (
              <button
                key={child.id}
                className="task-row"
                style={{ marginBottom: '2px' }}
                onClick={() => onSelectTask?.(child.id)}
                type="button"
              >
                <span className="task-row-title" title={child.title}>
                  {child.title.length > 28 ? child.title.slice(0, 28) + '…' : child.title}
                </span>
                <span className="task-row-stage">{STAGE_LABELS[child.stage] ?? child.stage}</span>
                <span className="task-row-status" style={{ color: childColor }}>{child.status}</span>
              </button>
            )
          })}
        </div>
      )}

      {task.status === 'blocked' && task.pendingQuestion && (
        <div className="task-question-box">
          <p className="dim" style={{ margin: '0 0 0.4rem', fontSize: '0.78rem' }}>Agent asks:</p>
          <p style={{ margin: '0 0 0.6rem', fontSize: '0.84rem', color: 'var(--text-h)' }}>{task.pendingQuestion}</p>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Your answer…"
            rows={3}
            style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--sans)', lineHeight: 1.4 }}
          />
          <button className="btn-primary" onClick={respond} disabled={loading || !answer.trim()}>
            {loading ? 'Sending…' : 'Send Answer'}
          </button>
        </div>
      )}

      {task.status === 'awaiting_approval' && (
        <div className="task-action-row">
          <button className="btn-primary" onClick={approve} disabled={loading}>
            {loading ? '…' : 'Approve'}
          </button>
        </div>
      )}

      {task.status === 'stuck' && (
        <div className="task-action-row">
          <button onClick={retry} disabled={loading}>{loading ? '…' : 'Retry'}</button>
        </div>
      )}

      {task.status !== 'running' && (
        <div className="task-action-row">
          <button onClick={restart} disabled={loading} style={{ fontSize: '0.75rem' }}>
            {loading ? '…' : '↺ Restart from beginning'}
          </button>
        </div>
      )}

      {stages.length > 0 && (
        <div className="task-stages">
          <p className="list-header" style={{ margin: '0.5rem 0 0.25rem' }}>Stage History</p>
          {stages.map((s) => (
            <div key={s.id} className="stage-row">
              <span className="stage-name">{STAGE_LABELS[s.stage] ?? s.stage}</span>
              <span className={`stage-status stage-${s.status}`}>{s.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SquadsTab({ squads, agents, projects, onRefresh }: {
  squads: Squad[]
  agents: GameAgent[]
  projects: Project[]
  onRefresh: () => void
}) {
  const [newSquadName, setNewSquadName] = useState('')
  const [newSquadProjects, setNewSquadProjects] = useState<string[]>([])
  const [creating, setCreating] = useState(false)

  const createSquad = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSquadName.trim()) return
    setCreating(true)
    await fetch('/api/squads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newSquadName.trim(), projectIds: newSquadProjects }),
    })
    setNewSquadName('')
    setNewSquadProjects([])
    setCreating(false)
    onRefresh()
  }

  const deleteSquad = async (id: string, name: string) => {
    if (!confirm(`Delete squad "${name}"? Agents will be unassigned.`)) return
    await fetch(`/api/squads/${id}`, { method: 'DELETE' })
    onRefresh()
  }

  const addAgentToSquad = async (squadId: string, agentId: string) => {
    await fetch(`/api/squads/${squadId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    })
    onRefresh()
  }

  const removeAgentFromSquad = async (squadId: string, agentId: string) => {
    await fetch(`/api/squads/${squadId}/agents/${agentId}`, { method: 'DELETE' })
    onRefresh()
  }

  const toggleProject = async (squadId: string, currentIds: string[], projectId: string) => {
    const next = currentIds.includes(projectId)
      ? currentIds.filter((id) => id !== projectId)
      : [...currentIds, projectId]
    await fetch(`/api/squads/${squadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectIds: next }),
    })
    onRefresh()
  }

  return (
    <div className="squads-tab">
      <h4>Squads</h4>
      <p className="dim" style={{ fontSize: '0.72rem', marginTop: 0 }}>
        Agents in a squad only pick up tasks from that squad's projects.
      </p>

      {/* Create squad form */}
      <form onSubmit={createSquad} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '0.75rem' }}>
        <input
          type="text"
          placeholder="Squad name…"
          value={newSquadName}
          onChange={(e) => setNewSquadName(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
        {projects.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setNewSquadProjects((prev) =>
                  prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                )}
                style={{
                  fontSize: '0.7rem',
                  padding: '2px 8px',
                  borderColor: newSquadProjects.includes(p.id) ? 'var(--accent)' : undefined,
                  color: newSquadProjects.includes(p.id) ? 'var(--accent)' : undefined,
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
        <button className="btn-primary" type="submit" disabled={creating || !newSquadName.trim()}>
          {creating ? 'Creating…' : 'Create Squad'}
        </button>
      </form>

      {squads.length === 0 && <p className="dim">No squads yet.</p>}

      {squads.map((squad) => {
        const squadProjectIds: string[] = (() => { try { return JSON.parse(squad.projectIds) as string[] } catch { return [] } })()
        const squadAgents = agents.filter((a) => a.squadId === squad.id)
        const unassignedAgents = agents.filter((a) => !a.squadId || a.squadId !== squad.id)

        return (
          <div key={squad.id} className="squad-card">
            <div className="squad-card-header">
              <span className="squad-name">{squad.name}</span>
              <button
                onClick={() => void deleteSquad(squad.id, squad.name)}
                style={{ fontSize: '0.65rem', color: 'var(--danger)', borderColor: 'var(--danger)', padding: '1px 6px' }}
              >
                ×
              </button>
            </div>

            {/* Projects */}
            <div style={{ marginBottom: '0.35rem' }}>
              <span className="dim" style={{ fontSize: '0.7rem' }}>Projects: </span>
              {squadProjectIds.length === 0 && <span className="dim" style={{ fontSize: '0.7rem' }}>all</span>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem', marginTop: '0.2rem' }}>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void toggleProject(squad.id, squadProjectIds, p.id)}
                    style={{
                      fontSize: '0.65rem',
                      padding: '1px 6px',
                      borderColor: squadProjectIds.includes(p.id) ? 'var(--accent)' : undefined,
                      color: squadProjectIds.includes(p.id) ? 'var(--accent)' : 'var(--text-dim)',
                    }}
                  >
                    {squadProjectIds.includes(p.id) ? '✓ ' : ''}{p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Agents */}
            <div>
              <span className="dim" style={{ fontSize: '0.7rem' }}>Agents: </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem', marginTop: '0.2rem' }}>
                {squadAgents.map((a) => (
                  <span key={a.id} className="squad-agent-pill">
                    {a.name}
                    <button
                      onClick={() => void removeAgentFromSquad(squad.id, a.id)}
                      style={{ marginLeft: '4px', fontSize: '0.65rem', color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {unassignedAgents.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) void addAgentToSquad(squad.id, e.target.value) }}
                    style={{ fontSize: '0.65rem', padding: '1px 4px', borderRadius: 3 }}
                  >
                    <option value="">+ Add agent</option>
                    {unassignedAgents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} ({a.jobType})</option>
                    ))}
                  </select>
                )}
                {squadAgents.length === 0 && unassignedAgents.length === 0 && (
                  <span className="dim" style={{ fontSize: '0.7rem' }}>No agents hired</span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SettingsTab({ onRefresh, zoomSensitivity, onZoomSensitivity, projects }: {
  onRefresh: () => void
  zoomSensitivity: number
  onZoomSensitivity: (v: number) => void
  projects: Project[]
}) {
  const [loading, setLoading] = useState(false)
  const [projectPath, setProjectPath] = useState('')
  const [projectError, setProjectError] = useState<string | null>(null)
  const [addingProject, setAddingProject] = useState(false)

  const addProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectPath.trim()) return
    setProjectError(null)
    setAddingProject(true)
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'path', value: projectPath.trim() }),
    })
    setAddingProject(false)
    if (!res.ok) {
      const body = await res.json() as { error?: string }
      setProjectError(body.error ?? 'Failed to add project')
      return
    }
    setProjectPath('')
    onRefresh()
  }

  const deleteProject = async (id: string, name: string) => {
    if (!confirm(`Remove project "${name}"?`)) return
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    onRefresh()
  }

  const triggerIngest = async () => {
    setLoading(true)
    await fetch('/api/cron/ingest-issues', { method: 'POST' })
    setLoading(false)
    onRefresh()
  }

  const triggerPoll = async () => {
    setLoading(true)
    await fetch('/api/cron/poll-prs', { method: 'POST' })
    setLoading(false)
    onRefresh()
  }

  const startScheduler = () => fetch('/api/scheduler/start', { method: 'POST' }).then(onRefresh)
  const stopScheduler = () => fetch('/api/scheduler/stop', { method: 'POST' }).then(onRefresh)

  return (
    <div className="settings-tab">
      <h4>Projects</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {projects.map((p) => (
          <div key={p.id} className="project-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="project-name">{p.name}</span>
              <span className="project-path dim">{p.path}</span>
            </div>
            <button
              onClick={() => void deleteProject(p.id, p.name)}
              style={{ fontSize: '0.7rem', color: 'var(--danger)', borderColor: 'var(--danger)', padding: '1px 6px', flexShrink: 0 }}
            >
              ×
            </button>
          </div>
        ))}
        {projects.length === 0 && <p className="dim">No projects added.</p>}
      </div>
      <form onSubmit={addProject} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.25rem' }}>
        <input
          type="text"
          placeholder="/path/to/git/repo"
          value={projectPath}
          onChange={(e) => setProjectPath(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--mono)', fontSize: '0.78rem' }}
        />
        {projectError && <p className="error">{projectError}</p>}
        <button className="btn-primary" type="submit" disabled={addingProject || !projectPath.trim()}>
          {addingProject ? 'Adding…' : 'Add Project'}
        </button>
      </form>

      <h4>Canvas</h4>
      <div className="settings-row" style={{ flexDirection: 'column', gap: '0.25rem' }}>
        <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          Zoom sensitivity — {Math.round(zoomSensitivity * 100)}%
        </label>
        <input
          type="range" min="0.01" max="0.4" step="0.01"
          value={zoomSensitivity}
          onChange={(e) => onZoomSensitivity(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--accent)' }}
        />
      </div>
      <h4>Scheduler</h4>
      <div className="settings-row">
        <button onClick={startScheduler}>Start</button>
        <button onClick={stopScheduler}>Stop</button>
      </div>
      <h4>GitHub Cron</h4>
      <div className="settings-row">
        <button onClick={triggerIngest} disabled={loading}>Ingest Issues</button>
        <button onClick={triggerPoll} disabled={loading}>Poll PRs</button>
      </div>
    </div>
  )
}

// ── Audit Tab ─────────────────────────────────────────────────────────────────

const AGENT_TYPE_COLOR: Record<string, string> = {
  prioritizer: '#607d8b',
  planner: '#7b1fa2',
  implementer: '#1976d2',
  reviewer: '#388e3c',
  merger: '#f57c00',
}

function AuditTab({ suggestions, onRefresh }: { suggestions: KnowledgeSuggestion[]; onRefresh: () => void }) {
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [resolving, setResolving] = useState<string | null>(null)

  const pending = suggestions.filter((s) => s.status === 'pending')
  const resolved = suggestions.filter((s) => s.status !== 'pending')

  const runAudit = async () => {
    setRunning(true)
    setRunError(null)
    const res = await fetch('/api/audit/run', { method: 'POST' })
    setRunning(false)
    if (!res.ok) {
      const body = await res.json() as { error?: string }
      setRunError(body.error ?? 'Failed to start audit')
    }
  }

  const resolve = async (id: string, action: 'approve' | 'reject') => {
    setResolving(id)
    await fetch(`/api/audit/suggestions/${id}/${action}`, { method: 'POST' })
    setResolving(null)
    onRefresh()
  }

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const renderSuggestion = (s: KnowledgeSuggestion, isPending: boolean) => {
    const typeColor = AGENT_TYPE_COLOR[s.agentType] ?? '#666'
    const isExpanded = expanded.has(s.id)
    return (
      <div key={s.id} className="audit-suggestion">
        <div className="audit-suggestion-header">
          <span className="audit-type-badge" style={{ background: typeColor + '22', color: typeColor, border: `1px solid ${typeColor}44` }}>
            {s.agentType}
          </span>
          <span className="audit-rationale">{s.rationale}</span>
          <button
            style={{ fontSize: '0.65rem', padding: '1px 6px', flexShrink: 0 }}
            onClick={() => toggleExpand(s.id)}
          >
            {isExpanded ? 'Hide' : 'View'}
          </button>
        </div>
        {isExpanded && (
          <pre className="audit-content-preview">{s.proposedContent}</pre>
        )}
        {isPending && (
          <div className="audit-actions">
            <button
              className="btn-primary"
              style={{ fontSize: '0.72rem', padding: '3px 10px' }}
              onClick={() => void resolve(s.id, 'approve')}
              disabled={resolving === s.id}
            >
              {resolving === s.id ? '…' : 'Approve & Apply'}
            </button>
            <button
              style={{ fontSize: '0.72rem', padding: '3px 10px', color: 'var(--danger)', borderColor: 'var(--danger)' }}
              onClick={() => void resolve(s.id, 'reject')}
              disabled={resolving === s.id}
            >
              Reject
            </button>
          </div>
        )}
        {!isPending && (
          <div style={{ fontSize: '0.68rem', color: s.status === 'approved' ? '#4caf50' : '#90a4ae', marginTop: '0.25rem' }}>
            {s.status === 'approved' ? '✓ Applied' : '✗ Rejected'}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="audit-tab">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <h4 style={{ margin: 0 }}>Agent Auditor</h4>
        <button
          className="btn-primary"
          style={{ fontSize: '0.72rem', padding: '3px 10px' }}
          onClick={() => void runAudit()}
          disabled={running}
        >
          {running ? 'Running audit…' : 'Run Audit'}
        </button>
      </div>
      <p className="dim" style={{ fontSize: '0.72rem', marginTop: 0, marginBottom: '0.5rem' }}>
        Auditor reviews agent performance and proposes improvements to knowledge files.
        Hire an "auditor" agent before running.
      </p>
      {runError && <p className="error">{runError}</p>}
      {running && <p className="dim" style={{ fontSize: '0.75rem' }}>Audit in progress — agent is analysing performance data…</p>}

      {pending.length > 0 && (
        <>
          <p className="list-header">Pending Suggestions ({pending.length})</p>
          {pending.map((s) => renderSuggestion(s, true))}
        </>
      )}

      {pending.length === 0 && !running && (
        <p className="dim" style={{ fontSize: '0.78rem' }}>No pending suggestions. Run an audit to generate recommendations.</p>
      )}

      {resolved.length > 0 && (
        <>
          <p className="list-header" style={{ marginTop: '0.75rem' }}>Resolved ({resolved.length})</p>
          {resolved.map((s) => renderSuggestion(s, false))}
        </>
      )}
    </div>
  )
}

export default function App() {
  const { agents, tasks, userProfile, projects, squads, suggestions, refetchAgents, refetchTasks, refetchSquads, refetchSuggestions, refetchAll } = useGameState()
  const [tab, setTab] = useState<Tab>('agents')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [zoomSensitivity, setZoomSensitivity] = useState(0.08)

  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const squadById = new Map(squads.map((s) => [s.id, s]))
  const selectedAgent = selectedAgentId ? agents.find((a) => a.id === selectedAgentId) : null
  const selectedTask = selectedAgent?.currentTaskId ? taskById.get(selectedAgent.currentTaskId) : null
  const selectedTaskDetail = selectedTaskId ? taskById.get(selectedTaskId) : null
  const maxXp = userProfile?.xpToNext ?? xpToNextLevel(userProfile?.level ?? 1)

  const activeTasks = tasks.filter((t) => t.status !== 'done')
  const doneTasks = tasks.filter((t) => t.status === 'done')

  return (
    <div className="app-shell">
      {/* Top HUD */}
      <header className="top-hud">
        <div className="hud-title">Agent Office</div>
        {userProfile && (
          <XpBar xp={userProfile.xp} level={userProfile.level} maxXp={maxXp} />
        )}
        <div className="hud-stats">
          <span className="hud-stat">{agents.length} agents</span>
          <span className="hud-stat">{activeTasks.length} active tasks</span>
        </div>
      </header>

      {/* Main layout */}
      <div className="main-layout">
        <OfficeCanvas
          agents={agents}
          tasks={tasks}
          onSelectAgent={(id) => {
            setSelectedAgentId((prev) => (prev === id ? null : id))
            setTab('agents')
          }}
          zoomSensitivity={zoomSensitivity}
        />

        {/* Right panel */}
        <aside className="right-panel">
          <div className="tab-bar">
            <button className={tab === 'agents' ? 'tab active' : 'tab'} onClick={() => setTab('agents')}>Agents</button>
            <button className={tab === 'tasks' ? 'tab active' : 'tab'} onClick={() => setTab('tasks')}>Tasks</button>
            <button className={tab === 'squads' ? 'tab active' : 'tab'} onClick={() => setTab('squads')}>Squads</button>
            <button className={tab === 'pr-wall' ? 'tab active' : 'tab'} onClick={() => setTab('pr-wall')}>PRs</button>
            <button className={tab === 'audit' ? 'tab active' : 'tab'} onClick={() => setTab('audit')}>Audit</button>
            <button className={tab === 'settings' ? 'tab active' : 'tab'} onClick={() => setTab('settings')}>⚙</button>
          </div>

          <div className="tab-content">
            {tab === 'agents' && (
              <div className="agents-tab">
                <HireAgentPanel onHired={refetchAgents} />
                <div className="agent-list">
                  {agents.length === 0 && <p className="dim">No agents hired yet.</p>}
                  {agents.map((agent) => (
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      task={agent.currentTaskId ? (taskById.get(agent.currentTaskId) ?? null) : null}
                      squadName={agent.squadId ? squadById.get(agent.squadId)?.name : undefined}
                      onClick={() => setSelectedAgentId((prev) => (prev === agent.id ? null : agent.id))}
                    />
                  ))}
                </div>

                {selectedAgent && (
                  <AgentDetailPanel
                    agent={selectedAgent}
                    task={selectedTask ?? null}
                    onFire={refetchAgents}
                    onClose={() => setSelectedAgentId(null)}
                  />
                )}
              </div>
            )}

            {tab === 'tasks' && (
              <div className="tasks-tab">
                {selectedTaskDetail ? (
                  <TaskDetailPanel
                    task={selectedTaskDetail}
                    onClose={() => setSelectedTaskId(null)}
                    onRefresh={refetchTasks}
                    onSelectTask={(id) => setSelectedTaskId(id)}
                  />
                ) : (
                  <>
                    <NewTaskPanel projects={projects} onCreated={refetchTasks} />
                    <div className="task-list">
                      <p className="list-header">Active ({activeTasks.length})</p>
                      {activeTasks.map((t) => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          onClick={() => { setSelectedTaskId(t.id); }}
                        />
                      ))}
                      {doneTasks.length > 0 && (
                        <>
                          <p className="list-header">Done ({doneTasks.length})</p>
                          {doneTasks.slice(0, 10).map((t) => (
                            <TaskRow
                              key={t.id}
                              task={t}
                              onClick={() => { setSelectedTaskId(t.id); }}
                            />
                          ))}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'squads' && <SquadsTab squads={squads} agents={agents} projects={projects} onRefresh={refetchSquads} />}

            {tab === 'pr-wall' && <PrWallTab tasks={tasks} />}

            {tab === 'audit' && <AuditTab suggestions={suggestions} onRefresh={refetchSuggestions} />}

            {tab === 'settings' && <SettingsTab onRefresh={refetchAll} zoomSensitivity={zoomSensitivity} onZoomSensitivity={setZoomSensitivity} projects={projects} />}
          </div>
        </aside>
      </div>
    </div>
  )
}
