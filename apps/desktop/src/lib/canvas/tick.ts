import { viewport } from '../ui-kit/src/api'

const TICK = 8

export function tick(): void {
  if (!viewport.touch || typeof navigator === 'undefined') return

  if (typeof navigator.vibrate !== 'function') return

  try {
    navigator.vibrate(TICK)
  } catch {
    // A browser that has the method and refuses the call, which some do inside
    // an iframe or before the first gesture. Nothing is lost but the knock.
  }
}
