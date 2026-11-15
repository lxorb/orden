// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { pasteHere } from './paste'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
  vi.unstubAllGlobals()
})

function clipboardHolding(html: string, text: string) {
  const item = {
    types: ['text/html', 'text/plain'],
    getType: (type: string) =>
      Promise.resolve(new Blob([type === 'text/html' ? html : text], { type })),
  }
  vi.stubGlobal('navigator', {
    clipboard: { read: () => Promise.resolve([item]), readText: () => Promise.resolve(text) },
  })
}

function viewOf(doc: string, at: number): EditorView {
  const view = new EditorView({
    state: parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(at),
        extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
      }),
    ),
    parent: document.body,
  })
  open.push(view)
  return view
}

describe('Paste from the menu inside a code block', () => {
  test('puts the plain text in, as a paste with the keys does', async () => {
    clipboardHolding('<pre><code>const a = 1</code></pre>', 'const a = 1')
    const doc = '```js\n\n```'
    const view = viewOf(doc, 6)

    expect(pasteHere(view)).toBe(true)
    await vi.waitFor(() => expect(view.state.doc.toString()).not.toBe(doc))
    expect(view.state.doc.toString()).toBe('```js\nconst a = 1\n```')
  })

  test('and tab separated text stays as it is', async () => {
    clipboardHolding('', 'a\tb\n1\t2')
    const doc = '```\n\n```'
    const view = viewOf(doc, 4)

    pasteHere(view)
    await vi.waitFor(() => expect(view.state.doc.toString()).not.toBe(doc))
    expect(view.state.doc.toString()).toBe('```\na\tb\n1\t2\n```')
  })
})
