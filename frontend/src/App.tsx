import { useState } from 'react'
import './App.css'
import OfficeCanvas from './OfficeCanvas'
import { useGameState } from './useGameState'
import type { GameAgent, GameTask, Project } from './useGameState'

type Tab = 'agents' | 'tasks' | 'settings'

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

function AgentRow({ agent, task, onClick }: { agent: GameAgent; task: GameTask | null; onClick: () => void }) {
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
      <span className="agent-row-level">Lv{agent.level}</span>
    </button>
  )
}

function TaskRow({ task, onClick }: { task: GameTask; onClick: () => void }) {
  const color = STATUS_COLOR[task.status] ?? '#666'
  return (
    <button className="task-row" onClick={onClick} type="button">
      <span className="task-row-title" title={task.title}>
        {task.title.length > 30 ? task.title.slice(0, 30) + '…' : task.title}
      </span>
      <span className="task-row-stage">{STAGE_LABELS[task.stage] ?? task.stage}</span>
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

function SettingsTab({ onRefresh }: { onRefresh: () => void }) {
  const [loading, setLoading] = useState(false)

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

export default function App() {
  const { agents, tasks, userProfile, projects, refetchAgents, refetchTasks, refetchAll } = useGameState()
  const [tab, setTab] = useState<Tab>('agents')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)

  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const selectedAgent = selectedAgentId ? agents.find((a) => a.id === selectedAgentId) : null
  const selectedTask = selectedAgent?.currentTaskId ? taskById.get(selectedAgent.currentTaskId) : null
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
        {/* Canvas */}
        <div className="canvas-wrap">
          <OfficeCanvas
            agents={agents}
            tasks={tasks}
            onSelectAgent={(id) => {
              setSelectedAgentId((prev) => (prev === id ? null : id))
              setTab('agents')
            }}
          />
        </div>

        {/* Right panel */}
        <aside className="right-panel">
          <div className="tab-bar">
            <button className={tab === 'agents' ? 'tab active' : 'tab'} onClick={() => setTab('agents')}>Agents</button>
            <button className={tab === 'tasks' ? 'tab active' : 'tab'} onClick={() => setTab('tasks')}>Tasks</button>
            <button className={tab === 'settings' ? 'tab active' : 'tab'} onClick={() => setTab('settings')}>Settings</button>
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
                      onClick={() => setSelectedAgentId((prev) => (prev === agent.id ? null : agent.id))}
                    />
                  ))}
                </div>

                {selectedAgent && (
                  <div className="agent-detail">
                    <h4>{selectedAgent.name}</h4>
                    <p className="dim">{selectedAgent.jobType} · Level {selectedAgent.level}</p>
                    <XpBar
                      xp={selectedAgent.xp}
                      level={selectedAgent.level}
                      maxXp={xpToNextLevel(selectedAgent.level)}
                    />
                    {selectedTask && (
                      <div className="agent-task-info">
                        <span className="dim">Working on:</span>
                        <span>{selectedTask.title}</span>
                        <span className="dim">{STAGE_LABELS[selectedTask.stage] ?? selectedTask.stage}</span>
                      </div>
                    )}
                    {selectedAgent.currentStation === null && <p className="dim">Idle in relaxation area</p>}
                  </div>
                )}
              </div>
            )}

            {tab === 'tasks' && (
              <div className="tasks-tab">
                <NewTaskPanel projects={projects} onCreated={refetchTasks} />
                <div className="task-list">
                  <p className="list-header">Active ({activeTasks.length})</p>
                  {activeTasks.map((t) => (
                    <TaskRow key={t.id} task={t} onClick={() => {}} />
                  ))}
                  {doneTasks.length > 0 && (
                    <>
                      <p className="list-header">Done ({doneTasks.length})</p>
                      {doneTasks.slice(0, 10).map((t) => (
                        <TaskRow key={t.id} task={t} onClick={() => {}} />
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}

            {tab === 'settings' && <SettingsTab onRefresh={refetchAll} />}
          </div>
        </aside>
      </div>
    </div>
  )
}
