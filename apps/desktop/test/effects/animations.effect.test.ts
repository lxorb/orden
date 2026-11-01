import { flushSync, mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'
import Fading from './Fading.svelte'

/** The stand-in animation the jsdom project plays transitions with (jsdom-layout.ts)
 *  finishes within the test that started it. One left to a timer finished after the
 *  file's jsdom had gone, now and then, and Svelte's `outroend` built from Node's own
 *  `CustomEvent` was refused by the element of the jsdom that had gone (#446). */

let ended = 0
const count = () => (ended += 1)

/** The line, mounted, with the one thing it exports. */
const shownIn = (host: HTMLElement) =>
  mount(Fading, { target: host, props: { ended: count } }) as unknown as { hide: () => void }

test('an outro under way as a test ends is left running', () => {
  const host = document.body.appendChild(document.createElement('div'))
  const line = shownIn(host)
  flushSync()
  line.hide()
  flushSync()
  // Not over yet: the stand-in finishes a task later, or as the test ends.
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
