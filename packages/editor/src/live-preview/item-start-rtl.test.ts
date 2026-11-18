// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap, runScopeHandlers } from '@codemirror/view'
import { standardKeymap } from '@codemirror/commands'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../../test/parsed'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { leftToRightLines } from '../modes'
import { livePreview } from '.'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  const computed = window.getComputedStyle.bind(window)
  window.getComputedStyle = (element: Element, pseudo?: string | null) => {
    const style = computed(element, pseudo)
    const written = element.closest('[dir]')?.getAttribute('dir')
    if (written !== 'rtl') return style
    return new Proxy(style, {
      get: (target, name): unknown => (name === 'direction' ? 'rtl' : Reflect.get(target, name)),
    })
  }
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function viewOf(doc: string, cursor: number) {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        EditorView.contentAttributes.of({ dir: 'ltr' }),
        leftToRightLines,
        livePreview(),
        keymap.of(standardKeymap),
      ],
    }),
  )
  const view = new EditorView({ state, parent: document.body })
  open.push(view)
  view.dispatch({})
  return view
}

function press(view: EditorView, key: string) {
  const event = new KeyboardEvent('keydown', { key, cancelable: true })
  return runScopeHandlers(view, event, 'editor')
}

describe('ArrowLeft at the start of a right-to-left item', () => {
  test('moves on into the words, as left is forward on that line', () => {
    const doc = 'intro\n- שלום עולם\n\nend'
    const start = doc.indexOf('שלום')
    const view = viewOf(doc, start)
    expect(view.textDirectionAt(start)).toBe(1)

    press(view, 'ArrowLeft')

    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2)
    expect(view.state.selection.main.head).toBe(start + 1)
  })

  test('ArrowRight there steps back out of the item, as right is backward on that line', () => {
    const doc = 'intro\n- שלום עולם\n\nend'
    const start = doc.indexOf('שלום')
    const view = viewOf(doc, start)

    press(view, 'ArrowRight')

    expect(view.state.selection.main.head).toBe(doc.indexOf('\n'))
  })
})
