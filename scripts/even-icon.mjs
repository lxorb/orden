/* The Orden mark as the Even Hub portal wants it: greyscale, no colour anywhere,
   as a foreground and a background of the same size.

   The portal takes the two separately and rejects a colour asset outright; the
   sizes it wants are not published, so this writes 24 and 256 and Emil uploads
   whichever the field asks for. The mark is the one in mark.mjs, in greys: the
   bars are white and the tile around them is dark, which is the only way a shape
   reads on a panel that lights pixels rather than inking them.

     node scripts/even-icon.mjs [directory]      (default docs/even) */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inSquircle, onBars, png } from './mark.mjs'

/** The two greys. The ground is not black: an icon that is only a silhouette
   loses its tile on a dark list, and a fifth of the way up is enough to hold
   the shape without competing with the mark. */
const INK = 255
const GROUND = 52

const mark = (x, y) => (inSquircle(x, y) ? (onBars(x, y) ? INK : GROUND) : null)

/** The background the portal asks for beside the icon: the same tile with nothing
   on it, so the two sit exactly on top of one another. */
const ground = (x, y) => (inSquircle(x, y) ? GROUND : null)

const out = process.argv[2] ?? join('docs', 'even')
mkdirSync(out, { recursive: true })

for (const size of [24, 256]) {
  writeFileSync(join(out, `icon-${size}.png`), png(size, mark, { grey: true }))
  writeFileSync(join(out, `icon-background-${size}.png`), png(size, ground, { grey: true }))
  console.log(`${out}/icon-${size}.png and its background, ${size}x${size}, greyscale`)
}
