import { useEffect, useRef, useState } from 'react'

export interface GameAgent {
  id: string
  name: string
  jobType: string
  avatar: string
  personality: string
  currentStation: string | null
  currentTaskId: string | null
  level: number
  xp: number
  squadId: string | null
}

export interface GameTask {
  id: string
  projectId: string
  title: string
  description: string
  stage: string
  status: string
  priority: number
  requiresHumanReview: number
  reviewLoopCount: number
  pendingQuestion: string | null
  branch: string | null
  prUrl: string | null
  source: string
  parentTaskId: string | null
  createdAt: string
  updatedAt: string
}

export interface UserProfile {
  id: number
  level: number
  xp: number
  xpToNext: number
}

export interface Project {
  id: string
  name: string
  path: string
  defaultBranch: string
  worktreesRoot: string
  githubUrl: string | null
  autoMerge: number
  createdAt: string
}

export interface Squad {
  id: string
  name: string
  projectIds: string // JSON-encoded string[]
}

interface GameState {
  agents: GameAgent[]
  tasks: GameTask[]
  userProfile: UserProfile | null
  projects: Project[]
  squads: Squad[]
  refetchTasks: () => void
  refetchAgents: () => void
  refetchSquads: () => void
  refetchAll: () => void
}

export function useGameState(): GameState {
  const [agents, setAgents] = useState<GameAgent[]>([])
  const [tasks, setTasks] = useState<GameTask[]>([])
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [squads, setSquads] = useState<Squad[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  const fetchAgents = () =>
    fetch('/api/agents')
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setAgents)
      .catch(() => {})

  const fetchTasks = () =>
    fetch('/api/tasks')
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setTasks)
      .catch(() => {})

  const fetchProfile = () =>
    fetch('/api/profile')
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setUserProfile)
      .catch(() => {})

  const fetchProjects = () =>
    fetch('/api/projects')
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setProjects)
      .catch(() => {})

  const fetchSquads = () =>
    fetch('/api/squads')
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setSquads)
      .catch(() => {})

  const fetchAll = () => {
    void fetchAgents()
    void fetchTasks()
    void fetchProfile()
    void fetchProjects()
    void fetchSquads()
  }

  useEffect(() => {
    fetchAll()

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${proto}//${location.host}/ws/events`
    let ws: WebSocket
    let alive = true

    const connect = () => {
      ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as Record<string, unknown>
          switch (msg.type) {
            case 'agent:update':
              setAgents((prev) =>
                prev.map((a) =>
                  a.id === msg.agentId
                    ? { ...a, currentStation: msg.station as string | null, currentTaskId: msg.taskId as string | null }
                    : a
                )
              )
              break
            case 'agent:xp':
              setAgents((prev) =>
                prev.map((a) =>
                  a.id === msg.agentId
                    ? { ...a, xp: msg.xp as number, level: msg.level as number }
                    : a
                )
              )
              break
            case 'user:xp':
              setUserProfile((prev) =>
                prev ? { ...prev, xp: msg.xp as number, level: msg.level as number } : prev
              )
              break
            case 'status':
            case 'task:gate':
            case 'task:stuck':
              void fetchTasks()
              break
          }
        } catch {
          // ignore malformed messages
        }
      }

      ws.onclose = () => {
        wsRef.current = null
        if (alive) setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      alive = false
      wsRef.current?.close()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    agents,
    tasks,
    userProfile,
    projects,
    squads,
    refetchTasks: fetchTasks,
    refetchAgents: fetchAgents,
    refetchSquads: fetchSquads,
    refetchAll: fetchAll,
  }
}
