// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { editorState } from '../editor'
import { setReadOnlyMode } from '../modes'
import { parsed } from '../../test/parsed'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
const NOTE =
  'See [docs](https://x.test) here.\n\n| site | note |\n| - | - |\n| [docs](https://x.test) | [[Other]] |\n\nend\n'
function opened(readOnly: boolean) {
  const links: string[] = []
  const view = new EditorView({
    state: parsed(
      editorState({
        doc: NOTE,
        selection: { anchor: NOTE.length },
        openLink: (href) => void links.push(href),
      }),
    ),
    parent: document.body,
  })
  open.push(view)
  if (readOnly) setReadOnlyMode(view, true)
  return { view, links }
}
function press(target: Element, modified: boolean) {
  const keys = { bubbles: true, cancelable: true, button: 0, ctrlKey: modified, metaKey: modified }
  target.dispatchEvent(new MouseEvent('mousedown', keys))
  target.dispatchEvent(new MouseEvent('mouseup', keys))
  target.dispatchEvent(new MouseEvent('click', keys))
}
describe('a link drawn in a table cell', () => {
  test('a link outside the table opens on Ctrl or Cmd-click', () => {
    const { view, links } = opened(false)
    const words = view.contentDOM.querySelector('.cm-line .orden-link')
    if (!words) throw new Error('no drawn link')
    press(words, true)
    expect(links).toEqual(['https://x.test'])
  })
  test('opens on Ctrl or Cmd-click, as the same link outside the table does', () => {
    const { view, links } = opened(false)
    const anchor = view.contentDOM.querySelector('td a')
    if (!anchor) throw new Error('no link in the cell')
    press(anchor, true)
    expect(links).toEqual(['https://x.test'])
  })
  test('opens on a click in Read-only mode, as the same link outside the table does', () => {
    const { view, links } = opened(true)
    const anchor = view.contentDOM.querySelector('td a')
    if (!anchor) throw new Error('no link in the cell')
    press(anchor, false)
    expect(links).toEqual(['https://x.test'])
  })
})
