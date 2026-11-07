// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import '@orden/markdown/eager'
import { livePreviewDecorations } from './decorate'
import { ordenMarkdownExtensions } from '../markdown/extensions'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const view of open.splice(0)) view.destroy()
})

function viewOf(doc: string, at: number): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        livePreviewDecorations,
      ],
    }),
    parent: document.body,
  })
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({})
  open.push(view)
  return view
}

function hidden(view: EditorView): string[] {
  const out: string[] = []
  const atomic = view.plugin(livePreviewDecorations)?.atomic
  atomic?.between(0, view.state.doc.length, (from, to) => {
    out.push(view.state.sliceDoc(from, to))
  })
  return out
}

function composition(view: EditorView, type: 'compositionstart' | 'compositionend') {
  view.contentDOM.dispatchEvent(new CompositionEvent(type, { bubbles: true, data: '' }))
}

describe('a composition', () => {
  test('changes nothing the page draws around it until it ends', () => {
    vi.useFakeTimers()
    const view = viewOf('`code` span', 6)
    expect(hidden(view)).toEqual([])

    composition(view, 'compositionstart')
    expect(view.compositionStarted).toBe(true)
    view.dispatch({ changes: { from: 6, insert: 'n' }, selection: { anchor: 7 } })
    expect(hidden(view)).toEqual([])

    composition(view, 'compositionend')
    vi.runAllTimers()
    expect(view.compositionStarted).toBe(false)
    expect(hidden(view)).toEqual(['`', '`'])
  })

  test('that never started leaves the page drawn as the caret moves', () => {
    const view = viewOf('`code` span', 6)
    view.dispatch({ changes: { from: 6, insert: 'n' }, selection: { anchor: 7 } })
    expect(hidden(view)).toEqual(['`', '`'])
  })
})
