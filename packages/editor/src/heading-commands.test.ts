import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { setHeading, shiftHeading } from './commands'

function ran(command: StateCommand, doc: string, from: number, to = from): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: [markdown({ base: markdownLanguage })],
    }),
  )
  command({ state, dispatch: (transaction) => (state = transaction.state) })
  return state.doc.toString()
}

describe('heading commands', () => {
  test('heading up on a list item makes the same heading that Heading 1 makes', () => {
    expect(ran(setHeading(1), '- item', 4)).toBe('# item')
    expect(ran(shiftHeading(1), '- item', 4)).toBe('# item')
  })

  test('heading up on a task makes a heading, not a heading that reads "- [ ] task"', () => {
    expect(ran(shiftHeading(1), '- [ ] task', 8)).toBe('# task')
  })

  test('making two paragraphs headings leaves the blank line between them blank', () => {
    expect(ran(setHeading(2), 'a\n\nb', 0, 4)).toBe('## a\n\n## b')
    expect(ran(shiftHeading(1), 'a\n\nb', 0, 4)).toBe('# a\n\n# b')
  })
})
