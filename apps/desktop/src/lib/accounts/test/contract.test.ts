import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  account,
  ApiError,
  called,
  clearsAt,
  faceUrl,
  farApart,
  fetchInTime,
  fromServer,
  stands,
} from '../src/api'
import { LATE } from '../src/client'
import { clampOffset, sourceSquare, zoomed } from '../src/crop'
import { carriesMetadata } from '../src/encode'
import { readPerson } from '../src/read'

const SRC = join(import.meta.dirname, '../src')

describe('the module stands on its own', () => {
  test('nothing under src reaches the sign-in sheet, the profile views or the sync engine', () => {
    const reaching = readdirSync(SRC)
      .filter((name) => !name.includes('.test.'))
      .filter((name) => /accounts-ui|sync-client/.test(readFileSync(join(SRC, name), 'utf8')))
    expect(reaching).toEqual([])
  })

  test('loads signed out: no token, nobody, no spaces', () => {
    expect(account.signedIn).toBe(false)
    expect(account.accountToken).toBeNull()
    expect(account.name).toBeNull()
    expect(account.spaces).toEqual([])
  })
})

describe('a person', () => {
  test('is called by the name chosen, else by the part of the address before the @', () => {
    expect(called({ name: ' Ada ', email: 'ada@example.org' })).toBe('Ada')
    expect(called({ name: null, email: 'ada@example.org' })).toBe('ada')
    expect(called({ name: '', email: 'nobody' })).toBe('nobody')
  })

  test('is read from the server with only the fields that are shaped right', () => {
    const hash = 'a'.repeat(64)
    const read = readPerson({
      id: 'u1',
      name: 'Ada',
      avatar: { s: hash, l: hash },
      pronouns: 7,
      status: { emoji: 'x', text: 'away', until: 'soon' },
      presence: 'busy',
    })
    expect(read).toEqual({
      id: 'u1',
      name: 'Ada',
      avatar: { s: hash, l: hash },
      pronouns: null,
      bio: null,
      status: { emoji: 'x', text: 'away', until: null, quiet: false },
      zone: null,
      presence: 'offline',
    })
    expect(readPerson({ id: 'u1' })).toBeNull()
    expect(readPerson({ id: 'u2', name: 'B', avatar: { s: 'short', l: hash } })?.avatar).toBeNull()
  })

  test('has a face address only for a real hash', () => {
    expect(faceUrl('b'.repeat(64))).toMatch(/\/i\/b{64}\.webp$/)
    expect(faceUrl('../etc')).toBeNull()
    expect(faceUrl(null)).toBeNull()
  })
})

describe('a status', () => {
  test('clears after the span chosen, at midnight for today, never when asked', () => {
    const noon = new Date(2026, 0, 7, 12, 0, 0)
    expect(clearsAt('30m', noon)).toBe(noon.getTime() + 30 * 60_000)
    expect(clearsAt('4h', noon)).toBe(noon.getTime() + 4 * 3_600_000)
    expect(clearsAt('today', noon)).toBe(new Date(2026, 0, 8, 0, 0, 0).getTime())
    expect(clearsAt('never', noon)).toBeNull()
  })

  test('stands while its end is ahead, or for good without one', () => {
    expect(stands({ until: 10 }, 5)).toBe(true)
    expect(stands({ until: 10 }, 10)).toBe(false)
    expect(stands({ until: null }, 10)).toBe(true)
    expect(stands(null, 10)).toBe(false)
  })

  test('two zones are far apart from an hour of difference', () => {
    const at = Date.UTC(2026, 0, 7, 12)
    expect(farApart('Europe/Zurich', 'Europe/Berlin', at)).toBe(false)
    expect(farApart('Asia/Tokyo', 'Europe/Zurich', at)).toBe(true)
    expect(farApart('Nowhere/Nothing', 'Europe/Zurich', at)).toBe(false)
  })
})

describe('a picture for a face', () => {
  test('is known to carry metadata by its container, and anything unknown is treated as if it did', () => {
    const jpegPlain = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])
    const jpegExif = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 2])
    expect(carriesMetadata(jpegPlain)).toBe(false)
    expect(carriesMetadata(jpegExif)).toBe(true)
    expect(carriesMetadata(new Uint8Array([1, 2, 3]))).toBe(true)
  })

  test('a crop stays inside the picture and zooms around the point under the pointer', () => {
    const inside = clampOffset({ x: 999, y: -999 }, 200, 100, 100, 1)
    expect(inside).toEqual({ x: 50, y: 0 })
    const zoom = zoomed({ zoom: 1, offset: { x: 0, y: 0 } }, 2, { x: 0, y: 0 }, 200, 100, 100)
    expect(zoom.zoom).toBe(2)
    const square = sourceSquare({ zoom: 1, offset: { x: 0, y: 0 } }, 200, 100, 100)
    expect(square).toEqual({ left: 50, top: 0, side: 100 })
  })
})

describe('a call to the account service', () => {
  test('gives up in time with the words the sheets show, and an abort from the caller stays its own', async () => {
    const never: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const why: unknown = init.signal?.reason
          reject(why instanceof Error ? why : new Error('aborted'))
        })
      })
    const was = globalThis.fetch
    globalThis.fetch = never
    try {
      await expect(fetchInTime('https://example.org', {}, 5)).rejects.toThrow(LATE)
      const own = new AbortController()
      const asked = fetchInTime('https://example.org', { signal: own.signal }, 1000)
      own.abort(new Error('went away'))
      await expect(asked).rejects.toThrow('went away')
    } finally {
      globalThis.fetch = was
    }
  })

  test('a refusal from the server is one it said itself only when it carries an error', () => {
    expect(fromServer(new ApiError(401, 'no', { error: 'no' }))).toBe(true)
    expect(fromServer(new ApiError(500, 'down'))).toBe(false)
    expect(fromServer(new Error('no'))).toBe(false)
  })
})
