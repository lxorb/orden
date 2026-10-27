import { afterEach, expect, test, vi } from 'vitest'

/** Putting a space on the web: which space the sheet is about, what it asks the
 *  server for, and what it does with the answer. The account and the network are
 *  stood in for; the store is the real one. */

interface World {
  /** Which remote space each folder mirrors, if any. */
  mirrors: Record<string, string>
  /** Every call that was made, in order. */
  asked: string[]
  /** Set to make the next call fail. */
  refuse: string | null
  /** What a name check comes back with. */
  available: { available: boolean; reason?: string }
  /** What the domain routes answer with. */
  domain: { state: string; dns: never[]; detail: string | null }
  /** The answers the forms on the site have collected. */
  answers: { id: string; note: string; path: string; at: number; answers: Record<string, string> }[]
  /** Whether the site's forms have stopped taking answers. */
  full: boolean
  /** The installed theme's file, as reading it from disk answers. */
  sheet: string
  /** What was sent up as a blob, by its hash. */
  blobs: Record<string, string>
}

const world = vi.hoisted((): World => ({
  mirrors: {},
  asked: [],
  refuse: null,
  available: { available: true },
  domain: { state: 'pending', dns: [], detail: null },
  answers: [],
  full: false,
  sheet: '',
  blobs: {},
}))

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>()

  const answer = <T>(what: string, value: T): Promise<T> => {
    world.asked.push(what)
    if (world.refuse) return Promise.reject(new original.ApiError(403, world.refuse))
    return Promise.resolve(value)
  }

  return {
    ...original,
    api: {
      subdomainAvailable: (_token: string, name: string, space?: string) =>
        answer(`available ${name} for ${space ?? 'nobody'}`, world.available),
      publish: (_token: string, id: string, settings: Record<string, unknown>) =>
        answer(`publish ${id} ${JSON.stringify(settings)}`, {
          space: {},
          dns: [{ type: 'CNAME', name: 'notes', value: 'cname.orden.so' }],
        }),
      site: (_token: string, id: string, settings: Record<string, unknown>) =>
        answer(`site ${id} ${JSON.stringify(settings)}`, { space: {}, site: {} }),
      sitePreview: (_token: string, id: string) =>
        answer(`preview ${id}`, {
          pages: 0,
          before: 0,
          adds: [],
          removes: [],
          more: false,
          dressing: {},
        }),
      domainStatus: (_token: string, id: string) => answer(`status ${id}`, world.domain),
      answers: (_token: string, id: string) =>
        answer(`answers ${id}`, { answers: [], more: false, keptDays: 180, full: false }),
    },
  }
})
vi.mock('./sync.svelte', () => ({
  sync: { remoteIdFor: (root: string) => world.mirrors[root] ?? null },
}))
vi.mock('./workspace.svelte', () => ({
  workspace: {
    activeSpaceId: 'Notes',
    notes: [],
    iconFor: () => null,
    tintFor: () => null,
    get spaces() {
      return Object.keys(world.mirrors).map((root) => ({ id: root, name: root, root }))
    },
    fileOps: { follow: () => () => undefined },
  },
}))

import { flushSync, mount, unmount } from 'svelte'
import { account } from './account.svelte'
import { publish } from './publishing.svelte'
import PublishSheet from './PublishSheet.svelte'
import type { RemoteSpace } from './api'

const nothing = () => undefined
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = nothing
    unobserve = nothing
    disconnect = nothing
  },
)
Element.prototype.animate = () =>
  ({
    cancel: nothing,
    pause: nothing,
    play: nothing,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

function remote(): RemoteSpace {
  return {
    id: 'space-1',
    name: 'Notes',
    role: 'owner',
    blog: { enabled: false, subdomain: null, domain: null, title: null, note: null, dns: [] },
  } as unknown as RemoteSpace
}

function open() {
  world.mirrors = { Notes: 'space-1' }
  account.token = 'session'
  account.user = { id: 'u1', email: 'o@example.com', name: 'E' }
  account.spaces = [remote()]
  const host = document.createElement('div')
  document.body.append(host)
  const shown = mount(PublishSheet, { target: host })
  publish.show({ id: 'Notes', name: 'Notes', root: 'Notes' })
  flushSync()
  publish.confirmed = true
  publish.subdomain = 'my-notes'
  publish.description = 'About me'
  publish.otherwise('none')
  flushSync()
  return shown
}

const typed = () => ({
  confirmed: publish.confirmed,
  subdomain: publish.subdomain,
  description: publish.description,
  otherwise: publish.rules.otherwise,
})

afterEach(() => {
  publish.close()
  flushSync()
})

test('a space listing while the sheet is open keeps what was typed', () => {
  const shown = open()
  // The five-minute reconcile, or any other `loadSpaces`: the same space, listed again.
  account.spaces = [remote()]
  flushSync()
  const kept = typed()
  void unmount(shown)
  expect(kept).toEqual({
    confirmed: true,
    subdomain: 'my-notes',
    description: 'About me',
    otherwise: 'none',
  })
})

test('a blog that changed under the open sheet is what the form shows', () => {
  const shown = open()
  const now = remote()
  now.blog = {
    ...now.blog,
    enabled: true,
    subdomain: 'theirs',
    site: { rules: { include: [], exclude: [], otherwise: 'all' }, description: 'Theirs' },
  } as never
  account.spaces = [now]
  flushSync()
  const shownNow = typed()
  void unmount(shown)
  expect(shownNow).toEqual({
    confirmed: true,
    subdomain: 'theirs',
    description: 'Theirs',
    otherwise: 'all',
  })
})

test('the sheet opened again on the same space starts from what the account holds', () => {
  const shown = open()
  publish.close()
  flushSync()
  publish.show({ id: 'Notes', name: 'Notes', root: 'Notes' })
  flushSync()
  const again = typed()
  void unmount(shown)
  expect(again).toEqual({ confirmed: false, subdomain: '', description: '', otherwise: 'all' })
})
