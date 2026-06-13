import { useEffect, useState } from 'react'
import './App.css'
import SidePanel from './SidePanel'
import OfficeCanvas from './OfficeCanvas'

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
  pendingQuestion: string | null
  deskIndex: number | null
}

function App() {
  const [status, setStatus] = useState('checking...')
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [pathInput, setPathInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [taskProjectId, setTaskProjectId] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskMode, setTaskMode] = useState<'sdk' | 'pty'>('sdk')
  const [taskError, setTaskError] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [maxConcurrentAgents, setMaxConcurrentAgents] = useState<number | null>(null)

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

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setStatus(data.status))
      .catch(() => setStatus('unreachable'))

    loadProjects()
    loadTasks()

    fetch('/api/settings')
      .then((res) => res.json())
      .then((data: { maxConcurrentAgents: number }) => setMaxConcurrentAgents(data.maxConcurrentAgents))
      .catch(() => {})

    const interval = setInterval(loadTasks, 3000)
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
  }

  const addProject = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'path', value: pathInput }),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error ?? 'failed to add project')
      return
    }

    setPathInput('')
    loadProjects()
  }

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault()
    setTaskError(null)

    if (!taskProjectId) {
      setTaskError('add a project first')
      return
    }

    const res = await fetch(`/api/projects/${taskProjectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: taskDescription, mode: taskMode }),
    })

    if (!res.ok) {
      const body = await res.json()
      setTaskError(body.error ?? 'failed to create task')
      return
    }

    setTaskDescription('')
    loadTasks()
  }

  const retryPr = async (taskId: string) => {
    await fetch(`/api/tasks/${taskId}/retry-pr`, { method: 'POST' })
    loadTasks()
  }

  const activeTasks = tasks.filter((t) => t.status !== 'done')
  const completedTasks = tasks.filter((t) => t.status === 'done')

  return (
    <div className="app">
      <h1>Agent Office</h1>
      <p>Backend status: {status}</p>

      {maxConcurrentAgents !== null && (
        <p>
          Max concurrent agents:{' '}
          <input
            type="number"
            min={1}
            max={10}
            value={maxConcurrentAgents}
            onChange={(e) => updateMaxConcurrentAgents(Number(e.target.value))}
          />
        </p>
      )}

      <h2>Projects</h2>
      <form onSubmit={addProject}>
        <input
          type="text"
          placeholder="/path/to/local/repo"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
        />
        <button type="submit">Add Project</button>
      </form>
      {error && <p className="error">{error}</p>}

      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong> — {p.path} (default branch: {p.defaultBranch})
          </li>
        ))}
      </ul>

      <h2>Office</h2>
      <OfficeCanvas tasks={tasks} onSelect={setSelectedTaskId} />

      <h2>Tasks</h2>
      <form onSubmit={addTask}>
        <select value={taskProjectId} onChange={(e) => setTaskProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="describe the task"
          value={taskDescription}
          onChange={(e) => setTaskDescription(e.target.value)}
        />
        <select value={taskMode} onChange={(e) => setTaskMode(e.target.value as 'sdk' | 'pty')}>
          <option value="sdk">sdk</option>
          <option value="pty">pty</option>
        </select>
        <button type="submit">New Task</button>
      </form>
      {taskError && <p className="error">{taskError}</p>}

      <ul>
        {activeTasks.map((t) => (
          <li key={t.id}>
            <button className="task-link" onClick={() => setSelectedTaskId(t.id)}>
              <strong>[{t.status}]</strong> {t.description} ({t.mode}, {t.branchName})
            </button>
          </li>
        ))}
      </ul>

      <h2>Completed</h2>
      <ul>
        {completedTasks.map((t) => (
          <li key={t.id}>
            <button className="task-link" onClick={() => setSelectedTaskId(t.id)}>
              {t.description} ({t.mode}, {t.branchName})
            </button>
            {t.prUrl && (
              <a href={t.prUrl} target="_blank" rel="noreferrer">
                {t.prUrl}
              </a>
            )}
            {t.prError && (
              <span className="error">
                {t.prError}{' '}
                <button onClick={() => retryPr(t.id)}>Retry PR</button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {selectedTaskId && (
        <SidePanel
          task={tasks.find((t) => t.id === selectedTaskId)!}
          onClose={() => setSelectedTaskId(null)}
          onTaskUpdate={loadTasks}
        />
      )}
    </div>
  )
}

export default App
