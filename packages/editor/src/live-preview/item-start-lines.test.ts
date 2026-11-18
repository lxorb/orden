// @vitest-environment jsdom
import { cursorLineBoundaryBackward } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../../test/parsed'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { livePreview } from '.'
import { quietMarks } from './reveal'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function viewOf(doc: string, cursor: number, quiet = false) {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        livePreview(),
        quietMarks.of(quiet),
      ],
    }),
  )
  const view = new EditorView({ state, parent: document.body })
  open.push(view)
  return view
}

describe('Home in a numbered task', () => {
  test('stops after the hidden number and box, where the words start', () => {
    const doc = 'intro\n\n1. [ ] buy milk\n2. [ ] buy eggs\n\nend'
    const end = doc.indexOf('buy milk') + 'buy milk'.length
    const view = viewOf(doc, end)
    view.dispatch({ selection: EditorSelection.cursor(end), userEvent: 'select' })
    cursorLineBoundaryBackward(view)
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.line(3).text).toBe('1. [ ] xbuy milk')
  })
})

describe('Home with quiet marks on', () => {
  test('in a heading stops after the hidden #, where the words start', () => {
    const doc = 'intro\n\n## Plan for today\n\nend'
    const end = doc.indexOf('Plan for today') + 'Plan for today'.length
    const view = viewOf(doc, end, true)
    view.dispatch({ selection: EditorSelection.cursor(end), userEvent: 'select' })
    cursorLineBoundaryBackward(view)
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.line(3).text).toBe('## xPlan for today')
  })

  test('in a quote stops after the hidden >, where the words start', () => {
    const doc = 'intro\n\n> quoted words\n\nend'
    const end = doc.indexOf('quoted words') + 'quoted words'.length
    const view = viewOf(doc, end, true)
    view.dispatch({ selection: EditorSelection.cursor(end), userEvent: 'select' })
    cursorLineBoundaryBackward(view)
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.line(3).text).toBe('> xquoted words')
  })
})

describe('a click on the bullet of an item', () => {
  test('puts the caret where the words start, not before the hidden marker', () => {
    const doc = 'intro\n\n- first item\n- second item\n\nend'
    const view = viewOf(doc, 0)
    const line = view.state.doc.line(4)
    view.dispatch({ selection: EditorSelection.cursor(line.from), userEvent: 'select.pointer' })
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.line(4).text).toBe('- xsecond item')
  })

  test('ArrowDown from the start of the line above lands where the words start', () => {
    const doc = 'intro\n- first item\n- second item\n\nend'
    const view = viewOf(doc, 0)
    const line = view.state.doc.line(2)
    view.dispatch({ selection: EditorSelection.cursor(line.from), userEvent: 'select' })
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.line(2).text).toBe('- xfirst item')
  })
})
