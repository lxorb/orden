import { beforeEach, describe, expect, test, vi } from 'vitest'

interface Held {
  email: string | null
  guest: string | null
  name: string | null
  role: string
}

const member = (email: string, role = 'write') => ({
  email,
  guest: null,
  name: null,
  role,
  pending: false,
})
const guest = (id: string, name: string, role = 'write') => ({ email: null, guest: id, name, role })

interface Who {
  owner: { email: string; name: string | null }
  members: (Held & { pending: boolean })[]
  requests: (Held & { at: number })[]
  link: { url: string; role: string; mode: string } | null
}

interface World {
  mirrors: Record<string, string>
  locals: string[]
  kept: Record<string, string>
  sharing: Who
  sharingOf: Record<string, Who>
  holding: boolean
  held: (() => void)[]
  refuse: string | null
  refuseStatus: number
  asked: string[]
  tabs: { path: string | null; note: { key: string } }[]
  notes: Record<string, string>
  shared: SharedItem[]
  words: Record<string, string>
  followers: ((op: FileOp) => unknown)[]
  opened: { id: string; name: string; path: string; text: string }[]
  closed: string[]
  showing: string[]
}

const world = vi.hoisted((): World => ({
  mirrors: {},
  locals: [],
  kept: {},
  sharing: {
    owner: { email: 'owner@example.com', name: 'Emil' },
    members: [],
    requests: [],
    link: null,
  },
  sharingOf: {},
  holding: false,
  held: [],
  refuse: null,
  refuseStatus: 403,
  asked: [],
  tabs: [],
  notes: {},
  shared: [],
  words: {},
  followers: [],
  opened: [],
  closed: [],
  showing: [],
}))

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>()

  const answer = (what: string, who = world.sharing) => {
    world.asked.push(what)

    const refuse = world.refuse
    const status = world.refuseStatus
    const settle = () =>
      refuse ? Promise.reject(new original.ApiError(status, refuse)) : Promise.resolve(who)

    if (!world.holding) return settle()

    return new Promise<Who>((go, stop) => {
      world.held.push(() => void settle().then(go, stop))
    })
  }

  const about = (item: string) => (item ? ` about ${item}` : '')

  return {
    ...original,
    api: {
      sharing: (_token: string, id: string, item = '') =>
        answer(`read ${id}${about(item)}`, world.sharingOf[item] ?? world.sharing),
      invite: (_token: string, id: string, email: string, role: string, item = '') =>
        answer(`invite ${email} as ${role} to ${id}${about(item)}`),
      setMemberRole: (_token: string, id: string, email: string, role: string, item = '') =>
        answer(`${email} is now ${role} in ${id}${about(item)}`),
      removeMember: (_token: string, _id: string, email: string, item = '') =>
        answer(`remove ${email}${about(item)}`),
      setGuestRole: (_token: string, id: string, id2: string, role: string, item = '') =>
        answer(`guest ${id2} is now ${role} in ${id}${about(item)}`),
      removeGuest: (_token: string, _id: string, id2: string, item = '') =>
        answer(`remove guest ${id2}${about(item)}`),
      acceptGuest: (_token: string, _id: string, id2: string, item = '') =>
        answer(`accept guest ${id2}${about(item)}`),
      setShareLink: (_token: string, _id: string, role: string, mode: string, item = '') =>
        answer(`link ${role} ${mode}${about(item)}`),
      revokeShareLink: (_token: string, _id: string, item = '') => answer(`revoke${about(item)}`),
      acceptRequest: (_token: string, _id: string, email: string, item = '') =>
        answer(`accept ${email}${about(item)}`),
      declineRequest: (_token: string, _id: string, email: string, item = '') =>
        answer(`decline ${email}${about(item)}`),
      listSpaces: () => Promise.resolve({ spaces: account.spaces, deleted: [] }),
      trustSpace: (_token: string, id: string) => {
        world.asked.push(`trust ${id}`)
        for (const one of account.spaces) {
          if (one.id === id) Object.assign(one, { onceShared: false, onceSharedItems: [] })
        }
        return Promise.resolve({ ok: true as const })
      },
      signOut: () => Promise.resolve({ ok: true as const }),

      shared: () => {
        if (world.refuse) {
          return Promise.reject(new original.ApiError(world.refuseStatus, world.refuse))
        }

        const listing = { shared: world.shared }
        if (!world.holding) return Promise.resolve(listing)

        return new Promise<typeof listing>((go) => world.held.push(() => go(listing)))
      },
      readNote: (_token: string, id: string) => {
        world.asked.push(`words of ${id}`)
        const content = world.words[id]
        if (content === undefined) {
          return Promise.reject(new original.ApiError(404, 'no such note'))
        }

        return Promise.resolve({ note: { id }, content })
      },
      leaveShared: (_token: string, id: string) => {
        world.asked.push(`leave ${id}`)
        return Promise.resolve({ ok: true as const })
      },
    },
  }
})

vi.mock('./sync.svelte', () => ({
  sync: {
    remoteIdFor: (root: string) => world.mirrors[root] ?? null,
    roleKept: (root: string) => world.kept[root] ?? null,
    tracked: (path: string) => {
      const id = world.notes[path]
      return id ? { id, hash: 'h' } : null
    },
  },
}))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    get spaces() {
      return [...Object.keys(world.mirrors), ...world.locals].map((root) => ({
        id: root,
        name: root,
        root,
      }))
    },
    get tabs() {
      return world.tabs
    },
    openShared: (item: { id: string; name: string; path: string }, text: string) =>
      world.opened.push({ id: item.id, name: item.name, path: item.path, text }),
    closeShared: (id: string) => world.closed.push(id),
    showingShared: (id: string) => world.showing.includes(id),
    adoptSpace: (name: string) => Promise.resolve(name),
    applyIcon: () => null,
    applySpaceOrder: () => false,
    bookmarks: { adopt: () => null },
    fileOps: {
      follow: (follower: (op: FileOp) => unknown) => world.followers.push(follower),
    },
  },
}))

