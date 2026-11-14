import { afterEach, describe, expect, test } from 'vitest'
import type { Hit } from '@orden/scan/search/match'

const { workspace } = await import('./workspace.svelte')
const { unlocks } = await import('./protect/src/unlocked.svelte')
const { search } = await import('./search.svelte')

const ROOT = '/space'
const SHUT = `${ROOT}/Diary.md`
const OPEN = `${ROOT}/Plans.md`
const LOCK = { root: ROOT, key: 'Diary.md', way: 'password' as const }
const hit = (path: string): Hit => ({ path, name: path, line: 1, text: 'tulip', ranges: [] })

afterEach(() => {
  search.found = []
  unlocks.lockAll()
  workspace.protection.set(ROOT, SHUT, null)
})

describe('what a search found in a protected note while it was open', () => {
  test('goes from the results, and from what Replace would change, when it locks', () => {
    workspace.protection.set(ROOT, SHUT, 'password')
    unlocks.unlock([LOCK])
    search.found = [hit(SHUT), hit(OPEN)]
    expect(search.hits.map((one) => one.path)).toEqual([SHUT, OPEN])
    expect(search.chosen.map((one) => one.path)).toEqual([SHUT, OPEN])

    unlocks.lockAll()
    expect(search.hits.map((one) => one.path)).toEqual([OPEN])
    expect(search.chosen.map((one) => one.path)).toEqual([OPEN])
  })
})
