import { beforeEach, expect, test, vi } from 'vitest'

import { sha256 } from './bytes'

const held = vi.hoisted(() => ({
  snapshots: [] as { taken_at: number; size: number; path: string; source?: string }[],
  words: new Map<string, string>(),
  account: [] as { at: number; size: number; by: string; hash?: string }[],
}))

vi.mock('./tauri', () => ({
  invoke: (command: string, args: { path: string }) => {
    if (command === 'list_snapshots') return Promise.resolve(held.snapshots)
    if (command === 'read_snapshot' && held.words.has(args.path))
      return Promise.resolve(held.words.get(args.path))
    return Promise.reject(new Error(command))
  },
}))
vi.mock('./account.svelte', () => ({ account: { accountToken: 't' } }))
vi.mock('./sync.svelte', () => ({ sync: { tracked: () => ({ id: 'n1' }) } }))
vi.mock('./api', () => ({
  api: { noteVersions: () => Promise.resolve({ versions: held.account }) },
}))

const { versionsOf } = await import('./versions')

beforeEach(() => {
  held.snapshots = []
  held.words = new Map()
  held.account = []
})

test("another Mac's version stays listed beside the copy kept here when it arrived", async () => {
  // Both machines are "Mac desktop". What this one kept of its own words when Bob's
  // arrived, and Bob's words, pushed fifteen seconds before.
  held.snapshots = [{ taken_at: 1_000_020_000, size: 9, path: '/h/1.md' }]
  held.words = new Map([['/h/1.md', 'the owner']])
  held.account = [
    { at: 1_000_005_000, size: 9, by: 'Mac desktop', hash: await sha256('Bob words') },
  ]

  const listed = await versionsOf('/s/Team/Plan.md')

  expect(listed.map((one) => [one.path, one.by])).toEqual([
    ['/h/1.md', ''],
    [null, 'Mac desktop'],
  ])
})

test('a push of the words kept here is that copy, listed once, whoever named it', async () => {
  // A room settled for this device's own typing names it "Mac", not "Mac desktop".
  held.snapshots = [{ taken_at: 1_000_000_000, size: 9, path: '/h/1.md' }]
  held.words = new Map([['/h/1.md', 'the owner']])
  held.account = [{ at: 1_000_004_000, size: 9, by: 'Mac', hash: await sha256('the owner') }]

  const listed = await versionsOf('/s/Team/Plan.md')

  expect(listed).toEqual([{ at: 1_000_000_000, size: 9, path: '/h/1.md', by: '' }])
})

test('a CRLF push of words kept here with LF is that copy', async () => {
  held.snapshots = [{ taken_at: 1_000_000_000, size: 8, path: '/h/1.md' }]
  held.words = new Map([['/h/1.md', 'one\ntwo\n']])
  held.account = [
    { at: 1_000_010_000, size: 10, by: 'Windows desktop', hash: await sha256('one\r\ntwo\r\n') },
  ]

  const listed = await versionsOf('/s/Team/Plan.md')

  expect(listed.map((one) => one.path)).toEqual(['/h/1.md'])
})

test('the same words long after anything kept here are listed', async () => {
  held.snapshots = [{ taken_at: 1_000_000_000, size: 9, path: '/h/1.md' }]
  held.words = new Map([['/h/1.md', 'the owner']])
  held.account = [
    { at: 1_000_000_000 + 5 * 60_000, size: 9, by: 'Mac desktop', hash: await sha256('the owner') },
  ]

  const listed = await versionsOf('/s/Team/Plan.md')

  expect(listed.map((one) => one.path)).toEqual([null, '/h/1.md'])
})

test('a version from a server that names no hash is listed beside the copy', async () => {
  held.snapshots = [{ taken_at: 1_000_000_000, size: 9, path: '/h/1.md' }]
  held.words = new Map([['/h/1.md', 'the owner']])
  held.account = [{ at: 1_000_004_000, size: 9, by: 'Mac desktop' }]

  const listed = await versionsOf('/s/Team/Plan.md')

  expect(listed.map((one) => one.path)).toEqual([null, '/h/1.md'])
})

test('a copy that cannot be read folds nothing', async () => {
  held.snapshots = [{ taken_at: 1_000_000_000, size: 9, path: '/h/gone.md' }]
  held.account = [
    { at: 1_000_004_000, size: 9, by: 'Mac desktop', hash: await sha256('the owner') },
  ]

  const listed = await versionsOf('/s/Team/Plan.md')

  expect(listed.map((one) => one.path)).toEqual([null, '/h/gone.md'])
})
