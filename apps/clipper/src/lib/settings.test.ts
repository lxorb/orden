import { beforeEach, describe, expect, test, vi } from 'vitest'
import { forget, remember, settings } from './settings'

let held: Record<string, unknown> = {}

/** As much of `chrome.storage.local` as this file talks to, holding its keys in
 *  an object so a test can put anything at all under one of them. */
beforeEach(() => {
  held = {}

  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: () => Promise.resolve({ ...held }),
        set: (patch: Record<string, unknown>) => {
          Object.assign(held, patch)
          return Promise.resolve()
        },
        remove: (keys: string[]) => {
          held = Object.fromEntries(Object.entries(held).filter(([key]) => !keys.includes(key)))
          return Promise.resolve()
        },
      },
    },
  })
})

describe('a first run', () => {
  test('has no session and no preferences to speak of', async () => {
    expect(await settings()).toEqual({
      token: null,
      email: null,
      spaces: [],
      target: { spaceId: '', folder: '' },
      language: 'system',
      theme: 'system',
    })
  })
})

describe('reading what an earlier run wrote', () => {
  test('takes the session and the address', async () => {
    held['nib:session'] = 'abc'
    held['nib:email'] = 'me@example.com'

    const read = await settings()
    expect(read.token).toBe('abc')
    expect(read.email).toBe('me@example.com')
  })

  test('takes the spaces it can read and drops the rest', async () => {
    held['nib:spaces'] = [{ id: 'a', name: 'Notes', position: 3 }, { id: 'b' }, 'Work']

    expect((await settings()).spaces).toEqual([{ id: 'a', name: 'Notes', position: 3 }])
  })

  test('gives a space with no position one, so the picker still has an order', async () => {
    held['nib:spaces'] = [{ id: 'a', name: 'Notes' }]

    expect((await settings()).spaces[0]?.position).toBe(0)
  })

  test('reads a half written target as an empty one', async () => {
    held['nib:target'] = { spaceId: 'a' }

    expect((await settings()).target).toEqual({ spaceId: 'a', folder: '' })
  })

  test('ignores a token that is not a string', async () => {
    held['nib:session'] = { token: 'abc' }
    expect((await settings()).token).toBe(null)
  })

  test('ignores a theme it has never heard of', async () => {
    held['nib:theme'] = 'sepia'
    expect((await settings()).theme).toBe('system')
  })

  test('ignores a target that is not an object at all', async () => {
    held['nib:target'] = 'Reading'
    expect((await settings()).target).toEqual({ spaceId: '', folder: '' })
  })
})

describe('writing', () => {
  test('puts each field under the key the app uses for it', async () => {
    await remember({ token: 'abc', language: 'de' })

    expect(held['nib:session']).toBe('abc')
    expect(held['nib:language']).toBe('de')
  })

  test('leaves what it was not asked about alone', async () => {
    held['nib:language'] = 'fr'
    await remember({ theme: 'dark' })

    expect(held['nib:language']).toBe('fr')
    expect((await settings()).theme).toBe('dark')
  })
})

describe('signing out', () => {
  test('takes the session with it', async () => {
    await remember({ token: 'abc', email: 'me@example.com', spaces: [] })
    await forget()

    expect((await settings()).token).toBe(null)
    expect((await settings()).email).toBe(null)
  })

  test('leaves the preferences, which are about this browser', async () => {
    await remember({ token: 'abc', language: 'ja', theme: 'light' })
    await forget()

    const read = await settings()
    expect(read.language).toBe('ja')
    expect(read.theme).toBe('light')
  })
})
