/** The line a pen would write, for the panel that sets one.
 *
 *  Not an impression of it: a stroke is built here and handed to the same
 *  outliner the plane uses, so what the panel shows is what the nib will do. A
 *  fountain pen swells in the middle, a brush tapers to nothing and a chisel nib
 *  goes thin on the turn, while the slider is still moving. */

import { type InkPoint, type InkStroke } from './format'
import { inkPath, outlineOf } from './ink'
import type { Nib } from './pens.svelte'

const SAMPLES = 44

/** How hard the hand presses along the sample line: light going in, leaning on
 *  the middle, lifting off at the end, which is what a written word does and what
 *  makes a pressure pen show what it is for. */
function pressureAt(share: number): number {
  return 0.3 + 0.7 * Math.sin(Math.PI * share) ** 0.7
}

/** A written line as this pen would write it, laid across a box of this size.
 *
 *  A stroke and not a picture of one: it goes through the same outliner as the
 *  ink on the plane, so a fountain pen swells, a calligraphy nib turns thin on
 *  the upstroke and a brush tapers to nothing, exactly as they will. */
export function sampleStroke(nib: Nib, width: number, height: number): InkStroke {
  // Room for the nib itself, and then some: a taper puts the outline a little
  // outside the half-width on the outside of a turn, and a fat nib turning is
  // where that shows. Measured rather than guessed; see nibs.test.ts.
  const room = Math.max(nib.size * 0.9, 3) + 2
  const middle = height / 2
  const swing = Math.max(0, height / 2 - room)
  const from = room
  const span = Math.max(1, width - 2 * room)

  // A fat nib writes a broad, slow line and a fine one writes a lively one, so
  // the wave loosens as the pen gets wider. It is also what keeps the ink inside
  // the box: a chisel twenty units across cannot turn sharply in sixty.
  const turns = nib.size > 10 ? 2 : 3

  const points: InkPoint[] = []

  for (let one = 0; one < SAMPLES; one++) {
    const share = one / (SAMPLES - 1)
    points.push({
      x: from + span * share,
      // Up, down and up again, which is enough turning for a flat nib to show
      // both of its widths and for a pressure pen to show its swell.
      y: middle - Math.sin(share * Math.PI * turns) * swing * 0.82,
      pressure: pressureAt(share),
      tiltX: 0,
      tiltY: 0,
      t: Math.round(share * 700),
    })
  }

  return {
    id: 'sample',
    tool: nib.tool,
    color: nib.colour,
    size: nib.size,
    opacity: nib.opacity,
    points,
  }
}

/** The sample line as an SVG path, ready for the popover. */
export function samplePath(nib: Nib, width: number, height: number): string {
  return inkPath(outlineOf(sampleStroke(nib, width, height)))
}
