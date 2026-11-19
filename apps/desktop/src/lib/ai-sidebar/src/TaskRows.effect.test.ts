import { flushSync, mount, unmount } from 'svelte'
import { expect, test } from 'vitest'

const TaskRows = (await import('./TaskRows.svelte')).default
function rows(tasks: unknown[]): string[] {
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(TaskRows, { target, props: { said: JSON.stringify({ total: tasks.length, tasks }) } })
  flushSync()
  const out = [...target.querySelectorAll('.task .words')].map((one) => one.textContent)
  void unmount(shown)
  target.remove()
  return out
}
test('a task with no space is a row of its own (#2263)', () => {
  expect(
    rows([
      { at: 'Inbox.md#3', text: 'Call Ana' },
      { at: 'Garden.md#1', text: 'Water the roses', due: '2026-11-20' },
    ]),
  ).toEqual(['Call Ana', 'Water the roses'])
})
test('two tasks at one place are two rows, and a row without its place or words is left out', () => {
  expect(
    rows([
      { at: 'Inbox.md#3', text: 'Call Ana' },
      { at: 'Inbox.md#3', text: 'Call Ana again' },
      { text: 'Nowhere' },
      { at: 'Inbox.md#4' },
    ]),
  ).toEqual(['Call Ana', 'Call Ana again'])
})
