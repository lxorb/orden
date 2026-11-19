// @vitest-environment jsdom
import { syntaxTree } from '@codemirror/language'
import { type EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from './editor'

const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function viewOf(doc: string, at: number) {
  const view = createEditor({ parent: document.body, doc, selection: { anchor: doc.length } })
  open.push(view)
  view.dispatch({ selection: { anchor: at }, userEvent: 'select' })
  return view
}
async function press(view: EditorView, key: string, shiftKey = false) {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key, shiftKey }), 'editor')
  await new Promise((settle) => setTimeout(settle, 200))
}
function blocks(view: EditorView): string[] {
  const names: string[] = []
  for (let node = syntaxTree(view.state).topNode.firstChild; node; node = node.nextSibling) {
    names.push(node.name)
  }
  return names
}
function firstLine(view: EditorView): HTMLElement | null {
  return view.contentDOM.querySelector<HTMLElement>('.cm-line')
}
describe('the first item of a note, pushed in two steps with Tab and back out with Shift-Tab', () => {
  test('is drawn as a list item again, not as a line of code', async () => {
    const doc = '- milk\n- eggs\n\nend'
    const view = viewOf(doc, 3)
    await press(view, 'Tab')
    await press(view, 'Tab')
    await press(view, 'Tab', true)
    await press(view, 'Tab', true)
    view.dispatch({ selection: { anchor: view.state.doc.length }, userEvent: 'select' })
    expect(view.state.doc.toString()).toBe(doc)
    expect(blocks(view)).toEqual(['BulletList', 'Paragraph'])
    expect(firstLine(view)?.classList.contains('orden-code')).toBe(false)
    expect(firstLine(view)?.textContent).not.toContain('- milk')
  })
})
describe('a note whose first line was indented four spaces and put back in one change', () => {
  test('draws that line as words again, with its bold drawn', () => {
    const doc = 'Shopping for **today**\nand tomorrow\n\nend'
    const view = viewOf(doc, 0)
    view.dispatch({ changes: { from: 0, insert: '    ' }, userEvent: 'input.type' })
    view.dispatch({ changes: { from: 0, to: 4 }, userEvent: 'delete.backward' })
    view.dispatch({ selection: { anchor: view.state.doc.length }, userEvent: 'select' })
    expect(view.state.doc.toString()).toBe(doc)
    expect(blocks(view)).toEqual(['Paragraph', 'Paragraph'])
    expect(firstLine(view)?.classList.contains('orden-code')).toBe(false)
    expect(firstLine(view)?.textContent).toBe('Shopping for today')
  })
})
