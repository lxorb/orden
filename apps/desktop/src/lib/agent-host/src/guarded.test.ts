import { describe, expect, test, vi } from 'vitest'

const shut = new Set(['/s/Private', '/s/Work/Diary.md'])
vi.mock('../../protect/src/api', async (original) => ({
  ...(await original<typeof import('../../protect/src/api')>()),
  protection: {
    agentsMay: (path: string) =>
      ![...shut].some((one) => path === one || path.startsWith(`${one}/`)),
    ways: () => ({ Private: 'password', 'Work/Diary.md': 'device', Open: 'device' }),
  },
}))

const { treeReadable } = await import('./guarded')

describe('what an agent may move or put in Recently deleted', () => {
  test.each([
    ['/s/Private/Diary.md', 'under a lock'],
    ['/s/Private', 'a locked folder'],
    ['/s/Work', 'a folder holding a locked note'],
    ['/s', 'the space holding them'],
  ])('is never %s (%s)', (path) => {
    expect(() => treeReadable('/s', path)).toThrow(/protected/)
  })

  test('is anything nothing shut covers or holds', () => {
    expect(() => treeReadable('/s', '/s/Work/Plan.md')).not.toThrow()
    expect(() => treeReadable('/s', '/s/Open')).not.toThrow()
  })
})