vi.mock('./i18n.svelte', () => ({
  message: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}))

import { account } from './account.svelte'
import { rooms } from './rooms.svelte'
import { accentFor } from './accents'
import {
  addressesIn,
  canShare,
  canShareItem,
  canTrustAgain,
  canWriteAt,
  isShared,
  isSharedItem,
  looksLikeAddress,
  originOfDocument,
  othersIn,
  reachedByOthers,
  reachedAs,
  reachedByOthersIn,
  roleOf,
  share,
  sharedWithYou,
  trustsHtmlAt,
  trustsHtmlIn,
  trustAgain,
} from './sharing.svelte'
import { pairSpaces, type Pairing } from './space-pairing'
import type { RemoteSpace, SharedItem } from './api'
import type { NoteDoc } from './workspace/documents.svelte'
import type { FileOp } from './workspace/file-ops'
import { memoryStorage } from '../../test/disk'

const storage = memoryStorage()
vi.stubGlobal('localStorage', storage)

function remote(
  id: string,
  role: 'owner' | 'write' | 'read',
  shared = false,
  sharedItems: string[] = [],
): RemoteSpace {
  return { id, name: id, role, shared, sharedItems } as RemoteSpace
}

function sharedFile(id: string, path: string, owner: string, role = 'write'): SharedItem {
  return {
    id,
    path,
    name: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
    role: role as 'write' | 'read',
    updatedAt: 1,
    owner: { name: owner },
    space: { id: 'theirs', name: 'Theirs' },
  }
}

const local = (name: string) => ({ id: name, name, root: name })

async function land(...order: number[]) {
  const held = world.held
  const when = order.length ? order : held.map((_one, at) => at)
  world.held = held.filter((_one, at) => !when.includes(at))

  for (const at of when) {
    held[at]?.()
    for (let turn = 0; turn < 6; turn++) await Promise.resolve()
  }
}

beforeEach(() => {
  world.mirrors = {}
  world.locals = []
  world.kept = {}
  world.sharing = {
    owner: { email: 'owner@example.com', name: 'Emil' },
    members: [],
    requests: [],
    link: null,
  }
  world.sharingOf = {}
  world.holding = false
  world.held = []
  world.refuse = null
  world.refuseStatus = 403
  world.asked = []
  world.tabs = []
  world.notes = {}
  world.shared = []
  world.words = {}
  world.opened = []
  world.closed = []
  world.showing = []
  rooms.present = {}
  sharedWithYou.stop()
  sharedWithYou.items = []

  account.token = 'session'
  account.user = { id: 'u1', email: 'owner@example.com', name: 'Emil' }
  account.spaces = []
  account.listed = false
  storage.clear()

  share.close()
  share.who = null
  share.error = null
  share.email = ''
  share.wrongAddress = false
  share.role = 'write'
})

describe('the addresses in the field', () => {
  test('are separated by a comma, a semicolon or a space, in any mixture', () => {
    expect(addressesIn('ada@example.com, bob@example.com')).toEqual([
      'ada@example.com',
      'bob@example.com',
    ])
    expect(addressesIn('ada@example.com; bob@example.com grace@example.com')).toEqual([
      'ada@example.com',
      'bob@example.com',
      'grace@example.com',
    ])
    expect(addressesIn('   ')).toEqual([])
  })

  test('and each of them is looked at before anybody waits on the server', () => {
    expect(looksLikeAddress('ada@example.com')).toBe(true)
    expect(looksLikeAddress('ada@mail.example.co.uk')).toBe(true)
    expect(looksLikeAddress('nonsense')).toBe(false)
    expect(looksLikeAddress('ada@example')).toBe(false)
    expect(looksLikeAddress('ada @example.com')).toBe(false)
    expect(looksLikeAddress('@example.com')).toBe(false)
  })
})

