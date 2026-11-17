import { providePort } from '@orden/contracts'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const { setup } = await import('./setup-state.svelte')
const ImportStep = (await import('./ImportStep.svelte')).default

let finish: () => void = () => undefined
const unprovide = providePort('import.bring', {
  here: () => Promise.resolve(new Set(['chrome', 'safari'] as const)),
  browser: () => new Promise((resolve) => (finish = () => resolve([]))),
  notes: () => Promise.resolve({ picked: false, trouble: null }),
  shared: () => Promise.resolve(null),
  landShared: () => Promise.resolve(null),
})

afterEach(() => {
  vi.useRealTimers()
  unprovide()
})

test('an import that ends after Back does not move the setup on from the step now showing', async () => {
  vi.useFakeTimers()
  localStorage.clear()
  setup.begin(true)
  await setup.look()
  setup.answer({ browser: 'chrome' })
  while (setup.step !== 'browser') setup.next(setup.step)
  setup.next(setup.step)
  expect(setup.step).toBe('import')

  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(ImportStep, { target, intro: false })
  flushSync()
  ;[...target.querySelectorAll('button')].find((one) => one.textContent.includes('Import'))?.click()
  flushSync()

  setup.back()
  expect(setup.step).toBe('browser')
  finish()
  await vi.runAllTimersAsync()

  expect(setup.step).toBe('browser')
  void unmount(shown)
  target.remove()
})
