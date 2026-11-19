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
  await import('@orden/markdown/from-html')
  await new Promise((done) => setTimeout(done, 20))
  const note = view.state.doc.toString()
  view.destroy()
  return note
}
const STYLE =
  "color: #cccccc;background-color: #1f1f1f;font-family: Consolas, 'Courier New', monospace;font-weight: normal;font-size: 14px;line-height: 19px;white-space: pre;"
function line(...spans: string[]): string {
  return `<div>${spans.map((span) => `<span style="color: #9cdcfe;">${span}</span>`).join('')}</div>`
}
describe('code copied from VS Code and pasted with Ctrl+V', () => {
  test('is pasted as a code block with its indent, as Edit > Paste does', async () => {
    const text = 'def total(price, qty_count):\n    return price * qty_count * 2'
    const html = `<meta charset="utf-8"><div style="${STYLE}">${line('def', ' total(price, qty_count):')}${line('    ', 'return', ' price * qty_count * 2')}</div>`
    await expect(pasted('|', text, html)).resolves.toBe(`\`\`\`\n${text}\n\`\`\``)
  })
})
