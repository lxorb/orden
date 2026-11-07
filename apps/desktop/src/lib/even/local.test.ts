import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { forTheCookie } from './local'
import { STORAGE_KEY as RECOVERY_KEY } from '../recovery.svelte'
import { STORAGE_KEY as MIRRORS_KEY } from '../sync.svelte'
import { STORAGE_KEY as FOLDER_ICONS_KEY } from '../workspace/folder-icons.svelte'
import { STORAGE_KEY as ARCHIVED_KEY } from '../workspace/archive.svelte'
import {
  EXPANDED_KEY,
  ICON_TINTS_KEY,
  ICONS_KEY,
  RECENT_KEY,
  TAGS_KEY,
} from '../workspace/device.svelte'

const phone = vi.hoisted(() => ({ held: new Map<string, string>(), reachable: false }))

vi.mock('./sdk', () => ({
  connectStore: async () => {
    while (!phone.reachable) await new Promise((resolve) => setTimeout(resolve, 20))

    return {
      read: (key: string) => Promise.resolve(phone.held.get(key) ?? ''),
      write: (key: string, value: string) => {
        phone.held.set(key, value)
        return Promise.resolve(true)
      },
    }
  },
}))

let jar = ''

beforeAll(async () => {
  await import('./local')
})

async function launch() {
  vi.useRealTimers()
  vi.resetModules()

  vi.stubGlobal('document', {
    get cookie() {
      return jar
    },
    set cookie(one: string) {
      const [pair = ''] = one.split(';')
      const [name = ''] = pair.split('=')
      const rest = jar
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith(`${name}=`))

      jar = [...rest, pair].join('; ')
    },
  })

  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  })

  const module = await import('./local')
  vi.useFakeTimers()

  return module
}

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  jar = ''
  phone.held.clear()
  phone.reachable = true
})

describe('settings across launches', () => {
  test('a setting written in one launch is there in the next', async () => {
    const first = await launch()
    const one = first.installLocal()
    localStorage.setItem('orden:theme', 'dark')
    await vi.advanceTimersByTimeAsync(1000)

    const second = await launch()
    second.installLocal()

    expect(localStorage.getItem('orden:theme')).toBe('dark')
    expect(one.getItem('orden:theme')).toBe('dark')
  })

  test('it is there at the first paint, without waiting for the phone', async () => {
    const first = await launch()
    first.installLocal()
    localStorage.setItem('orden:theme', 'dark')
    await vi.advanceTimersByTimeAsync(1000)

    phone.reachable = false
    const second = await launch()
    second.installLocal()

    expect(localStorage.getItem('orden:theme')).toBe('dark')
  })

  test('what the cookie could not hold comes back from the phone', async () => {
    const first = await launch()
    first.installLocal()
    localStorage.setItem('orden:theme', 'dark')
    localStorage.setItem('orden:layouts', 'x'.repeat(6000))
    await vi.advanceTimersByTimeAsync(1000)

    const second = await launch()
    const local = second.installLocal()
    expect(localStorage.getItem('orden:theme')).toBe('dark')
    expect(localStorage.getItem('orden:layouts')).toBeNull()

    await second.fillLocal(local)
    expect(localStorage.getItem('orden:layouts')).toHaveLength(6000)
  })

  test('a setting changed this launch is not undone by the phone answering late', async () => {
    const first = await launch()
    first.installLocal()
    localStorage.setItem('orden:theme', 'dark')
    await vi.advanceTimersByTimeAsync(1000)

    const second = await launch()
    const local = second.installLocal()
    localStorage.setItem('orden:theme', 'light')

    await second.fillLocal(local)
    expect(localStorage.getItem('orden:theme')).toBe('light')
  })

  test('the page keeps working when there is no cookie and no phone', async () => {
    phone.reachable = false
    const only = await launch()
    only.installLocal()

    localStorage.setItem('orden:theme', 'dark')
    expect(localStorage.getItem('orden:theme')).toBe('dark')
    expect(localStorage.getItem('nothing')).toBeNull()
  })
})

describe('which store a key rides in', () => {
  function mirrors(notes: number): string {
    const held: Record<string, unknown> = {}
    for (let at = 0; at < notes; at++) {
      held[`/Notes/A note ${String(at)}.md`] = {
        id: `note-${String(at)}`,
        hash: 'f'.repeat(64),
        at: 1_788_000_000_000,
        rev: at,
      }
    }

    return JSON.stringify({ mirrors: { '/Notes': { spaceId: 's', notes: held, files: {} } } })
  }

  test('is decided by what it is for, not by how big it is', async () => {
    expect(encodeURIComponent(mirrors(20)).length).toBeGreaterThan(3500)

    const first = await launch()
    first.installLocal()
    localStorage.setItem('orden:theme', 'dark')
    localStorage.setItem('orden:language', 'de')
    localStorage.setItem('orden:mirrors', mirrors(20))
    localStorage.setItem('orden:recent', JSON.stringify(['/Notes/One.md', '/Notes/Two.md']))
    await vi.advanceTimersByTimeAsync(1000)

    phone.reachable = false
    const second = await launch()
    second.installLocal()

    expect(localStorage.getItem('orden:theme')).toBe('dark')
    expect(localStorage.getItem('orden:language')).toBe('de')
    expect(localStorage.getItem('orden:mirrors')).toBeNull()
    expect(localStorage.getItem('orden:recent')).toBeNull()
  })

  test('and the bookkeeping comes back whole when the phone answers', async () => {
    const first = await launch()
    first.installLocal()
    localStorage.setItem('orden:mirrors', mirrors(20))
    await vi.advanceTimersByTimeAsync(1000)

    const second = await launch()
    const local = second.installLocal()
    expect(localStorage.getItem('orden:mirrors')).toBeNull()

    await second.fillLocal(local)
    expect(localStorage.getItem('orden:mirrors')).toBe(mirrors(20))
  })

  test('and one an older build truncated into the cookie is not read at all', async () => {
    const first = await launch()
    first.installLocal()
    localStorage.setItem('orden:mirrors', mirrors(20))
    await vi.advanceTimersByTimeAsync(1000)

    const short = JSON.stringify({ 'orden:mirrors': mirrors(3) })
    jar = `orden:local=${encodeURIComponent(short)}`

    const second = await launch()
    const local = second.installLocal()
    expect(localStorage.getItem('orden:mirrors')).toBeNull()

    await second.fillLocal(local)
    expect(localStorage.getItem('orden:mirrors')).toBe(mirrors(20))
  })

  test('leaves everything else where it was, so nothing moved by accident', () => {
    const kept = forTheCookie({
      'orden:theme': 'dark',
      'orden:accent': 'violet',
      'orden:session': 'a-token',
      'orden:workspace': '{"panes":[]}',
      'orden:modes': '{"vim":true}',
      'orden:mirrors': '{}',
      'orden:recovery': '{"every":5}',
    })

    expect(Object.keys(kept).sort()).toEqual([
      'orden:accent',
      'orden:modes',
      'orden:session',
      'orden:theme',
      'orden:workspace',
    ])
  })

  test('names the keys those stores actually use', () => {
    const owned = [
      MIRRORS_KEY,
      RECOVERY_KEY,
      RECENT_KEY,
      EXPANDED_KEY,
      TAGS_KEY,
      ICONS_KEY,
      ICON_TINTS_KEY,
      FOLDER_ICONS_KEY,
      ARCHIVED_KEY,
    ]

    expect(forTheCookie(Object.fromEntries(owned.map((one) => [one, 'x'])))).toEqual({})
  })
})
