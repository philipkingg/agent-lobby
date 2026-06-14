import { useEffect, useState } from 'react'
import './App.css'
import SidePanel from './SidePanel'
import OfficeCanvas from './OfficeCanvas'
import KanbanBoard from './KanbanBoard'
import SettingsMenu from './SettingsMenu'
import WorkerPanel from './WorkerPanel'

interface Project {
  id: string
  name: string
  path: string
  defaultBranch: string
  worktreesRoot: string
  createdAt: string
}

interface Task {
  id: string
  projectId: string
  description: string
  mode: 'sdk' | 'pty'
  status: string
  branchName: string
  worktreePath: string
  prUrl: string | null
  prError: string | null
  error: string | null
  worktreeRemoved: number
  pendingQuestion: string | null
  deskIndex: number | null
}

interface Worker {
  deskIndex: number
  name: string
}

const ACTIVE_STATUSES = ['queued', 'running', 'blocked']

function App() {
  const [status, setStatus] = useState('checking...')
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [projectSource, setProjectSource] = useState<'path' | 'url'>('path')
  const [error, setError] = useState<string | null>(null)

  const [taskProjectId, setTaskProjectId] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskMode, setTaskMode] = useState<'sdk' | 'pty'>('sdk')
  const [taskError, setTaskError] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedDeskIndex, setSelectedDeskIndex] = useState<number | null>(null)
  const [maxConcurrentAgents, setMaxConcurrentAgents] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [assignWorkerDesk, setAssignWorkerDesk] = useState('')

  const loadProjects = () => {
    fetch('/api/projects')
      .then((res) => res.json())
      .then((data: Project[]) => {
        setProjects(data)
        setTaskProjectId((current) => current || data[0]?.id || '')
      })
      .catch(() => setProjects([]))
  }

  const loadTasks = () => {
    fetch('/api/tasks')
      .then((res) => res.json())
      .then(setTasks)
      .catch(() => setTasks([]))
  }

  const loadWorkers = () => {
    fetch('/api/workers')
      .then((res) => res.json())
      .then(setWorkers)
      .catch(() => setWorkers([]))
  }

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setStatus(data.status))
      .catch(() => setStatus('unreachable'))

    loadProjects()
    loadTasks()
    loadWorkers()

    fetch('/api/settings')
      .then((res) => res.json())
      .then((data: { maxConcurrentAgents: number }) => setMaxConcurrentAgents(data.maxConcurrentAgents))
      .catch(() => {})

    const interval = setInterval(() => {
      loadTasks()
      loadWorkers()
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const updateMaxConcurrentAgents = async (value: number) => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxConcurrentAgents: value }),
    })
    const data: { maxConcurrentAgents: number } = await res.json()
    setMaxConcurrentAgents(data.maxConcurrentAgents)
    loadWorkers()
  }

  const addProject = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: projectSource, value: pathInput }),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error ?? 'failed to add project')
      return
    }

    setPathInput('')
    loadProjects()
  }

  const removeProject = async (projectId: string) => {
    setError(null)

    const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error ?? 'failed to remove project')
      return
    }

    if (taskProjectId === projectId) setTaskProjectId('')
    loadProjects()
    loadTasks()
  }

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault()
    setTaskError(null)

    if (!taskProjectId) {
      setTaskError('add a project first')
      return
    }

    if (!taskTitle.trim()) {
      setTaskError('give the ticket a title')
      return
    }

    const description = taskDescription.trim() ? `${taskTitle}\n\n${taskDescription}` : taskTitle

    const payload =
      assignWorkerDesk === ''
        ? { description, mode: taskMode, draft: true }
        : { description, mode: taskMode, draft: false, deskIndex: Number(assignWorkerDesk) }

    const res = await fetch(`/api/projects/${taskProjectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const body = await res.json()
      setTaskError(body.error ?? 'failed to create task')
      return
    }

    setTaskTitle('')
    setTaskDescription('')
    setAssignWorkerDesk('')
    loadTasks()
    loadWorkers()
  }

  /** Hands a draft ticket (in the "New" column) to a specific idle worker's desk. */
  const assignDraftToWorker = async (taskId: string, deskIndex: number) => {
    await fetch(`/api/tasks/${taskId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deskIndex }),
    })
    setSelectedDeskIndex(null)
    loadTasks()
    loadWorkers()
  }

  /** Creates a brand new ticket and runs it directly on the given worker's desk. */
  const createAndAssignToWorker = async (projectId: string, description: string, mode: 'sdk' | 'pty', deskIndex: number) => {
    await fetch(`/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, mode, draft: false, deskIndex }),
    })
    setSelectedDeskIndex(null)
    loadTasks()
    loadWorkers()
  }

  const startTicket = async (taskId: string) => {
    await fetch(`/api/tasks/${taskId}/start`, { method: 'POST' })
    loadTasks()
  }

  const closeTicket = async (taskId: string) => {
    await fetch(`/api/tasks/${taskId}/close`, { method: 'POST' })
    loadTasks()
  }

  const retryPr = async (taskId: string) => {
    await fetch(`/api/tasks/${taskId}/retry-pr`, { method: 'POST' })
    loadTasks()
  }

  const retryTask = async (taskId: string) => {
    await fetch(`/api/tasks/${taskId}/retry`, { method: 'POST' })
    loadTasks()
  }

  const removeWorktree = async (taskId: string) => {
    await fetch(`/api/tasks/${taskId}/worktree`, { method: 'DELETE' })
    loadTasks()
  }

  const clearTask = async (taskId: string) => {
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
    if (selectedTaskId === taskId) setSelectedTaskId(null)
    loadTasks()
  }

  const selectTask = (taskId: string) => {
    setSelectedDeskIndex(null)
    setSelectedTaskId(taskId)
  }

  const selectWorker = (deskIndex: number) => {
    setSelectedTaskId(null)
    setSelectedDeskIndex(deskIndex)
  }

  // Desks busy with an active (non-done) task can't be handed a new ticket directly.
  const busyDeskIndexes = new Set(
    (tasks ?? []).filter((t) => ACTIVE_STATUSES.includes(t.status) && t.deskIndex !== null).map((t) => t.deskIndex)
  )
  const idleWorkers = workers.filter((w) => !busyDeskIndexes.has(w.deskIndex))
  const draftTasks = (tasks ?? []).filter((t) => t.status === 'draft')
  const selectedWorker = selectedDeskIndex !== null ? workers.find((w) => w.deskIndex === selectedDeskIndex) : undefined

  return (
    <div className="app">
      <div className="app-header">
        <h1>Agent Office</h1>
        <div className="app-header-meta">
          <span className={`pill ${status === 'ok' ? 'pill-success' : 'pill-error'}`}>{status}</span>
          <button type="button" className="settings-toggle" onClick={() => setSettingsOpen((open) => !open)}>
            {settingsOpen ? 'Close Settings' : 'Settings'}
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div className="panel">
          <SettingsMenu
            status={status}
            maxConcurrentAgents={maxConcurrentAgents}
            onUpdateMaxConcurrentAgents={updateMaxConcurrentAgents}
            projects={projects}
            projectSource={projectSource}
            onProjectSourceChange={setProjectSource}
            pathInput={pathInput}
            onPathInputChange={setPathInput}
            onAddProject={addProject}
            onRemoveProject={removeProject}
            error={error}
          />
        </div>
      )}

      <section className="section">
        <div className="office-canvas">
          <OfficeCanvas tasks={tasks ?? []} workers={workers} onSelect={selectTask} onSelectWorker={selectWorker} />
        </div>
      </section>

      <section className="section">
        <div className="panel new-ticket-panel">
          <h3>New Ticket</h3>
          <form className="ticket-form" onSubmit={addTask}>
            <div className="ticket-form-row">
              <select value={taskProjectId} onChange={(e) => setTaskProjectId(e.target.value)}>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select value={taskMode} onChange={(e) => setTaskMode(e.target.value as 'sdk' | 'pty')}>
                <option value="sdk">sdk</option>
                <option value="pty">pty</option>
              </select>
              <select value={assignWorkerDesk} onChange={(e) => setAssignWorkerDesk(e.target.value)}>
                <option value="">Assign to: auto (queue)</option>
                {idleWorkers.map((w) => (
                  <option key={w.deskIndex} value={w.deskIndex}>
                    Assign to: {w.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="ticket-form-label" htmlFor="ticket-title">
              Title
            </label>
            <input
              id="ticket-title"
              type="text"
              className="ticket-title-input"
              placeholder="What needs doing?"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
            />
            <label className="ticket-form-label" htmlFor="ticket-description">
              Description
            </label>
            <textarea
              id="ticket-description"
              className="ticket-description-input"
              placeholder="Add context, acceptance criteria, links — anything the agent should know."
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              rows={4}
            />
            {taskError && <p className="error">{taskError}</p>}
            <button type="submit" className="btn-primary">
              New Ticket
            </button>
          </form>
        </div>

        {tasks === null ? (
          <p>Loading tasks…</p>
        ) : (
          <KanbanBoard
            tasks={tasks}
            onSelect={selectTask}
            onStart={startTicket}
            onClose={closeTicket}
            onRetryPr={retryPr}
            onRetryTask={retryTask}
            onRemoveWorktree={removeWorktree}
            onClear={clearTask}
          />
        )}
      </section>

      {selectedTaskId && (
        <SidePanel
          task={(tasks ?? []).find((t) => t.id === selectedTaskId)!}
          onClose={() => setSelectedTaskId(null)}
          onTaskUpdate={loadTasks}
          onStart={startTicket}
          onCloseTicket={closeTicket}
          onRetryPr={retryPr}
          onRetryTask={retryTask}
          onRemoveWorktree={removeWorktree}
          onClear={clearTask}
        />
      )}

      {selectedWorker && (
        <WorkerPanel
          worker={selectedWorker}
          draftTasks={draftTasks}
          projects={projects ?? []}
          onClose={() => setSelectedDeskIndex(null)}
          onAssignDraft={assignDraftToWorker}
          onCreateAndAssign={createAndAssignToWorker}
        />
      )}
    </div>
  )
}

export default App
