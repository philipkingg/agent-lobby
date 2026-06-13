import { useEffect, useState } from 'react'
import './App.css'

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
  }, [])

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

  return (
    <div className="app">
      <h1>Agent Office</h1>
      <p>Backend status: {status}</p>

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
        {tasks.map((t) => (
          <li key={t.id}>
            <strong>[{t.status}]</strong> {t.description} ({t.mode}, {t.branchName})
          </li>
        ))}
      </ul>
    </div>
  )
}

export default App
