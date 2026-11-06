import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { said } from '../../src/lib/said.svelte'
import Announcing from './Announcing.svelte'
import { reactive, root, watch } from './runes.svelte'

let target: HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
  vi.runAllTimers()

  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  target.remove()
  vi.runAllTimers()
  vi.useRealTimers()
})

function region(): string {
  return target.querySelector('[data-said]')?.textContent ?? ''
}

test('the same thing said twice from an effect leaves the page still updating', async () => {
  const props = reactive<{ status: 'idle' | 'syncing' | 'error'; saving: 'idle' | 'saving' }>({
    status: 'idle',
    saving: 'idle',
  })
  const app = mount(Announcing, { target, props })
  flushSync()
  expect(region()).toBe('')

  props.status = 'error'
  flushSync()
  expect(region()).toBe('Sync failed')

  props.status = 'idle'
  flushSync()
  props.status = 'error'
  expect(() => flushSync()).not.toThrow()
  expect(region()).toBe('')

  await Promise.resolve()
  flushSync()
  expect(region()).toBe('Sync failed')

  props.saving = 'saving'
  flushSync()
  expect(target.querySelector('[data-saving]')?.textContent).toBe('saving')

  void unmount(app)
})

test('an effect that says the same thing runs once per change, not a thousand times', () => {
  const driver = reactive({ passes: 0 })
  const seen: number[] = []

  const stop = root(() => {
    watch(() => {
      seen.push(driver.passes)
      said.say('Sync failed')
    })
  })

  flushSync()
  expect(seen).toEqual([0])
  expect(said.words).toBe('Sync failed')

  driver.passes++
  flushSync()
  expect(seen).toEqual([0, 1])

  stop()
})
