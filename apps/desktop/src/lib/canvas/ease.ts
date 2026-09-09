/** Coming up to a number rather than jumping to it.
 *
 *  What the other hands on a plane need. Presence arrives in packets - twenty a
 *  second at best, fewer over a slow line - and drawing each one where it lands
 *  makes somebody else's pointer hop across the page. Easing towards the latest
 *  point instead turns the same packets into a pointer that moves, which is what a
 *  hand does.
 *
 *  Critically damped and frame-rate independent: the share of the remaining
 *  distance covered depends on how long the frame took, so a slow frame catches up
 *  in one step rather than dropping behind. There is no overshoot, because a
 *  pointer that sails past where somebody is pointing and comes back is worse than
 *  one that hops. */

/** How far towards `to` a step of `dt` milliseconds gets, given a time constant.
 *
 *  `tau` is the time it takes to close about two thirds of the gap. Zero, or a
 *  reader who has asked for as little movement as possible, arrives at once. */
export function approach(from: number, to: number, dt: number, tau: number): number {
  if (tau <= 0 || dt <= 0) return to

  const share = 1 - Math.exp(-dt / tau)
  return from + (to - from) * share
}

/** How near is near enough to stop: half a plane unit, which is under a pixel at
 *  any zoom anybody reads at. */
const ARRIVED = 0.5

/** Whether a point has come near enough to its target to be put there and left
 *  alone, which is what stops a frame loop running for ever over a gap of nothing. */
export function arrived(
  from: { x: number; y: number },
  to: { x: number; y: number },
  unit = 1,
): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) <= ARRIVED * unit
}
