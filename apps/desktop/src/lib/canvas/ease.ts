export function approach(from: number, to: number, dt: number, tau: number): number {
  if (tau <= 0 || dt <= 0) return to

  const share = 1 - Math.exp(-dt / tau)
  return from + (to - from) * share
}

const ARRIVED = 0.5

export function arrived(
  from: { x: number; y: number },
  to: { x: number; y: number },
  unit = 1,
): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) <= ARRIVED * unit
}
