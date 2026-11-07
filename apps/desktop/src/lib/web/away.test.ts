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
