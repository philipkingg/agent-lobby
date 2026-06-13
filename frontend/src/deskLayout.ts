export const MAX_DESKS = 12
export const DESKS_PER_ROW = 4
export const DESK_SIZE = 80
export const DESK_GAP = 40
export const DESK_MARGIN = 60

export function deskPosition(index: number): { x: number; y: number } {
  const col = index % DESKS_PER_ROW
  const row = Math.floor(index / DESKS_PER_ROW)
  return {
    x: DESK_MARGIN + col * (DESK_SIZE + DESK_GAP),
    y: DESK_MARGIN + row * (DESK_SIZE + DESK_GAP),
  }
}

export function officeSize(): { width: number; height: number } {
  const rows = Math.ceil(MAX_DESKS / DESKS_PER_ROW)
  return {
    width: DESK_MARGIN * 2 + DESKS_PER_ROW * DESK_SIZE + (DESKS_PER_ROW - 1) * DESK_GAP,
    height: DESK_MARGIN * 2 + rows * DESK_SIZE + (rows - 1) * DESK_GAP,
  }
}
