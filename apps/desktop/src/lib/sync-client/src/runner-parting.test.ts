import '../../sync-ports'
import { afterEach, describe, expect, test, vi } from 'vitest'

const { memoryStorage } = await import('../../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())
const { runner } = await import('./runner.svelte')
const { written } = await import('../../parting/src/api')
const open = runner as unknown as { current: unknown }
function engineOwing(...owed: string[]) {
  const unsent = new Set(owed)
  const said: string[] = []
  open.current = {
    core: {
      spaces: new Map([
        ['s1', {}],
        ['s2', {}],
      ]),
    },
    waiting: (id: string) => unsent.has(id),
    flush: () => Promise.resolve(void said.push('flush')),
    quit: () => Promise.resolve(void said.push('quit')),
    pass: (id: string) => {
      said.push(`pass ${id}`)
      unsent.delete(id)
      return Promise.resolve({ pulled: 0, pushed: 1, finished: true, full: false })
    },
  }
  return said
}
afterEach(() => {
  open.current = null
})
describe('a window that goes, or hides, right after a write (#2269)', () => {
  test('sends what is still unsent before the engine quits', async () => {
    const said = engineOwing('s2')
    runner.parting()
    await written()
    expect(said).toEqual(['flush', 'pass s2', 'quit'])
  })
  test('hiding sends what is unsent at once, not after the nudge', async () => {
    const said = engineOwing('s1')
    runner.flushing()
    await written()
    expect(said).toEqual(['flush', 'pass s1'])
  })
  test('with nothing unsent asks the account nothing', async () => {
    const said = engineOwing()
    runner.parting()
    await written()
    expect(said).toEqual(['flush', 'quit'])
  })
})
