// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from '../editor'

const NOTE = [
  'first words',
  '',
  '[toc]',
  '',
  '# A heading',
  '',
  '- a bullet',
  '- [ ] a task',
  '- [x] a done task (30 min)',
  '',
  '1. a number',
  '',
  '> [!note] A callout',
  '> inside it',
  '',
  '***',
  '',
  '```js',
  'const a = 1',
  '```',
  '',
  '| one | two |',
  '| --- | --- |',
  '| a | b |',
  '',
  '## Another heading',
  '',
  'last words',
  '',
].join('\n')
const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function shown(): EditorView {
  const view = createEditor({ parent: document.body, doc: NOTE })
  open.push(view)
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({ selection: { anchor: view.state.doc.length }, userEvent: 'select' })
  return view
}
interface Tiled {
  cmTile?: { widget?: unknown }
}
function drawn(view: EditorView): Element[] {
  return [...view.contentDOM.querySelectorAll('*')].filter((one) => (one as Tiled).cmTile?.widget !== undefined)
}
function typeAt(view: EditorView, at: number, words: string) {
  for (const letter of words) {
    view.dispatch({ changes: { from: at, insert: letter }, selection: { anchor: at + 1 }, userEvent: 'input.type' })
    at++
  }
}
describe('typing above what the editor draws keeps it drawn', () => {
  test('the note draws the widgets this guard watches', () => {
    const view = shown()
    const watched = drawn(view)
    for (const one of ['orden-toc', 'orden-checkbox', 'orden-fence-header', 'orden-table-wrap', 'orden-callout-label'])
      expect(
        watched.some((dom) => dom.classList.contains(one) || !!dom.querySelector(`.${one}`)),
        one,
      ).toBe(true)
  })
  test('no widget is built again when letters are typed at the top of the note', () => {
    const view = shown()
    const before = drawn(view)
    typeAt(view, 0, 'abc')
    const after = drawn(view)
    const rebuilt = before.filter((one) => !after.includes(one)).map((one) => one.className || one.tagName)
    expect(rebuilt).toEqual([])
  })
  test('a line added at the top keeps every widget too', () => {
    const view = shown()
    const before = drawn(view)
    typeAt(view, 0, 'new line\n')
    const after = drawn(view)
    expect(before.filter((one) => !after.includes(one)).map((one) => one.className || one.tagName)).toEqual([])
  })
})
describe('a widget kept through typing above still acts where it now stands', () => {
  test('the contents jump to the heading', () => {
    const view = shown()
    typeAt(view, 0, 'abc')
    const links = [...view.contentDOM.querySelectorAll('.orden-toc a')]
    const link = links.find((one) => one.textContent === 'Another heading')
    link?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf('## Another heading'))
  })
  test('the language of a code block is set on its own line', async () => {
    const view = shown()
    typeAt(view, 0, 'abc')
    view.contentDOM
      .querySelector('.orden-fence-language')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    const field = view.contentDOM.querySelector<HTMLInputElement>('.orden-fence-language-input')
    if (!field) throw new Error('no field to type the language into')
    field.value = 'python'
    field.dispatchEvent(new FocusEvent('blur'))
    await Promise.resolve()
    await Promise.resolve()
    expect(view.state.doc.toString()).toContain('```python\nconst a = 1\n```')
  })
})
