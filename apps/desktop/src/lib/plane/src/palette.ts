import { DEFAULT_INK, PRESET_COLOURS, type CanvasColour } from '@orden/markdown/canvas'
import type { Palette } from './paint'

export { DEFAULT_INK } from '@orden/markdown/canvas'

export function shownColour(colour: CanvasColour | undefined): string | null {
  if (colour === undefined) return null
  if (PRESET_COLOURS.some((one) => one === colour)) return `var(--canvas-${colour})`

  return colour
}

export function shownInk(colour: string): string {
  if (colour === DEFAULT_INK) return 'var(--text-strong)'
  return shownColour(colour) ?? 'var(--text-strong)'
}

export function readPalette(element: Element): Palette {
  const style = getComputedStyle(element)
  const palette: Palette = {}

  for (const colour of PRESET_COLOURS) {
    palette[colour] = style.getPropertyValue(`--canvas-${colour}`).trim() || '#888'
  }

  for (const [name, token, fallback] of TOKENS) {
    palette[name] = style.getPropertyValue(token).trim() || fallback
  }

  return palette
}

export function paletteOf(scheme: 'light' | 'dark'): Palette {
  const probe = document.createElement('div')
  probe.dataset.theme = scheme
  probe.hidden = true
  document.body.append(probe)

  try {
    return readPalette(probe)
  } finally {
    probe.remove()
  }
}

const TOKENS: readonly [string, string, string][] = [
  ['accent', '--accent', '#4c6ef5'],
  [DEFAULT_INK, '--text-strong', '#111111'],
  ['text', '--text', '#1f2933'],
  ['muted', '--muted', '#8a9099'],
  ['line', '--line-strong', '#d6d9de'],
  ['surface', '--surface', '#ffffff'],
  ['bg', '--bg', '#fbfbfd'],
  ['dot', '--canvas-dot', '#d5dce5'],
]
