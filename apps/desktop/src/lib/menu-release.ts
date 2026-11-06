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
