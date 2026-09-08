/** How a pen is pictured: the drawing of it in the bar, and the line it writes.
 *
 *  A row of seven identical glyphs with different scribbles inside them is a
 *  puzzle. A row of pens is not: a fountain pen, a pencil sharpened to a point, a
 *  fat chisel-tipped marker and a wide flat highlighter are told apart in
 *  silhouette, from across a table, by anybody who has ever held one. So each pen
 *  is drawn as itself, standing on its nib, and the nib is filled with the ink
 *  that pen writes in at the alpha it writes at: the drawing of the pen is also
 *  the swatch for its colour and the read-out of its dials.
 *
 *  Three paths each, so one `<svg>` shape draws all seven and the theme decides
 *  what a barrel looks like: the barrel, a detail on it - a collar, a ferrule, the
 *  facets of a hexagonal pencil - and the nib.
 *
 *  The line a pen writes is the app's own ink, not an impression of it: a stroke
 *  is built here and handed to the same outliner the plane uses, so what the
 *  popover shows is what the nib will do. */

import { type InkPoint, type InkStroke, type InkTool } from './format'
import { inkPath, outlineOf } from './ink'
import type { Nib } from './pens.svelte'

/** The box every pen is drawn in. Tall and narrow, tip at the bottom. */
export const PEN_BOX = { width: 22, height: 44 } as const

export interface PenArt {
  /** The body of the pen, in a neutral. */
  barrel: string
  /** A collar, a ferrule or the facets of a pencil, a shade darker. */
  detail: string
  /** The nib, filled with what the pen writes in. Wound with `evenodd`, so a
   *  fountain pen's slit is a gap rather than another path. */
  nib: string
}

export const PEN_ART: Record<InkTool, PenArt> = {
  /** A slim barrel and a cone to a fine ball. */
  pen: {
    barrel: 'M9.2 2h3.6a1.6 1.6 0 0 1 1.6 1.6V24H7.6V3.6A1.6 1.6 0 0 1 9.2 2z',
    detail: 'M7.6 24h6.8v2.6H7.6z',
    nib: 'M7.6 26.6h6.8L11.8 38.4 11 42.6l-.8-4.2z',
  },
  /** A pointed nib with a slit up the middle of it. */
  fountain: {
    barrel: 'M8.8 2h4.4a1.6 1.6 0 0 1 1.6 1.6V22H7.2V3.6A1.6 1.6 0 0 1 8.8 2z',
    detail: 'M7.2 22h7.6v2.4H7.2z',
    nib: 'M7.2 24.4h7.6v7.2L11 42.6 7.2 31.6zM10.5 27.6h1v10.4h-1z',
  },
  /** Hexagonal, and sharpened to a long point. */
  pencil: {
    barrel: 'M7.4 2h7.2v22H7.4z',
    detail: 'M9.4 2h1.1v22H9.4zM12.1 2h.9v22h-.9z',
    nib: 'M7.4 24h7.2L11 42.6z',
  },
  /** Chunkier, ending in a broad chisel. */
  marker: {
    barrel: 'M7.4 2h7.2a1.6 1.6 0 0 1 1.6 1.6V20H5.8V3.6A1.6 1.6 0 0 1 7.4 2z',
    detail: 'M5.8 20h10.4v2.6H5.8z',
    nib: 'M6.4 22.6h9.2v10.8l-2.4 6.4H8.8l-2.4-6.4z',
  },
  /** The widest of them, flat right across. */
  highlighter: {
    barrel: 'M6.2 2h9.6a1.6 1.6 0 0 1 1.6 1.6V18H4.6V3.6A1.6 1.6 0 0 1 6.2 2z',
    detail: 'M4.6 18h12.8v2.8H4.6z',
    nib: 'M5 20.8h12v11.4l-1.8 7.6H6.8L5 32.2z',
  },
  /** A soft bundle in a ferrule, coming to a point. */
  brush: {
    barrel: 'M9.4 2h3.2a1.6 1.6 0 0 1 1.6 1.6V18H7.8V3.6A1.6 1.6 0 0 1 9.4 2z',
    detail: 'M6.6 18h8.8v3.4H6.6z',
    nib: 'M6.6 21.4c0 4.6.7 8.8 2.1 12.6L11 42.6l2.3-8.6c1.4-3.8 2.1-8 2.1-12.6z',
  },
  /** A flat nib cut at an angle, which is what makes the line thick one way and
   *  thin the other. */
  calligraphy: {
    barrel: 'M7.8 2h6.4a1.6 1.6 0 0 1 1.6 1.6V21H6.2V3.6A1.6 1.6 0 0 1 7.8 2z',
    detail: 'M6.2 21h9.6v2.4H6.2z',
    nib: 'M6.2 23.4h9.6v7L7.6 41.8 6.2 36z',
  },
}

/** How many points the sample line is drawn through. Enough that the curve is a
 *  curve and few enough that building it on every drag of a slider is free. */
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
