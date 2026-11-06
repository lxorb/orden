export interface Feel {
  response: number
  damping: number
}

export const FLIGHT: Feel = { response: 0.38, damping: 0.86 }

const LONGEST = 1 / 240

export const PIXELS = 0.5

export const SHARE = 0.004

export interface Spring {
  at: number
  speed: number
  to: number
  rest: number
}

export function spring(at: number, rest = PIXELS): Spring {
  return { at, speed: 0, to: at, rest }
}

export function step(one: Spring, seconds: number, feel: Feel = FLIGHT): void {
  const stiffness = (2 * Math.PI) / feel.response
  const k = stiffness * stiffness
  const c = 2 * feel.damping * stiffness

  let left = Math.min(seconds, 0.1)
  while (left > 0) {
    const dt = Math.min(left, LONGEST)
    one.speed += (-k * (one.at - one.to) - c * one.speed) * dt
    one.at += one.speed * dt
    left -= dt
  }

  if (resting(one)) {
    one.at = one.to
    one.speed = 0
  }
}

export function resting(one: Spring): boolean {
  return Math.abs(one.at - one.to) < one.rest && Math.abs(one.speed) < one.rest * 10
}

export function land(one: Spring): void {
  one.at = one.to
  one.speed = 0
}
