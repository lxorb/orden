// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { loadLineCommands } from './line-door'
import { richPaste } from './paste'
import { noRects } from '../test/views'

beforeAll(() => {
  noRects()
  return import('@orden/markdown/from-html')
})

async function pasted(marked: string, text: string, html = ''): Promise<string> {
  const caret = marked.indexOf('|')
  const view = new EditorView({
    parent: document.body,
    state: parsed(
      EditorState.create({
        doc: marked.replace('|', ''),
        selection: { anchor: caret },
        extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), richPaste()],
      }),
    ),
  })

  const flavours: Record<string, string> = { 'text/plain': text, 'text/html': html }
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { files: [], getData: (type: string) => flavours[type] ?? '' },
  })
  view.contentDOM.dispatchEvent(event)
  await loadLineCommands()
  await new Promise((done) => setTimeout(done))

  const note = view.state.doc.toString()
  view.destroy()
  return note
}

describe('a paste into code', () => {
  test('of comma-separated lines inside a fence stays those lines', async () => {
    const csv = 'name,size,kind\nfoo,1,a\nbar,2,b'
    await expect(pasted('```csv\n|\n```', csv)).resolves.toBe(`\`\`\`csv\n${csv}\n\`\`\``)
  })

  test('from an editor that copies HTML too is its plain text', async () => {
    const code = '// see [docs]\nconst a = 1'
    const html = '<div><div><span>// see [docs]</span></div><div><span>const a = 1</span></div></div>'
    await expect(pasted('```js\n|\n```', code, html)).resolves.toBe(`\`\`\`js\n${code}\n\`\`\``)
  })

  test('outside code is still converted', async () => {
    await expect(pasted('|', 'a,b,c\n1,2,3')).resolves.toContain('| a | b | c |')
  })
})

describe('a paste with the caret right beside inline code, not in it', () => {
  test('bold words pasted right after a code span are still bold', async () => {
    await expect(pasted('Use `x`|', ' carefully', '<span> </span><b>carefully</b>')).resolves.toContain('**carefully**')
  })

  test('a web link pasted just before a code span is still a link', async () => {
    await expect(pasted('|`npm i` installs it', 'the docs', '<a href="https://docs.dev">the docs</a>')).resolves.toBe(
      '[the docs](https://docs.dev)`npm i` installs it',
    )
  })

  test('paragraphs copied in Orden pasted right after a code span in an item stay in the item', async () => {
    const copied = '<div data-orden="markdown"><p>one</p><p>two</p></div>'
    await expect(pasted('- run `x`|', ' one\n\ntwo', copied)).resolves.toBe('- run `x` one\n\n  two')
  })
})
