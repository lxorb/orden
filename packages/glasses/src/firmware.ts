/** The firmware's own type, and what it cannot draw.
 *
 *  A text container on the G2 has no typography at all: one font baked into the
 *  firmware, no family, no size, no weight, no slant, no alignment, a fixed 27
 *  pixel line, five levels of brightness. So every decision text mode makes -
 *  which glyph stands for a bullet, how wide a rule is, where a line breaks, how
 *  a page number reaches the right hand edge - is a question about that one font,
 *  and this is the only file that asks it.
 *
 *  It asks `@evenrealities/pretext`, which carries the metrics lifted out of the
 *  LVGL fonts in the firmware and models the same shaping the glasses do. That
 *  matters much more than it sounds, because of one fact that is not written down
 *  anywhere: **a codepoint the firmware has no glyph for is drawn as nothing at
 *  all.** Zero pixels wide, no box, no gap, no error. It does not fail, it
 *  vanishes.
 *
 *  Measured here against those metrics, the font has no `✓`, no `☐`, no `☑`, no
 *  `◦`, no `▸`, no tab, none of the thin spaces, and - the one that decides how a
 *  fence is written - **no backtick**. A note with a task list in it was a note
 *  with holes where its checkboxes should be, and ``` reached the glasses as an
 *  empty line.
 *
 *  `fold` is the answer: everything the font cannot draw becomes something it
 *  can, so the reader sees a character rather than a silence. Nothing in a note
 *  is dropped, which is the whole promise of text mode. */

import { getAdvW, getTextWidth, measureTextWrap } from '@evenrealities/pretext'
import { which as emojiNamed } from 'node-emoji'

/** The firmware's line, in pixels. Fixed, and not ours to choose. */
export const LINE = 27

/** Whether the firmware has a glyph for this codepoint.
 *
 *  A zero advance is how a miss comes back: `getAdvW` walks the fallback chain -
 *  Latin, then Cyrillic and Greek, then CJK, then the emoji font - and answers
 *  zero when none of them has it, which is exactly what the glasses then draw. */
export function draws(code: number): boolean {
  return getAdvW(code) !== 0
}

/** Characters that are meant to be invisible, and so are not a loss.
 *
 *  The zero width joiners, the variation selector that follows an emoji, the
 *  directional marks, the soft hyphen. The font has none of them and wants none
 *  of them: without this every `❤️` would come out as a heart followed by a box,
 *  because the selector after it is a codepoint like any other. */
function formatting(code: number): boolean {
  return (
    code === 0x00ad ||
    code === 0x061c ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x206a && code <= 0x206f) ||
    code === 0xfeff ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0xe0100 && code <= 0xe01ef)
  )
}

/** What a character the font lacks is drawn as instead.
 *
 *  Every pair was checked against the firmware metrics: the left hand side draws
 *  nothing, the right hand side draws. They are chosen by shape rather than by
 *  meaning, because the reader is looking at a shape.
 *
 *  The first entry is the one that decides the most. A grave accent is a tick
 *  leaning left; so is a left single quote, and the firmware has that one. It is
 *  how ``` reaches the glasses at all. */
const INSTEAD: Readonly<Record<string, string>> = {
  '`': '‘',
  // A tick the font has: the radical sign is the same stroke as a check mark.
  '✓': '√',
  '✔': '√',
  '☑': '■',
  '☐': '□',
  '☒': '■',
  '✗': '×',
  '✘': '×',
  '✕': '×',
  '✖': '×',
  '◦': '·',
  '∙': '·',
  '∘': '°',
  '‣': '•',
  '⁃': '-',
  '▪': '■',
  '▫': '□',
  '▢': '□',
  '◉': '◎',
  '⊕': '⊙',
  // The shades and half blocks it is missing, as the ones it has.
  '░': '▒',
  '▓': '▒',
  '▀': '▔',
  '▐': '▕',
  // The double box rules, as single ones.
  '║': '│',
  '╔': '┌',
  '╗': '┐',
  '╚': '└',
  '╝': '┘',
  '╠': '├',
  '╣': '┤',
  '╦': '┬',
  '╩': '┴',
  '╬': '┼',
  // The dashed rules, as solid ones.
  '┄': '─',
  '┅': '─',
  '┈': '─',
  '┉': '─',
  '╌': '─',
  '╍': '─',
  '┆': '│',
  '┇': '│',
  '┊': '│',
  '┋': '│',
  // The small triangles, as the large ones.
  '▸': '▶',
  '▹': '▶',
  '▾': '▼',
  '▿': '▼',
  '◂': '◀',
  '◃': '◀',
  '►': '▶',
  '◄': '◀',
  '∅': 'Ø',
  '∆': 'Δ',
  '⋮': ':',
  '⋯': '…',
  '⏎': '¶',
  '↵': '¶',
  '☰': '≡',
  '≣': '≡',
  '⁕': '*',
  '∗': '*',
  '⁎': '*',
  '⁂': '*',
  '‾': '_',
  '‗': '_',
  '¯': '-',
  '´': "'",
  '¨': '"',
  '‑': '-',
  '‒': '-',
  '∕': '/',
  '∖': '\\',
  '⇐': '←',
}

/** What the backtick is drawn as, said out loud because a fence is written with
 *  three of them and the mapping table is the only reason they show up at all. */
export const TICK = INSTEAD['`'] ?? '‘'

/** What is drawn when nothing else will do.
 *
 *  A box is the convention for a glyph that is not there, and being seen is the
 *  entire point: a reader who cannot read a character has at least been told
 *  there is one. */
const TOFU = '□'

/** How wide one step of a tab is, in spaces.
 *
 *  The font has no glyph for a tab, so a fence indented with tabs was a fence
 *  with no indentation at all. Two, because the panel is 28 characters of box
 *  drawing wide and four would spend a quarter of a line on one level. */
