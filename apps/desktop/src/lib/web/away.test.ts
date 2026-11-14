import { expect, test } from 'vitest'
import { keptAway } from './away.svelte'

test('a note just let go of is away at once, so a write brings it back first', async () => {
  const fetched: string[] = []
  keptAway.keep([], (path) => {
    fetched.push(path)
    return Promise.resolve(true)
  })
  expect(keptAway.at('/space/Ideas.md')).toBeNull()

  keptAway.went('/space/Ideas.md')
  expect(keptAway.at('/space/Ideas.md')?.path).toBe('/space/Ideas.md')
  expect(await keptAway.bringBack('/space/Ideas.md')).toBe(true)
  expect(fetched).toEqual(['/space/Ideas.md'])
  expect(keptAway.at('/space/Ideas.md')).toBeNull()
  keptAway.clear()
})

test('a note the syncing engine already keeps away is away before its list is retold', async () => {
  const fetched: string[] = []
  keptAway.reach(
    (path) => (path === '/space/Board.canvas' ? { id: 'n1', path, size: 9, modified: 1 } : null),
    (path) => {
      fetched.push(path)
      return Promise.resolve(true)
    },
  )
  expect(keptAway.all()).toEqual([])
  expect(keptAway.at('/space/Board.canvas')?.id).toBe('n1')
  expect(keptAway.at('/space/Other.md')).toBeNull()
  expect(keptAway.under('/space/Board.canvas').map((one) => one.id)).toEqual(['n1'])
  expect(await keptAway.bringBack('/space/Board.canvas')).toBe(true)
  expect(await keptAway.bringBack('/space/Other.md')).toBe(false)
  expect(fetched).toEqual(['/space/Board.canvas'])

  keptAway.clear()
  expect(keptAway.at('/space/Board.canvas')).toBeNull()
})
