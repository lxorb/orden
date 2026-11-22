import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const logged = vi.hoisted(() => [] as string[])
vi.mock('../../src/lib/platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/api')>()),
  log: (level: string, text: string) => logged.push(`${level} ${text}`),
}))
const { held } = await import('./region-state.svelte')
const RegionPair = (await import('./RegionPair.svelte')).default
let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null
function draw() {
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(RegionPair, { target })
  flushSync()
}
afterEach(() => {
  if (shown) void unmount(shown, { outro: false })
  shown = null
  target.remove()
  held.fail = false
  held.count = 0
  logged.length = 0
})
const settled = () => new Promise((done) => setTimeout(done, 0))
test('a region that throws is written to the log by name with its stack, and the region beside it still answers (#2416)', async () => {
  draw()
  held.fail = true
  flushSync()
  await settled()
  expect(logged.some((one) => one.startsWith('error left failed: Error: the left region broke'))).toBe(true)
  expect(logged.join('\n')).toContain('RegionThrower')
  target.querySelector<HTMLButtonElement>('.right')?.click()
  flushSync()
  expect(target.querySelector('.right')?.textContent).toBe('1')
})
test('a region is rebuilt once, and one that fails again at once offers Reload while the others go on', async () => {
  draw()
  held.fail = true
  flushSync()
  await settled()
  flushSync()
  await settled()
  flushSync()
  expect(target.querySelector('[data-lost="left"] button')?.textContent).toBe('Reload')
  target.querySelector<HTMLButtonElement>('.right')?.click()
  flushSync()
  expect(target.querySelector('.right')?.textContent).toBe('1')
  expect(target.querySelector('[data-lost="right"]')).toBeNull()
})
test('every region of the window sits in its own boundary', () => {
  const app = readFileSync(resolve(import.meta.dirname, '../../src/App.svelte'), 'utf8')
  for (const name of [
    'title bar',
    'left sidebar',
    'right sidebar',
    'panes',
    'first screen',
    'scratchpad column',
    'status bar',
    'notices',
  ]) {
    expect(app, name).toContain(`<Region name="${name}">`)
  }
})
