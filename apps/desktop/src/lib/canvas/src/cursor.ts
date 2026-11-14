import type { HandleId } from '../../plane/src/api'

const BIGGEST = 120

export type Over = HandleId | 'port' | 'turn' | 'thing' | null

export interface Look {
  tool: 'select' | 'hand' | 'draw' | 'erase' | 'lasso' | 'put'
  busy: boolean
  holding: boolean
  over: Over
  nib: { size: number; colour: string }
  rub: { size: number; whole: boolean }
}

const PULLS: Record<HandleId, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}

export function cursorFor(look: Look): string {
  if (look.holding) return look.busy ? 'grabbing' : 'grab'

  switch (look.tool) {
    case 'hand':
      return look.busy ? 'grabbing' : 'grab'
    case 'draw':
      return nibCursor(look.nib.size, look.nib.colour)
    case 'erase':
      return rubCursor(look.rub)
    case 'lasso':
    case 'put':
      return 'crosshair'
    case 'select':
      break
  }

  if (look.over === 'port') return 'pointer'
  if (look.over === 'turn') return 'grab'
  if (look.over === 'thing') return 'move'
  if (look.over) return PULLS[look.over]

  return 'default'
}

export function nibCursor(size: number, colour: string): string {
  const across = Math.min(BIGGEST, Math.max(6, Math.round(size)))
  const room = across + 4
  const middle = room / 2

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${room}" height="${room}">` +
    `<circle cx="${middle}" cy="${middle}" r="${across / 2}" fill="${escaped(colour)}"` +
    ` stroke="#fff" stroke-width="1" stroke-opacity="0.85"/>` +
    `<circle cx="${middle}" cy="${middle}" r="${across / 2 + 1}" fill="none"` +
    ` stroke="#000" stroke-width="0.75" stroke-opacity="0.4"/>` +
    `</svg>`

  return `${drawn(svg)} ${Math.round(middle)} ${Math.round(middle)}, crosshair`
}

export function rubCursor(rub: { size: number; whole: boolean }): string {
  const across = Math.min(BIGGEST, Math.max(rub.whole ? 12 : 6, Math.round(rub.size * 2)))
  const room = across + 4
  const middle = room / 2

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${room}" height="${room}">` +
    `<circle cx="${middle}" cy="${middle}" r="${across / 2}" fill="#fff" fill-opacity="0.18"` +
    ` stroke="#000" stroke-width="2" stroke-opacity="0.45"${rub.whole ? ' stroke-dasharray="3 2"' : ''}/>` +
    `<circle cx="${middle}" cy="${middle}" r="${across / 2 - 1}" fill="none"` +
    ` stroke="#fff" stroke-width="1" stroke-opacity="0.9"${rub.whole ? ' stroke-dasharray="3 2"' : ''}/>` +
    `</svg>`

  return `${drawn(svg)} ${Math.round(middle)} ${Math.round(middle)}, crosshair`
}

function drawn(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function escaped(colour: string): string {
  return colour.replace(/[^#a-zA-Z0-9(),.%\s-]/g, '')
}
