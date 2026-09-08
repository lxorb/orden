import { beforeEach, describe, expect, test, vi } from 'vitest'

/** What the app knows about who may do what in a space, and the sheet that
 *  changes it. The account, the mirrors and the network are stood in for; what
 *  is under test is the reading of a role and what each control on the sheet
 *  actually asks for. */

interface Held {
  /** An address, for somebody invited by one; null for a guest. */
  email: string | null
  /** A guest id, for somebody a link let in; null for a member by address. */
  guest: string | null
  name: string | null
  role: string
}

/** Somebody in a space, as the sheet hands them back to the store. */
const member = (email: string, role = 'write') => ({ email, guest: null, name: null, role })
const guest = (id: string, name: string, role = 'write') => ({ email: null, guest: id, name, role })

interface World {
  /** Which remote space each folder mirrors, if any. */
  mirrors: Record<string, string>
  /** What every share call answers with. */
  sharing: {
    owner: { email: string; name: string | null }
    members: (Held & { pending: boolean })[]
    requests: (Held & { at: number })[]
    link: { url: string; role: string; mode: string } | null
  }
  /** Set to make the next call fail. */
  refuse: string | null
  /** Every share call that was made, in order. */
  asked: string[]
  copied: string
}

const world = vi.hoisted((): World => ({
  mirrors: {},
  sharing: {
    owner: { email: 'owner@example.com', name: 'Emil' },
    members: [],
    requests: [],
    link: null,
  },
  refuse: null,
  asked: [],
  copied: '',
}))

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>()

  const answer = (what: string) => {
    world.asked.push(what)
    if (world.refuse) return Promise.reject(new original.ApiError(403, world.refuse))

    return Promise.resolve(world.sharing)
  }

  return {
    ...original,
    api: {
      sharing: (_token: string, id: string) => answer(`read ${id}`),
      invite: (_token: string, id: string, email: string, role: string) =>
        answer(`invite ${email} as ${role} to ${id}`),
      setMemberRole: (_token: string, id: string, email: string, role: string) =>
        answer(`${email} is now ${role} in ${id}`),
      removeMember: (_token: string, _id: string, email: string) => answer(`remove ${email}`),
      setGuestRole: (_token: string, id: string, id2: string, role: string) =>
        answer(`guest ${id2} is now ${role} in ${id}`),
      removeGuest: (_token: string, _id: string, id2: string) => answer(`remove guest ${id2}`),
      acceptGuest: (_token: string, _id: string, id2: string) => answer(`accept guest ${id2}`),
      setShareLink: (_token: string, _id: string, role: string, mode: string) =>
        answer(`link ${role} ${mode}`),
      revokeShareLink: () => answer('revoke'),
      acceptRequest: (_token: string, _id: string, email: string) => answer(`accept ${email}`),
      declineRequest: (_token: string, _id: string, email: string) => answer(`decline ${email}`),
      listSpaces: () => Promise.resolve({ spaces: account.spaces, deleted: [] }),
    },
  }
})

vi.mock('./sync.svelte', () => ({
  sync: { remoteIdFor: (root: string) => world.mirrors[root] ?? null },
}))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    get spaces() {
      return Object.keys(world.mirrors).map((root) => ({ id: root, name: root, root }))
    },
  },
}))

vi.mock('./clipboard', () => ({
  copyText: (text: string) => {
    world.copied = text
    return Promise.resolve()
  },
}))

vi.mock('./i18n.svelte', () => ({
  message: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}))

// Imported once, at module scope: a hook that re-imported the store graph would
// charge whichever test ran first for compiling it.
import { account } from './account.svelte'
import { canShare, canWriteAt, isShared, roleOf, share } from './sharing.svelte'
import type { RemoteSpace } from './api'

/** A space on the account, with only the fields any of this reads. */
function remote(id: string, role: 'owner' | 'write' | 'read', shared = false): RemoteSpace {
  return { id, name: id, role, shared } as RemoteSpace
}

const local = (name: string) => ({ id: name, name, root: name })

beforeEach(() => {
  world.mirrors = {}
  world.sharing = {
    owner: { email: 'owner@example.com', name: 'Emil' },
    members: [],
    requests: [],
    link: null,
  }
  world.refuse = null
  world.asked = []
  world.copied = ''

  account.token = 'session'
  account.user = { id: 'u1', email: 'owner@example.com', name: 'Emil' }
  account.spaces = []

  share.close()
  share.who = null
  share.error = null
  share.email = ''
  share.role = 'write'
})

describe('what may be done in a space', () => {
  test('is the account holder’s own until the account says otherwise', () => {
    // A folder no pass has paired with anything is this machine's. So is every
    // folder on a machine that is signed out.
    expect(roleOf('Notes')).toBe('owner')
    expect(isShared('Notes')).toBe(false)
    expect(canWriteAt('Notes/plan.md')).toBe(true)
  })

  test('is whatever the account says for a space somebody shared', () => {
    world.mirrors = { Notes: 'space-1' }
    account.spaces = [remote('space-1', 'read', true)]

    expect(roleOf('Notes')).toBe('read')
    expect(isShared('Notes')).toBe(true)
    expect(canWriteAt('Notes/plan.md')).toBe(false)
  })

  test('is decided per space, so a reader’s own notes are still theirs', () => {
    world.mirrors = { Theirs: 'space-1', Mine: 'space-2' }
    account.spaces = [remote('space-1', 'read', true), remote('space-2', 'owner')]

    expect(canWriteAt('Theirs/plan.md')).toBe(false)
    expect(canWriteAt('Mine/plan.md')).toBe(true)
  })

  test('lets a writer write, and still marks the space as shared', () => {
    world.mirrors = { Notes: 'space-1' }
    account.spaces = [remote('space-1', 'write', true)]

    expect(canWriteAt('Notes/plan.md')).toBe(true)
    expect(isShared('Notes')).toBe(true)
  })

  test('leaves a note in no space alone, which is every note outside one', () => {
    world.mirrors = { Notes: 'space-1' }
    account.spaces = [remote('space-1', 'read', true)]

    expect(canWriteAt('/elsewhere/loose.md')).toBe(true)
  })
})

