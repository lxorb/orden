import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { FILLS_ITS_BOX, outlineName } from './src/lib/outline-names'

const NOTO_OUTLINES = 'virtual:noto-outlines'

const RESOLVED = `\0${NOTO_OUTLINES}`

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

function short(value: number): string {
  return String(Math.round(value * 10) / 10).replace(/^(-?)0\./, '$1.')
}

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
    const letter = LETTER[command]
    d += (letter === last && 'LQC'.includes(letter) ? ' ' : letter) + points.join(' ')
    last = letter
  }

  return `<path fill="currentColor" d="${d.replace(/ -/g, '-')}"/>`
}

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

  if (lacking.length) throw new Error(`Noto Emoji draws no ${lacking.join(' ')}`)

  drawn = found
  return found
}

export function emojiOutlines() {
  return {
    name: 'orden-emoji-outlines',
    resolveId: (source: string) => (source === NOTO_OUTLINES ? RESOLVED : null),
    load: (id: string) =>
      id === RESOLVED ? `export default ${JSON.stringify(notoOutlines())}\n` : null,
  }
}
