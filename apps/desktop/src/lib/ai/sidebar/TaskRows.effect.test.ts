import { flushSync, mount, unmount } from 'svelte'
import { expect, test } from 'vitest'

/** `/tasks` lists every space's tasks, so two rows can be at one note and line, each in
 *  its own space: both are drawn, and each box is its own (B505).
 *
 *  In the jsdom project because rows are drawn. */

const TaskRows = (await import('./TaskRows.svelte')).default

test('two tasks at one place in two spaces are two rows', () => {
  const said = JSON.stringify({
    total: 2,
    tasks: [
      { at: 'Inbox.md#3', space: 'Work', text: 'Call Ana' },
      { at: 'Inbox.md#3', space: 'Home', text: 'Water the roses' },
    ],
  })
  const target = document.createElement('div')
  document.body.append(target)
  let shown: ReturnType<typeof mount> | undefined
  expect(() => {
    shown = mount(TaskRows, { target, props: { said } })
    flushSync()
  }).not.toThrow()
  expect(target.querySelectorAll('.task')).toHaveLength(2)
  if (shown) void unmount(shown)
  target.remove()
})