const TAB = 2

/** Cached per codepoint. A page is a couple of thousand characters, almost all
 *  of them ASCII, and the ones that are not are usually the same few. */
const folded = new Map<number, string>()

/** Whether every character of a string can be drawn as it stands. */
function drawable(text: string): boolean {
  for (const one of text) {
    if (!draws(one.codePointAt(0) ?? 0)) return false
  }

  return text !== ''
}

/** Marks that hang off the letter before them, which the firmware has none of.
 *
 *  Composing first means almost none of these are ever reached: `e` and an acute
 *  become `é`, which the font has. What is left is a mark with no precomposed
 *  form, and the right thing to do with one of those is to drop it and keep the
 *  letter, rather than to put a box after it. */
const COMBINING = /^\p{Mn}$/u

/** One character the firmware can draw, for one it cannot.
 *
 *  In order: the table above; nothing at all for something meant to be
 *  invisible; a compatibility decomposition, which rescues a whole class at once
 *  (`ⁿ` is `n`, `⁽` is `(`, `ﬁ` is `fi`, `µ` is `μ`); the same with the combining
 *  marks taken off, for an accent with no precomposed form; the emoji's own name,
 *  which carries far more than a box does; and a box. */
function insteadOf(one: string, code: number): string {
  const mapped = INSTEAD[one]
  if (mapped !== undefined) return mapped
  if (formatting(code)) return ''

  const wide = one.normalize('NFKD')
  if (wide !== one && drawable(wide)) return wide

  const bare = wide.replace(/\p{Mn}/gu, '')
  if (bare !== one && drawable(bare)) return bare

  const name = emojiNamed(one, { markdown: true })
  if (name) return name

  return COMBINING.test(one) ? '' : TOFU
}

/** A string the firmware can actually draw, character for character.
 *
 *  Newlines are left alone: the container breaks on them, and they are the only
 *  control character that means anything to it. Everything else that would draw
 *  nothing becomes something that draws. */
export function fold(text: string): string {
  let out = ''
  let column = 0

  // Composed first, because the firmware has no combining marks at all: `e`
  // followed by an acute is two codepoints, one of which draws nothing, and `é`
  // is one the font has. Notes written on a Mac arrive decomposed.
  for (const one of text.normalize('NFC')) {
    if (one === '\n') {
      out += one
      column = 0
      continue
    }

    if (one === '\t') {
      const gap = TAB - (column % TAB)
      out += ' '.repeat(gap)
      column += gap
      continue
    }

    const code = one.codePointAt(0) ?? 0
    // ASCII, which the font has all of but the backtick. The fast path, because
    // almost every character of almost every note is here.
    if (code < 0x80) {
      out += code === 0x60 ? TICK : one
      column += 1
      continue
    }

    let known = folded.get(code)
    if (known === undefined) {
      // Formatting before drawing, because the font does have a glyph for some
      // of them: a soft hyphen in the middle of a word would come out as a
      // hyphen in the middle of a word.
      known = formatting(code) ? '' : draws(code) ? one : insteadOf(one, code)
      folded.set(code, known)
    }

    out += known
    column += known.length
  }

  return out
}

/** How wide a line is on the panel, in pixels, as the firmware will set it.
 *
 *  Folded first: a character the font lacks measures zero, so a line measured
 *  unfolded fits and then does not. */
export function width(text: string): number {
  return getTextWidth(fold(text))
}

/** How many of the firmware's lines a string takes in a container this wide.
 *
 *  An empty string takes one: it is the space between two paragraphs and the
 *  container gives it a line like any other. `measureTextWrap` answers zero for
 *  it, which would let a page hold any number of blank lines and then overflow. */
export function rows(text: string, inner: number): number {
  if (text === '') return 1
  return Math.max(1, measureTextWrap(fold(text), inner).lineCount)
}

/** A string cut to fit a width, with an ellipsis where it was cut.
 *
 *  Its own rather than pretext's `pxTruncate`, which appends three full stops:
 *  the font has a single ellipsis at ten pixels, half the width of those, and it
 *  reads as one mark rather than as a pause. */
export function fit(text: string, most: number): string {
  const whole = fold(text)
  if (getTextWidth(whole) <= most) return whole

  const room = most - getTextWidth('…')
  if (room <= 0) return ''

  let taken = ''
  for (const one of whole) {
    if (getTextWidth(taken + one) > room) break
    taken += one
  }

  return `${taken.trimEnd()}…`
}

/** The width of a space, in pixels. The only unit padding comes in. */
export const SPACE = getAdvW(0x20) / 16

/** A line with `text` pushed against the right hand edge of `inner` pixels.
 *
 *  A text container has no alignment of any kind, so the only way to put a page
 *  number where a page number belongs is to measure the gap and spend it on
 *  spaces. A space is five pixels, so the edge is met within five pixels, which
 *  on a 576 pixel panel is under one percent of it. */
export function rightward(text: string, inner: number): string {
  const whole = fold(text)
  const gap = Math.floor((inner - getTextWidth(whole)) / SPACE)
  return gap > 0 ? ' '.repeat(gap) + whole : whole
}

/** A run of one glyph, as wide as it goes without passing `inner`.
 *
 *  What a rule is made of. Every box drawing character is exactly twenty pixels,
 *  so twenty eight of them are 560, which is the body's own width to the pixel:
 *  a rule reaches exactly as far as a full line of text reaches. */
export function ruleOf(glyph: string, inner: number): string {
  const one = width(glyph)
  if (one <= 0) return ''

  return glyph.repeat(Math.max(1, Math.floor(inner / one)))
}
