import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { noReveal } from './live-preview/reveal'
import { nibMarkdownExtensions } from './markdown/extensions'
import { GAP, mathsAtCaret, mathsInText, place } from './maths-preview'
import { parsed } from '../test/parsed'

/** A note with the caret where the `|` is, or the selection between two of them. */
function at(written: string, ...extensions: Extension[]) {
  const first = written.indexOf('|')
  const second = written.indexOf('|', first + 1)
  const doc = written.replaceAll('|', '')
  const selection =
    second === -1 ? EditorSelection.cursor(first) : EditorSelection.range(first, second - 1)
  return parsed(
    EditorState.create({
      doc,
      selection,
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        ...extensions,
      ],
    }),
  )
}

const tex = (written: string, ...extensions: Extension[]) =>
  mathsAtCaret(at(written, ...extensions))?.tex ?? null

describe('the formula the caret is in', () => {
  test('inline, anywhere inside it and against either dollar', () => {
    expect(tex('so $a^|2$ holds')).toBe('a^2')
    expect(tex('so |$a^2$ holds')).toBe('a^2')
    expect(tex('so $a^2$| holds')).toBe('a^2')
    expect(mathsAtCaret(at('so $a^2$ holds'))).toBeNull()
  })

  test('outside it there is none', () => {
    expect(tex('so| $a^2$ holds')).toBeNull()
    expect(tex('words $a$ and |more')).toBeNull()
    expect(tex('costs $5 and $|6')).toBeNull()
  })

  test('of two on a line, the one the caret is in', () => {
    expect(tex('$x$ and $y|$')).toBe('y')
    expect(tex('$x|$ and $y$')).toBe('x')
  })

  test('a display block, on any of its lines', () => {
    const block = mathsAtCaret(at('above\n\n$$\n\\frac{1}{2}\n+ |x\n$$\n\nbelow'))
    expect(block).toMatchObject({ tex: '\\frac{1}{2}\n+ x', block: true })
    expect(tex('$$|\nx\n$$')).toBe('x')
    expect(tex('$$\nx\n$$|')).toBe('x')
  })

  test('a display block written on one line', () => {
    expect(tex('$$E = m|c^2$$')).toBe('E = mc^2')
  })

  test('a display block still being written, with no closing $$ yet', () => {
    expect(tex('$$\na + |b')).toBe('a + b')
  })

  test('in a quote or a callout, without the > of each line', () => {
    expect(tex('> [!note]\n> $$\n> a +| b\n> $$')).toBe('a + b')
    expect(tex('> so $x^|2$')).toBe('x^2')
  })

  test('in a list item and a heading', () => {
    expect(tex('- item $\\alpha|$')).toBe('\\alpha')
    expect(tex('# Title $\\beta|$')).toBe('\\beta')
  })

  test('a selection inside it counts, one reaching past it does not', () => {
    expect(tex('so $|a^2|$ holds')).toBe('a^2')
    expect(tex('s|o $a^2|$ holds')).toBeNull()
  })

  test('none where nothing can be typed or nothing is revealed', () => {
    expect(tex('$a|$', EditorState.readOnly.of(true))).toBeNull()
    expect(tex('$a|$', noReveal.of(true))).toBeNull()
  })

  test('none in a fence, where a dollar is code', () => {
    expect(tex('```\n$a|$\n```')).toBeNull()
    expect(tex('so `$a|$` here')).toBeNull()
  })
})

describe('the formula in a table cell', () => {
  test('read by the note’s parser', () => {
    expect(mathsInText('so $x^2$ here', 5)).toMatchObject({ from: 3, to: 8, tex: 'x^2' })
    expect(mathsInText('so $x^2$ here', 1)).toBeNull()
    expect(mathsInText('$5 and $6', 4)).toBeNull()
  })
})

describe('where the preview goes', () => {
  const visible = { top: 100, bottom: 700, left: 50, right: 650 }
  const row = (top: number) => ({ top, bottom: top + 20, left: 200, right: 210 })
  const size = { width: 120, height: 40 }

  test('above the row being typed, aligned with the formula', () => {
    expect(place(row(400), 180, visible, size, null)).toEqual({
      top: 400 - GAP - 40,
      left: 180,
      above: true,
      maxHeight: null,
    })
  })

  test('below when there is no room above, at the top of the note', () => {
    const placed = place(row(110), 180, visible, size, null)
    expect(placed).toMatchObject({ above: false, top: 130 + GAP })
  })

  test('stays on its side while it still fits there', () => {
    // Room for it above now, but it was below a keystroke ago: no jump.
    expect(place(row(160), 180, visible, size, false)?.above).toBe(false)
    expect(place(row(160), 180, visible, size, null)?.above).toBe(true)
    // And back above once it no longer fits below.
    expect(place(row(670), 180, visible, size, false)?.above).toBe(true)
  })

  test('inside the pane, however far right the formula starts', () => {
    expect(place(row(400), 600, visible, size, null)?.left).toBe(650 - GAP - 120)
    expect(place(row(400), 10, visible, size, null)?.left).toBe(50 + GAP)
  })

  test('cut to the room there is when it is taller than either side', () => {
    const tall = { width: 120, height: 500 }
    const placed = place(row(400), 180, visible, tall, null)
    expect(placed).toMatchObject({ above: true, maxHeight: 400 - 100 - GAP, top: 100 })
  })

  test('nowhere when the caret has been scrolled out of the pane', () => {
    expect(place(row(20), 180, visible, size, null)).toBeNull()
    expect(place(row(720), 180, visible, size, null)).toBeNull()
  })
})
