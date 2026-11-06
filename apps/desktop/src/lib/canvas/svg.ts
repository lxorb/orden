import { escapeAll } from '@orden/markdown/html'
import type { InkStroke } from './format'
import { INK_STYLES, inkOpacity, inkPath, outlineOf } from './ink'
import { inkColour, type Palette } from './paint'

export function inkSvg(strokes: readonly InkStroke[], palette: Palette): string {
  const out: string[] = []

  for (const stroke of strokes) {
    const d = inkPath(outlineOf(stroke))
    if (!d) continue

    const colour = escapeAll(inkColour(stroke.color, palette))
    const blend = INK_STYLES[stroke.tool].multiply ? ' style="mix-blend-mode:multiply"' : ''

    out.push(`<path d="${d}" fill="${colour}" fill-opacity="${inkOpacity(stroke)}"${blend}/>`)
  }

  return out.join('')
}
