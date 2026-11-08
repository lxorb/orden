import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AccountDouble } from '../account-double'

const kept = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  removeItem: (key: string) => void kept.delete(key),
})

vi.mock('../account.svelte', async () => ({
  account: (await import('../account-double')).accountDouble(),
}))

const PNG = 'data:image/png;base64,iVBORw0KGgo='

const server = vi.hoisted(() => ({
  told: [] as Record<string, unknown>[],
  forgot: [] as unknown[],
  sites: [] as { site: string; label: string; seen: number; hash: string | null }[],
  refuse: null as null | Error,
  calls: 0,
  held: null as Promise<void> | null,
}))
vi.mock('../api', () => ({
  api: {
    siteIcons: async () => {
      server.calls++
      await server.held
      return server.refuse
        ? Promise.reject(server.refuse)
        : Promise.resolve({ sites: server.sites })
    },
    sawSite: async (_token: string, site: Record<string, unknown>) => {
      server.calls++
      await server.held
      if (server.refuse) return Promise.reject(server.refuse)
      server.told.push(site)
      return Promise.resolve({
        site: { site: site.site, label: site.label, seen: site.seen, hash: 'h1' },
      })
    },
    forgetSites: (_token: string, which: unknown) => {
      server.forgot.push(which)
      return Promise.resolve({ ok: true })
    },
    siteIconPicture: () => Promise.resolve(PNG),
  },
}))

const { bounded, labelOf, siteIcons, siteOf, siteSet } = await import('./site-icons.svelte')
const { readIcon, SITE_ICONS, takesTint, writtenIcon } = await import('../icons')
const account = (await import('../account.svelte')).account as unknown as AccountDouble

beforeEach(async () => {
  account.signInAs('a')
  server.held = null
  server.told.length = 0
  server.forgot.length = 0
  server.sites = []
  await siteIcons.forgetSince(0)
  server.forgot.length = 0
})

describe('a site', () => {
  test('is its host, lower case, without www, and only for a page on the web', () => {
    expect(siteOf('https://WWW.GitHub.com/lxorb/orden')).toBe('github.com')
    expect(siteOf('http://example.org:8080/')).toBe('example.org')
    expect(siteOf('file:///home/a.html')).toBeNull()
    expect(siteOf('https://localhost/')).toBeNull()
    expect(siteOf('https://127.0.0.1/')).toBeNull()
    expect(siteOf(null)).toBeNull()
  })

  test('is called by the title of its front page, and by nothing further in', () => {
    expect(labelOf('https://github.com/', ' GitHub ')).toBe('GitHub')
    expect(labelOf('https://github.com/lxorb/orden', 'lxorb/orden')).toBe('')
  })

  test('is written as a value of its own, drawn in its own colours', () => {
    const value = writtenIcon(SITE_ICONS, 'github.com')
    expect(value).toBe('site:github.com')
    expect(readIcon(value)).toEqual({ kind: 'set', set: SITE_ICONS, name: 'github.com' })
    expect(takesTint(readIcon(value))).toBe(false)
  })
})

