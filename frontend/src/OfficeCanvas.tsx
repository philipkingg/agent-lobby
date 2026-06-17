import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot, extend, useTick } from '@pixi/react'

type PixiRoot = ReturnType<typeof createRoot>
import type { AnimatedSprite as AnimatedSpriteType } from 'pixi.js'
import { AnimatedSprite, Assets, Container, Graphics, Rectangle, Text, Texture } from 'pixi.js'
import { CANVAS_W, CANVAS_H, STATIONS, SPRITE_SCALE, getAgentSlot, type SlotPos } from './office-layout'
import type { GameAgent, GameTask } from './useGameState'

extend({ Container, Graphics, Text, AnimatedSprite })

// ── Sprite sheet helpers ──────────────────────────────────────────────────────

const FRAME_W = 16
const FRAME_H = 16
const ANIM_CONFIGS = {
  idle_anim: { frameCount: 8, row: 0 },
  sit2:      { frameCount: 8, row: 0 },
  phone:     { frameCount: 9, row: 0 },
  run:       { frameCount: 8, row: 0 },
  run_up:    { frameCount: 8, row: 1 },
} as const

type AnimKey = keyof typeof ANIM_CONFIGS
type TexCache = Map<string, Texture[]>

function makeFrames(baseTex: Texture, count: number, row: number): Texture[] {
  return Array.from({ length: count }, (_, i) =>
    new Texture({
      source: baseTex.source,
      frame: new Rectangle(i * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H),
    })
  )
}

function buildTexCache(entries: [string, Texture][]): TexCache {
  const cache: TexCache = new Map()
  for (const [url, baseTex] of entries) {
    baseTex.source.scaleMode = 'nearest'
    const m = url.match(/characters\/(\w+)_(\w+)_16x16/)
    if (!m) continue
    const [, avatar, animName] = m
    const cfg = ANIM_CONFIGS[animName as AnimKey]
    if (!cfg) continue
    cache.set(`${avatar}_${animName}`, makeFrames(baseTex, cfg.frameCount, cfg.row))
    if (animName === 'run') {
      cache.set(`${avatar}_run_up`, makeFrames(baseTex, ANIM_CONFIGS.run_up.frameCount, ANIM_CONFIGS.run_up.row))
    }
  }
  return cache
}

const AVATARS = ['Adam', 'Alex', 'Amelia', 'Bob']
const ANIM_NAMES = ['idle_anim', 'sit2', 'phone', 'run']
const SPRITE_URLS = AVATARS.flatMap((a) =>
  ANIM_NAMES.map((anim) => `/sprites/characters/${a}_${anim}_16x16.png`)
)

// ── Drawing helpers ───────────────────────────────────────────────────────────

const FLOOR_BG   = 0x0a0907
const FLOOR_TILE_A = 0x100d0a
const FLOOR_TILE_B = 0x0d0b08

function drawFloor(g: Graphics) {
  g.clear()
  g.rect(0, 0, CANVAS_W, CANVAS_H).fill(FLOOR_BG)
  const tile = 32
  for (let y = 0; y < CANVAS_H; y += tile) {
    for (let x = 0; x < CANVAS_W; x += tile) {
      if ((x / tile + y / tile) % 2 === 0) {
        g.rect(x, y, tile, tile).fill(FLOOR_TILE_A)
      } else {
        g.rect(x, y, tile, tile).fill(FLOOR_TILE_B)
      }
    }
  }
}

function drawStationBg(g: Graphics) {
  g.clear()
  for (const st of Object.values(STATIONS)) {
    g.roundRect(st.x, st.y, st.w, st.h, 6).fill({ color: st.color, alpha: 0.92 })
    g.roundRect(st.x, st.y, st.w, st.h, 6).stroke({ color: st.labelColor, alpha: 0.3, width: 1 })
  }
}

function StationLabels() {
  return (
    <>
      {Object.values(STATIONS).map((st) => (
        <pixiText
          key={st.id}
          text={st.label.toUpperCase()}
          x={st.x + 8}
          y={st.y + 8}
          style={{ fontFamily: 'monospace', fontSize: 9, fill: st.labelColor, fontWeight: 'bold' }}
        />
      ))}
    </>
  )
}

// ── AgentSprite ───────────────────────────────────────────────────────────────

const WALK_SPEED = 4

function getBadge(status: string): string | null {
  if (status === 'blocked') return '💬'
  if (status === 'awaiting_approval') return '🚩'
  if (status === 'stuck') return '⚠'
  return null
}

function getAnimKey(stationId: string | null): AnimKey {
  const station = stationId ? STATIONS[stationId] : null
  return station?.animation ?? 'idle_anim'
}

interface AgentSpriteProps {
  agent: GameAgent
  task: GameTask | null
  targetPos: SlotPos
  animKey: AnimKey
  texCache: TexCache
  onClick: () => void
}

