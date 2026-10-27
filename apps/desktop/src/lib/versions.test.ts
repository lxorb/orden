import { beforeEach, expect, test, vi } from 'vitest'

const held = vi.hoisted(() => ({
  snapshots: [] as { taken_at: number; size: number; path: string; source?: string }[],
  account: [] as { at: number; size: number; by: string }[],
}))

vi.mock('./tauri', () => ({
  invoke: (command: string) =>
    command === 'list_snapshots'
      ? Promise.resolve(held.snapshots)
      : Promise.reject(new Error(command)),
}))
vi.mock('./account.svelte', () => ({ account: { accountToken: 't' } }))
vi.mock('./sync.svelte', () => ({ sync: { tracked: () => ({ id: 'n1' }) } }))
vi.mock('./device', () => ({ deviceName: () => 'Linux desktop' }))
vi.mock('./api', () => ({
  api: { noteVersions: () => Promise.resolve({ versions: held.account }) },
}))

const { versionsOf } = await import('./versions')

beforeEach(() => {
  held.snapshots = []
  held.account = []
})

test("another device's version stays listed beside the copy kept here when it arrived", async () => {
  // What this device kept of its own words when Bob's arrived, and Bob's words, pushed
  // fifteen seconds before.
  held.snapshots = [{ taken_at: 1_000_020_000, size: 5, path: '/h/1.md' }]
  held.account = [{ at: 1_000_005_000, size: 40, by: "Bob's laptop" }]

  const listed = await versionsOf('/s/Team/Plan.md')

  expect(listed.map((one) => one.by)).toEqual(['', "Bob's laptop"])
})

test("this device's own push is the copy it kept, listed once", async () => {
  held.snapshots = [{ taken_at: 1_000_000_000, size: 40, path: '/h/1.md' }]
  held.account = [{ at: 1_000_004_000, size: 40, by: 'Linux desktop' }]

  const listed = await versionsOf('/s/Team/Plan.md')

  expect(listed).toEqual([{ at: 1_000_000_000, size: 40, path: '/h/1.md', by: '' }])
})

test("this device's own push long after anything kept here is listed", async () => {
  held.snapshots = [{ taken_at: 1_000_000_000, size: 40, path: '/h/1.md' }]
  held.account = [{ at: 1_000_000_000 + 5 * 60_000, size: 41, by: 'Linux desktop' }]

  const listed = await versionsOf('/s/Team/Plan.md')

  expect(listed.map((one) => one.path)).toEqual([null, '/h/1.md'])
})
