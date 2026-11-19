import { describe, expect, test, vi } from 'vitest'

const purged: string[] = []
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_trash') {
      return Promise.resolve([
        { id: 'root', from: 'C:\\Spaces\\Uni' },
        { id: 'inside', from: 'C:\\Spaces\\Uni\\Notes\\a.md' },
        { id: 'beside', from: 'C:\\Spaces\\University\\b.md' },
        { id: 'elsewhere', from: 'C:\\Spaces\\Home\\c.md' },
      ])
    }
    if (command === 'purge_trash') purged.push(String(args?.id))
    return Promise.resolve(null)
  },
}))
vi.stubGlobal('localStorage', (await import('../../../../test/disk')).memoryStorage())
const { dropSpace } = await import('./space-changes')
describe('a space dropped for good', () => {
  test('purges what was deleted inside it, also where paths are written with backslashes', async () => {
    const uni = { id: 'uni', name: 'Uni', root: 'C:\\Spaces\\Uni' }
    const ws = {
      spaces: [uni],
      activeSpaceId: null,
      tabs: [],
      tree: null,
      setsRead: undefined,
      fileGone: () => Promise.resolve(),
      persist: () => undefined,
    }
    await dropSpace(ws as never, 'uni')
    expect(purged.sort()).toEqual(['inside', 'root'])
    expect(ws.spaces).toEqual([])
  })
})
