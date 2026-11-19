import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
import { priorityTone } from '../../tasks-model/src/api'

const QuickAdd = (await import('./QuickAdd.svelte')).default
let target: HTMLDivElement
let drawn: ReturnType<typeof mount> | undefined
function shown(text: string) {
  target = document.createElement('div')
  document.body.append(target)
  drawn = mount(QuickAdd, {
    target,
    props: { langs: ['en'], prefill: { text }, dictates: false, onsubmit: () => false, onclose: () => undefined },
  })
  flushSync()
  return target.querySelector<HTMLButtonElement>('button[aria-label="Priority"]')?.style.getPropertyValue('color')
}
afterEach(() => {
  if (drawn) void unmount(drawn)
  target.remove()
})
test('the flag of p1 wears the tone of a high todo', () => {
  const high = priorityTone(3)
  expect(high).toBeTruthy()
  expect(shown('Call mum p1')).toBe(high)
})
test('p4 leaves the flag uncoloured', () => {
  expect(shown('Call mum p4')).toBe('')
})