describe('the list', () => {
  test('is told once a site and mark, and holds the picture the service has', async () => {
    await siteIcons.saw('https://github.com/', 'GitHub', PNG)
    await siteIcons.saw('https://github.com/lxorb', 'lxorb', PNG)
    expect(server.told).toHaveLength(1)
    expect(server.told[0]).toMatchObject({ site: 'github.com', label: 'GitHub', icon: PNG })
    expect(siteIcons.picture('github.com')).toBe(PNG)
  })

  test('says nothing for a device nobody is signed in on', async () => {
    account.signOut()
    await siteIcons.saw('https://example.org/', 'Example', PNG)
    expect(server.told).toHaveLength(0)
    expect(siteIcons.list).toHaveLength(0)
  })

  test('is the account list, newest first, from every device', async () => {
    server.sites = [
      { site: 'b.dev', label: '', seen: 20, hash: 'x' },
      { site: 'a.dev', label: 'A', seen: 10, hash: 'y' },
    ]
    await siteIcons.refresh()
    expect(siteIcons.list.map((one) => one.site)).toEqual(['b.dev', 'a.dev'])

    const set = siteSet()
    expect(set.entries.map((one) => [one.name, one.words])).toEqual([
      ['b.dev', 'b.dev'],
      ['a.dev', 'a'],
    ])
    expect(set.shape('a.dev')).toEqual({ kind: 'picture', src: PNG })
    expect(set.shape('nowhere.dev')).toBeNull()
  })

  test('forgets what a range saw, here and on the account', async () => {
    await siteIcons.saw('https://old.dev/', '', PNG)
    const old = siteIcons.list[0]
    expect(old).toBeDefined()
    await siteIcons.forgetSince((old?.seen ?? 0) + 1)
    expect(siteIcons.list).toHaveLength(1)
    await siteIcons.forgetSince(0)
    expect(siteIcons.list).toHaveLength(0)
    expect(server.forgot).toEqual([{ since: (old?.seen ?? 0) + 1 }, { since: 0 }])
  })

  test('keeps the newest pictures within its ceiling', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(600 * 1024)
    const list = bounded([
      { site: 'a.dev', label: '', seen: 1, hash: 'a', picture: big },
      { site: 'b.dev', label: '', seen: 2, hash: 'b', picture: big },
    ])
    expect(list.map((one) => [one.site, one.picture !== null])).toEqual([
      ['b.dev', true],
      ['a.dev', false],
    ])
  })
})

describe('the list when the account changes', () => {
  function hold(): () => void {
    let free: () => void = () => undefined
    server.held = new Promise((resolve) => (free = resolve))
    return free
  }

  test('is gone with the account that saw those sites, here and in what is kept', async () => {
    await siteIcons.saw('https://github.com/', 'GitHub', PNG)
    expect(siteIcons.list).toHaveLength(1)

    account.signInAs('b')

    expect(siteIcons.list).toEqual([])
    expect(kept.get('orden:site-icons')).toBe('[]')
  })

  test('never takes the last account’s answer into the next account’s list', async () => {
    server.sites = [{ site: 'a.dev', label: 'A', seen: 10, hash: 'y' }]
    const free = hold()
    const asking = siteIcons.refresh()

    account.signInAs('b')
    free()
    await asking

    expect(siteIcons.list).toEqual([])
  })

  test('never keeps a site the last account was telling of', async () => {
    const free = hold()
    const telling = siteIcons.saw('https://github.com/', 'GitHub', PNG)

    account.signInAs('b')
    free()
    await telling

    expect(siteIcons.list).toEqual([])
  })
})

describe('a service from before the Web icons', () => {
  test('is asked once, says nothing to anybody, and the picker leaves the section out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 60 * 60_000)
      server.refuse = Object.assign(new Error('not found'), { status: 404 })
      server.calls = 0

      await siteIcons.saw('https://one.dev/', 'One', PNG)
      await siteIcons.saw('https://one.dev/', 'One', PNG)
      await siteIcons.saw('https://two.dev/', 'Two', PNG)
      await siteIcons.refresh()
      expect(server.calls).toBe(1)
      expect(siteIcons.list).toHaveLength(0)
      expect(siteIcons.lacking).toBe(true)
      expect(siteSet().unoffered).toBe(true)

      server.refuse = null
      vi.setSystemTime(Date.now() + 11 * 60_000)
      await siteIcons.refresh()
      expect(siteIcons.lacking).toBe(false)
      expect(siteSet().unoffered).toBe(false)
    } finally {
      server.refuse = null
      vi.useRealTimers()
    }
  })

  test('and a service out of reach is waited for, but the section stays', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 2 * 60 * 60_000)
      server.refuse = new TypeError('Failed to fetch')
      server.calls = 0
      await siteIcons.saw('https://three.dev/', '', PNG)
      await siteIcons.saw('https://four.dev/', '', PNG)
      expect(server.calls).toBe(1)
      expect(siteIcons.lacking).toBe(false)
    } finally {
      server.refuse = null
      vi.useRealTimers()
    }
  })
})
