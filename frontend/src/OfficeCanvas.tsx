import { Application, extend } from '@pixi/react'
import { Container, Graphics, Text } from 'pixi.js'
import type { Graphics as PixiGraphics } from 'pixi.js'
import { agentVisual } from './agentState'
import { MAX_DESKS, DESK_SIZE, deskPosition, officeSize } from './deskLayout'

extend({ Container, Graphics, Text })

interface Task {
  id: string
  description: string
  status: string
  deskIndex: number | null
}

interface OfficeCanvasProps {
  tasks: Task[]
  onSelect: (taskId: string) => void
}

const DESK_COLOR = 0xd7ccc8
const BADGE_COLORS: Record<string, number> = {
  question: 0xffc107,
  error: 0xe53935,
}

function drawDesk(g: PixiGraphics) {
  g.clear()
  g.rect(0, 0, DESK_SIZE, DESK_SIZE).fill(DESK_COLOR)
}

function drawAgent(g: PixiGraphics, color: number) {
  g.clear()
  g.circle(DESK_SIZE / 2, DESK_SIZE / 2, DESK_SIZE / 3).fill(color)
}

function drawBadge(g: PixiGraphics, color: number) {
  g.clear()
  g.circle(0, 0, 10).fill(color)
}

function OfficeCanvas({ tasks, onSelect }: OfficeCanvasProps) {
  const { width, height } = officeSize()
  const byDesk = new Map<number, Task>()
  for (const task of tasks) {
    if (task.deskIndex !== null) byDesk.set(task.deskIndex, task)
  }

  return (
    <Application width={width} height={height} background={0xeeeeee}>
      {Array.from({ length: MAX_DESKS }, (_, index) => {
        const pos = deskPosition(index)
        const task = byDesk.get(index)
        const visual = task ? agentVisual(task.status) : null

        return (
          <pixiContainer
            key={index}
            x={pos.x}
            y={pos.y}
            eventMode={task ? 'static' : 'none'}
            cursor={task ? 'pointer' : 'default'}
            onClick={() => task && onSelect(task.id)}
          >
            <pixiGraphics draw={drawDesk} />
            {visual && <pixiGraphics draw={(g) => drawAgent(g, visual.color)} />}
            {visual?.badge && (
              <pixiGraphics x={DESK_SIZE - 6} y={6} draw={(g) => drawBadge(g, BADGE_COLORS[visual.badge!])} />
            )}
          </pixiContainer>
        )
      })}
    </Application>
  )
}

export default OfficeCanvas
