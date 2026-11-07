import { expect, test, vi } from 'vitest'

const { appCommands } = await import('./commands')

test('the palette offers reloading Orden, with its key, with or without a note open', () => {
  const reload = appCommands().find((one) => one.id === 'reload-app')
  expect(reload?.label).toContain('Reload')
  expect(reload?.hint).toMatch(/R$/)
  expect(reload?.disabled).not.toBe(true)

  const reloaded = vi.fn()
  vi.stubGlobal('location', { reload: reloaded })
  reload?.run()
  expect(reloaded).toHaveBeenCalledOnce()
  vi.unstubAllGlobals()
})
