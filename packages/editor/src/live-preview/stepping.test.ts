import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { blockDecorations } from './blocks'
import { edgeBeside } from './stepping'
import { dragFreeze } from './dragging'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

function state(doc: string, cursor = 0) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        dragFreeze,
        blockDecorations,
      ],
    }),
  )
}

const moved = (doc: string, to: number) =>
  parsed(state(doc).update({ selection: EditorSelection.cursor(to) }).state)

const FORMULA = 'above\n\n$$\nE = mc^2\n$$\n\nbelow\n'
const at = (doc: string, text: string) => doc.indexOf(text)

describe('a press onto a block that draws itself', () => {
  test('stops at the top of it on the way down', () => {
    const doc = FORMULA
    const blank = at(doc, '\n\n$$') + 1
    expect(edgeBeside(state(doc, blank), blank, true)).toBe(at(doc, '$$'))
  })

  test('and at the bottom of it on the way up', () => {
    const doc = FORMULA
    const blank = at(doc, '$$\n\nbelow') + 3
    expect(edgeBeside(state(doc, blank), blank, false)).toBe(at(doc, '$$\n\nbelow') + 2)
  })

  test.each([
    [state(FORMULA, 0), null, 0, true],
    [state(FORMULA, at(FORMULA, 'below')), null, at(FORMULA, 'below'), false],
    [state('one\ntwo\nthree\n', 0), null, 0, true],
    [state('one\ntwo\nthree\n', 5), null, 5, false],
    [state(FORMULA, 0), null, 0, false],
    [state(FORMULA, FORMULA.length), null, FORMULA.length, true],
  ])('%j', (input, wanted, extra, last) => expect(edgeBeside(input, extra, last)).toBe(wanted))

  test('nothing for the block the caret is already in, which is showing its source', () => {
    const doc = FORMULA
    const inside = at(doc, 'E = mc')
    expect(edgeBeside(moved(doc, inside), inside, false)).toBe(null)
    expect(edgeBeside(moved(doc, inside), inside, true)).toBe(null)
  })

  const META = '---\ntitle: One\n---\n\nwords\n'

  test('nothing for front matter, which is written out as it is and has nothing to open', () => {
    const blank = at(META, '\nwords')
    expect(edgeBeside(state(META, blank), blank, false)).toBe(null)
  })
})
