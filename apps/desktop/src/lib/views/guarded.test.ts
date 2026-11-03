import { readBase } from '@orden/bases'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A base somebody else could have written may not freeze the app for whoever opens it,
 *  and the reader's own runs exactly what it says. The same line raw HTML is held to;
 *  see expr/pattern.ts in @orden/bases. */

let shared = false

vi.mock('../sharing.svelte', () => ({
  trustsHtmlAt: () => !shared,
  canWriteAt: () => true,
}))

const { LiveView } = await import('./live.svelte')

const risky = readBase(`formulas:
  f: /(a+)+$/.matches(note.x)
views:
  - type: table
    name: T
`)
const fine = readBase(`formulas:
  f: /^(foo|bar)+$/.matches(note.x)
views:
  - type: table
    name: T
`)

const opened = async (base: typeof risky) => {
  const live = new LiveView({
    scope: null,
    path: 'space/A.base',
    load: () => Promise.resolve(base),
    save: () => Promise.resolve(),
  })
  await live.reload()
  return live
}

describe('a base with a pattern that could freeze the app', () => {
  beforeEach(() => {
    shared = false
  })

  test('in a space somebody else can reach is refused and says so', async () => {
    shared = true
    const live = await opened(risky)
    expect(live.failed).toBe(true)
    expect(live.base).toBeNull()
  })

  test('in a space of the reader is the reader, and is not marked', async () => {
    const live = await opened(risky)
    expect(live.failed).toBe(false)
    expect(live.base?.guarded).toBeUndefined()
  })

  test('a shared base with a pattern it may run opens, marked', async () => {
    shared = true
    const live = await opened(fine)
    expect(live.failed).toBe(false)
    expect(live.base?.guarded).toBe(true)
  })
})
