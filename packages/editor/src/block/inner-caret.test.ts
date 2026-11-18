import { history } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { duplicateBlock, moveBlockDown } from './commands'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

function viewOf(doc: string, caret: number) {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        history(),
      ],
    }),
  )
  return {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec | Transaction) => {
      state = parsed(spec instanceof Transaction ? spec.state : state.update(spec).state)
    },
    focus: () => undefined,
  } as unknown as EditorView
}

function ran(doc: string, words: string, command: typeof moveBlockDown): string {
  const view = viewOf(doc, doc.indexOf(words) + 1)
  command(view)
  return view.state.doc.toString()
}

const STEPS = '- step\n\n  ```sh\n  npm i\n  ```\n\n  then run it\n\n- next\n'

describe('Block commands with the caret on a later line of a block inside a list item', () => {
  test('Move block down from inside the code moves the code, as from its opening line', () => {
    expect(ran(STEPS, '```sh', moveBlockDown)).toBe(
      '- step\n\n  then run it\n\n  ```sh\n  npm i\n  ```\n\n- next\n',
    )
    expect(ran(STEPS, 'npm i', moveBlockDown)).toBe(
      '- step\n\n  then run it\n\n  ```sh\n  npm i\n  ```\n\n- next\n',
    )
  })

  test('Move block down from the second line of a child item moves that child', () => {
    const doc = '- one\n  - two\n    more of two\n  - three\n- four\n'
    expect(ran(doc, 'more', moveBlockDown)).toBe(
      '- one\n  - three\n  - two\n    more of two\n- four\n',
    )
  })

  test('Duplicate block from inside the code copies the code, not the whole item', () => {
    const copied =
      '- step\n\n  ```sh\n  npm i\n  ```\n\n  ```sh\n  npm i\n  ```\n\n  then run it\n\n- next\n'
    expect(ran(STEPS, '```sh', duplicateBlock)).toBe(copied)
    expect(ran(STEPS, 'npm i', duplicateBlock)).toBe(copied)
  })
})
