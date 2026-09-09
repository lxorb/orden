/** The pattern behind the plane: one lattice of points, thinned as the plane goes out.
 *
 *  The points are on the plane, not on the screen. The finest lattice is the grid a
 *  node lands on and its spacing in plane units never changes, at any zoom; what
 *  changes is how many of its points are drawn. Zoomed out, every second point along
 *  each axis stops being drawn, so what is left is the same lattice at twice the
 *  spacing. Every level is exactly twice the one before it, so the points that stay
 *  are always a subset of the points that were there: the pattern only ever thins. It
 *  never shifts, and it never closes up.
 *
 *  Two rules keep it calm.
 *
 *  The level is chosen with hysteresis: a level thins when its points have closed to
 *  THINS_AT on screen, and comes back only once the finer level's points have opened
 *  again to FILLS_AT. A zoom resting on a threshold has to go a quarter of the way
 *  back before anything happens, so the pattern cannot flap.
 *
 *  The change itself is a fade over a fixed length of time, started by crossing the
 *  threshold. It is no function of the zoom at all. Blending two levels by the zoom -
 *  which is what this replaced - means the pattern is part of one and part of another
 *  at every scroll position in between, and two lattices at once read as clutter
 *  rather than as a grid.
 *
 *  Where the pattern stands is one number, a position between levels rather than an
 *  opacity, so a single fade carries it across any number of levels: heading from two
 *  to four it passes through three, and each level's points leave in turn instead of
 *  a whole level popping away. Which is why a fling out is smooth and not a stack of
 *  jumps.
 *
 *  Pure, and here rather than in the component, because all of it is arithmetic:
 *  which level the zoom asks for, how far through the fade the pattern is, and the
 *  one or two tiles that draws. */

import { GRID } from './geometry'

/** How close the points may come on screen, in pixels, before the lattice thins.
 *  Under this they stop reading as points and start reading as a wash. */
const THINS_AT = 12

/** How far apart the finer level's points must have opened again, in pixels, before
 *  it comes back. The gap between this and THINS_AT is the hysteresis, and it is a
 *  quarter: crossing a threshold and drifting back over it does nothing. */
const FILLS_AT = 15

/** As far out as the levels go. The camera stops at a twenty-fifth, which is four
 *  levels; a plane can arrive from a file, a share or a room with a camera in it that
 *  nobody here chose, so what bounds the count is this rather than the zoom. */
const MOST = 32

/** How faint a layer may be before it is not worth drawing. */
const FAINTEST = 0.004

/** Plane units between one level's points: the grid itself, doubled once per level. */
export function latticeEvery(level: number): number {
  return GRID * 2 ** level
}

/** Which level a zoom asks for, given the one already in force.
 *
 *  Two loops rather than a formula, because the answer depends on where the pattern
 *  is now: the first thins the lattice while its points are too close together, the
 *  second brings a finer one back once there is comfortably room for it. Only one of
 *  them can ever run, so the answer is settled and asking again of the answer gives
 *  the answer back. */
export function latticeLevel(scale: number, held = 0): number {
  let level = Number.isFinite(held) ? Math.min(MOST, Math.max(0, Math.round(held))) : 0

  // Not a zoom: the level stands, since there is nothing to work an answer out of.
  if (!(scale > 0) || !Number.isFinite(scale)) return level

  const finest = GRID * scale

  while (level < MOST && finest * 2 ** level < THINS_AT) level++
  while (level > 0 && finest * 2 ** (level - 1) >= FILLS_AT) level--

  return level
}

/** A fade, in flight or standing still. */
export interface Fade {
  /** Where the pattern stands, in levels. Whole means one lattice and nothing
   *  moving; between two whole numbers means the finer of the two is on its way out
   *  or on its way in. Never below zero: no level draws more points than the grid. */
  at: number
  /** The level this tween set off from, so a retarget picks up from wherever the last
   *  one had got to. */
  from: number
  /** The level it is heading for. */
  to: number
  /** Milliseconds gone of this tween. */
  gone: number
}

/** A pattern standing still at a level, which is how a plane opens. */
export function settled(level: number): Fade {
  const at = Math.max(0, level)
  return { at, from: at, to: at, gone: 0 }
}

/** The same fade, now heading for `to`.
 *
 *  A level change in the middle of a fade retargets the fade that is running - from
 *  where it has reached, over a full duration again - rather than queueing behind it.
 *  The reader has scrolled on, and what they are looking at has to be going where
 *  they are going. */
export function aimed(fade: Fade, to: number): Fade {
  const level = Math.max(0, to)
  if (level === fade.to) return fade

  return { at: fade.at, from: fade.at, to: level, gone: 0 }
}

/** Whether the pattern is still moving, which is what keeps a frame loop going. */
export function fading(fade: Fade): boolean {
  return fade.at !== fade.to
}

/** The fade `dt` milliseconds on, over a tween of `ms`.
 *
 *  Eased out, the house curve for something arriving or leaving: the points go
 *  promptly and settle rather than sliding away at one rate. A duration of nothing -
 *  which is what a reader who has asked for as little movement as possible is given;
 *  see motion.ts - arrives at once, so the pattern simply is the level asked for. */
export function stepped(fade: Fade, dt: number, ms: number): Fade {
  if (!fading(fade)) return fade

  const gone = fade.gone + Math.max(0, dt)
  if (!(ms > 0) || gone >= ms) return settled(fade.to)

  const through = gone / ms
  const eased = 1 - (1 - through) ** 3

  return { at: fade.from + (fade.to - fade.from) * eased, from: fade.from, to: fade.to, gone }
}

/** One tile of the pattern: a lattice, and how much of it is showing. */
export interface LatticeLayer {
  /** Plane units between its points, which is what makes it the same tile from one
   *  frame to the next. */
  every: number
  /** Pixels between them on screen, which is what a repeating tile is sized by. */
  step: number
  /** 0 to 1. */
  showing: number
}

function tile(level: number, scale: number, showing: number): LatticeLayer {
  const every = latticeEvery(level)
  return { every, step: every * scale, showing }
}

/** The tiles a fade standing at `at` draws, coarsest first.
 *
 *  One tile when the pattern is settled, which is nearly always. Two while it is
 *  moving, and they are always neighbours: the coarser of the pair at full strength,
 *  because its points belong to every level out here and are going nowhere, and the
 *  finer one - the points that are leaving, or arriving - at the fade's own strength
 *  over it. Coarsest first so the points the two share come out the colour they
 *  always were.
 *
 *  So the cost is one repeating tile, two for a fifth of a second while a threshold
 *  is being crossed, however far the plane reaches and however many points are in
 *  view. */
export function latticeLayers(at: number, scale: number): LatticeLayer[] {
  if (!(scale > 0) || !Number.isFinite(scale) || !Number.isFinite(at)) return []

  const stands = Math.min(MOST, Math.max(0, at))
  const coarse = Math.ceil(stands)
  const showing = coarse - stands

  const layers = [tile(coarse, scale, 1)]
  if (coarse > 0 && showing > FAINTEST) layers.push(tile(coarse - 1, scale, showing))

  return layers
}
