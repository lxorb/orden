// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeAll, expect, test, vi } from 'vitest'
import { parsed } from '../test/parsed'
import { loadLineCommands } from './line-door'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { pasteHere } from './paste'
import { noRects } from '../test/views'

beforeAll(() => {
  noRects()
  return import('@orden/markdown/from-html')
})
async function pastedHere(marked: string, text: string, html = '') {
  const caret = marked.indexOf('|')
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
  const flavours: Record<string, string> = { 'text/plain': text, 'text/html': html }
  vi.stubGlobal('navigator', {
    clipboard: {
      read: () =>
        Promise.resolve([
          {
            types: Object.keys(flavours).filter((type) => flavours[type]),
            getType: (type: string) => Promise.resolve(new Blob([flavours[type] ?? ''])),
          },
        ]),
    },
  })
  pasteHere(view)
  await loadLineCommands()
  await vi.waitFor(() => expect(view.state.doc.toString()).not.toBe(marked.replace('|', '')))
  const out = { doc: view.state.doc.toString(), head: view.state.selection.main.head }
  view.destroy()
  return out
}
test('inside a code block, tab separated words go in as they are, not as a table', async () => {
  const { doc } = await pastedHere('```\n|\n```', 'a\tb\nc\td')
  expect(doc).toBe('```\na\tb\nc\td\n```')
})
test('inside a code block, copied HTML code goes in as its text, not as a fence of its own', async () => {
  const { doc } = await pastedHere('```\n|\n```', 'let a = 1', '<pre><code>let a = 1</code></pre>')
  expect(doc).toBe('```\nlet a = 1\n```')
})
test('in prose the caret lands after what was pasted', async () => {
  const { doc, head } = await pastedHere('a|b', 'xyz')
  expect(doc).toBe('axyzb')
  expect(head).toBe(4)
})
