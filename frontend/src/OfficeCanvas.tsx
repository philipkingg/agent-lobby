import { useEffect, useRef, useState } from 'react'
import { Application, extend, useTick } from '@pixi/react'
import type { AnimatedSprite as AnimatedSpriteType } from 'pixi.js'
import { AnimatedSprite, Assets, Container, Graphics, Rectangle, Text, Texture } from 'pixi.js'
import type { Graphics as GfxT } from 'pixi.js'
import { CANVAS_W, CANVAS_H, STATIONS, SPRITE_SCALE, getAgentSlot, type SlotPos } from './office-layout'
import type { GameAgent, GameTask } from './useGameState'

extend({ Container, Graphics, Text, AnimatedSprite })

const FRAME_W = 16
const FRAME_H = 16
const ANIM_CONFIGS = {
  idle_anim: { frameCount: 8, row: 0 },
  sit2: { frameCount: 8, row: 0 },
  phone: { frameCount: 9, row: 0 },
  run: { frameCount: 8, row: 0 },
  run_up: { frameCount: 8, row: 1 },
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
    const avatarMatch = url.match(/characters\/(\w+)_(\w+)_16x16/)
    if (!avatarMatch) continue
    const [, avatar, animName] = avatarMatch
    const cfg = ANIM_CONFIGS[animName as AnimKey]
    if (!cfg) continue
    const key = `${avatar}_${animName}`
    cache.set(key, makeFrames(baseTex, cfg.frameCount, cfg.row))
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

const FLOOR_BG = 0x0a0907
const FLOOR_TILE_A = 0x100d0a
const FLOOR_TILE_B = 0x0d0b08

function drawFloor(g: GfxT) {
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

function drawStationBg(g: GfxT) {
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
          style={{
            fontFamily: 'monospace',
            fontSize: 9,
            fill: st.labelColor,
            letterSpacing: 1,
            fontWeight: 'bold',
          }}
        />
      ))}
    </>
  )
}

const WALK_SPEED = 4

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

  const texKey = isWalking ? `${agent.avatar}_${walkDir === 'up' ? 'run_up' : 'run'}` : `${agent.avatar}_${animKey}`
  const frames = texCache.get(texKey) ?? texCache.get(`${agent.avatar}_idle_anim`) ?? null

  // Re-play whenever the texture set changes (textures setter stops the animation)
  useEffect(() => {
    spriteRef.current?.play()
  }, [texKey])

  useTick((ticker) => {
    const dx = targetPos.x - posRef.current.x
    const dy = targetPos.y - posRef.current.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const wasWalking = isWalking
    if (dist > 2) {
      const speed = Math.min(WALK_SPEED * ticker.deltaTime, dist)
      posRef.current.x += (dx / dist) * speed
      posRef.current.y += (dy / dist) * speed
      setDisplayPos({ ...posRef.current })
      if (!wasWalking) {
        setIsWalking(true)
        setWalkDir(dy < 0 ? 'up' : 'down')
      }
    } else if (wasWalking) {
      posRef.current.x = targetPos.x
      posRef.current.y = targetPos.y
      setDisplayPos({ x: targetPos.x, y: targetPos.y })
      setIsWalking(false)
    }
  })

  const status = task?.status ?? 'idle'
  const badge = getBadge(status)

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
        ref={(s: AnimatedSpriteType | null) => {
          spriteRef.current = s
          if (s) s.play()
        }}
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

interface OfficeCanvasProps {
  agents: GameAgent[]
  tasks: GameTask[]
  onSelectAgent: (agentId: string) => void
}

export default function OfficeCanvas({ agents, tasks, onSelectAgent }: OfficeCanvasProps) {
  const [texCache, setTexCache] = useState<TexCache | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all(SPRITE_URLS.map((url) => Assets.load<Texture>(url).then((tex) => [url, tex] as [string, Texture])))
      .then((entries) => {
        if (cancelled) return
        setTexCache(buildTexCache(entries))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Slot assignment: stable sort by id within each station
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const agentsByStation = new Map<string, string[]>()
  for (const station of Object.keys(STATIONS)) agentsByStation.set(station, [])
  for (const agent of [...agents].sort((a, b) => a.id.localeCompare(b.id))) {
    const sid = agent.currentStation ?? 'relaxation'
    const target = agentsByStation.get(sid) ?? agentsByStation.get('relaxation')!
    target.push(agent.id)
  }

  return (
    <Application width={CANVAS_W} height={CANVAS_H} background={FLOOR_BG}>
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
    </Application>
  )
}
