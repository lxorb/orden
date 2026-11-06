import { flushSync, mount, unmount } from 'svelte'
import { expect, test } from 'vitest'

const { default: Fetching } = await import('./Fetching.svelte')

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
  void shown.fetch(broken.promise)
  await unmount(shown)

  part.resolve('menu')
  broken.reject(new Error('the environment was torn down'))
  await settled()
  expect(ran).toBe(false)
})