function AgentSprite({ agent, task, targetPos, animKey, texCache, onClick }: AgentSpriteProps) {
  const posRef = useRef({ x: targetPos.x, y: targetPos.y })
  const [displayPos, setDisplayPos] = useState({ x: targetPos.x, y: targetPos.y })
  const [isWalking, setIsWalking] = useState(false)
  const [walkDir, setWalkDir] = useState<'down' | 'up'>('down')
  const spriteRef = useRef<AnimatedSpriteType | null>(null)

  const texKey = isWalking
    ? `${agent.avatar}_${walkDir === 'up' ? 'run_up' : 'run'}`
    : `${agent.avatar}_${animKey}`
  const frames = texCache.get(texKey) ?? texCache.get(`${agent.avatar}_idle_anim`) ?? null

  const handleRef = useCallback((s: AnimatedSpriteType | null) => {
    spriteRef.current = s
    if (s) s.play()
  }, [])

  useEffect(() => {
    spriteRef.current?.play()
  }, [texKey])

  useTick((ticker) => {
    const dx = targetPos.x - posRef.current.x
    const dy = targetPos.y - posRef.current.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist > 2) {
      const speed = Math.min(WALK_SPEED * ticker.deltaTime, dist)
      posRef.current.x += (dx / dist) * speed
      posRef.current.y += (dy / dist) * speed
      setDisplayPos({ ...posRef.current })
      if (!isWalking) {
        setIsWalking(true)
        setWalkDir(dy < 0 ? 'up' : 'down')
      }
    } else if (isWalking) {
      posRef.current.x = targetPos.x
      posRef.current.y = targetPos.y
      setDisplayPos({ x: targetPos.x, y: targetPos.y })
      setIsWalking(false)
    }
  })

  const badge = getBadge(task?.status ?? '')

  if (!frames) return null

  return (
    <pixiContainer
      x={displayPos.x}
      y={displayPos.y}
      eventMode="static"
      cursor="pointer"
      onClick={onClick}
    >
      <pixiAnimatedSprite
        ref={handleRef}
        textures={frames}
        animationSpeed={0.12}
        scale={SPRITE_SCALE}
        anchor={0}
      />
      <pixiText
        text={agent.name}
        x={24}
        y={-14}
        anchor={0.5}
        style={{ fontFamily: 'monospace', fontSize: 9, fill: 0xd4c5a9, align: 'center' }}
      />
      {badge && (
        <pixiText
          text={badge}
          x={42}
          y={-2}
          style={{ fontFamily: 'monospace', fontSize: 11 }}
        />
      )}
    </pixiContainer>
  )
}

// ── PixiScene — rendered inside the Pixi reconciler ───────────────────────────

interface PixiSceneProps {
  agents: GameAgent[]
  tasks: GameTask[]
  texCache: TexCache | null
  onSelectAgent: (id: string) => void
}

function PixiScene({ agents, tasks, texCache, onSelectAgent }: PixiSceneProps) {
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const agentsByStation = new Map<string, string[]>()
  for (const sid of Object.keys(STATIONS)) agentsByStation.set(sid, [])
  for (const agent of [...agents].sort((a, b) => a.id.localeCompare(b.id))) {
    const sid = agent.currentStation ?? 'relaxation'
    const target = agentsByStation.get(sid) ?? agentsByStation.get('relaxation')!
    target.push(agent.id)
  }

  return (
    <>
      <pixiGraphics draw={drawFloor} />
      <pixiGraphics draw={drawStationBg} />
      <StationLabels />
      {texCache &&
        agents.map((agent) => {
          const stationId = agent.currentStation ?? 'relaxation'
          const atStation = agentsByStation.get(stationId) ?? []
          const slot = getAgentSlot(agent.id, stationId, atStation)
          const task = agent.currentTaskId ? (taskById.get(agent.currentTaskId) ?? null) : null
          return (
            <AgentSprite
              key={agent.id}
              agent={agent}
              task={task}
              targetPos={slot}
              animKey={getAnimKey(stationId)}
              texCache={texCache}
              onClick={() => onSelectAgent(agent.id)}
            />
          )
        })}
    </>
  )
}

// ── OfficeCanvas — manages Pixi lifecycle ─────────────────────────────────────

interface OfficeCanvasProps {
  agents: GameAgent[]
  tasks: GameTask[]
  onSelectAgent: (agentId: string) => void
}

const APP_OPTIONS = {
  width: CANVAS_W,
  height: CANVAS_H,
  background: FLOOR_BG,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
}

export default function OfficeCanvas({ agents, tasks, onSelectAgent }: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<PixiRoot | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [texCache, setTexCache] = useState<TexCache | null>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setScale(Math.min(width / CANVAS_W, height / CANVAS_H))
    })
    obs.observe(wrap)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const root = createRoot(canvas, {
      onInit: () => setIsReady(true)
    })
    rootRef.current = root

    void root.render(<></>, APP_OPTIONS)

    void Promise.all(
      SPRITE_URLS.map((url) => Assets.load<Texture>(url).then((tex) => [url, tex] as [string, Texture]))
    )
      .then((entries) => setTexCache(buildTexCache(entries)))
      .catch(() => {})

    return () => {
      rootRef.current = null
    }
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!isReady || !root) return
    void root.render(
      <PixiScene agents={agents} tasks={tasks} texCache={texCache} onSelectAgent={onSelectAgent} />,
      APP_OPTIONS
    )
  }, [isReady, agents, tasks, texCache, onSelectAgent])

  return (
    <div
      ref={wrapRef}
      style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center', lineHeight: 0 }}>
        <canvas ref={canvasRef} style={{ display: 'block', borderRadius: 10 }} />
      </div>
    </div>
  )
}
