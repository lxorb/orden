import '../../sync-ports'
import { afterEach, describe, expect, test, vi } from 'vitest'

const { memoryStorage } = await import('../../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())
const { runner } = await import('./runner.svelte')
const { keptAway } = await import('../../away/src/api')
const open = runner as unknown as {
  current: unknown
  fetchAway(engine: unknown, path: string): Promise<boolean>
}
afterEach(() => {
  open.current = null
  vi.restoreAllMocks()
})
describe('a note kept away that the account no longer holds (#2348)', () => {
  test('is let go, and the device is not taken for offline', async () => {
    const letGo = vi.spyOn(keptAway, 'letGoUnder').mockImplementation(() => undefined)
    const engine = { fetch: () => Promise.resolve('gone' as const) }
    open.current = engine
    expect(await open.fetchAway(engine, '/s/Plan.md')).toBe(true)
    expect(letGo).toHaveBeenCalledWith('/s/Plan.md')
  })
})
