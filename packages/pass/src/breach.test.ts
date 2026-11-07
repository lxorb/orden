import { describe, expect, it } from 'vitest'
import {
  BreachLookupError,
  type Fetcher,
  breachedAccount,
  compromisedOf,
  parseRange,
  pwnedCount,
  rangeOf,
  sha1Hex,
} from './breach'
import { newEnvelope } from './envelope'
import { loginOf } from './import/build'
import type { Item } from './types'

const PASSWORD_HASH = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8'

function login(id: string, password: string, extra: Partial<Item> = {}): Item {
  return {
    ...newEnvelope(loginOf({ title: id, password }), 1),
    id,
    vault: 'v',
    rev: 1,
    ...extra,
  }
}

interface Call {
  url: string
  headers: Record<string, string>
}

function fakeRanges(known: Record<string, number>, calls: Call[] = []): Fetcher {
  return async (url, init) => {
    calls.push({ url, headers: init.headers })
    const prefix = url.slice(-5)
    const lines = Object.entries(known)
      .filter(([hash]) => hash.startsWith(prefix))
      .map(([hash, count]) => `${hash.slice(5)}:${String(count)}`)
    lines.push('0000000000000000000000000000000000A:0')
    await Promise.resolve()
    return { ok: true, status: 200, text: async () => lines.join('\r\n') }
  }
}

describe('sha1Hex', () => {
  it('is upper-case hex', async () => {
    expect(await sha1Hex('password')).toBe(PASSWORD_HASH)
  })
})

describe('parseRange', () => {
  it('reads suffixes and counts and drops padding', () => {
    const counts = parseRange(
      '1E4C9B93F3F0682250B6CF8331B7EE68FD8:3\r\nabcdefabcdefabcdefabcdefabcdefabcde:0\nnot a line\n',
    )
    expect([...counts]).toEqual([['1E4C9B93F3F0682250B6CF8331B7EE68FD8', 3]])
  })
})

describe('rangeOf and pwnedCount', () => {
  it('sends only the first five digits with padding', async () => {
    const calls: Call[] = []
    const count = await pwnedCount('password', fakeRanges({ [PASSWORD_HASH]: 9 }, calls), undefined)
    expect(count).toBe(9)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.pwnedpasswords.com/range/5BAA6')
    expect(calls[0]?.url).not.toContain(PASSWORD_HASH.slice(5))
    expect(calls[0]?.headers).toEqual({ 'Add-Padding': 'true' })
  })

  it('is 0 for a password not in the range', async () => {
    expect(await pwnedCount('correct horse battery staple', fakeRanges({}))).toBe(0)
  })

  it('refuses a prefix that is not five hex digits', async () => {
    await expect(rangeOf('5baa6', fakeRanges({}))).rejects.toThrow()
  })

  it.each([429, 503])('throws a BreachLookupError on %i', async (status) => {
    const fetcher: Fetcher = async () => ({ ok: false, status, text: async () => '' })
    const error = await pwnedCount('password', fetcher).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BreachLookupError)
    expect((error as BreachLookupError).status).toBe(status)
  })

  it('throws a BreachLookupError with no status when the network fails', async () => {
    const fetcher: Fetcher = async () => {
      throw new TypeError('fetch failed')
    }
    const error = await pwnedCount('password', fetcher).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BreachLookupError)
    expect((error as BreachLookupError).status).toBeNull()
  })
})

