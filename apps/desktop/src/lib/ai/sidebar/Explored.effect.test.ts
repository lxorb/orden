import { flushSync, mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'

/** A provider that sends no ids gets `call_0`, `call_1`, … in each answer
 *  (chat/completions.ts), so one Explored step made of two answers' reads holds two of
 *  one id: both are drawn (B505).
 *
 *  In the jsdom project because rows are drawn. */

vi.mock('./chat.svelte', () => ({ chat: { unfolded: true, root: '/n/Work' } }))

const Explored = (await import('./Explored.svelte')).default

test('two reads with one id are two rows', () => {
  const read = (path: string) => ({
    kind: 'tool' as const,
    id: 'call_0',
    verb: 'read',
    args: { path },
    state: 'done' as const,
  })
  const target = document.createElement('div')
  document.body.append(target)
  let shown: ReturnType<typeof mount> | undefined
  expect(() => {
    shown = mount(Explored, { target, props: { rows: [read('Plan.md'), read('Ana.md')] } })
    flushSync()
  }).not.toThrow()
  expect(target.textContent).toContain('Ana')
  if (shown) void unmount(shown)
  target.remove()
})
