import { useEffect, useState } from 'react'
import { Application, extend, useTick } from '@pixi/react'
import { Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { Graphics as PixiGraphics } from 'pixi.js'
import { agentVisual, projectColor, type Animation } from './agentState'
import { MAX_DESKS, DESK_SIZE, DESK_MARGIN, deskPosition, officeSize } from './deskLayout'

extend({ Container, Graphics, Text, Sprite })

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

const FLOOR_BG = 0x100d0a
const FLOOR_TILE_A = 0x1b1611
const FLOOR_TILE_B = 0x191510
const STRIPE_HEIGHT = 6
const BADGE_COLORS: Record<string, number> = {
  question: 0xffc107,
  error: 0xe53935,
}

// Pixel-art tiles cropped from Kenney's "Roguelike/RPG Pack" (CC0) - see public/sprites/CREDITS.txt
const SPRITE_URLS = {
  deskA: '/sprites/desk-a.png',
  deskB: '/sprites/desk-b.png',
  chair: '/sprites/chair.png',
  cabinet: '/sprites/cabinet.png',
  plant: '/sprites/plant.png',
  tree: '/sprites/tree.png',
  door: '/sprites/door.png',
  rug: '/sprites/rug.png',
} as const

type SpriteName = keyof typeof SPRITE_URLS

function drawFloor(g: PixiGraphics, width: number, height: number) {
  g.clear()
  g.rect(0, 0, width, height).fill(FLOOR_BG)
  const tile = 32
  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      const checker = (x / tile + y / tile) % 2 === 0
      g.rect(x, y, tile, tile).fill(checker ? FLOOR_TILE_A : FLOOR_TILE_B)
    }
  }
}

function drawAccentStripe(g: PixiGraphics, accentColor: number) {
  g.clear()
  g.rect(0, 0, DESK_SIZE, STRIPE_HEIGHT).fill(accentColor)
}

function drawAgent(g: PixiGraphics, color: number) {
  g.clear()
  g.circle(0, 0, DESK_SIZE / 5).fill(color)
}

function drawBadge(g: PixiGraphics, color: number) {
  g.clear()
  g.circle(0, 0, 8).fill(color)
}

/** Animates an agent sprite per its status: bobbing while working, pulsing
 * while blocked/erroring, and a tilted "slacking off" pose once done. */
function AnimatedAgent({ color, animation }: { color: number; animation: Animation }) {
  const [t, setT] = useState(0)
  useTick((ticker) => setT((prev) => prev + ticker.deltaTime))

  let x = 0
  let y = 0
  let rotation = 0
  let scale = 1

  if (animation === 'bob') {
    y = Math.sin(t / 10) * 3
  } else if (animation === 'pulse') {
    scale = 1 + Math.sin(t / 6) * 0.15
  } else if (animation === 'slack') {
    rotation = Math.PI / 8
  }

  return <pixiGraphics x={x} y={y} rotation={rotation} scale={scale} draw={(g) => drawAgent(g, color)} />
}

/** A 16x16 pixel-art tile from the office sprite sheet, drawn crisp (no smoothing) at the given scale. */
function PixelSprite({
  texture,
  x,
  y,
  scale = DESK_SIZE / 16,
  alpha = 1,
}: {
  texture: Texture
  x: number
  y: number
  scale?: number
  alpha?: number
}) {
  return <pixiSprite texture={texture} x={x} y={y} scale={scale} alpha={alpha} />
}

function OfficeCanvas({ tasks, onSelect }: OfficeCanvasProps) {
  const { width, height } = officeSize()
  const [textures, setTextures] = useState<Record<SpriteName, Texture> | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all(Object.entries(SPRITE_URLS).map(([key, url]) => Assets.load(url).then((tex) => [key, tex] as const)))
      .then((entries) => {
        if (cancelled) return
        for (const [, tex] of entries) {
          ;(tex as Texture).source.scaleMode = 'nearest'
        }
        setTextures(Object.fromEntries(entries) as Record<SpriteName, Texture>)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const byDesk = new Map<number, Task>()
  for (const task of tasks) {
    if (task.deskIndex !== null) byDesk.set(task.deskIndex, task)
  }

  const officeWidth = width + 64
  const officeHeight = height + 32

  return (
    <Application width={officeWidth} height={officeHeight} background={FLOOR_BG}>
      <pixiGraphics draw={(g) => drawFloor(g, officeWidth, officeHeight)} />

      {textures && (
        <>
          <PixelSprite texture={textures.door} x={DESK_MARGIN + 32} y={4} scale={3} />
          <PixelSprite texture={textures.tree} x={8} y={officeHeight - 70} scale={3.5} />
          <PixelSprite texture={textures.plant} x={officeWidth - 56} y={16} scale={3} />
          <PixelSprite texture={textures.plant} x={officeWidth - 56} y={officeHeight - 60} scale={3} />
          <PixelSprite texture={textures.cabinet} x={officeWidth - 60} y={height / 2} scale={3} />
          <PixelSprite texture={textures.rug} x={12} y={20} scale={3} />
        </>
      )}

      {Array.from({ length: MAX_DESKS }, (_, index) => {
        const pos = deskPosition(index)
        const task = byDesk.get(index)
        const visual = task ? agentVisual(task.status) : null
        const accentColor = task ? projectColor(task.projectId) : 0x4a3f33
        const deskSprite = textures ? (index % 2 === 0 ? textures.deskA : textures.deskB) : null

        return (
          <pixiContainer
            key={index}
            x={pos.x}
            y={pos.y}
            eventMode={task ? 'static' : 'none'}
            cursor={task ? 'pointer' : 'default'}
            onClick={() => task && onSelect(task.id)}
          >
            {deskSprite ? (
              <PixelSprite texture={deskSprite} x={0} y={0} />
            ) : (
              <pixiGraphics draw={(g) => g.clear().rect(0, 0, DESK_SIZE, DESK_SIZE).fill(0x2a221b)} />
            )}
            {textures && <PixelSprite texture={textures.chair} x={0} y={DESK_SIZE * 0.55} />}
            <pixiGraphics y={DESK_SIZE - STRIPE_HEIGHT} draw={(g) => drawAccentStripe(g, accentColor)} />
            {visual && (
              <pixiContainer x={DESK_SIZE * 0.72} y={DESK_SIZE * 0.32}>
                <AnimatedAgent color={visual.color} animation={visual.animation} />
              </pixiContainer>
            )}
            {visual?.badge && (
              <pixiGraphics
                x={DESK_SIZE - 4}
                y={4}
                draw={(g) => drawBadge(g, BADGE_COLORS[visual.badge!])}
              />
            )}
          </pixiContainer>
        )
      })}
    </Application>
  )
}

export default OfficeCanvas
