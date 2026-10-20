// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { nibMarkdownExtensions } from './markdown/extensions'
import { richPaste } from './paste'

// The converter a page's HTML goes through, fetched before any paste waits on it. jsdom
// lays nothing out, so a range has no rectangles for a measure the view schedules.
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  return import('@nib/markdown/from-html')
})

/** The note after `text` (and `html`, where there is some) is pasted at the `|`. */
async function pasted(marked: string, text: string, html = ''): Promise<string> {
  const caret = marked.indexOf('|')
  const view = new EditorView({
    parent: document.body,
    state: parsed(
      EditorState.create({
        doc: marked.replace('|', ''),
        selection: { anchor: caret },
        extensions: [
          markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
          richPaste(),
        ],
      }),
    ),
  })

  const flavours: Record<string, string> = { 'text/plain': text, 'text/html': html }
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { files: [], getData: (type: string) => flavours[type] ?? '' },
  })
  view.contentDOM.dispatchEvent(event)
  // A page's HTML is written once the converter answers.
  await new Promise((done) => setTimeout(done))

  const note = view.state.doc.toString()
  view.destroy()
  return note
}

/** Code takes a paste as its words, not as a table or as markdown made of HTML. */
describe('a paste into code', () => {
  test('of comma-separated lines inside a fence stays those lines', async () => {
    const csv = 'name,size,kind\nfoo,1,a\nbar,2,b'
    await expect(pasted('```csv\n|\n```', csv)).resolves.toBe(`\`\`\`csv\n${csv}\n\`\`\``)
  })

  test('from an editor that copies HTML too is its plain text', async () => {
    const code = '// see [docs]\nconst a = 1'
    const html =
      '<div><div><span>// see [docs]</span></div><div><span>const a = 1</span></div></div>'
    await expect(pasted('```js\n|\n```', code, html)).resolves.toBe(`\`\`\`js\n${code}\n\`\`\``)
  })

  test('outside code is still converted', async () => {
    await expect(pasted('|', 'a,b,c\n1,2,3')).resolves.toContain('| a | b | c |')
  })
})
