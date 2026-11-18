import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { setHeading, shiftHeading } from './commands'

function ran(command: StateCommand, doc: string, from: number, to = from): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  command({ state, dispatch: (transaction) => (state = transaction.state) })
  return state.doc.toString()
}

describe('edit14 headings on item lines', () => {
  test('a heading written in an item changes level instead of gaining a second run of hashes', () => {
    expect(ran(setHeading(2), '- # Item', 5)).not.toMatch(/#+ #/)
    expect(ran(shiftHeading(1), '- # Item', 5)).not.toMatch(/#+ #/)
    expect(ran(setHeading(0), '- # Item', 5)).toBe('- Item')
  })

  test('a heading inside an item can be taken off', () => {
    const doc = '- a\n\n  ## b'
    expect(ran(setHeading(0), doc, doc.indexOf('b'))).toBe('- a\n\n  b')
    expect(ran(setHeading(2), doc, doc.indexOf('b'))).toBe('- a\n\n  b')
  })

  test('a heading made on a paragraph of an item stays in the item', () => {
    const doc = '- a\n\n  b'
    expect(ran(setHeading(2), doc, doc.indexOf('b'))).toBe('- a\n\n  ## b')
  })
})

describe('edit14 headings over a selection holding blocks that keep their lines', () => {
  test('front matter keeps its lines', () => {
    const doc = '---\ntitle: x\n---\n\npara'
    expect(ran(setHeading(2), doc, 0, doc.length)).toBe('---\ntitle: x\n---\n\n## para')
    expect(ran(shiftHeading(1), doc, 0, doc.length)).toBe('---\ntitle: x\n---\n\n# para')
  })

  test('a maths block keeps its lines', () => {
    const doc = 'a\n\n$$\nx = 1\n$$\n\nb'
    expect(ran(setHeading(2), doc, 0, doc.length)).toBe('## a\n\n$$\nx = 1\n$$\n\n## b')
  })

  test('an HTML block keeps its lines', () => {
    const doc = 'a\n\n<div>\nhi\n</div>\n\nb'
    expect(ran(setHeading(2), doc, 0, doc.length)).toBe('## a\n\n<div>\nhi\n</div>\n\n## b')
  })
})
