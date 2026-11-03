import { flushSync, mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'

/** A helper is in no list of chats (#1062), so the step that started it is the way to
 *  it: a row each, opening the helper's thread; a batch's many wait behind Show all,
 *  and one deleted is not drawn.
 *
 *  In the jsdom project because the rows are drawn. */

const panel = vi.hoisted(() => ({
  every: [
    { id: 'h1', title: '↳ Aufgabe 5', space: 'work' },
    { id: 'h2', title: 'two', space: 'work' },
    { id: 'h3', title: 'three', space: 'work' },
    { id: 'h4', title: 'four', space: 'work' },
  ],
  threadOf: (_id: string) => null,
  running: ['h2'],
  openThread: vi.fn((_id: string) => Promise.resolve()),
}))
vi.mock('./chat.svelte', () => ({ chat: panel }))

const Spawned = (await import('./Spawned.svelte')).default

function draw(threads: string[]) {
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(Spawned, { target, props: { threads } })
  flushSync()
  return { target, close: () => void unmount(shown) }
}

test('a helper’s row opens its thread', () => {
  const { target, close } = draw(['h1', 'gone'])
  const rows = target.querySelectorAll('button')
  expect(rows).toHaveLength(1)
  expect(rows[0]?.textContent).toContain('↳ Aufgabe 5')
  rows[0]?.click()
  expect(panel.openThread).toHaveBeenCalledWith('h1')
  close()
})

test('a batch’s helpers wait behind Show all', () => {
  const { target, close } = draw(['h1', 'h2', 'h3', 'h4'])
  expect(target.querySelectorAll('button')).toHaveLength(4)
  expect(target.querySelectorAll('.dot')).toHaveLength(1)
  ;[...target.querySelectorAll('button')].at(-1)?.click()
  flushSync()
  expect(target.querySelectorAll('button')).toHaveLength(4)
  expect(target.textContent).toContain('four')
  close()
})
