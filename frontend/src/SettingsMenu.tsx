interface Project {
  id: string
  name: string
  path: string
  defaultBranch: string
  worktreesRoot: string
  createdAt: string
}

interface SettingsMenuProps {
  status: string
  maxConcurrentAgents: number | null
  onUpdateMaxConcurrentAgents: (value: number) => void
  projects: Project[] | null
  projectSource: 'path' | 'url'
  onProjectSourceChange: (source: 'path' | 'url') => void
  pathInput: string
  onPathInputChange: (value: string) => void
  onAddProject: (e: React.FormEvent) => void
  onRemoveProject: (projectId: string) => void
  error: string | null
}

function SettingsMenu({
  status,
  maxConcurrentAgents,
  onUpdateMaxConcurrentAgents,
  projects,
  projectSource,
  onProjectSourceChange,
  pathInput,
  onPathInputChange,
  onAddProject,
  onRemoveProject,
  error,
}: SettingsMenuProps) {
  return (
    <div className="settings-menu">
      <h2>Settings</h2>

      <section className="settings-section">
        <h3>Backend</h3>
        <p>Backend status: {status}</p>
      </section>

      <section className="settings-section">
        <h3>Concurrency</h3>
        {maxConcurrentAgents !== null && (
          <p>
            Max concurrent agents:{' '}
            <input
              type="number"
              min={1}
              max={10}
              value={maxConcurrentAgents}
              onChange={(e) => onUpdateMaxConcurrentAgents(Number(e.target.value))}
            />
          </p>
        )}
      </section>

      <section className="settings-section">
        <h3>Projects</h3>
        <form onSubmit={onAddProject}>
          <select value={projectSource} onChange={(e) => onProjectSourceChange(e.target.value as 'path' | 'url')}>
            <option value="path">local path</option>
            <option value="url">git URL</option>
          </select>
          <input
            type="text"
            placeholder={projectSource === 'path' ? '/path/to/local/repo' : 'https://github.com/org/repo.git'}
            value={pathInput}
            onChange={(e) => onPathInputChange(e.target.value)}
          />
          <button type="submit">Add Project</button>
        </form>
        {error && <p className="error">{error}</p>}

        {projects === null ? (
          <p>Loading projects…</p>
        ) : projects.length === 0 ? (
          <p>No projects yet — add one above to get started.</p>
        ) : (
          <ul>
            {projects.map((p) => (
              <li key={p.id}>
                <strong>{p.name}</strong> — {p.path} (default branch: {p.defaultBranch})
                {' '}
                <button type="button" onClick={() => onRemoveProject(p.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default SettingsMenu
