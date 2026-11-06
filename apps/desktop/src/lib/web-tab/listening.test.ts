import { expect, test, vi } from 'vitest'

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

let release: () => void = () => undefined
const slow = new Promise<void>((go) => (release = go))

vi.mock('../own-window', () => ({
  hearHere: async (name: string) => {
    if (order.length === 0) await slow
    order.push(name)
    return () => undefined
  },
}))

const { pages } = await import('./pages.svelte')

test('the first page is asked for only once the window hears where pages get to', async () => {
  const shown = pages.show('a', 'http://127.0.0.1:8765/', { x: 0, y: 0, width: 800, height: 600 })
  for (let turn = 0; turn < 20; turn += 1) await new Promise<void>((go) => setTimeout(go, 0))
  expect(order).not.toContain('web_open')

  release()
  await shown
  await vi.waitFor(() => expect(order).toContain('web_open'))
  expect(order.indexOf('nib://web-tab')).toBeGreaterThanOrEqual(0)
  expect(order.indexOf('nib://web-tab')).toBeLessThan(order.indexOf('web_open'))
})
