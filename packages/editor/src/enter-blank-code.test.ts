import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { closeFence, continueInCode, continueLists, leaveQuote } from './commands'
import { ordenMarkdownExtensions } from './markdown/extensions'

const enter: StateCommand = (target) =>
  closeFence(target) || leaveQuote(target) || continueLists(target) || continueInCode(target)

function typedAfterEnter(doc: string, at: number, words: string): EditorState {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  enter({ state, dispatch: (transaction) => (state = transaction.state) })
  const head = state.selection.main.head
  return parsed(state.update({ changes: { from: head, insert: words } }).state)
}

describe('Enter on an empty line inside code in a list item', () => {
  test('the new line keeps the item indent, so the code stays in the item', () => {
    const doc = '- a\n\n  ```js\n  x\n\n  y\n  ```\n- b\n'
    const blank = doc.indexOf('x\n\n') + 2
    const state = typedAfterEnter(doc, blank, 'z')

    expect(state.doc.toString()).toBe('- a\n\n  ```js\n  x\n\n  z\n  y\n  ```\n- b\n')
    const top: string[] = []
    for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
      top.push(node.name)
    }
    expect(top).toEqual(['BulletList'])
  })
})
