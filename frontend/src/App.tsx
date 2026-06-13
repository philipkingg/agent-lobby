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

function App() {
  const [status, setStatus] = useState('checking...')
  const [projects, setProjects] = useState<Project[]>([])
  const [pathInput, setPathInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const loadProjects = () => {
    fetch('/api/projects')
      .then((res) => res.json())
      .then(setProjects)
      .catch(() => setProjects([]))
  }

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setStatus(data.status))
      .catch(() => setStatus('unreachable'))

    loadProjects()
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
    </div>
  )
}

export default App
