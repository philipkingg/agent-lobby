import { useState } from 'react'
import { Application, extend, useTick } from '@pixi/react'
import { Container, Graphics, Text } from 'pixi.js'
import type { Graphics as PixiGraphics } from 'pixi.js'
import { agentVisual, projectColor, type Animation } from './agentState'
import { MAX_DESKS, DESK_SIZE, deskPosition, officeSize } from './deskLayout'

extend({ Container, Graphics, Text })

interface Task {
  id: string
  projectId: string
  description: string
  status: string
  deskIndex: number | null
}

interface OfficeCanvasProps {
  tasks: Task[]
  onSelect: (taskId: string) => void
}

const DESK_COLOR = 0xd7ccc8
const STRIPE_HEIGHT = 6
const BADGE_COLORS: Record<string, number> = {
  question: 0xffc107,
  error: 0xe53935,
}

function drawDesk(g: PixiGraphics, accentColor: number) {
  g.clear()
  g.rect(0, 0, DESK_SIZE, DESK_SIZE).fill(DESK_COLOR)
  g.rect(0, 0, DESK_SIZE, STRIPE_HEIGHT).fill(accentColor)
}

function drawAgent(g: PixiGraphics, color: number) {
  g.clear()
  g.circle(0, 0, DESK_SIZE / 3).fill(color)
}

function drawBadge(g: PixiGraphics, color: number) {
  g.clear()
  g.circle(0, 0, 10).fill(color)
}

/** Animates an agent sprite per its status: bobbing while working, pulsing
 * while blocked/erroring, and a tilted "slacking off" pose once done. */
function AnimatedAgent({ color, animation }: { color: number; animation: Animation }) {
  const [t, setT] = useState(0)
  useTick((ticker) => setT((prev) => prev + ticker.deltaTime))

  const center = DESK_SIZE / 2
  let x = center
  let y = center
  let rotation = 0
  let scale = 1

  if (animation === 'bob') {
    y = center + Math.sin(t / 10) * 4
  } else if (animation === 'pulse') {
    scale = 1 + Math.sin(t / 6) * 0.15
  } else if (animation === 'slack') {
    rotation = Math.PI / 8
  }

  return <pixiGraphics x={x} y={y} rotation={rotation} scale={scale} draw={(g) => drawAgent(g, color)} />
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
        const accentColor = task ? projectColor(task.projectId) : DESK_COLOR

        return (
          <pixiContainer
            key={index}
            x={pos.x}
            y={pos.y}
            eventMode={task ? 'static' : 'none'}
            cursor={task ? 'pointer' : 'default'}
            onClick={() => task && onSelect(task.id)}
          >
            <pixiGraphics draw={(g) => drawDesk(g, accentColor)} />
            {visual && <AnimatedAgent color={visual.color} animation={visual.animation} />}
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
