import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { setHeading, shiftHeading } from './commands'
import { ordenMarkdownExtensions } from './markdown/extensions'

function over(doc: string, command: StateCommand): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  command({ state, dispatch: (one: Transaction) => (state = one.state) })
  return state.doc.toString()
}
describe('a heading made over a selection that holds a code block or table', () => {
  test('Heading 2 leaves the lines of a code fence alone', () => {
    const doc = 'Intro\n\n```js\nlet a = 1\n```\n\nOutro'
    expect(over(doc, setHeading(2))).toBe('## Intro\n\n```js\nlet a = 1\n```\n\n## Outro')
  })
  test('Heading up leaves the rows of a table alone', () => {
    const doc = 'Intro\n\n| a | b |\n| - | - |\n| 1 | 2 |'
    expect(over(doc, shiftHeading(1))).toBe('# Intro\n\n| a | b |\n| - | - |\n| 1 | 2 |')
  })
})