describe('compromisedOf', () => {
  it('asks once per prefix and marks every item with a known password', async () => {
    const calls: Call[] = []
    const items = [
      login('a', 'password'),
      login('b', 'password'),
      login('c', 'unbreached-and-long-enough'),
      login('d', ''),
      login('e', 'password', { trashed: 5 }),
      login('f', 'password', { monitored: false }),
    ]
    const found = await compromisedOf(items, fakeRanges({ [PASSWORD_HASH]: 1 }, calls))
    expect([...found].sort()).toEqual(['a', 'b'])
    expect(calls).toHaveLength(2)
    expect(new Set(calls.map((c) => c.url)).size).toBe(2)
  })

  it('asks once for two passwords that share a prefix', async () => {
    const calls: Call[] = []
    const sharing = '5BAA6730767DDDF4BAE7F5992FF4F38FAE136F34'
    expect(await sha1Hex('orden-341009')).toBe(sharing)
    const items = [login('a', 'password'), login('b', 'orden-341009'), login('c', 'password')]
    const found = await compromisedOf(
      items,
      fakeRanges({ [PASSWORD_HASH]: 2, [sharing]: 1 }, calls),
    )
    expect([...found].sort()).toEqual(['a', 'b', 'c'])
    expect(calls).toHaveLength(1)
  })

  it('keeps to its concurrency', async () => {
    let running = 0
    let most = 0
    const fetcher: Fetcher = async () => {
      running++
      most = Math.max(most, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return { ok: true, status: 200, text: async () => '' }
    }
    const items = Array.from({ length: 12 }, (_, i) =>
      login(String(i), `password number ${String(i)}`),
    )
    await compromisedOf(items, fetcher, { concurrency: 3 })
    expect(most).toBeLessThanOrEqual(3)
    expect(most).toBeGreaterThan(1)
  })

  it('stops when aborted', async () => {
    const controller = new AbortController()
    let asked = 0
    const fetcher: Fetcher = async () => {
      asked++
      controller.abort()
      return { ok: true, status: 200, text: async () => '' }
    }
    const items = Array.from({ length: 8 }, (_, i) =>
      login(String(i), `another password ${String(i)}`),
    )
    await expect(
      compromisedOf(items, fetcher, { concurrency: 1, signal: controller.signal }),
    ).rejects.toThrow()
    expect(asked).toBe(1)
  })

  it('does not start when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let asked = 0
    const fetcher: Fetcher = async () => {
      asked++
      return { ok: true, status: 200, text: async () => '' }
    }
    await expect(
      compromisedOf([login('a', 'password')], fetcher, { signal: controller.signal }),
    ).rejects.toThrow()
    expect(asked).toBe(0)
  })

  it('passes a lookup failure on', async () => {
    const fetcher: Fetcher = async () => ({ ok: false, status: 503, text: async () => '' })
    await expect(compromisedOf([login('a', 'password')], fetcher)).rejects.toBeInstanceOf(
      BreachLookupError,
    )
  })
})

describe('breachedAccount', () => {
  it('asks HIBP v3 with the key and reads the breaches', async () => {
    const calls: Call[] = []
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, headers: init.headers })
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            {
              Name: 'Adobe',
              Title: 'Adobe',
              Domain: 'adobe.com',
              BreachDate: '2013-10-04',
              DataClasses: ['Email addresses', 'Passwords'],
            },
            { Title: 'no name' },
          ]),
      }
    }
    const breaches = await breachedAccount(' me+pass@example.com ', 'KEY', fetcher)
    expect(breaches).toEqual([
      {
        name: 'Adobe',
        title: 'Adobe',
        domain: 'adobe.com',
        date: '2013-10-04',
        dataClasses: ['Email addresses', 'Passwords'],
      },
    ])
    expect(calls[0]?.url).toBe(
      'https://haveibeenpwned.com/api/v3/breachedaccount/me%2Bpass%40example.com?truncateResponse=false',
    )
    expect(calls[0]?.headers).toEqual({ 'hibp-api-key': 'KEY', 'user-agent': 'Orden' })
  })

  it('is empty on 404', async () => {
    const fetcher: Fetcher = async () => ({ ok: false, status: 404, text: async () => '' })
    expect(await breachedAccount('a@b.c', 'KEY', fetcher)).toEqual([])
  })

  it.each([401, 429, 503])('throws on %i', async (status) => {
    const fetcher: Fetcher = async () => ({ ok: false, status, text: async () => '' })
    await expect(breachedAccount('a@b.c', 'KEY', fetcher)).rejects.toMatchObject({ status })
  })
})
