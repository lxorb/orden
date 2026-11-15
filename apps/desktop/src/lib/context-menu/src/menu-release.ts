export const SLOP = 4

export type Release = 'choose' | 'close' | 'stay'

export function released(
  from: { x: number; y: number },
  at: { x: number; y: number },
  under: 'row' | 'menu' | 'outside',
): Release {
  if (Math.hypot(at.x - from.x, at.y - from.y) <= SLOP) return 'stay'
  if (under === 'row') return 'choose'
  return under === 'menu' ? 'stay' : 'close'
}

const MODIFIERS = new Set(['Control', 'Meta', 'Alt', 'AltGraph', 'Shift', 'CapsLock'])

export function shortcutPassesBy(press: { key: string; ctrlKey: boolean; metaKey: boolean }) {
  return (press.ctrlKey || press.metaKey) && !MODIFIERS.has(press.key)
}
