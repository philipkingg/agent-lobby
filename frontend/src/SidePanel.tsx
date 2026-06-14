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

/** Plain-language summary for "simple mode": only what the agent said and which
 * tools it used, skipping raw system/user/stream noise. Returns null to hide an entry. */
function simpleSummarize(entry: TranscriptEntry): string | null {
  try {
    const parsed = JSON.parse(entry.content)
    if (entry.type === 'assistant') {
      const blocks = (parsed.message?.content ?? []) as { type: string; text?: string; name?: string }[]
      const parts = blocks
        .map((b) => {
          if (b.type === 'text') return b.text?.trim()
          if (b.type === 'tool_use') return `→ used ${b.name}`
          return null
        })
        .filter((b): b is string => !!b)
      return parts.length ? parts.join('\n') : null
    }
    if (entry.type === 'result') {
      return parsed.result ?? `Finished (${parsed.subtype})`
    }
    return null
  } catch {
    return null
  }
}

function SidePanel({ task, onClose, onTaskUpdate }: SidePanelProps) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [status, setStatus] = useState(task.status)
  const [pendingQuestion, setPendingQuestion] = useState(task.pendingQuestion)
  const [reply, setReply] = useState('')
  const [simpleMode, setSimpleMode] = useState(true)
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
        <>
          <label className="simple-mode-toggle">
            <input
              type="checkbox"
              checked={simpleMode}
              onChange={(e) => setSimpleMode(e.target.checked)}
            />
            Simple mode
          </label>
          <div className="transcript-log" ref={logRef}>
            {simpleMode
              ? entries.map((entry) => {
                  const text = simpleSummarize(entry)
                  if (text === null) return null
                  return (
                    <div key={entry.id} className="transcript-entry transcript-simple">
                      {text}
                    </div>
                  )
                })
              : entries.map((entry) => (
                  <div key={entry.id} className={`transcript-entry transcript-${entry.type}`}>
                    <span className="transcript-type">{entry.type}</span> {summarize(entry)}
                  </div>
                ))}
          </div>
        </>
      ) : (
        <PtyTerminal taskId={task.id} onStatus={setStatus} />
      )}

      {(status === 'running' || status === 'blocked' || status === 'queued') && (
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
