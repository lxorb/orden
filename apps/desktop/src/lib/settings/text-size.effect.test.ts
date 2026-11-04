import { expect, test, vi } from 'vitest'

const { memoryStorage } = await import('../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())
const { modes } = await import('../modes.svelte')

test('an arrow key moves the text size slider a rung, and a drag lands on the nearest', () => {
  modes.setZoom(1)
  modes.setZoom(1.05)
  expect(modes.zoom).toBe(1.1)
  modes.setZoom(1.05)
  expect(modes.zoom).toBe(1)
  modes.setZoom(0.95)
  expect(modes.zoom).toBe(0.9)
  modes.setZoom(1.38)
  expect(modes.zoom).toBe(1.4)
  modes.setZoom(1)
})
