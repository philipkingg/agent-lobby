import { useEffect, useRef, useState } from 'react'
import PtyTerminal from './PtyTerminal'

interface TranscriptEntry {
  id: string
  taskId: string
  type: string
  content: string
  timestamp: string
}

interface Task {
  id: string
  status: string
  pendingQuestion: string | null
  description: string
  mode: 'sdk' | 'pty'
}

type AgentEvent =
  | { type: 'transcript'; entry: TranscriptEntry }
  | { type: 'status'; status: string; pendingQuestion?: string | null }

interface SidePanelProps {
  task: Task
  onClose: () => void
  onTaskUpdate: () => void
}

function summarize(entry: TranscriptEntry): string {
  try {
    const parsed = JSON.parse(entry.content)
    if (entry.type === 'assistant') {
      const blocks = parsed.message?.content ?? []
      return blocks
        .map((b: { type: string; text?: string; name?: string }) =>
          b.type === 'text' ? b.text : b.type === 'tool_use' ? `[tool: ${b.name}]` : `[${b.type}]`
        )
        .join(' ')
    }
    if (entry.type === 'result') {
      return parsed.result ?? `[result: ${parsed.subtype}]`
    }
    return entry.content
  } catch {
    return entry.content
  }
}

function SidePanel({ task, onClose, onTaskUpdate }: SidePanelProps) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [status, setStatus] = useState(task.status)
  const [pendingQuestion, setPendingQuestion] = useState(task.pendingQuestion)
  const [reply, setReply] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setStatus(task.status)
    setPendingQuestion(task.pendingQuestion)

    if (task.mode !== 'sdk') return

    fetch(`/api/tasks/${task.id}/transcript`)
      .then((res) => res.json())
      .then(setEntries)
      .catch(() => setEntries([]))

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/tasks/${task.id}`)

    ws.onmessage = (event) => {
      const data: AgentEvent = JSON.parse(event.data)
      if (data.type === 'transcript') {
        setEntries((current) => [...current, data.entry])
      } else if (data.type === 'status') {
        setStatus(data.status)
        if ('pendingQuestion' in data) {
          setPendingQuestion(data.pendingQuestion ?? null)
        }
        onTaskUpdate()
      }
    }

    return () => ws.close()
  }, [task.id])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [entries])

  const stopTask = async () => {
    await fetch(`/api/tasks/${task.id}/stop`, { method: 'POST' })
    onTaskUpdate()
  }

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reply.trim()) return

    await fetch(`/api/tasks/${task.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: reply }),
    })

    setReply('')
  }

  return (
    <div className="side-panel">
      <button className="side-panel-close" onClick={onClose}>
        close
      </button>
      <h3>{task.description}</h3>
      <p>
        status: <strong>{status}</strong>
      </p>

      {task.mode === 'sdk' ? (
        <div className="transcript-log" ref={logRef}>
          {entries.map((entry) => (
            <div key={entry.id} className={`transcript-entry transcript-${entry.type}`}>
              <span className="transcript-type">{entry.type}</span> {summarize(entry)}
            </div>
          ))}
        </div>
      ) : (
        <PtyTerminal taskId={task.id} onStatus={setStatus} />
      )}

      {(status === 'running' || status === 'blocked') && (
        <button className="stop-button" onClick={stopTask}>
          Stop
        </button>
      )}

      {status === 'blocked' && (
        <form onSubmit={sendReply} className="respond-form">
          <p className="pending-question">{pendingQuestion}</p>
          <input
            type="text"
            placeholder="your answer"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <button type="submit">Send</button>
        </form>
      )}
    </div>
  )
}

export default SidePanel
