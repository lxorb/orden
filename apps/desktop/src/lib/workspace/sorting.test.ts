import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Which order each space's list is read in, carried with the account (#423): Emil, *"if
 *  I turn on manual for one space, it will remain on for that space even on other
 *  devices"*. What each machine chose before is taken over once; the first time an
 *  account sees a space this machine's choice stands where the account has none and is
 *  sent up; after that the account's word is taken. */

const sent = vi.hoisted(() => [] as { root: string; sort: string }[])
vi.mock('./pushing', () => ({
  push: async (
    root: string,
    save: (
      api: { saveSort: (t: string, id: string, sort: string) => unknown },
      token: string,
      id: string,
    ) => unknown,
  ) => {
    await save({ saveSort: (_t, _id, sort) => sent.push({ root, sort }) }, 'token', 'space')
  },
}))

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

const { SpaceSorting, SORT_KEY: STORAGE_KEY } = await import('./arranged.svelte')

const ROOT = '/spaces/Notes'
const made = () => new SpaceSorting(() => ROOT)

beforeEach(() => {
  store.clear()
  sent.length = 0
})

describe('the order a space is read in', () => {
  test('is by name until somebody chooses', () => {
    expect(made().of(ROOT)).toBe('name')
  })

  test('chosen, is kept here and sent to the account at once', async () => {
    const sorting = made()
    sorting.set('manual')
    expect(sorting.of(ROOT)).toBe('manual')
    await vi.waitFor(() => expect(sent).toEqual([{ root: ROOT, sort: 'manual' }]))
    expect(made().of(ROOT)).toBe('manual')
  })

  test('what this machine chose before is taken over once, from where it kept it', () => {
    store.set('nib:list-order', JSON.stringify({ [ROOT]: 'modified-desc', '/other': 'sideways' }))
    const sorting = made()
    expect(sorting.of(ROOT)).toBe('modified-desc')
    expect(sorting.of('/other')).toBe('name')
    expect(JSON.parse(store.get(STORAGE_KEY) ?? '{}')[ROOT].mode).toBe('modified-desc')

    // Read once: a choice changed under the old key afterwards is not read again.
    store.set('nib:list-order', JSON.stringify({ [ROOT]: 'created-asc' }))
    expect(made().of(ROOT)).toBe('modified-desc')
  })

  test('meets an account that has none: this machine’s stands, and is sent up', async () => {
    store.set('nib:list-order', JSON.stringify({ [ROOT]: 'manual' }))
    const sorting = made()
    sorting.adopt(ROOT, 'name', 'account')
    expect(sorting.of(ROOT)).toBe('manual')
    await vi.waitFor(() => expect(sent).toEqual([{ root: ROOT, sort: 'manual' }]))
  })

  test('meets an account that has one: the account’s is taken, from then on', () => {
    const sorting = made()
    sorting.adopt(ROOT, 'manual', 'account')
    expect(sorting.of(ROOT)).toBe('manual')

    // Another device chose again; the next pass brings it here.
    sorting.adopt(ROOT, 'created-desc', 'account')
    expect(sorting.of(ROOT)).toBe('created-desc')
    expect(sent).toEqual([])
  })

  test('reads an order it has never heard of as by name', () => {
    const sorting = made()
    sorting.adopt(ROOT, 'by-colour', 'account')
    expect(sorting.of(ROOT)).toBe('name')
  })

  test('follows its space folder, and is forgotten with it', () => {
    const sorting = made()
    sorting.set('manual')
    sorting.spaceMoved(ROOT, '/spaces/Work')
    expect(sorting.of('/spaces/Work')).toBe('manual')
    expect(sorting.of(ROOT)).toBe('name')
    sorting.forget('/spaces/Work')
    expect(sorting.of('/spaces/Work')).toBe('name')
  })
})

describe('a choice the account has not heard yet', () => {
  test('stands against a listing that arrives before it lands, and is sent again', async () => {
    const sorting = made()
    sorting.adopt(ROOT, 'name', 'account')
    sent.length = 0
    // Chosen, and the push not yet answered: a listing still saying the old order.
    sorting.set('manual')
    sorting.adopt(ROOT, 'name', 'account')
    expect(sorting.of(ROOT)).toBe('manual')
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0))
    expect(sent.every((one) => one.sort === 'manual')).toBe(true)
  })
})
