import { flushSync, mount, unmount } from 'svelte'
import { expect, test } from 'vitest'

const Bookmarks = (await import('../../src/lib/sidebar/src/Bookmarks.svelte')).default
const { DIVIDER, menu } = await import('../../src/lib/ui-kit/src/api')
const { workspace } = await import('../../src/lib/workspace/src/api')
const file = (path: string, is_dir = false) => {
  const name = path.split('/').pop() ?? path
  return { name, path, is_dir, modified: 0, created: 0, children: [] }
}
test("an Essential's own menu draws no line between its items", () => {
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tree = { ...file('/space', true), children: [file('/space/a.md')] }
  workspace.bookmarks.put('/space', [{ kind: 'note', path: 'a.md', text: '' }])
  const target = document.body.appendChild(document.createElement('div'))
  const drawn = mount(Bookmarks, { target, props: { onsearch: () => undefined } })
  flushSync()
  const tile = target.querySelector<HTMLElement>('.tile')
  expect(tile).not.toBeNull()
  tile!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
  flushSync()
  const items = menu.items
  void unmount(drawn)
  target.remove()
  menu.hide()
  expect(items.length).toBeGreaterThan(2)
  expect(items.filter((one) => one === DIVIDER)).toEqual([])
  expect(items.map((one) => (one === DIVIDER ? '|' : one.label))).toContain('New group')
})
