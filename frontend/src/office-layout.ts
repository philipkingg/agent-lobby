export const CANVAS_W = 900
export const CANVAS_H = 540
export const SPRITE_SCALE = 3   // 16px tiles → 48px rendered

export interface SlotPos { x: number; y: number }

export interface Station {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
  color: number
  labelColor: number
  slots: SlotPos[]
  animation: 'idle_anim' | 'sit2' | 'phone'
}

export const STATIONS: Record<string, Station> = {
  planning: {
    id: 'planning', label: 'Planning Board',
    x: 8, y: 8, w: 200, h: 260,
    color: 0x0c1a0c, labelColor: 0x4caf50,
    animation: 'idle_anim',
    slots: [
      { x: 28, y: 50 }, { x: 118, y: 50 },
      { x: 28, y: 158 }, { x: 118, y: 158 },
    ],
  },
  desks: {
    id: 'desks', label: 'Work Desks',
    x: 218, y: 8, w: 430, h: 370,
    color: 0x0a0a1e, labelColor: 0x5c8de0,
    animation: 'sit2',
    slots: [
      { x: 258, y: 58 }, { x: 368, y: 58 }, { x: 478, y: 58 },
      { x: 258, y: 168 }, { x: 368, y: 168 }, { x: 478, y: 168 },
      { x: 258, y: 278 }, { x: 368, y: 278 }, { x: 478, y: 278 },
    ],
  },
  meeting: {
    id: 'meeting', label: 'Meeting Room',
    x: 658, y: 8, w: 234, h: 260,
    color: 0x1a0c1a, labelColor: 0xab47bc,
    animation: 'phone',
    slots: [
      { x: 668, y: 50 }, { x: 748, y: 50 },
      { x: 668, y: 158 }, { x: 748, y: 158 },
    ],
  },
  relaxation: {
    id: 'relaxation', label: 'Relaxation',
    x: 8, y: 278, w: 200, h: 254,
    color: 0x0c1a16, labelColor: 0x26a69a,
    animation: 'idle_anim',
    slots: [
      { x: 28, y: 328 }, { x: 118, y: 328 },
      { x: 28, y: 438 }, { x: 118, y: 438 },
    ],
  },
  'pr-wall': {
    id: 'pr-wall', label: 'PR Wall',
    x: 658, y: 278, w: 234, h: 254,
    color: 0x1a0e06, labelColor: 0xff7043,
    animation: 'sit2',
    slots: [
      { x: 668, y: 328 }, { x: 748, y: 328 },
      { x: 668, y: 438 }, { x: 748, y: 438 },
    ],
  },
}

/** Returns the station + slot index for a given agent position. */
export function getAgentSlot(
  agentId: string,
  stationId: string,
  agentsAtStation: string[],
): SlotPos {
  const station = STATIONS[stationId] ?? STATIONS['relaxation']
  const idx = agentsAtStation.indexOf(agentId)
  const slotIdx = Math.max(0, idx) % station.slots.length
  return station.slots[slotIdx]
}
