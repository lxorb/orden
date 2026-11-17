import { expect, test, vi } from 'vitest'

vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
}))

const { memoryStorage } = await import('../../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())

await import('../../theme-ports')
const { themeDeclarations } = await import('./appearance-pane')

test('every field of a theme not worn reads as its starting value on a fresh profile', async () => {
  const fields = await themeDeclarations()
  const switches = fields.filter((one) => one.kind === 'switch' && one.initial === true)
  expect(switches.length).toBeGreaterThan(0)
  for (const one of fields) {
    if (!('initial' in one) || one.initial === undefined) continue
    expect([one.key, one.get()]).toEqual([one.key, one.initial])
  }
})
