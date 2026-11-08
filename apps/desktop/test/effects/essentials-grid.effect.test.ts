import { flushSync, mount, unmount } from 'svelte'
import { expect, test } from 'vitest'

const Bookmarks = (await import('../../src/lib/Bookmarks.svelte')).default
const { workspace } = await import('../../src/lib/workspace.svelte')

const file = (path: string, is_dir = false) => {
  const name = path.split('/').pop() ?? path
  return { name, path, is_dir, modified: 0, created: 0, children: [] }
}

test('an account that chose the list look sees its Essentials as the grid, in their order', () => {
  localStorage.setItem('orden:essentials-look', 'list')
  workspace.device.reread()
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tree = {
    ...file('/space', true),
    children: [file('/space/Cherry.md'), file('/space/Apple.md'), file('/space/Banana.md')],
  }
  workspace.bookmarks.put(
    '/space',
    ['Cherry', 'Apple', 'Banana'].map((name) => ({
      kind: 'note' as const,
      path: `${name}.md`,
      text: name,
    })),
  )

  const target = document.body.appendChild(document.createElement('div'))
  const drawn = mount(Bookmarks, { target, props: { onsearch: () => undefined } })
  flushSync()

  const tiles = [...target.querySelectorAll('.tiles li [aria-label]')].map((one) =>
    one.getAttribute('aria-label'),
  )
  expect(tiles).toEqual(['Cherry', 'Apple', 'Banana'])
  expect(target.querySelector('ul.list')).toBeNull()
  expect(localStorage.getItem('orden:essentials-look')).toBeNull()
  void unmount(drawn)
})
