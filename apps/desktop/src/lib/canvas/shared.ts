/** A plane several devices are drawing on, as the two sides of it see each other.
 *
 *  Two interfaces because there are two halves of one contract, and they are here
 *  rather than in either half so that neither has to import the other: the surface
 *  knows what it may ask of a room, the room knows what it may do to a surface, and
 *  a test can be one without being the other. What a room actually is lives in
 *  `rooms/plane.ts`; what a surface actually is lives in `store.svelte.ts`.
 *
 *  Nothing here draws, talks over a socket or touches a file. */

import type { Canvas, InkStroke } from './format'
import type { Point } from './geometry'

/** Somebody else's hand on the plane: where their pointer is, and the stroke under
 *  their pen while there is one. The canvas's answer to a remote caret, and drawn
 *  in the same accent, with the same name beside it. */
export interface Hand {
  /** Whose it is, as the awareness protocol numbers devices. */
  id: number
  /** The device, or the person, depending on who else is here. */
  name: string
  colour: string
  /** Where the pointer is, in plane units. */
  at: Point
  stroke: InkStroke | null
}

/** The room, as the surface sees it. */
export interface SharedPlane {
  /** Whether there is anything of this device's own to take back. Per device: an
   *  undo never reaches what somebody else drew. */
  readonly canUndo: boolean
  readonly canRedo: boolean
  /** An edit made here, on its way to the others. `after` is already stamped. */
  push: (before: Canvas, after: Canvas) => void
  /** Answers whether there was anything to take back or put forward. */
  undo: () => boolean
  redo: () => boolean
  /** Where this hand is and what it is drawing, on its way to the others. Null for
   *  a pointer that has left the plane. */
  hand: (at: Point | null, drawing: InkStroke | null) => void
}

/** The surface, as the room sees it. */
export interface PlaneSurface {
  /** The plane as it stands. */
  readonly canvas: Canvas
  /** The room this plane is in, while it is in one. Set by the room once it has
   *  said what it holds, and taken away again when the last tab closes. */
  shared: SharedPlane | null
  /** The plane as the room now says it is. */
  arrived: (canvas: Canvas) => void
  /** Who else is on the plane, for the surface to draw. */
  handsAre: (hands: readonly Hand[]) => void
}
