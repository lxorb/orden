import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { pointerSnap, snapOutward } from './snap'
import { nibMarkdownExtensions } from '../markdown/extensions'

/** Somewhere to park the caret that is outside every construct under test. */
const PARK = '\n\nx'

function state(doc: string, cursor: number) {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [
      markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
      pointerSnap,
    ],
  })
}

/** Where the caret ends up after a click that CodeMirror mapped to `pos`,
 *  with the caret previously parked away from the sample. */
function click(doc: string, pos: number, parkedAt?: number): number {
  const full = parkedAt === undefined ? doc + PARK : doc
  const before = state(full, parkedAt ?? full.length)
  const after = before.update({
    selection: EditorSelection.cursor(pos),
    userEvent: 'select.pointer',
  })
  return after.state.selection.main.head
}

describe('inline code', () => {
  const doc = 'a `code` b'
  // a=0 ' '=1 `=2 code=3..6 `=7 ' '=8 b=9

  test('a click at the right edge lands after the closing backtick', () => {
    expect(click(doc, 7)).toBe(8)
  })

  test('a click at the left edge lands before the opening backtick', () => {
    expect(click(doc, 3)).toBe(2)
  })

  test('a click inside the code stays where it was', () => {
    expect(click(doc, 5)).toBe(5)
  })

  test('a click already outside stays put', () => {
    expect(click(doc, 8)).toBe(8)
    expect(click(doc, 2)).toBe(2)
  })

  test('visible marks are not stepped over', () => {
    // Caret already in the span, so its backticks are shown and unambiguous.
    expect(click(doc, 7, 4)).toBe(7)
    expect(click(doc, 3, 4)).toBe(3)
  })
})

describe('emphasis', () => {
  test('bold', () => {
    const doc = '**bold** x'
    expect(click(doc, 6)).toBe(8)
    expect(click(doc, 2)).toBe(0)
  })

  test('italic, strikethrough and highlight', () => {
    expect(click('_i_ x', 2)).toBe(3)
    expect(click('~~s~~ x', 3)).toBe(5)
    expect(click('==h== x', 3)).toBe(5)
  })

  test('nested constructs snap all the way out', () => {
    const doc = '**bold `code`** x'
    // Closing backtick starts at 12; the bold ends at 15.
    expect(click(doc, 12)).toBe(15)
    // Opening backtick ends at 8; bold starts at 0 but the caret is not at
    // the bold's own edge, so it stops before the backtick.
    expect(click(doc, 8)).toBe(7)
  })

  test('adjacent constructs meet between their marks', () => {
    const doc = '**a**`b`'
    // Between the visible a and b, whichever side the browser picked.
    expect(click(doc, 3)).toBe(5)
    expect(click(doc, 6)).toBe(5)
  })
})

describe('links', () => {
  test('the whole target is stepped over', () => {
    const doc = 'see [docs](https://x.dev) now'
    const label = doc.indexOf('docs')
    expect(click(doc, label + 4)).toBe(doc.indexOf(')') + 1)
    expect(click(doc, label)).toBe(doc.indexOf('['))
  })

  test('a title after a space is part of the target', () => {
    const doc = 'see [docs](https://x.dev "t") now'
    expect(click(doc, doc.indexOf(']'))).toBe(doc.indexOf(')') + 1)
  })
})

describe('constructs that are not applicable', () => {
  test('a rendered image is already atomic', () => {
    const doc = '![](pic.png)'
    expect(click(doc, 0)).toBe(0)
    expect(click(doc, doc.length)).toBe(doc.length)
  })

  test('inline math is replaced wholesale', () => {
    const doc = 'mass $E$ here'
    expect(click(doc, 5)).toBe(5)
    expect(click(doc, 8)).toBe(8)
  })

  test('block marks follow the line, not the click', () => {
    expect(click('# Title', 2)).toBe(2)
    expect(click('> quoted', 2)).toBe(2)
  })

  test('marks that open a whole line are block marks too', () => {
    // Front matter: a click on the concealed opening line stays there.
    const front = '---\ntitle: Hi\n---\n\nbody'
    expect(click(front, 3)).toBe(3)
    // Definition detail, footnote definition, abbreviation definition.
    expect(click('Term\n: a meaning', 6)).toBe(6)
    expect(click('[^1]: the note', 4)).toBe(4)
    expect(click('*[HTML]: Markup', 2)).toBe(2)
  })

  test('a footnote reference in prose still snaps', () => {
    const doc = 'text[^1] more'
    expect(click(doc, 7)).toBe(8)
  })
})

describe('only clicks', () => {
  test('keyboard selection changes are left alone', () => {
    const before = state('a `code` b' + PARK, 12)
    const after = before.update({ selection: EditorSelection.cursor(7) })
    expect(after.state.selection.main.head).toBe(7)
  })

  test('dragged ranges are left alone', () => {
    const before = state('a `code` b' + PARK, 12)
    const after = before.update({
      selection: EditorSelection.range(3, 7),
      userEvent: 'select.pointer',
    })
    expect(after.state.selection.main).toMatchObject({ from: 3, to: 7 })
  })

  test('the pure function reports the same landing spots', () => {
    const doc = 'a `code` b' + PARK
    expect(snapOutward(state(doc, doc.length), 7)).toBe(8)
    expect(snapOutward(state(doc, doc.length), 3)).toBe(2)
  })
})
