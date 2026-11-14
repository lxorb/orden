import { beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted((): { mirrors: Record<string, string> } => ({ mirrors: {} }))

vi.mock('./sync.svelte', () => ({
  sync: {
    remoteIdFor: (root: string) => world.mirrors[root] ?? null,
    roleKept: () => null,
  },
}))

vi.mock('./workspace.svelte', () => {
  const spaces = [
    { id: 'theirs', name: 'Theirs', root: '/spaces/Theirs' },
    { id: 'mine', name: 'Mine', root: '/spaces/Mine' },
  ]
  return {
    workspace: {
      spaces,
      shownSpaces: spaces,
      archivedSpaces: new Set<string>(),
      activeSpaceId: 'mine',
      tabs: [],
      fileOps: { follow: () => undefined },
    },
  }
})

vi.mock('./sharing/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sharing/src/api')>()),
  protectEntries: () => [],
}))

const { account } = await import('./accounts/src/account.svelte')
const { spaceMenu } = await import('./space-actions')
const { workspace } = await import('./workspace.svelte')

const ICON = 'Choose an icon'

function labels(id: string): string[] {
  const space = workspace.spaces.find((one) => one.id === id)
  if (!space) throw new Error(id)
  return spaceMenu(space).flatMap((one) => (one && 'label' in one ? [one.label] : []))
}

beforeEach(() => {
  world.mirrors = { '/spaces/Theirs': 'remote-theirs', '/spaces/Mine': 'remote-mine' }
  account.listed = true
})

describe('choosing a space’s icon', () => {
  test('is not offered to somebody the space was shared with to read', () => {
    account.spaces = [
      { id: 'remote-theirs', name: 'Theirs', role: 'read', shared: true, sharedItems: [] },
      { id: 'remote-mine', name: 'Mine', role: 'owner', shared: false, sharedItems: [] },
    ] as unknown as typeof account.spaces

    expect(labels('theirs')).not.toContain(ICON)
    expect(labels('mine')).toContain(ICON)
  })

  test('is offered to somebody who may write there', () => {
    account.spaces = [
      { id: 'remote-theirs', name: 'Theirs', role: 'write', shared: true, sharedItems: [] },
    ] as unknown as typeof account.spaces

    expect(labels('theirs')).toContain(ICON)
  })

  test('is offered for a space that is on this computer only', () => {
    world.mirrors = {}
    account.listed = false
    account.spaces = []

    expect(labels('theirs')).toContain(ICON)
  })
})
