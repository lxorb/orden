// @vitest-environment jsdom
import { beforeAll, expect, test, vi } from 'vitest'
import { noRects } from '../../test/views'

const DOC =
  '| a | **b** |\n| :-: | --- |\n| 1 | [two](https://example.com) | <!-- orden:widths 120,- -->\n| 3 | 4 |\n\nend'
beforeAll(noRects)
const shape = (root: Element | null) =>
  [...(root?.querySelectorAll('th, td') ?? [])].map((cell) => {
    const copy = cell.cloneNode(true) as HTMLElement
    copy.querySelector('.orden-table-resize')?.remove()
    return [copy.tagName, copy.dataset.row, copy.dataset.column, copy.style.cssText, copy.innerHTML]
  })
test('a table is drawn at once, before its editing code has come, in the shape it keeps', async () => {
  vi.resetModules()
  const { createEditor } = await import('../editor')
  const { loadTableView, tableMenuAt } = await import('./widget')
  const view = createEditor({ parent: document.body, doc: DOC, selection: { anchor: DOC.length } })
  const wrap = view.dom.querySelector('.orden-table-wrap')
  const before = shape(wrap)
  expect(before).toHaveLength(6)
  expect(wrap?.querySelector('.orden-table-grip')).toBeNull()
  expect(tableMenuAt(wrap?.querySelector('td') ?? null)).toBeNull()
  await loadTableView()
  expect(view.dom.querySelector('.orden-table-wrap')).toBe(wrap)
  expect(shape(wrap)).toEqual(before)
  expect(wrap?.querySelector('.orden-table-grip')).not.toBeNull()
  const cell = wrap?.querySelector<HTMLElement>('td')
  if (!cell) throw new Error('no cell')
  cell.textContent = '1x'
  cell.dispatchEvent(new InputEvent('input', { bubbles: true }))
  expect(view.state.doc.toString()).toContain('| 1x  | [two](https://example.com) | <!-- orden:widths 120,- -->')
  view.destroy()
})
test('a table changed or taken away before its editing code came is left as the note has it', async () => {
  vi.resetModules()
  const { createEditor } = await import('../editor')
  const { loadTableView } = await import('./widget')
  const view = createEditor({ parent: document.body, doc: DOC, selection: { anchor: DOC.length } })
  const other = createEditor({ parent: document.body, doc: DOC, selection: { anchor: DOC.length } })
  const at = DOC.indexOf('| 3 | 4 |')
  view.dispatch({ changes: { from: at + 2, to: at + 3, insert: 'three' } })
  other.dispatch({ changes: { from: 0, to: DOC.length - 3, insert: 'gone' } })
  await loadTableView()
  expect([...view.dom.querySelectorAll('td')].map((cell) => cell.textContent)).toContain('three')
  expect(view.dom.querySelector('.orden-table-grip')).not.toBeNull()
  expect(other.dom.querySelector('.orden-table-wrap')).toBeNull()
  view.destroy()
  other.destroy()
})
test('a long table is drawn in part both before and after', async () => {
  vi.resetModules()
  const { createEditor } = await import('../editor')
  const { loadTableView } = await import('./widget')
  const rows = Array.from({ length: 400 }, (_, row) => `| ${row} | x |`).join('\n')
  const doc = `| a | b |\n| - | - |\n${rows}\n\nend`
  const view = createEditor({ parent: document.body, doc, selection: { anchor: doc.length } })
  const drawn = () => view.dom.querySelectorAll('tbody tr[data-row]').length
  const before = drawn()
  expect(before).toBe(80)
  expect(view.dom.querySelector<HTMLElement>('.orden-table-gap td')?.style.height).toBe('10240px')
  await loadTableView()
  expect(drawn()).toBe(before)
  expect(view.dom.querySelector<HTMLElement>('.orden-table-gap td')?.style.height).toBe('10240px')
  view.destroy()
})
