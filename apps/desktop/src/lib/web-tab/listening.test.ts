/** The first page of a window is built only once the window can hear it (#777).
 *
 *  The window's listeners are put in place with its first web tab, behind a few imports.
 *  They used to be marked as started before any of them was, so the placement right
 *  after found them "started" and built the page at once: a page that loaded quickly
 *  said its title, and what its worker had answered, before anything was listening, and
 *  the tab kept no title for good. So the listening is slowed here, the way a cold
 *  machine slows the imports, and the page has to be asked for only after the window is
 *  listening for where it has got to. */

import { expect, test, vi } from 'vitest'

/** What happened, in order: a listener put in place, or the page asked for. */
const order: string[] = []

vi.stubGlobal('window', {})
vi.stubGlobal('requestAnimationFrame', (go: () => void) => setTimeout(go, 0))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  invoke: async (command: string) => {
    if (command === 'web_open') order.push('web_open')
    return undefined
  },
}))

/** The first listener waits for this, as one behind a cold import does. */
let release: () => void = () => undefined
const slow = new Promise<void>((go) => (release = go))

vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string) => {
    if (order.length === 0) await slow
    order.push(name)
    return () => undefined
  },
}))

const { pages } = await import('./pages.svelte')

test('the first page is asked for only once the window hears where pages get to', async () => {
  const shown = pages.show('a', 'http://127.0.0.1:8765/', { x: 0, y: 0, width: 800, height: 600 })
  // Turns enough for a build that does not wait to have been asked for.
  for (let turn = 0; turn < 20; turn += 1) await new Promise<void>((go) => setTimeout(go, 0))
  expect(order).not.toContain('web_open')

  release()
  await shown
  await vi.waitFor(() => expect(order).toContain('web_open'))
  expect(order.indexOf('nib://web-tab')).toBeGreaterThanOrEqual(0)
  expect(order.indexOf('nib://web-tab')).toBeLessThan(order.indexOf('web_open'))
})
