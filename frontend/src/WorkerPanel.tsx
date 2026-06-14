import { useState } from 'react'

interface Project {
  id: string
  name: string
}

interface Task {
  id: string
  projectId: string
  description: string
  status: string
}

interface Worker {
  deskIndex: number
  name: string
}

interface WorkerPanelProps {
  worker: Worker
  draftTasks: Task[]
  projects: Project[]
  onClose: () => void
  onAssignDraft: (taskId: string, deskIndex: number) => void
  onCreateAndAssign: (projectId: string, description: string, mode: 'sdk' | 'pty', deskIndex: number) => void
}

function projectName(projects: Project[], id: string): string {
  return projects.find((p) => p.id === id)?.name ?? id
}

/** Side panel for an idle worker desk: hand it an existing draft ticket, or
 * spin up a brand new one assigned straight to this worker. */
function WorkerPanel({ worker, draftTasks, projects, onClose, onAssignDraft, onCreateAndAssign }: WorkerPanelProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<'sdk' | 'pty'>('sdk')

  const createAndAssign = (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectId || !title.trim()) return
    onCreateAndAssign(projectId, title, mode, worker.deskIndex)
    setTitle('')
  }

  return (
    <div className="side-panel">
      <div className="side-panel-header">
        <h3>{worker.name} is free</h3>
        <button className="side-panel-close" onClick={onClose}>
          close
        </button>
      </div>
      <p className="kanban-card-meta">Desk {worker.deskIndex + 1} · waiting for a ticket</p>

      <div className="worker-panel-section">
        <h4>Assign an existing ticket</h4>
        {draftTasks.length === 0 ? (
          <p className="kanban-card-meta">No draft tickets in "New" right now.</p>
        ) : (
          <ul className="worker-panel-draft-list">
            {draftTasks.map((task) => (
              <li key={task.id} className="worker-panel-draft-item">
                <span className="worker-panel-draft-title">{task.description || '(no description)'}</span>
                <span className="kanban-card-meta">{projectName(projects, task.projectId)}</span>
                <button className="btn-primary" onClick={() => onAssignDraft(task.id, worker.deskIndex)}>
                  Assign to {worker.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="worker-panel-section">
        <h4>New ticket for {worker.name}</h4>
        <form className="ticket-form" onSubmit={createAndAssign}>
          <div className="ticket-form-row">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select value={mode} onChange={(e) => setMode(e.target.value as 'sdk' | 'pty')}>
              <option value="sdk">sdk</option>
              <option value="pty">pty</option>
            </select>
          </div>
          <input
            type="text"
            className="ticket-title-input"
            placeholder="What needs doing?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={!projectId}>
            Assign to {worker.name}
          </button>
        </form>
      </div>
    </div>
  )
}

export default WorkerPanel
