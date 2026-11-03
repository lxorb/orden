/** How a window of the overview moves: a spring per number, each carrying its speed.
 *
 *  A tween knows where it started and when it ends, so a tween asked to go somewhere
 *  else halfway either jumps to its new start or stops dead and sets off again. A spring
 *  only knows where it is, how fast it is going and where it is pulled to, so pointing it
 *  somewhere new mid-flight bends the path it is already on: Alt Alt pressed again while
 *  the windows are still arriving sends them back from wherever they are, at the speed
 *  they had (issue #331). That is the whole of why this is a spring.
 *
 *  Described the way Apple's SwiftUI describes one, by how long it takes to answer and
 *  how much it is allowed to overshoot, rather than by stiffness and friction, which
 *  nobody can picture. Pure: the clock is handed in, so every case is a test. */

/** How a spring feels. */
export interface Feel {
  /** Seconds for one swing, were it allowed to swing: how quick it is. */
  response: number
  /** 1 comes to rest without passing the target; below 1 passes it a little. */
  damping: number
}

/** The windows coming out and going home: quick, with the least overshoot a hand can
 *  feel, so a window lands rather than stops. */
export const FLIGHT: Feel = { response: 0.38, damping: 0.86 }

/** A step no longer than this, however long the frame was: a frame dropped while the
 *  layer mounted must not throw a window past where it is going. */
const LONGEST = 1 / 240

/** Close enough to stop, for a number in pixels: under half of one, and as slow as a
 *  pixel every few frames. A window waiting on the last hundredth of a pixel is a strip
 *  waiting for its tabs back. */
export const PIXELS = 0.5

/** And for a share between 0 and 1. */
export const SHARE = 0.004

/** One number on a spring, and how near is near enough for it. */
export interface Spring {
  at: number
  speed: number
  to: number
  rest: number
}

export function spring(at: number, rest = PIXELS): Spring {
  return { at, speed: 0, to: at, rest }
}

/** Moves `one` on by `seconds`. */
export function step(one: Spring, seconds: number, feel: Feel = FLIGHT): void {
  const stiffness = (2 * Math.PI) / feel.response
  const k = stiffness * stiffness
  const c = 2 * feel.damping * stiffness

  let left = Math.min(seconds, 0.1)
  while (left > 0) {
    const dt = Math.min(left, LONGEST)
    // Semi-implicit Euler: the speed first, then the place from the new speed, which
    // keeps a stiff spring from gaining energy at a long step.
    one.speed += (-k * (one.at - one.to) - c * one.speed) * dt
    one.at += one.speed * dt
    left -= dt
  }

  if (resting(one)) {
    one.at = one.to
    one.speed = 0
  }
}

/** Whether it has arrived and stopped. */
export function resting(one: Spring): boolean {
  return Math.abs(one.at - one.to) < one.rest && Math.abs(one.speed) < one.rest * 10
}

/** Puts it where it is going with no movement at all: what reduced motion asks. */
export function land(one: Spring): void {
  one.at = one.to
  one.speed = 0
}
