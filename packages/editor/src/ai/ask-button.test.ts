// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from '../editor'
import { setAiRunner } from './run'

const NOTE = 'words\n\n```ai\nWhat is in this note?\n```\n\nend'
const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
  setAiRunner(null)
})
function header(): HTMLElement {
  const view = createEditor({ parent: document.body, doc: NOTE })
  open.push(view)
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({ selection: { anchor: NOTE.length } })
  const found = view.contentDOM.querySelector<HTMLElement>('.orden-fence-header')
  if (!found) throw new Error('no code block header')
  return found
}
const asks = (bar: HTMLElement) => [...bar.querySelectorAll('button')].some((one) => one.title === 'Ask')
describe('an AI block', () => {
  test('offers no Ask where nothing can answer it, as on the web and on phones', () => {
    setAiRunner(null)
    expect(asks(header())).toBe(false)
  })
  test('offers Ask where something answers it', () => {
    setAiRunner(() => Promise.resolve())
    expect(asks(header())).toBe(true)
  })
})
