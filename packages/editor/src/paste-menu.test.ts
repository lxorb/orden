// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { parsed } from '../test/parsed'
import { copiedFlavours, readyToCopy } from './copy'
import { loadLineCommands } from './line-door'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { pasteHere, richPaste } from './paste'

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  await import('@orden/markdown/from-html')
  await loadLineCommands()
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
        extensions: [
          markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
          richPaste(),
        ],
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

async function copiedInOrden(words: string): Promise<{ html: string; text: string }> {
  await readyToCopy()
  const flavours = copiedFlavours(
    EditorState.create({ doc: words, selection: { anchor: 0, head: words.length } }),
  )
  return { html: flavours?.html ?? '', text: flavours?.text ?? '' }
}

async function menuPaste(marked: string, html: string, text: string): Promise<string> {
  clipboardHolding(html, text)
  const doc = marked.replace('|', '')
  const view = viewOf(doc, marked.indexOf('|'))
  pasteHere(view)
  await vi.waitFor(() => expect(view.state.doc.toString()).not.toBe(doc))
  return view.state.doc.toString()
}

async function keyPaste(marked: string, html: string, text: string): Promise<string> {
  const view = viewOf(marked.replace('|', ''), marked.indexOf('|'))
  const flavours: Record<string, string> = { 'text/plain': text, 'text/html': html }
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { files: [], getData: (type: string) => flavours[type] ?? '' },
  })
  view.contentDOM.dispatchEvent(event)
  await new Promise((done) => setTimeout(done, 20))
  return view.state.doc.toString()
}

describe('paragraphs copied in Orden, pasted from the menu or with the keys', () => {
  test('both keep every paragraph inside the quote they are pasted into', async () => {
    const { html, text } = await copiedInOrden('one\n\ntwo')
    expect(html).toContain('data-orden')
    expect(await menuPaste('> quote |', html, text)).toBe('> quote one\n>\n> two')
    expect(await keyPaste('> quote |', html, text)).toBe('> quote one\n>\n> two')
  })

  test('both keep every paragraph inside the list item they are pasted into', async () => {
    const { html, text } = await copiedInOrden('one\n\ntwo')
    expect(await menuPaste('- item |', html, text)).toBe('- item one\n\n  two')
    expect(await keyPaste('- item |', html, text)).toBe('- item one\n\n  two')
  })
})

describe('lines pasted from the menu or with the keys into code inside a list item or quote', () => {
  test('both keep the later lines inside the list item', async () => {
    const marked = '- step\n  ```js\n  |\n  ```\n\nafter'
    const held = '- step\n  ```js\n  let a = 1\n  let b = 2\n  ```\n\nafter'
    expect(await menuPaste(marked, '', 'let a = 1\nlet b = 2')).toBe(held)
    expect(await keyPaste(marked, '', 'let a = 1\nlet b = 2')).toBe(held)
  })

  test('both keep the later lines inside the quote', async () => {
    const marked = '> ```js\n> |\n> ```\n\nafter'
    const held = '> ```js\n> let a = 1\n> let b = 2\n> ```\n\nafter'
    expect(await menuPaste(marked, '', 'let a = 1\nlet b = 2')).toBe(held)
    expect(await keyPaste(marked, '', 'let a = 1\nlet b = 2')).toBe(held)
  })
})
