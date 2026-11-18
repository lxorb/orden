// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { loadCompletion } from './completion'
import { createEditor } from './editor'

const open: EditorView[] = []

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  await loadCompletion()
})

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function typedAfter(doc: string, words: string): string {
  const view = createEditor({ parent: document.body, doc, selection: { anchor: doc.length } })
  open.push(view)
  for (const typed of words) {
    ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
    const { from, to } = view.state.selection.main
    const insert = () =>
      view.state.update({
        changes: { from, to, insert: typed },
        selection: { anchor: from + typed.length },
        userEvent: 'input.type',
      })
    const handlers = view.state.facet(EditorView.inputHandler)
    if (!handlers.some((handler) => handler(view, from, to, typed, insert))) view.dispatch(insert())
  }
  return view.state.doc.toString()
}

describe('edit76 an apostrophe typed after a link or marked words', () => {
  test('after a wiki link adds no closing quote', () => {
    expect(typedAfter('Met [[John]]', "'s dog")).toBe("Met [[John]]'s dog")
  })

  test('after bold words adds no closing quote', () => {
    expect(typedAfter('Met **John**', "'s dog")).toBe("Met **John**'s dog")
  })

  test('after a link adds no closing quote', () => {
    expect(typedAfter('Read [the guide](https://x.com)', "'s end")).toBe(
      "Read [the guide](https://x.com)'s end",
    )
  })
})
