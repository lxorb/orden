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
  test.each([
    ['**bold** x', 8, 6],
    ['**bold** x', 0, 2],
    ['**bold `code`** x', 15, 12],
    ['**bold `code`** x', 7, 8],
    ['**a**`b`', 5, 3],
    ['**a**`b`', 5, 6],
  ])('%j', (input, wanted, extra) => expect(click(input, extra)).toBe(wanted))

  test.each([
    ['_i_ x', 3, 2],
    ['~~s~~ x', 5, 3],
    ['==h== x', 5, 3],
  ])('%j', (input, wanted, extra) => expect(click(input, extra)).toEqual(wanted))
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

  test.each([
    ['mass $E$ here', 5, 5],
    ['mass $E$ here', 8, 8],
    ['---\ntitle: Hi\n---\n\nbody', 3, 3],
    ['Term\n: a meaning', 6, 6],
    ['[^1]: the note', 4, 4],
    ['*[HTML]: Markup', 2, 2],
    ['text[^1] more', 8, 7],
  ])('%j', (input, wanted, extra) => expect(click(input, extra)).toBe(wanted))

  test.each([
    ['# Title', 2, 2],
    ['> quoted', 2, 2],
  ])('%j', (input, wanted, extra) => expect(click(input, extra)).toEqual(wanted))
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

  test.each([
    [state('a `code` b' + PARK, ('a `code` b' + PARK).length), 8, 7],
    [state('a `code` b' + PARK, ('a `code` b' + PARK).length), 2, 3],
  ])('%j', (input, wanted, extra) => expect(snapOutward(input, extra)).toBe(wanted))
})
