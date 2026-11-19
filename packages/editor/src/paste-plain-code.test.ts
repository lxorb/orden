// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { pastePlain } from './paste'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
async function pastedPlainly(marked: string, text: string): Promise<string> {
  const caret = marked.indexOf('|')
  Object.defineProperty(navigator, 'clipboard', {
    value: { readText: () => Promise.resolve(text) },
    configurable: true,
  })
  const view = new EditorView({
    parent: document.body,
    state: parsed(
      EditorState.create({
        doc: marked.replace('|', ''),
        selection: { anchor: caret },
        extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
      }),
    ),
  })
  pastePlain(view)
  await new Promise((done) => setTimeout(done))
  const note = view.state.doc.toString()
  view.destroy()
  return note
}
describe('paste as plain text into code held in a list item or quote', () => {
  test('keeps every pasted line inside the item, as a normal paste does', async () => {
    await expect(pastedPlainly('- step\n  ```js\n  |\n  ```\n- next', 'let a = 1\nlet b = 2')).resolves.toBe(
      '- step\n  ```js\n  let a = 1\n  let b = 2\n  ```\n- next',
    )
  })
  test('keeps every pasted line inside the quote', async () => {
    await expect(pastedPlainly('> ```js\n> |\n> ```', 'let a = 1\nlet b = 2')).resolves.toBe(
      '> ```js\n> let a = 1\n> let b = 2\n> ```',
    )
  })
})
