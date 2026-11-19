import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { reverseLines, sortLines } from './lines'

function ran(command: StateCommand, doc: string, at: string): string {
  const pos = doc.indexOf(at)
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(pos),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  command({ state, dispatch: (transaction) => (state = transaction.state) })
  return state.doc.toString()
}
describe('edit14 sort and reverse lines with the caret in a block that keeps its lines', () => {
  test('front matter keeps its fences round the sorted properties', () => {
    const doc = '---\ntitle: x\nauthor: b\n---\n\npara'
    expect(ran(sortLines, doc, 'author')).toBe('---\nauthor: b\ntitle: x\n---\n\npara')
  })
  test('a maths block keeps its fences', () => {
    const doc = 'a\n\n$$\nz = 1\ny = 2\n$$\n\nb'
    expect(ran(sortLines, doc, 'y = 2')).toBe('a\n\n$$\ny = 2\nz = 1\n$$\n\nb')
  })
  test('a comment keeps its opener before its closer', () => {
    const doc = 'a\n\n<!--\nzeta\nalpha\n-->\n\nb'
    expect(ran(sortLines, doc, 'alpha')).toBe('a\n\n<!--\nalpha\nzeta\n-->\n\nb')
    expect(ran(reverseLines, doc, 'alpha')).toBe('a\n\n<!--\nalpha\nzeta\n-->\n\nb')
  })
})
