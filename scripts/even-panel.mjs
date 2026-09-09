/* The panel as a picture, for the docs and for looking at.

   Nobody outside Even Realities has the firmware's font, so a preview cannot be
   drawn with the real glyphs. What it can be drawn with is the real *metrics*:
   `@evenrealities/pretext` carries the advance width of every codepoint the
   firmware has, so every character can be placed at exactly the pixel the glasses
   will place it at, and the bands, the rules, the gutter and the wrapping are then
   right to the pixel even though the letterforms are a stand-in.

   So what these pictures prove is the layout, and they are honest about the rest.

   Reads a JSON array of screens on stdin, or from a file named as the first
   argument:

     [{ "name": "note", "head": "...", "rule": "...", "nums": "...",
        "body": "...", "foot": "...", "mic": "●", "lineNumbers": true }]

   and writes one HTML file per screen next to it, each 576 by 288, which
   `scripts/even-e2e.py` screenshots.

     node scripts/even-panel.mjs target/even-e2e/screens.json */

import { getAdvW, getTextWidth } from '@evenrealities/pretext'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Where each band sits. The same numbers as `packages/glasses/src/panel.ts`,
   because both ends of this have to agree on them to the pixel; a test in that
   package is what holds them together. */
const LINE = 27
const WIDTH = 576
const HEIGHT = 288
const MARGIN = 8
const NUMS = 48

function bands(lineNumbers) {
  return {
    head: { x: MARGIN, y: 2, width: WIDTH - MARGIN - 42, colour: 4 },
    mic: { x: WIDTH - 34, y: 2, width: 26, colour: 3 },
    rule: { x: MARGIN, y: 29, width: WIDTH - 2 * MARGIN, colour: 2 },
    // Over the left of the body rather than beside it; the note's own rows carry a
    // constant indent to clear it. See `packages/glasses/src/panel.ts`.
    nums: { x: MARGIN, y: 56, width: lineNumbers ? NUMS : 0, colour: 2 },
    body: { x: MARGIN, y: 56, width: WIDTH - 2 * MARGIN, colour: 4 },
    foot: { x: MARGIN, y: 256, width: WIDTH - 2 * MARGIN, colour: 2 },
  }
}

/** The firmware's five brightnesses, as the green a G2 lights.
   Level zero is a pixel that is off, which on these glasses is see-through. */
const GREEN = ['#0c150f', '#2f7d52', '#49b072', '#63d98d', '#8bffb0']

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The glyphs a stand-in face draws badly, drawn as rules instead.
 *
 *  A box drawing character is a line that reaches both edges of its advance, and
 *  the firmware's does; a text face's does not, so a run of them comes out as a row
 *  of dashes with gaps where the firmware draws a solid rule. Since a rule is the
 *  one piece of structure the panel has, drawing it wrong would misrepresent the
 *  thing these pictures exist to show. Each is a stack of bands down its own line,
 *  as a fraction of the 27 pixels it sits in. */
const RULES = {
  '─': [[0.52, 0.07]],
  '━': [[0.48, 0.15]],
  '═': [
    [0.4, 0.07],
    [0.63, 0.07],
  ],
  '│': null,
  '┃': null,
}

/** Every character of a row, at the pixel the firmware will put it at.
 *
 *  Per glyph, and each advance rounded on its own, which is what LVGL does; see
 *  pretext's own note about it. Kerning is left out here: it moves a character by at
 *  most a pixel and carrying it would mean carrying pretext's tables too. */
function glyphs(text, left, top) {
  // The advances summed one at a time come out a few percent wider than the
  // firmware sets the same row, because the firmware kerns and pretext only exposes
  // kerning inside its own measurement. So the row is laid out per glyph and then
  // pulled back to the width the row actually measures: every character is within a
  // pixel of where the glasses put it, and the end of the line is exact.
  let sum = 0
  for (const one of text) sum += Math.round(getAdvW(one.codePointAt(0) ?? 32) / 16)
  const scale = sum > 0 ? getTextWidth(text) / sum : 1

  let x = left
  const out = []
  for (const one of text) {
    const code = one.codePointAt(0) ?? 32
    const advance = Math.round(getAdvW(code) / 16) * scale
    const rule = Object.hasOwn(RULES, one) ? RULES[one] : undefined
    const at = Math.round(x)
    const room = Math.max(1, Math.round(x + advance) - at)

    if (rule) {
      for (const [down, deep] of rule) {
        out.push(
          `<b style="left:${String(at)}px;top:${String(Math.round(top + down * LINE))}px;width:${String(room)}px;height:${String(Math.max(1, Math.round(deep * LINE)))}px"></b>`,
        )
      }
    } else if (rule === null) {
      // The uprights, which are a band down rather than across.
      out.push(
        `<b style="left:${String(at + Math.floor(room / 2))}px;top:${String(top)}px;width:2px;height:${String(LINE)}px"></b>`,
      )
    } else if (one !== ' ') {
      out.push(
        `<i style="left:${String(at)}px;top:${String(top)}px;width:${String(room)}px">${escape(one)}</i>`,
      )
    }

    x += advance
  }

  return out
}

function screen(one) {
  const where = bands(one.lineNumbers !== false)
  const out = []

  for (const [name, band] of Object.entries(where)) {
    const words = String(one[name] ?? '')
    if (!words.trim()) continue

    for (const [at, row] of words.split('\n').entries()) {
      const top = band.y + at * LINE
      if (top + LINE > HEIGHT) break

      out.push(`<span class="c${String(band.colour)}">${glyphs(row, band.x, top).join('')}</span>`)
    }
  }

  return `<!doctype html>
<meta charset="utf-8" />
<title>${escape(String(one.name ?? 'panel'))}</title>
<style>
  html,
  body {
    margin: 0;
    padding: 0;
    background: #000;
  }

  /* The panel itself: 576 by 288, and nothing outside it. */
  .panel {
    position: relative;
    width: ${String(WIDTH)}px;
    height: ${String(HEIGHT)}px;
    overflow: hidden;
    background: #000;
    font-family: 'Segoe UI', 'Noto Sans', system-ui, sans-serif;
    /* Under the firmware's own average advance rather than at it, because the
       stand-in face is wider per character and a picture whose letters touch each
       other says the panel is fuller than it is. The positions are the firmware's
       either way; only the letterforms are borrowed. */
    font-size: 16px;
    font-variant-ligatures: none;
    line-height: ${String(LINE)}px;
  }

  /* One glyph, at the pixel the firmware puts it at and in the room it takes
     there. Centred in that room, because the stand-in face is not the firmware's
     and the difference is better spread than left on one side. */
  i {
    position: absolute;
    display: inline-block;
    height: ${String(LINE)}px;
    font-style: normal;
    text-align: center;
    white-space: pre;
  }

  /* A rule, as the firmware draws one: a band that reaches both edges of its own
     advance, so a run of them is solid rather than a row of dashes. */
  b {
    position: absolute;
    display: block;
  }

  ${GREEN.map(
    (colour, at) => `.c${String(at)} i { color: ${colour}; }
  .c${String(at)} b { background: ${colour}; }`,
  ).join('\n  ')}
</style>
<div class="panel">
${out.join('\n')}
</div>
`
}

const where = process.argv[2]
if (!where) {
  console.error('usage: node scripts/even-panel.mjs <screens.json>')
  process.exit(1)
}

const screens = JSON.parse(readFileSync(where, 'utf8'))
const into = dirname(where)
for (const one of screens) {
  const name = String(one.name ?? 'panel')
  writeFileSync(join(into, `${name}.html`), screen(one))
  console.log(`${name}.html`)
}
