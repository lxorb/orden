/** A note carried out of the file list finds the empty Essentials drawn for it from the
 *  moment the drag begins, not only once the pointer comes up to them (#417); a folder
 *  alone is no tile and finds nothing. The place stands over the list rather than in
 *  front of it, so the rows under the pointer stay where the drag found them. See
 *  `offered` in Bookmarks.svelte. */

import { flushSync, mount, unmount } from 'svelte'
import { expect, test } from 'vitest'

const Bookmarks = (await import('../../src/lib/Bookmarks.svelte')).default
const { carry } = await import('../../src/lib/drag-paths')
const { workspace } = await import('../../src/lib/workspace.svelte')

const file = (path: string, is_dir = false) => {
  const name = path.split('/').pop() ?? path
  return { name, path, is_dir, modified: 0, created: 0, children: [] }
}

test.each([
  ['/space/a.md', true],
  ['/space/Work', false],
])('%s carried out of the list is offered the empty Essentials: %s', (path, offered) => {
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tree = {
    ...file('/space', true),
    children: [file('/space/a.md'), file('/space/Work', true)],
  }
  workspace.bookmarks.put('/space', [])
  const target = document.body.appendChild(document.createElement('div'))
  const drawn = mount(Bookmarks, { target, props: { onsearch: () => undefined } })
  const empty = () => target.querySelector('.tiles.is-floating .is-empty') !== null

  carry({ setData: () => undefined } as unknown as DataTransfer, [path])
  workspace.panes.dragged({ tabId: null })
  flushSync()
  expect(empty()).toBe(offered)
  void unmount(drawn)
})
