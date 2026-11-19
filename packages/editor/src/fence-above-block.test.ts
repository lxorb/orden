import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { closeFence } from './commands'
import { ordenMarkdownExtensions } from './markdown/extensions'

function enterAt(doc: string, at: number): { took: boolean; doc: string } {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  const took = closeFence({ state, dispatch: (one: Transaction) => (state = one.state) })
  return { took, doc: state.doc.toString() }
}
describe('Enter after a new fence typed above a code block further down', () => {
  const below = '\nMore words.\n\n```js\nlet x = 1\n```\n'
  test('a fence with a language is closed, though the later block closes it for now', () => {
    const doc = `Intro\n\`\`\`py${below}`
    const at = doc.indexOf('```py') + 5
    expect(enterAt(doc, at)).toEqual({
      took: true,
      doc: `Intro\n\`\`\`py\n\n\`\`\`${below}`,
    })
  })
  test('a bare fence is closed too, since the next fence opens a block of its own', () => {
    const doc = `Intro\n\`\`\`${below}`
    const at = doc.indexOf('```') + 3
    expect(enterAt(doc, at)).toEqual({ took: true, doc: `Intro\n\`\`\`\n\n\`\`\`${below}` })
  })
})
