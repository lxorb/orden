/** The emoji's outlines the set does not draw, drawn at build time out of Google's Noto
 *  Emoji (#1097).
 *
 *  Fluent Emoji High Contrast draws 1,594 of the 1,914 base emoji. The rest are the flags,
 *  the newest emoji, the families and couples, and the one drawing that fills its box
 *  (`FILLS_ITS_BOX`); left alone they were the colour emoji in a grid of outlines. Noto
 *  Emoji is the monochrome font Google draws every emoji in, flags included (a flag
 *  waving with its letters on it), under the SIL Open Font Licence. Its glyphs are turned
 *  into the set's own shape here - a body in a 32 unit box, filled in `currentColor` - so
 *  the app draws them as it draws the rest, under the name the app looks them up by.
 *
 *  At build time rather than as a font in the app: what ships is the few hundred drawings
 *  wanted, not 11 MB of font, and nothing on the device has to lay out a ligature. The
 *  regular weight, which is the one whose stroke is the set's. */

import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { FILLS_ITS_BOX, outlineName } from './src/lib/outline-names'

/** What the app imports the drawings as; see `loadOutlines` in icon-sets.ts. */
const NOTO_OUTLINES = 'virtual:noto-outlines'

const RESOLVED = `\0${NOTO_OUTLINES}`

/** The box the set draws in, and the margin its drawings keep inside it. */
const BOX = 32
const DRAWN = 30

interface Command {
  command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath'
  args: number[]
}

interface Glyph {
  id: number
  path: {
    commands: Command[]
    bbox: { minX: number; minY: number; maxX: number; maxY: number }
  }
}

interface Font {
  layout(text: string): { glyphs: Glyph[] }
}

const LETTER: Record<Command['command'], string> = {
  moveTo: 'M',
  lineTo: 'L',
  quadraticCurveTo: 'Q',
  bezierCurveTo: 'C',
  closePath: 'Z',
}

/** A number to a tenth of a unit, which in a 64 pixel mark is a fifth of a pixel. */
function short(value: number): string {
  return String(Math.round(value * 10) / 10).replace(/^(-?)0\./, '$1.')
}

/** A glyph as a body in the set's box: turned the right way up, and fitted to the box the
 *  way the set's own drawings are, centred, with a unit of air on the longer side. */
function bodyOf(glyph: Glyph): string {
  const { minX, minY, maxX, maxY } = glyph.path.bbox
  const scale = DRAWN / Math.max(maxX - minX, maxY - minY)
  const x = (value: number) => BOX / 2 + (value - (minX + maxX) / 2) * scale
  const y = (value: number) => BOX / 2 - (value - (minY + maxY) / 2) * scale

  let d = ''
  let last = ''
  for (const { command, args } of glyph.path.commands) {
    const points: string[] = []
    for (let at = 0; at + 1 < args.length; at += 2) {
      points.push(`${short(x(args[at] ?? 0))} ${short(y(args[at + 1] ?? 0))}`)
    }
    // A command that repeats the one before needs no letter of its own.
    const letter = LETTER[command]
    d += (letter === last && 'LQC'.includes(letter) ? ' ' : letter) + points.join(' ')
    last = letter
  }

  return `<path fill="currentColor" d="${d.replace(/ -/g, '-')}"/>`
}

/** The one glyph a font draws an emoji as - a family is one glyph for its seven code
 *  points - or null where it draws none. */
function glyphOf(fonts: readonly Font[], emoji: string): Glyph | null {
  for (const font of fonts) {
    const { glyphs } = font.layout(emoji)
    const [only] = glyphs
    if (glyphs.length === 1 && only && only.id !== 0) return only
  }

  return null
}

interface EmojiGroup {
  emojis: { emoji: string; slug: string }[]
}

interface Iconify {
  icons: Record<string, unknown>
  aliases?: Record<string, unknown>
}

let drawn: Record<string, string> | null = null

/** Every drawing filled in, by the name the app looks it up by. */
export function notoOutlines(): Record<string, string> {
  if (drawn) return drawn

  const require = createRequire(import.meta.url)
  const fontkit = require('fontkit') as { openSync: (path: string) => Font }
  const fontFiles = resolve(dirname(require.resolve('@fontsource/noto-emoji/LICENSE')), 'files')
  const groups = require('unicode-emoji-json/data-by-group.json') as EmojiGroup[]
  const set = require('@iconify-json/fluent-emoji-high-contrast/icons.json') as Iconify
  const chars = require('@iconify-json/fluent-emoji-high-contrast/chars.json') as Record<
    string,
    string
  >
  // Fontsource cuts the font into pieces by character range; a flag is in one, a family
  // in another.
  const fonts = readdirSync(fontFiles)
    .filter((name) => name.endsWith('-400-normal.woff2'))
    .sort()
    .map((name) => fontkit.openSync(resolve(fontFiles, name)))

  const found: Record<string, string> = {}
  const lacking: string[] = []
  for (const group of groups) {
    for (const one of group.emojis) {
      const name = outlineName(one.emoji, one.slug, chars)
      const drawnByTheSet = name in set.icons || name in (set.aliases ?? {})
      if (drawnByTheSet && !FILLS_ITS_BOX.has(name)) continue

      const glyph = glyphOf(fonts, one.emoji)
      if (glyph) found[name] = bodyOf(glyph)
      else lacking.push(one.emoji)
    }
  }

  // A build that would ship an emoji in colour among the outlines says so, rather than
  // the picker saying it to whoever scrolls past.
  if (lacking.length) throw new Error(`Noto Emoji draws no ${lacking.join(' ')}`)

  drawn = found
  return found
}

/** The plugin that serves them, in the app's build and in its tests. */
export function emojiOutlines() {
  return {
    name: 'nib-emoji-outlines',
    resolveId: (source: string) => (source === NOTO_OUTLINES ? RESOLVED : null),
    load: (id: string) =>
      id === RESOLVED ? `export default ${JSON.stringify(notoOutlines())}\n` : null,
  }
}
