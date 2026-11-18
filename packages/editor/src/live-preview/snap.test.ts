import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { pointerSnap, snapOutward } from './snap'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

const PARK = '\n\nx'

function state(doc: string, cursor: number) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        pointerSnap,
      ],
    }),
  )
}

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

  test.each([
    [doc, 8, 7],
    [doc, 2, 3],
    [doc, 5, 5],
    [doc, 8, 8],
    [doc, 2, 2],
  ])('%j', (input, wanted, extra) => expect(click(input, extra)).toEqual(wanted))

  test.each([
    [doc, 7, 7, 4],
    [doc, 3, 3, 4],
  ])('%j', (input, wanted, extra, last) => expect(click(input, extra, last)).toEqual(wanted))
})

describe('emphasis', () => {
  test('bold', () => {
    const doc = '**bold** x'
    expect(click(doc, 6)).toBe(8)
    expect(click(doc, 2)).toBe(0)
  })

  test.each([
    ['_i_ x', 3, 2],
    ['~~s~~ x', 5, 3],
    ['==h== x', 5, 3],
  ])('%j', (input, wanted, extra) => expect(click(input, extra)).toEqual(wanted))

  test('nested constructs snap all the way out', () => {
    const doc = '**bold `code`** x'
    expect(click(doc, 12)).toBe(15)
    expect(click(doc, 8)).toBe(7)
  })

  test('adjacent constructs meet between their marks', () => {
    const doc = '**a**`b`'
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

  test.each([
    ['# Title', 2, 2],
    ['> quoted', 2, 2],
  ])('%j', (input, wanted, extra) => expect(click(input, extra)).toEqual(wanted))

  test('marks that open a whole line are block marks too', () => {
    const front = '---\ntitle: Hi\n---\n\nbody'
    expect(click(front, 3)).toBe(3)
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
