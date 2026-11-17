import { readBase } from '@orden/bases'
import { beforeEach, describe, expect, test, vi } from 'vitest'

let shared = false

vi.mock('../../sharing/src/api', () => ({
  trustsHtmlAt: () => !shared,
  canWriteAt: () => true,
}))

const { LiveView } = await import('./live.svelte')
const { guardedAt } = await import('./guard')

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

describe('a fence in a file somebody shared on its own', () => {
  test('is refused for a pattern that could freeze the app', async () => {
    const live = new LiveView({
      scope: null,
      path: null,
      stranger: true,
      load: () => Promise.resolve(risky),
      save: () => Promise.resolve(),
    })
    await live.reload()
    expect(live.failed).toBe(true)
  })
})

describe('a base read from a file by anything that answers it', () => {
  beforeEach(() => {
    shared = false
  })

  test('is the reader own as it is', () => {
    expect(guardedAt(risky, 'space/A.base')).toBe(risky)
  })

  test('is refused where it holds a pattern it may not run', () => {
    shared = true
    expect(guardedAt(risky, 'space/A.base')).toBeNull()
  })

  test('is marked, the one copy for the one base, so what an answer keeps stays', () => {
    shared = true
    const once = guardedAt(fine, 'space/A.base')
    expect(once?.guarded).toBe(true)
    expect(guardedAt(fine, 'space/A.base')).toBe(once)
  })

  test('in a file shared on its own, which has no path, is not the reader own', () => {
    expect(guardedAt(risky, null)).toBe(risky)
    expect(guardedAt(risky, null, true)).toBeNull()
    expect(guardedAt(fine, null, true)?.guarded).toBe(true)
  })

  test('follows the space when it comes to be shared after the read', () => {
    expect(guardedAt(fine, 'space/A.base')?.guarded).toBeUndefined()
    shared = true
    expect(guardedAt(fine, 'space/A.base')?.guarded).toBe(true)
  })
})
