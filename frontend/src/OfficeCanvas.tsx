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
    const m = url.match(/characters\/(\w+?)_(\w+)_16x16/)
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

interface Viewport { x: number; y: number; zoom: number }

interface PixiSceneProps {
  agents: GameAgent[]
  tasks: GameTask[]
  texCache: TexCache | null
  onSelectAgent: (id: string) => void
  viewport: Viewport
}

function PixiScene({ agents, tasks, texCache, onSelectAgent, viewport }: PixiSceneProps) {
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const agentsByStation = new Map<string, string[]>()
  for (const sid of Object.keys(STATIONS)) agentsByStation.set(sid, [])
  for (const agent of [...agents].sort((a, b) => a.id.localeCompare(b.id))) {
    const sid = agent.currentStation ?? 'relaxation'
    const target = agentsByStation.get(sid) ?? agentsByStation.get('relaxation')!
    target.push(agent.id)
  }

  return (
    <pixiContainer x={viewport.x} y={viewport.y} scale={viewport.zoom}>
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
    </pixiContainer>
  )
}

// ── OfficeCanvas — manages Pixi lifecycle ─────────────────────────────────────

const BASE_APP_OPTIONS = {
  background: FLOOR_BG,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
}

interface OfficeCanvasProps {
  agents: GameAgent[]
  tasks: GameTask[]
  onSelectAgent: (agentId: string) => void
  zoomSensitivity?: number
}

export default function OfficeCanvas({ agents, tasks, onSelectAgent, zoomSensitivity = 0.08 }: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appRef = useRef<any>(null)
  const rootRef = useRef<PixiRoot | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [texCache, setTexCache] = useState<TexCache | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const dragRef = useRef<{ active: boolean; moved: boolean; lastX: number; lastY: number }>({ active: false, moved: false, lastX: 0, lastY: 0 })

  // Dynamically resize PixiJS renderer to fill container
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const w = Math.round(width)
      const h = Math.round(height)
      if (w > 0 && h > 0 && appRef.current) {
        appRef.current.renderer.resize(w, h)
      }
    })
    obs.observe(wrap)
    return () => obs.disconnect()
  }, [])

  // Wheel handler — non-passive to allow preventDefault
  // ctrlKey=true  → pinch gesture (zoom)
  // ctrlKey=false → two-finger scroll (pan)
  const sensitivityRef = useRef(zoomSensitivity)
  sensitivityRef.current = zoomSensitivity

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey) {
        // Pinch to zoom — browser normalises pinch delta to same scale as scroll
        const s = sensitivityRef.current
        const factor = e.deltaY < 0 ? (1 + s) : 1 / (1 + s)
        setViewport((prev) => {
          const newZoom = Math.max(0.15, Math.min(5, prev.zoom * factor))
          const rect = wrap.getBoundingClientRect()
          const mx = e.clientX - rect.left
          const my = e.clientY - rect.top
          const wx = (mx - prev.x) / prev.zoom
          const wy = (my - prev.y) / prev.zoom
          return { zoom: newZoom, x: mx - wx * newZoom, y: my - wy * newZoom }
        })
      } else {
        // Two-finger scroll — pan
        setViewport((prev) => ({ ...prev, x: prev.x - e.deltaX, y: prev.y - e.deltaY }))
      }
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    dragRef.current = { active: true, moved: false, lastX: e.clientX, lastY: e.clientY }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active) return
    const dx = e.clientX - dragRef.current.lastX
    const dy = e.clientY - dragRef.current.lastY
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (!dragRef.current.moved && dist < 3) return
    dragRef.current.moved = true
    dragRef.current.lastX = e.clientX
    dragRef.current.lastY = e.clientY
    setViewport((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
  }, [])

  const onPointerUp = useCallback(() => {
    dragRef.current.active = false
  }, [])

  const handleZoomSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setViewport((prev) => ({ ...prev, zoom: Number(e.target.value) }))
  }, [])

  const resetView = useCallback(() => {
    setViewport({ x: 0, y: 0, zoom: 1 })
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const { width, height } = wrap.getBoundingClientRect()
    const initW = Math.round(width) || CANVAS_W
    const initH = Math.round(height) || CANVAS_H

    const root = createRoot(canvas, {
      onInit: (app) => {
        appRef.current = app
        setIsReady(true)
      }
    })
    rootRef.current = root

    void root.render(<></>, { ...BASE_APP_OPTIONS, width: initW, height: initH })

    void Promise.all(
      SPRITE_URLS.map((url) => Assets.load<Texture>(url).then((tex) => [url, tex] as [string, Texture]))
    )
      .then((entries) => setTexCache(buildTexCache(entries)))
      .catch(() => {})

    return () => {
      rootRef.current = null
      appRef.current = null
    }
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!isReady || !root) return
    const w = appRef.current?.renderer.width ?? CANVAS_W
    const h = appRef.current?.renderer.height ?? CANVAS_H
    void root.render(
      <PixiScene agents={agents} tasks={tasks} texCache={texCache} onSelectAgent={onSelectAgent} viewport={viewport} />,
      { ...BASE_APP_OPTIONS, width: w, height: h }
    )
  }, [isReady, agents, tasks, texCache, onSelectAgent, viewport])

  return (
    <div
      ref={wrapRef}
      style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {/* Zoom controls overlay */}
      <div style={{
        position: 'absolute', bottom: 12, left: 12,
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(16,13,10,0.82)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '4px 8px', backdropFilter: 'blur(4px)',
      }}>
        <button
          style={{ padding: '2px 7px', fontSize: '1rem', lineHeight: 1, minWidth: 0 }}
          onClick={() => setViewport((p) => ({ ...p, zoom: Math.max(0.15, p.zoom / (1 + sensitivityRef.current * 3)) }))}
        >−</button>
        <input
          type="range" min="0.15" max="5" step="0.01"
          value={viewport.zoom}
          onChange={handleZoomSlider}
          style={{ width: 90, cursor: 'pointer', accentColor: 'var(--accent)' }}
        />
        <button
          style={{ padding: '2px 7px', fontSize: '1rem', lineHeight: 1, minWidth: 0 }}
          onClick={() => setViewport((p) => ({ ...p, zoom: Math.min(5, p.zoom * (1 + sensitivityRef.current * 3)) }))}
        >+</button>
        <span style={{ fontSize: '0.68rem', fontFamily: 'var(--mono)', color: 'var(--text-dim)', minWidth: 32 }}>
          {Math.round(viewport.zoom * 100)}%
        </span>
        <button
          style={{ padding: '2px 6px', fontSize: '0.68rem', lineHeight: 1, minWidth: 0, color: 'var(--text-dim)' }}
          onClick={resetView}
        >↺</button>
      </div>
    </div>
  )
}