describe('the colour somebody wears in the list', () => {
  test('is the same colour for the same person, every time', () => {
    expect(accentFor('ada@example.com', 'dark')).toBe(accentFor('ada@example.com', 'dark'))
    expect(accentFor('Ada@Example.com ', 'dark')).toBe(accentFor('ada@example.com', 'dark'))
  })

  test('and a different one for somebody else', () => {
    expect(accentFor('ada@example.com', 'dark')).not.toBe(accentFor('bob@example.com', 'dark'))
  })

  test('and the shade the scheme in front of the reader needs', () => {
    expect(accentFor('ada@example.com', 'dark')).not.toBe(accentFor('ada@example.com', 'light'))
  })

  test('and something, for somebody with nothing to name them yet', () => {
    expect(accentFor('', 'dark')).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('what may be done in a space', () => {
  test('is the account holder’s own until the account says otherwise', () => {
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

  test('answers for the space’s own folder as for a note inside it', () => {
    world.mirrors = { Notes: 'space-1' }
    account.spaces = [remote('space-1', 'read', true)]

    expect(canWriteAt('Notes')).toBe(false)
  })

  test('leaves a note in no space alone, which is every note outside one', () => {
    world.mirrors = { Notes: 'space-1' }
    account.spaces = [remote('space-1', 'read', true)]

    expect(canWriteAt('/elsewhere/loose.md')).toBe(true)
  })
})

describe('what may be done before the account has listed its spaces', () => {
  test('is what the sync store kept for a space shared to read', () => {
    world.mirrors = { Theirs: 'space-1' }
    world.kept = { Theirs: 'read' }

    expect(roleOf('Theirs')).toBe('read')
    expect(canWriteAt('Theirs/plan.md')).toBe(false)
  })

  test('and the same for a space shared to write, and for one of the reader’s own', () => {
    world.mirrors = { Theirs: 'space-1', Mine: 'space-2' }
    world.kept = { Theirs: 'write', Mine: 'owner' }

    expect(canWriteAt('Theirs/plan.md')).toBe(true)
    expect(roleOf('Mine')).toBe('owner')
    expect(canWriteAt('Mine/plan.md')).toBe(true)
  })

  test('is nothing for a paired space whose role nobody kept', () => {
    world.mirrors = { Notes: 'space-1' }

    expect(roleOf('Notes')).toBe(null)
    expect(canWriteAt('Notes/plan.md')).toBe(false)
    expect(canWriteAt('Notes')).toBe(false)
  })

  test('leaves a folder that mirrors nothing the reader’s own', () => {
    world.locals = ['Local']

    expect(roleOf('Local')).toBe('owner')
    expect(canWriteAt('Local/plan.md')).toBe(true)
  })

  test('changes once the listing comes back', async () => {
    world.mirrors = { Theirs: 'space-1', Mine: 'space-2' }
    expect(canWriteAt('Theirs/plan.md')).toBe(false)
    expect(canWriteAt('Mine/plan.md')).toBe(false)

    account.spaces = [remote('space-1', 'read', true), remote('space-2', 'owner')]
    await account.loadSpaces()

    expect(canWriteAt('Theirs/plan.md')).toBe(false)
    expect(canWriteAt('Mine/plan.md')).toBe(true)
  })

  test('is what the last listing said, on a launch that cannot ask the account', async () => {
    world.mirrors = { Theirs: 'space-1', Mine: 'space-2' }
    account.spaces = [remote('space-1', 'read', true), remote('space-2', 'owner')]
    await account.loadSpaces()

    account.spaces = []
    account.listed = false
    world.mirrors = {}
    world.locals = ['Theirs', 'Mine']

    expect(roleOf('Theirs')).toBe('read')
    expect(canWriteAt('Theirs/plan.md')).toBe(false)
    expect(canWriteAt('Mine/plan.md')).toBe(true)
  })

  test('counts the reader’s own shared space as shared, from what the last listing kept', async () => {
    world.mirrors = { Team: 'space-1', Solo: 'space-2', Items: 'space-3' }
    world.notes = { 'Items/plan.md': 'n1', 'Items/other.md': 'n2' }
    account.spaces = [
      remote('space-1', 'owner', true),
      remote('space-2', 'owner'),
      remote('space-3', 'owner', false, ['n1']),
    ]
    await account.loadSpaces()

    account.spaces = []
    account.listed = false
    account.user = null
    world.mirrors = {}
    world.locals = ['Team', 'Solo', 'Items']

    expect(roleOf('Team')).toBe('owner')
    expect(reachedByOthers('Team/weekly.md')).toBe(true)
    expect(trustsHtmlAt('Team/weekly.md')).toBe(false)
    expect(reachedByOthers('Solo/plan.md')).toBe(false)
    expect(reachedByOthers('Items/plan.md')).toBe(true)
    expect(reachedByOthers('Items/other.md')).toBe(false)
    expect(reachedByOthers('Items/new.md')).toBe(true)
  })

  test('answers for a whole space as its notes would, before and after the listing', async () => {
    world.mirrors = { Team: 'space-1', Solo: 'space-2', Items: 'space-3' }
    world.notes = { 'Items/plan.md': 'n1' }
    account.spaces = [
      remote('space-1', 'owner', true),
      remote('space-2', 'owner'),
      remote('space-3', 'owner', false, ['n1']),
    ]
    await account.loadSpaces()

    expect(reachedByOthersIn('Team')).toBe(true)
    expect(reachedByOthersIn('Items')).toBe(true)
    expect(reachedByOthersIn('Solo')).toBe(false)

    account.spaces = []
    account.listed = false
    account.user = null
    world.mirrors = {}
    world.locals = ['Team', 'Solo', 'Items']

    expect(reachedByOthersIn('Team')).toBe(true)
    expect(reachedByOthersIn('Items')).toBe(true)
    expect(reachedByOthersIn('Solo')).toBe(false)
  })

  test('counts it as shared while the listing is in and nothing is paired yet', async () => {
    world.mirrors = { Team: 'space-1' }
    account.spaces = [remote('space-1', 'owner', true)]
    await account.loadSpaces()

    world.mirrors = {}
    world.locals = ['Team', 'Local']
    account.spaces = [remote('space-1', 'owner', true)]
    account.listed = true

    expect(reachedByOthers('Team/weekly.md')).toBe(true)
    expect(reachedByOthers('Local/plan.md')).toBe(false)
  })

  test('keeps what the listing said of a space paired after it, for the next launch', async () => {
    world.mirrors = { Local: 'space-0' }
    account.spaces = [
      remote('space-0', 'owner'),
      { ...remote('space-1', 'write', true), name: 'Team' },
    ]
    await account.loadSpaces()

    const pairing: Pairing = {
      pairs: () =>
        Object.entries(world.mirrors).map(([root, spaceId]) => ({ root, spaceId, shared: false })),
      pair: (root, spaceId) => {
        world.mirrors = { ...world.mirrors, [root]: spaceId }
      },
      unpair: (root) => {
        world.mirrors = Object.fromEntries(
          Object.entries(world.mirrors).filter(([one]) => one !== root),
        )
      },
      share: () => undefined,
    }
    await pairSpaces('session', pairing)
    expect(world.mirrors).toEqual({ Local: 'space-0', Team: 'space-1' })

    account.spaces = []
    account.listed = false
    account.user = null
    world.mirrors = {}
    world.locals = ['Team', 'Local']

    expect(roleOf('Team')).toBe('write')
    expect(reachedByOthers('Team/weekly.md')).toBe(true)
    expect(trustsHtmlAt('Team/weekly.md')).toBe(false)
    expect(reachedByOthers('Local/plan.md')).toBe(false)
  })

  test('keeps what the listing said of a space renamed after it, for the next launch', async () => {
    world.mirrors = { Team: 'space-1' }
    account.spaces = [remote('space-1', 'owner', true)]
    await account.loadSpaces()

    world.mirrors = { Crew: 'space-1' }
    for (const follow of world.followers) {
      follow({ op: 'moved', kind: 'space', from: 'Team', to: 'Crew', root: null })
    }

    account.spaces = []
    account.listed = false
    account.user = null
    world.mirrors = {}
    world.locals = ['Crew']

    expect(reachedByOthers('Crew/weekly.md')).toBe(true)
    expect(trustsHtmlAt('Crew/weekly.md')).toBe(false)
  })

  test('forgets what was kept of a space once its folder goes', async () => {
    world.mirrors = { Theirs: 'space-1' }
    account.spaces = [remote('space-1', 'read', true)]
    await account.loadSpaces()

    world.mirrors = {}
    for (const follow of world.followers) {
      follow({ op: 'removed', kind: 'space', path: 'Theirs', root: null })
    }

    account.spaces = []
    account.listed = false
    account.user = null
    world.locals = ['Theirs']

    expect(roleOf('Theirs')).toBe('owner')
    expect(canWriteAt('Theirs/plan.md')).toBe(true)
  })

  test('takes a role an older build kept, which says nothing of who else is in, as shared', () => {
    world.locals = ['Team', 'Local']
    account.user = null
    storage.setItem('nib:space-roles', JSON.stringify({ Team: 'owner' }))

    expect(roleOf('Team')).toBe('owner')
    expect(reachedByOthers('Team/weekly.md')).toBe(true)
    expect(reachedByOthers('Local/plan.md')).toBe(false)
  })

  test('and forgets that with the session', async () => {
    world.mirrors = { Theirs: 'space-1' }
    account.spaces = [remote('space-1', 'read', true)]
    await account.loadSpaces()
    await account.signOut()

    world.mirrors = {}
    world.locals = ['Theirs']

    expect(canWriteAt('Theirs/plan.md')).toBe(true)
  })
})

describe('whether somebody else is in a note', () => {
  const open = (path: string, key: string) => ({ path, note: { key } })

  test('is nobody until a room says there is', () => {
    world.tabs = [open('Notes/plan.md', 'k1')]
    expect(othersIn('Notes/plan.md')).toBe(false)
  })

  test('is somebody once a room counts one', () => {
    world.tabs = [open('Notes/plan.md', 'k1')]
    rooms.present = { k1: 1 }

    expect(othersIn('Notes/plan.md')).toBe(true)
  })

  test('and only about the note the room is for', () => {
    world.tabs = [open('Notes/plan.md', 'k1'), open('Notes/other.md', 'k2')]
    rooms.present = { k1: 2 }

    expect(othersIn('Notes/plan.md')).toBe(true)
    expect(othersIn('Notes/other.md')).toBe(false)
  })

  test('is nobody for a note nothing has opened, which is most of them', () => {
    rooms.present = { k1: 3 }
    expect(othersIn('Notes/never-opened.md')).toBe(false)
  })

  test('and a note open in two panes is still one answer', () => {
    world.tabs = [open('Notes/plan.md', 'k1'), open('Notes/plan.md', 'k1')]
    rooms.present = { k1: 1 }

    expect(othersIn('Notes/plan.md')).toBe(true)
  })
})

describe('where a document’s words came from', () => {
  const document = (path: string | null, pasted = false, shared: string | null = null) =>
    ({ path, key: 'k1', pasted, shared }) as unknown as NoteDoc

  test('is the reader’s own, for a note in a space nobody else is in', () => {
    world.mirrors = { Notes: 'space-1' }
    account.spaces = [remote('space-1', 'owner')]

    expect(originOfDocument(document('Notes/plan.md'))).toBe('own')
    expect(trustsHtmlIn(document('Notes/plan.md'))).toBe(true)
  })

  test('is the reader’s own, for a note in no space at all', () => {
    expect(originOfDocument(document('/elsewhere/loose.md'))).toBe('own')
    expect(originOfDocument(document(null))).toBe('own')
  })

  test('is the space, once somebody else is in it', () => {
    world.mirrors = { Notes: 'space-1' }
    account.spaces = [remote('space-1', 'owner', true)]

    expect(originOfDocument(document('Notes/plan.md'))).toBe('space')
    expect(trustsHtmlIn(document('Notes/plan.md'))).toBe(false)
  })

  test('is the space, for one somebody shared with the reader', () => {
    world.mirrors = { Notes: 'space-1' }
    account.spaces = [remote('space-1', 'read')]

    expect(originOfDocument(document('Notes/plan.md'))).toBe('space')
  })

  test('is the space, for one file somebody shared with the reader on its own', () => {
    expect(originOfDocument(document(null, false, 'item-1'))).toBe('space')
    expect(trustsHtmlIn(document(null, false, 'item-1'))).toBe(false)
  })

  test('is a paste, once markup has been put in from outside', () => {
    expect(originOfDocument(document('/elsewhere/loose.md', true))).toBe('paste')
    expect(trustsHtmlIn(document('/elsewhere/loose.md', true))).toBe(false)
  })

  test('is a guest, for a session a link let in', () => {
    account.guest = { id: 'g1', name: 'Someone' }
    try {
      expect(originOfDocument(document('/elsewhere/loose.md'))).toBe('guest')
      expect(trustsHtmlIn(document('/elsewhere/loose.md'))).toBe(false)
    } finally {
      account.guest = null
    }
  })

  test('is the room, while somebody else is in the file', () => {
    world.mirrors = { Notes: 'space-1' }
    account.spaces = [remote('space-1', 'owner', true)]
    rooms.present = { k1: 1 }

    try {
      expect(originOfDocument(document('Notes/plan.md'))).toBe('room')
    } finally {
      rooms.present = {}
    }
  })

  test('is the space, for a note of the reader’s own shared on its own', () => {
    world.mirrors = { Notes: 'space-1' }
    world.notes = { 'Notes/plan.md': 'n1' }
    account.spaces = [remote('space-1', 'owner', false, ['n1'])]
    account.listed = true

    expect(originOfDocument(document('Notes/plan.md'))).toBe('space')
    expect(trustsHtmlAt('Notes/plan.md')).toBe(false)
    expect(reachedByOthers('Notes/plan.md')).toBe(true)
    expect(reachedByOthers('Notes/other.md')).toBe(false)
  })

  test('is the space, for a paired space of the reader’s own before the listing is in', () => {
    world.mirrors = { Notes: 'space-1' }
    world.kept = { Notes: 'owner' }

    expect(roleOf('Notes')).toBe('owner')
    expect(originOfDocument(document('Notes/plan.md'))).toBe('space')
    expect(trustsHtmlAt('Notes/plan.md')).toBe(false)
    expect(reachedByOthers('Notes/plan.md')).toBe(true)

    account.spaces = [remote('space-1', 'owner')]
    account.listed = true
    expect(reachedByOthers('Notes/plan.md')).toBe(false)
  })

  test('is the reader’s own, for a folder that mirrors nothing, before any listing', () => {
    world.locals = ['Local']

    expect(reachedByOthers('Local/plan.md')).toBe(false)
  })

  test('is still the reader’s own with a second device in an unshared space', () => {
    world.mirrors = { Notes: 'space-1' }
    account.spaces = [remote('space-1', 'owner')]
    rooms.present = { k1: 1 }

    try {
      expect(originOfDocument(document('Notes/plan.md'))).toBe('own')
    } finally {
      rooms.present = {}
    }
  })
})

describe('a space somebody has left', () => {
  test('stays reached by others, as the account says it once was', () => {
    world.mirrors = { Home: 'space-1' }
    account.spaces = [{ ...remote('space-1', 'owner'), onceShared: true }]
    account.listed = true

    expect(isShared('Home')).toBe(false)
    expect(reachedByOthers('Home/evil.md')).toBe(true)
    expect(trustsHtmlAt('Home/evil.md')).toBe(false)
  })

  test('and a note handed back stays reached, the one beside it does not', () => {
    world.mirrors = { Home: 'space-1' }
    world.notes = { 'Home/shared.md': 'n1', 'Home/other.md': 'n2' }
    account.spaces = [{ ...remote('space-1', 'owner'), onceSharedItems: ['n1'] }]
    account.listed = true

    expect(isSharedItem('Home/shared.md')).toBe(false)
    expect(reachedByOthers('Home/shared.md')).toBe(true)
    expect(reachedAs('Home/shared.md')).toBe('note')
    expect(reachedByOthers('Home/other.md')).toBe(false)
    expect(reachedByOthersIn('Home')).toBe(true)
  })

  test('marks the whole space for an answer that names many of its notes', () => {
    world.mirrors = { Home: 'space-1', Solo: 'space-2' }
    account.spaces = [
      { ...remote('space-1', 'owner'), onceShared: true },
      remote('space-2', 'owner'),
    ]
    account.listed = true

    expect(reachedAs('Home/evil.md')).toBe('space')
    expect(reachedByOthersIn('Home')).toBe(true)
    expect(reachedByOthersIn('Solo')).toBe(false)
  })

  test('stays reached once this device saw it shared, whatever a later listing says', async () => {
    world.mirrors = { Home: 'space-1' }
    world.notes = { 'Home/shared.md': 'n1' }
    account.spaces = [remote('space-1', 'owner', true, ['n1'])]
    await account.loadSpaces()

    account.spaces = [remote('space-1', 'owner')]
    await account.loadSpaces()
    expect(reachedByOthers('Home/evil.md')).toBe(true)
    expect(reachedByOthers('Home/shared.md')).toBe(true)

    account.spaces = []
    account.listed = false
    world.mirrors = {}
    world.locals = ['Home']
    expect(reachedByOthers('Home/evil.md')).toBe(true)
  })

  test('takes what an older build kept as shared as once shared', async () => {
    world.mirrors = { Home: 'space-1' }
    storage.setItem(
      'nib:space-roles',
      JSON.stringify({ Home: { role: 'owner', shared: true, items: [] } }),
    )
    account.spaces = [remote('space-1', 'owner')]
    await account.loadSpaces()

    expect(reachedByOthers('Home/evil.md')).toBe(true)
  })

  test('is the reader’s own again once its owner says so, here and on the account', async () => {
    world.mirrors = { Home: 'space-1' }
    account.spaces = [remote('space-1', 'owner', true)]
    await account.loadSpaces()
    account.spaces = [{ ...remote('space-1', 'owner'), onceShared: true }]
    await account.loadSpaces()

    const space = local('Home')
    expect(canTrustAgain(space)).toBe(true)
    await trustAgain(space)

    expect(world.asked).toContain('trust space-1')
    expect(reachedByOthers('Home/evil.md')).toBe(false)
    expect(canTrustAgain(space)).toBe(false)

    await account.loadSpaces()
    expect(reachedByOthers('Home/evil.md')).toBe(false)
    account.spaces = []
    account.listed = false
    world.mirrors = {}
    world.locals = ['Home']
    expect(reachedByOthers('Home/evil.md')).toBe(false)
  })

  test('is not offered to be trusted while somebody is still in it, or for somebody else’s', () => {
    world.mirrors = { Home: 'space-1', Theirs: 'space-2', Solo: 'space-3' }
    account.spaces = [
      { ...remote('space-1', 'owner', true), onceShared: true },
      remote('space-2', 'write', true),
      remote('space-3', 'owner'),
    ]
    account.listed = true

    expect(canTrustAgain(local('Home'))).toBe(false)
    expect(canTrustAgain(local('Theirs'))).toBe(false)
    expect(canTrustAgain(local('Solo'))).toBe(false)
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
    expect(share.email).toBe('')
  })

  test('asks nothing when the address is empty', async () => {
    share.email = '   '
    await share.invite()

    expect(world.asked).toEqual([])
  })

  test('invites everybody in the field, in the order they were typed', async () => {
    share.email = 'ada@example.com, bob@example.com grace@example.com'
    share.role = 'read'
    await share.invite()

    expect(world.asked).toEqual([
      'invite ada@example.com as read to space-1',
      'invite bob@example.com as read to space-1',
      'invite grace@example.com as read to space-1',
    ])
    expect(share.email).toBe('')
  })

  test('keeps whatever has not gone in when one of them is refused', async () => {
    share.email = 'ada@example.com, bob@example.com, grace@example.com'
    world.refuse = 'that is as many people as one space holds'
    await share.invite()

    expect(world.asked).toEqual(['invite ada@example.com as write to space-1'])
    expect(share.error).toBe('that is as many people as one space holds')
    expect(share.email).toBe('ada@example.com, bob@example.com, grace@example.com')
  })

  test('says so about something that is not an address, and asks nothing', async () => {
    share.email = 'nonsense'
    await share.invite()

    expect(world.asked).toEqual([])
    expect(share.wrongAddress).toBe(true)
    expect(share.error).toBeNull()
    expect(share.email).toBe('nonsense')
  })

  test('and refuses the whole field when one address in it is not one', async () => {
    share.email = 'ada@example.com, nonsense'
    await share.invite()

    expect(world.asked).toEqual([])
    expect(share.wrongAddress).toBe(true)
    expect(share.email).toBe('ada@example.com, nonsense')
  })

  test('keeps the address when the server refused it', async () => {
    world.refuse = 'enter a valid email address'
    share.email = 'ada@example.com'
    await share.invite()

    expect(share.error).toBe('enter a valid email address')
    expect(share.email).toBe('ada@example.com')
  })

  test('sends the invitation again to somebody who has not opened it', async () => {
    await share.resend({ email: 'ada@example.com', guest: null, role: 'read' })

    expect(world.asked).toEqual(['invite ada@example.com as read to space-1'])
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

  test('resets the link by revoking it and making another like it', async () => {
    await share.reset('write', 'open')

    expect(world.asked).toEqual(['revoke', 'link write open'])
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

  test('takes one change at a time, and says which row it is about', async () => {
    world.sharing.members = [member('ada@example.com')]
    await share.show(local('Notes'))
    expect(share.busy).toBe(false)

    const removing = share.remove(member('ada@example.com'))
    expect(share.busy).toBe(true)
    expect(share.waiting('person:ada@example.com')).toBe(true)
    expect(share.waiting('person:bob@example.com')).toBe(false)

    expect(await share.remove(member('ada@example.com'))).toBe(false)
    await removing

    expect(share.busy).toBe(false)
    expect(world.asked.filter((one) => one.startsWith('remove'))).toEqual([
      'remove ada@example.com',
    ])
  })

  test('reads the list again rather than complaining when they are already out', async () => {
    world.sharing.members = [member('ada@example.com')]
    await share.show(local('Notes'))

    world.refuse = 'nobody by that address'
    world.refuseStatus = 404
    const done = share.setRole(member('ada@example.com'), 'read')
    world.refuse = null
    world.sharing.members = []

    expect(await done).toBe(true)
    expect(share.error).toBeNull()
    expect(share.who?.members).toEqual([])
  })

  test('still says what went wrong when something actually did', async () => {
    await share.show(local('Notes'))
    world.refuse = 'only the owner can do that'

    expect(await share.remove(member('ada@example.com'))).toBe(false)
    expect(share.error).toBe('only the owner can do that')
  })
})

describe('the sheet about one file', () => {
  beforeEach(() => {
    world.mirrors = { Notes: 'space-1' }
    world.notes = { 'Notes/plan.md': 'note-1' }
    account.spaces = [remote('space-1', 'owner')]
  })

  test('asks about the file, and says which file it is about', async () => {
    await share.showItem(local('Notes'), 'Notes/plan.md')

    expect(share.item).toEqual({ id: 'note-1', path: 'Notes/plan.md' })
    expect(world.asked).toEqual(['read space-1 about note-1'])
  })

  test('and the same sheet about the space carries no file at all', async () => {
    await share.show(local('Notes'))

    expect(share.item).toBeNull()
    expect(world.asked).toEqual(['read space-1'])
  })

  test('carries the file through every control on it', async () => {
    await share.showItem(local('Notes'), 'Notes/plan.md')
    world.asked = []

    share.email = 'ada@example.com'
    await share.invite()
    await share.setRole(member('ada@example.com'), 'read')
    await share.remove(member('ada@example.com'))
    await share.setRole(guest('g1', 'Ada'), 'read')
    await share.remove(guest('g1', 'Ada'))
    await share.accept(guest('g1', 'Ada'))
    await share.decline(guest('g1', 'Ada'))
    await share.accept(member('bob@example.com'))
    await share.decline(member('bob@example.com'))
    await share.setLink('read', 'approval')
    await share.revoke()
    await share.reset('write', 'open')

    expect(world.asked).toEqual([
      'invite ada@example.com as write to space-1 about note-1',
      'ada@example.com is now read in space-1 about note-1',
      'remove ada@example.com about note-1',
      'guest g1 is now read in space-1 about note-1',
      'remove guest g1 about note-1',
      'accept guest g1 about note-1',
      'remove guest g1 about note-1',
      'accept bob@example.com about note-1',
      'decline bob@example.com about note-1',
      'link read approval about note-1',
      'revoke about note-1',
      'revoke about note-1',
      'link write open about note-1',
    ])
  })

  test('opens on nothing at all where the file never reached the account', async () => {
    world.notes = {}
    await share.showItem(local('Notes'), 'Notes/plan.md')

    expect(share.open).toBe(false)
    expect(world.asked).toEqual([])
  })
})

describe('a sheet opened on another file while the first is still being read', () => {
  const PLAN = 'Notes/plan.md'
  const DIARY = 'Notes/diary.md'

  const shareOf = (email: string, url: string): Who => ({
    owner: { email: 'owner@example.com', name: 'Emil' },
    members: [member(email)],
    requests: [],
    link: { url, role: 'read', mode: 'open' },
  })

  const twoSheets = () => {
    const first = share.showItem(local('Notes'), PLAN)
    share.close()
    const second = share.showItem(local('Notes'), DIARY)

    return Promise.all([first, second])
  }

  beforeEach(() => {
    world.mirrors = { Notes: 'space-1' }
    world.notes = { [PLAN]: 'note-1', [DIARY]: 'note-2' }
    account.spaces = [remote('space-1', 'owner')]
    world.sharingOf = {
      'note-1': shareOf('ada@example.com', 'https://nib.test/plan'),
      'note-2': shareOf('bob@example.com', 'https://nib.test/diary'),
    }
    world.holding = true
  })

  test('asks about the file it is headed with rather than going quiet behind the first', async () => {
    const both = twoSheets()
    expect(world.asked).toEqual(['read space-1 about note-1', 'read space-1 about note-2'])

    await land()
    await both
  })

  test('shows the people of that file even when the first answer lands last', async () => {
    const both = twoSheets()
    await land(1, 0)
    await both

    expect(share.item?.id).toBe('note-2')
    expect(share.who?.members.map((one) => one.email)).toEqual(['bob@example.com'])
  })

  test('and hands out that file’s invite link rather than the other file’s', async () => {
    const both = twoSheets()
    await land(1, 0)
    await both

    expect(share.who?.link?.url).toBe('https://nib.test/diary')
  })

  test('and the first answer landing leaves the sheet waiting on its own', async () => {
    const both = twoSheets()

    await land(0)
    expect(share.who).toBeNull()
    expect(share.waiting('sheet')).toBe(true)

    await land()
    await both
    expect(share.who?.members.map((one) => one.email)).toEqual(['bob@example.com'])
  })

  test('and Remove takes the person it is showing out of the file it is showing', async () => {
    const both = twoSheets()
    await land(1, 0)
    await both

    world.holding = false
    world.asked = []
    const shown = share.who?.members[0]?.email ?? ''
    await share.remove({ email: shown, guest: null })

    expect(world.asked).toEqual(['remove bob@example.com about note-2'])
  })

  test('and a list read again after a change had already happened is dropped as well', async () => {
    world.holding = false
    await share.showItem(local('Notes'), PLAN)

    world.holding = true
    world.refuse = 'nobody by that address'
    world.refuseStatus = 404
    const removing = share.remove(member('ada@example.com'))

    world.refuse = null
    await land()

    const second = share.showItem(local('Notes'), DIARY)
    await land()
    await Promise.all([removing, second])

    expect(share.item?.id).toBe('note-2')
    expect(share.who?.members.map((one) => one.email)).toEqual(['bob@example.com'])
  })
})

describe('the mark on a file shared on its own', () => {
  test('is drawn from the listing, by the id this machine holds for the path', () => {
    world.mirrors = { Notes: 'space-1' }
    world.notes = { 'Notes/plan.md': 'note-1', 'Notes/other.md': 'note-2' }
    account.spaces = [remote('space-1', 'owner', false, ['note-1'])]

    expect(isSharedItem('Notes/plan.md')).toBe(true)
    expect(isSharedItem('Notes/other.md')).toBe(false)
  })

  test('and is not the same fact as the space being shared', () => {
    world.mirrors = { Notes: 'space-1' }
    world.notes = { 'Notes/plan.md': 'note-1' }
    account.spaces = [remote('space-1', 'owner', true, [])]

    expect(isShared('Notes')).toBe(true)
    expect(isSharedItem('Notes/plan.md')).toBe(false)
  })
})

describe('whether a file can be shared from here', () => {
  beforeEach(() => {
    world.mirrors = { Notes: 'space-1', Theirs: 'space-2' }
    world.notes = { 'Notes/plan.md': 'note-1', 'Theirs/plan.md': 'note-2' }
    account.spaces = [remote('space-1', 'owner'), remote('space-2', 'write')]
  })

  test('yes, for a file of the account own space that the account holds', () => {
    expect(canShareItem('Notes/plan.md')).toBe(true)
  })

  test('no, for a file of a space somebody else owns', () => {
    expect(canShareItem('Theirs/plan.md')).toBe(false)
  })

  test('no, for a file the account has never been handed: a share names an id', () => {
    expect(canShareItem('Notes/fresh.md')).toBe(false)
  })

  test('and no, for nothing at all', () => {
    expect(canShareItem(null)).toBe(false)
    expect(canShareItem('/elsewhere/loose.md')).toBe(false)
  })
})

describe('the files other people shared with you', () => {
  test('arrive grouped under whoever shared them, in the order they came', async () => {
    world.shared = [
      sharedFile('n1', 'Plans/meeting.md', 'Ada'),
      sharedFile('n2', 'Plans/next.md', 'Ada'),
      sharedFile('n3', 'Work/board.canvas', 'Grace'),
    ]

    await sharedWithYou.load()

    expect(sharedWithYou.byOwner.map((one) => one.owner)).toEqual(['Ada', 'Grace'])
    expect(sharedWithYou.byOwner[0]?.items.map((one) => one.name)).toEqual(['meeting', 'next'])
    expect(sharedWithYou.byOwner[1]?.items.map((one) => one.name)).toEqual(['board.canvas'])
  })

  test('open in a tab whose words came down once, and a canvas as a canvas', async () => {
    world.shared = [
      sharedFile('n1', 'Plans/meeting.md', 'Ada'),
      sharedFile('n3', 'Work/b.canvas', 'Ada'),
    ]
    world.words = { n1: '# the meeting', n3: '{}' }
    await sharedWithYou.load()

    await sharedWithYou.open(world.shared[0]!)
    await sharedWithYou.open(world.shared[1]!)

    expect(world.opened).toEqual([
      { id: 'n1', name: 'meeting', path: 'Plans/meeting.md', text: '# the meeting' },
      { id: 'n3', name: 'b.canvas', path: 'Work/b.canvas', text: '{}' },
    ])
  })

  test('and one already open is brought forward rather than read again', async () => {
    world.shared = [sharedFile('n1', 'Plans/meeting.md', 'Ada')]
    world.words = { n1: '# the meeting' }
    world.showing = ['n1']
    await sharedWithYou.load()
    world.asked = []

    await sharedWithYou.open(world.shared[0]!)

    expect(world.asked).toEqual([])
    expect(world.opened).toHaveLength(1)
  })

  test('stop being listed once they are taken back, and their tabs close', async () => {
    world.shared = [sharedFile('n1', 'Plans/meeting.md', 'Ada')]
    await sharedWithYou.load()
    expect(sharedWithYou.items).toHaveLength(1)

    world.shared = []
    await sharedWithYou.load()

    expect(sharedWithYou.items).toEqual([])
    expect(world.closed).toEqual(['n1'])
  })

  test('and can be handed back from the row, which closes the tab at once', async () => {
    world.shared = [sharedFile('n1', 'Plans/meeting.md', 'Ada')]
    await sharedWithYou.load()

    await sharedWithYou.leave(world.shared[0]!)

    expect(sharedWithYou.items).toEqual([])
    expect(world.closed).toEqual(['n1'])
    expect(world.asked).toContain('leave n1')
  })

  test('and a listing that could not be read leaves the last one standing', async () => {
    world.shared = [sharedFile('n1', 'Plans/meeting.md', 'Ada')]
    await sharedWithYou.load()

    world.refuse = 'could not reach the server'
    await sharedWithYou.load()

    expect(sharedWithYou.items).toHaveLength(1)
    expect(world.closed).toEqual([])
  })

  test('and one handed back while a listing was in the air stays gone', async () => {
    world.shared = [
      sharedFile('n1', 'Plans/meeting.md', 'Ada'),
      sharedFile('n2', 'Plans/next.md', 'Ada'),
    ]
    await sharedWithYou.load()

    world.holding = true
    const listing = sharedWithYou.load()

    world.holding = false
    await sharedWithYou.leave(world.shared[0]!)

    await land()
    await listing

    expect(sharedWithYou.items.map((one) => one.id)).toEqual(['n2'])
  })
})
