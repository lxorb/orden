import { flushSync, mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'
import Fading from './Fading.svelte'

let ended = 0
const count = () => (ended += 1)

const shownIn = (host: HTMLElement) =>
  mount(Fading, { target: host, props: { ended: count } }) as unknown as { hide: () => void }

test('an outro under way as a test ends is left running', () => {
  const host = document.body.appendChild(document.createElement('div'))
  const line = shownIn(host)
  flushSync()
  line.hide()
  flushSync()
  expect(ended).toBe(0)
  expect(host.querySelector('p')).not.toBeNull()
})

test('and has finished by the next test, inside the one that started it', () => {
  expect(ended).toBe(1)
  expect(document.querySelector('p')).toBeNull()
})

test('one that runs its course finishes on its own, a task or two after it starts', async () => {
  const host = document.body.appendChild(document.createElement('div'))
  const line = shownIn(host)
  flushSync()
  line.hide()
  flushSync()
  await vi.waitFor(() => {
    expect(ended).toBe(2)
  })
  expect(host.querySelector('p')).toBeNull()
  await unmount(line)
})
