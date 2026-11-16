// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { loadLineCommands } from './line-door'
import { richPaste } from './paste'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  return import('@orden/markdown/from-html')
})

async function pasted(marked: string, text: string, html: string): Promise<string> {
  const caret = marked.indexOf('|')
  const view = new EditorView({
    parent: document.body,
    state: parsed(
      EditorState.create({
        doc: marked.replace('|', ''),
        selection: { anchor: caret },
        extensions: [
          markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
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
  await loadLineCommands()
  await new Promise((done) => setTimeout(done))

  const note = view.state.doc.toString()
  view.destroy()
  return note
}

const TEX = String.raw`\sum_{i=1}^{n} x_i^2 \left[ a \right]`
const PAGE = `<meta charset="utf-8"><span style="color: rgb(0, 0, 0);">${TEX}</span>`
const MATHS = '$$'

describe('LaTeX copied from a web page', () => {
  test('pasted into a maths block is written as copied', async () => {
    await expect(pasted(`${MATHS}\n|\n${MATHS}`, TEX, PAGE)).resolves.toBe(
      `${MATHS}\n${TEX}\n${MATHS}`,
    )
  })

  test('pasted into inline maths is written as copied', async () => {
    await expect(pasted('Sum: $|$', TEX, PAGE)).resolves.toBe(`Sum: $${TEX}$`)
  })
})
