import { flushSync, mount, unmount } from 'svelte'
import { expect, test } from 'vitest'

/** A part a component fetched lands after the component has gone: nothing runs, and a
 *  failure nobody is waiting for any more is no unhandled rejection - which is what failed
 *  a run when a test ended while a tab's carrying code was on its way (#331's strip,
 *  tab-strip-gestures.effect.test.ts). See src/lib/while-here.ts. In the jsdom project
 *  because it mounts a component. */

const { default: Fetching } = await import('./Fetching.svelte')

/** The component as the test holds it: what it exports. */
interface Fetches {
  fetch<T>(asked: Promise<T>): Promise<T>
}
const shownHere = () => mount(Fetching, { target: document.body }) as unknown as Fetches

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const settled = () => new Promise((go) => setTimeout(go, 0))

test('while the component is there, it hears what it fetched, and a failure', async () => {
  const shown = shownHere()
  flushSync()
  const part = deferred<string>()
  const heard = shown.fetch(part.promise)
  part.resolve('menu')
  await expect(heard).resolves.toBe('menu')

  const broken = deferred<string>()
  const failed = shown.fetch(broken.promise)
  broken.reject(new Error('gone offline'))
  await expect(failed).rejects.toThrow('gone offline')
  void unmount(shown)
})

test('once it is gone, what lands is dropped, success and failure alike', async () => {
  const shown = shownHere()
  flushSync()
  const part = deferred<string>()
  const broken = deferred<string>()
  let ran = false
  void shown.fetch(part.promise).then(() => (ran = true))
  // Not awaited and not caught: a rejection that reached it would be unhandled, and
  // Vitest fails the run on one.
  void shown.fetch(broken.promise)
  await unmount(shown)

  part.resolve('menu')
  broken.reject(new Error('the environment was torn down'))
  await settled()
  expect(ran).toBe(false)
})
