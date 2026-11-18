// @vitest-environment jsdom
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { editorState } from './editor'
import { setQuietMarks } from './modes'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function quietView(doc: string): EditorView {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  setQuietMarks(view, true)
  return view
}

function press(view: EditorView, key: string) {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key }), 'editor')
}

describe('Enter at the start of a heading with the marks kept out of sight', () => {
  test('pushes the heading down instead of leaving an empty heading above its words', () => {
    const view = quietView('Intro\n\n## Results\n\nText')
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('Results') + 3 } })
    press(view, 'Home')
    expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf('Results'))

    press(view, 'Enter')
    const lines = view.state.doc.toString().split('\n')
    expect(lines).toContain('## Results')
    expect(lines.some((line) => /^#{1,6}\s*$/.test(line))).toBe(false)
  })
})