describe('who may open the Share sheet', () => {
  test('nobody, while signed out', () => {
    account.token = null
    account.user = null
    world.mirrors = { Notes: 'space-1' }
    account.spaces = [remote('space-1', 'owner')]

    expect(canShare(local('Notes'))).toBe(false)
  })

  test('nobody, for a folder the account has never seen', () => {
    expect(canShare(local('Notes'))).toBe(false)
  })

  test('nobody, for a space somebody shared with them', () => {
    world.mirrors = { Notes: 'space-1' }
    account.spaces = [remote('space-1', 'write', true)]

    expect(canShare(local('Notes'))).toBe(false)
  })

  test('the owner', () => {
    world.mirrors = { Notes: 'space-1' }
    account.spaces = [remote('space-1', 'owner')]

    expect(canShare(local('Notes'))).toBe(true)
  })
})

describe('the Share sheet', () => {
  beforeEach(async () => {
    world.mirrors = { Notes: 'space-1' }
    account.spaces = [remote('space-1', 'owner')]
    await share.show(local('Notes'))
    world.asked = []
  })

  test('opens on who is already in the space', () => {
    expect(share.open).toBe(true)
    expect(share.who?.owner.name).toBe('Emil')
  })

  test('does not open on a folder the account has never seen', async () => {
    share.close()
    world.mirrors = {}

    await share.show(local('Elsewhere'))
    expect(share.open).toBe(false)
  })

  test('invites the address that was typed, at the role beside it', async () => {
    share.email = '  Ada@example.com '
    share.role = 'read'
    await share.invite()

    expect(world.asked).toEqual(['invite Ada@example.com as read to space-1'])
    // The field is empty again, ready for the next one.
    expect(share.email).toBe('')
  })

  test('asks nothing when the address is empty', async () => {
    share.email = '   '
    await share.invite()

    expect(world.asked).toEqual([])
  })

  test('keeps the address when the invitation was refused', async () => {
    world.refuse = 'enter a valid email address'
    share.email = 'nonsense'
    await share.invite()

    expect(share.error).toBe('enter a valid email address')
    expect(share.email).toBe('nonsense')
  })

  test('changes one person’s role and takes another out', async () => {
    await share.setRole(member('ada@example.com'), 'read')
    await share.remove(member('bob@example.com'))

    expect(world.asked).toEqual([
      'ada@example.com is now read in space-1',
      'remove bob@example.com',
    ])
  })

  test('reaches the guest route for somebody a link let in', async () => {
    await share.setRole(guest('g1', 'Windows wren'), 'read')
    await share.remove(guest('g2', 'iPhone lark'))

    expect(world.asked).toEqual(['guest g1 is now read in space-1', 'remove guest g2'])
  })

  test('lets a waiting guest in, and turns another away', async () => {
    await share.accept(guest('g1', 'Windows wren'))
    await share.decline(guest('g2', 'iPhone lark'))

    expect(world.asked).toEqual(['accept guest g1', 'remove guest g2'])
  })

  test('makes a link, changes what it hands out, and revokes it', async () => {
    await share.setLink('read', 'approval')
    await share.setLink('write', 'open')
    await share.revoke()

    expect(world.asked).toEqual(['link read approval', 'link write open', 'revoke'])
  })

  test('accepts and declines the people waiting', async () => {
    await share.accept(member('ada@example.com'))
    await share.decline(member('bob@example.com'))

    expect(world.asked).toEqual(['accept ada@example.com', 'decline bob@example.com'])
  })

  test('draws whatever came back rather than what it asked for', async () => {
    world.sharing.members = [{ ...member('ada@example.com'), pending: true }]
    await share.setRole(member('ada@example.com'), 'read')

    expect(share.who?.members).toEqual([{ ...member('ada@example.com'), pending: true }])
  })

  test('says what went wrong and keeps showing what it had', async () => {
    world.sharing.members = [{ ...member('ada@example.com', 'read'), pending: false }]
    await share.setRole(member('ada@example.com'), 'read')

    world.refuse = 'only the owner can do that'
    await share.remove(member('ada@example.com'))

    expect(share.error).toBe('only the owner can do that')
    expect(share.who?.members).toHaveLength(1)
  })

  test('copies the link, and says so for a moment', async () => {
    vi.useFakeTimers()
    try {
      world.sharing.link = { url: 'https://nibeditor.com/join/abc', role: 'read', mode: 'open' }
      await share.setLink('read', 'open')

      await share.copy()
      expect(world.copied).toBe('https://nibeditor.com/join/abc')
      expect(share.copied).toBe(true)

      vi.advanceTimersByTime(2000)
      expect(share.copied).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  test('has nothing to copy without a link', async () => {
    await share.copy()
    expect(world.copied).toBe('')
  })
})
