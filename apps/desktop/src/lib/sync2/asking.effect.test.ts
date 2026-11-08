import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./Diverged.svelte', () => ({ default: () => undefined }))

const { workspace } = await import('../workspace.svelte')
const { unlocks } = await import('../protect/unlocked.svelte')
const { asking } = await import('./asking.svelte')
type Engine = import('./asking.svelte').Engine

const ROOT = '/space'
const NOTE = `${ROOT}/Diary.md`
const LOCK = { root: ROOT, key: 'Diary.md', way: 'password' as const }
const side = (words: string) => ({ device: 'Laptop', at: 1, excerpt: { text: words, marks: [] } })

const engine = {
  held: {
    notes: [
      { id: 'one', path: NOTE, name: 'Diary', mine: side('what nobody'), theirs: side('may read') },
    ],
    answer: () => Promise.resolve(undefined),
  },
  store: { read: () => Promise.resolve(null) },
  on: () => () => undefined,
} as unknown as Engine

let gone: () => void = () => undefined

beforeEach(() => {
  workspace.spaces = [{ id: 'space', name: 'Space', root: ROOT }]
  workspace.protection.set(ROOT, NOTE, 'password')
  unlocks.lockAll()
  vi.spyOn(workspace, 'active', 'get').mockReturnValue({
    id: 'diary',
    kind: 'note',
    path: NOTE,
  } as never)
  gone = asking.connect(engine)
  flushSync()
})

afterEach(() => {
  gone()
  vi.restoreAllMocks()
  unlocks.lockAll()
  workspace.protection.set(ROOT, NOTE, null)
})

describe('a protected note that went two ways', () => {
  test('is not shown side by side while it is shut, and is once it opens', () => {
    expect(asking.asked).toBeNull()
    unlocks.unlock([LOCK])
    flushSync()
    expect(asking.asked?.id).toBe('one')
    unlocks.close([LOCK])
    flushSync()
    expect(asking.asked).toBeNull()
  })
})
