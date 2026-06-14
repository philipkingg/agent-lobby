import { useEffect, useState } from 'react'
import './App.css'
import SidePanel from './SidePanel'
import OfficeCanvas from './OfficeCanvas'
import KanbanBoard from './KanbanBoard'
import SettingsMenu from './SettingsMenu'

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

function App() {
  const [status, setStatus] = useState('checking...')
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [projectSource, setProjectSource] = useState<'path' | 'url'>('path')
  const [error, setError] = useState<string | null>(null)

  const [taskProjectId, setTaskProjectId] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskMode, setTaskMode] = useState<'sdk' | 'pty'>('sdk')
  const [taskError, setTaskError] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [maxConcurrentAgents, setMaxConcurrentAgents] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

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

    const res = await fetch(`/api/projects/${taskProjectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: taskDescription, mode: taskMode, draft: true }),
    })

    if (!res.ok) {
      const body = await res.json()
      setTaskError(body.error ?? 'failed to create task')
      return
    }

    setTaskDescription('')
    loadTasks()
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

  return (
    <div className="app">
      <div className="app-header">
        <h1>Agent Office</h1>
        <button type="button" className="settings-toggle" onClick={() => setSettingsOpen((open) => !open)}>
          {settingsOpen ? 'Close Settings' : 'Settings'}
        </button>
      </div>

      {settingsOpen && (
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
      )}

      <h2>Office</h2>
      <OfficeCanvas tasks={tasks ?? []} onSelect={setSelectedTaskId} />

      <h2>Board</h2>
      <form onSubmit={addTask}>
        <select value={taskProjectId} onChange={(e) => setTaskProjectId(e.target.value)}>
          {(projects ?? []).map((p) => (
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
        <button type="submit">New Ticket</button>
      </form>
      {taskError && <p className="error">{taskError}</p>}

      {tasks === null ? (
        <p>Loading tasks…</p>
      ) : (
        <KanbanBoard
          tasks={tasks}
          onSelect={setSelectedTaskId}
          onStart={startTicket}
          onClose={closeTicket}
          onRetryPr={retryPr}
          onRetryTask={retryTask}
          onRemoveWorktree={removeWorktree}
          onClear={clearTask}
        />
      )}

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
    </div>
  )
}

export default App
