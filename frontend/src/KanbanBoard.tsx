import {
  DndContext,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  PointerSensor,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useState } from 'react'

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

interface Column {
  key: string
  title: string
  statuses: string[]
}

const COLUMNS: Column[] = [
  { key: 'new', title: 'New', statuses: ['draft'] },
  { key: 'todo', title: 'Todo', statuses: ['queued'] },
  { key: 'in-progress', title: 'In Progress', statuses: ['running', 'blocked', 'error', 'failed', 'stopped'] },
  { key: 'review', title: 'In Code Review', statuses: ['done'] },
  { key: 'done', title: 'Done', statuses: ['closed'] },
]

const DELETE_ZONE_ID = 'delete-zone'

function columnForStatus(status: string): string | undefined {
  return COLUMNS.find((c) => c.statuses.includes(status))?.key
}

interface KanbanBoardProps {
  tasks: Task[]
  onSelect: (taskId: string) => void
  onStart: (taskId: string) => void
  onClose: (taskId: string) => void
  onRetryPr: (taskId: string) => void
  onRetryTask: (taskId: string) => void
  onRemoveWorktree: (taskId: string) => void
  onClear: (taskId: string) => void
}

function TicketCard({ task, ...actions }: { task: Task } & Omit<KanbanBoardProps, 'tasks'>) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10 }
    : undefined

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`kanban-card${isDragging ? ' dragging' : ''}`}
      onClick={() => actions.onSelect(task.id)}
      {...listeners}
      {...attributes}
    >
      <div className="kanban-card-title">{task.description || '(no description)'}</div>
      <div className="kanban-card-meta">
        {task.mode}
        {task.branchName && ` · ${task.branchName}`}
      </div>

      {task.status === 'draft' && (
        <button onClick={stop(() => actions.onStart(task.id))}>Start</button>
      )}

      {task.status === 'blocked' && task.pendingQuestion && (
        <p className="pending-question">{task.pendingQuestion}</p>
      )}

      {(task.status === 'error' || task.status === 'failed') && (
        <>
          <p className="error">{task.error ?? task.status}</p>
          {task.status === 'failed' && (
            <button onClick={stop(() => actions.onRetryTask(task.id))}>Start Fresh Task</button>
          )}
        </>
      )}

      {task.status === 'done' && (
        <>
          {task.prUrl && (
            <a href={task.prUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              {task.prUrl}
            </a>
          )}
          {task.prError && (
            <span className="error">
              {task.prError} <button onClick={stop(() => actions.onRetryPr(task.id))}>Retry PR</button>
            </span>
          )}
          <button onClick={stop(() => actions.onClose(task.id))}>Move to Done</button>
        </>
      )}
    </div>
  )
}

function ColumnDropArea({ column, children }: { column: Column; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key })

  return (
    <div ref={setNodeRef} className={`kanban-column${isOver ? ' over' : ''}`}>
      <h3>{column.title}</h3>
      <div className="kanban-cards">{children}</div>
    </div>
  )
}

function DeleteDropArea() {
  const { setNodeRef, isOver } = useDroppable({ id: DELETE_ZONE_ID })

  return (
    <div ref={setNodeRef} className={`kanban-delete-zone${isOver ? ' over' : ''}`}>
      Drop here to delete ticket
    </div>
  )
}

function KanbanBoard({ tasks, ...actions }: KanbanBoardProps) {
  const [isDragging, setIsDragging] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleDragStart = (_event: DragStartEvent) => {
    setIsDragging(true)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setIsDragging(false)
    const { active, over } = event
    if (!over) return

    const task = tasks.find((t) => t.id === active.id)
    if (!task) return

    if (over.id === DELETE_ZONE_ID) {
      actions.onClear(task.id)
      return
    }

    const from = columnForStatus(task.status)
    const to = over.id as string
    if (from === to) return

    if (from === 'new' && to === 'todo') {
      actions.onStart(task.id)
    } else if (from === 'review' && to === 'done') {
      actions.onClose(task.id)
    }
    // Other drags are no-ops: column membership is derived from status, so
    // the card snaps back unless the transition above applies.
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="kanban-board">
        {COLUMNS.map((column) => (
          <ColumnDropArea key={column.key} column={column}>
            {tasks
              .filter((t) => column.statuses.includes(t.status))
              .map((task) => (
                <TicketCard key={task.id} task={task} {...actions} />
              ))}
          </ColumnDropArea>
        ))}
      </div>
      {isDragging && <DeleteDropArea />}
    </DndContext>
  )
}

export default KanbanBoard
