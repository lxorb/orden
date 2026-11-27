import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  engine: {
    status: { bytes: 79341311 },
    received: null as number | null,
    trouble: null as string | null,
    going: false,
    asked: [] as string[],
    look() {
      return Promise.resolve()
    },
    download() {
      world.engine.asked.push('download')
      return Promise.resolve()
    },
    cancel() {
      world.engine.asked.push('cancel')
      return Promise.resolve()
    },
  },
}))
vi.mock('../../opencode-client/src/api', () => ({
  engine: world.engine,
  stoppedLine: (kind: string) => (kind === 'offline' ? 'No connection. Try again.' : kind),
}))
const { default: EngineOffer } = await import('./EngineOffer.svelte')
let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null
function draw() {
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(EngineOffer, { target })
  flushSync()
}
beforeEach(() => {
  Object.assign(world.engine, { received: null, trouble: null, going: false, asked: [] })
})
afterEach(() => {
  if (shown) void unmount(shown)
  shown = null
  target.remove()
})
test('says in one sentence what must be downloaded, with its size, and offers Download', () => {
  draw()
  expect(target.querySelector('.words')?.textContent).toBe(
    'OpenCode (79 MB) must be downloaded to use the AI integration.',
  )
  const button = target.querySelector<HTMLButtonElement>('button.orden-button')
  expect(button?.textContent).toBe('Download')
  button?.click()
  expect(world.engine.asked).toEqual(['download'])
})
test('while it downloads, the button is a thin progress bar with Cancel under it', () => {
  Object.assign(world.engine, { received: 39670656, going: true })
  draw()
  expect(target.querySelector('button.orden-button')).toBeNull()
  expect(target.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50')
  const cancel = target.querySelector<HTMLButtonElement>('button.link')
  expect(cancel?.textContent).toBe('Cancel')
  cancel?.click()
  expect(world.engine.asked).toEqual(['cancel'])
})
test('when it stops, one line under the button says why', () => {
  Object.assign(world.engine, { received: 1000, trouble: 'offline', going: false })
  draw()
  expect(target.querySelector('button.orden-button')?.textContent).toBe('Download')
  expect(target.querySelector('.stopped')?.textContent).toBe('No connection. Try again.')
})
