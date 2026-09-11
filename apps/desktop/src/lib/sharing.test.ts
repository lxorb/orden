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
const member = (email: string, role = 'write') => ({
  email,
  guest: null,
  name: null,
  role,
  pending: false,
})
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
  /** What the refusal comes back as. 404 is the space saying the change had
   *  already happened. */
  refuseStatus: number
  /** Every share call that was made, in order. */
  asked: string[]
  /** The open tabs, as much of each as `othersIn` reads: a path and the key its
   *  document's room is counted under. */
  tabs: { path: string | null; note: { key: string } }[]
  /** What the account holds for each path on this machine: the note's id, which
   *  is what a share about one file names. */
  notes: Record<string, string>
  /** What `GET /v1/shared` answers: the files other people shared on their own. */
  shared: SharedItem[]
  /** The words each of those files comes down with. */
  words: Record<string, string>
  /** Every shared file that was opened, and every one whose tabs were closed. */
  opened: { id: string; name: string; canvas: boolean; text: string }[]
  closed: string[]
  /** Which shared files have a tab right now, as the workspace would answer. */
  showing: string[]
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
  refuseStatus: 403,
  asked: [],
  tabs: [],
  notes: {},
  shared: [],
  words: {},
  opened: [],
  closed: [],
  showing: [],
}))

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>()

  const answer = (what: string) => {
    world.asked.push(what)
    if (world.refuse) {
      return Promise.reject(new original.ApiError(world.refuseStatus, world.refuse))
    }

    return Promise.resolve(world.sharing)
  }

  /** Which share a call was about, as the calls themselves say it: the space, or
   *  one file of it. Written into what the test reads, so a control that forgot
   *  to carry the file it is about is a call that says the wrong thing. */
  const about = (item: string) => (item ? ` about ${item}` : '')

  return {
    ...original,
    api: {
      sharing: (_token: string, id: string, item = '') => answer(`read ${id}${about(item)}`),
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

      // The files other people shared on their own, and the two things that can
      // be done with one: read its words, and hand it back.
      // Not written into `asked`: the listing rides along with the spaces on
      // every pass, and a ledger of what a control asked for should not fill up
      // with a read nobody pressed anything for.
      shared: () => {
        if (world.refuse) {
          return Promise.reject(new original.ApiError(world.refuseStatus, world.refuse))
        }

        return Promise.resolve({ shared: world.shared })
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
    tracked: (path: string) => {
      const id = world.notes[path]
      return id ? { id, hash: 'h' } : null
    },
  },
}))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    get spaces() {
      return Object.keys(world.mirrors).map((root) => ({ id: root, name: root, root }))
    },
    get tabs() {
      return world.tabs
    },
    openShared: (item: { id: string; name: string; canvas: boolean }, text: string) =>
      world.opened.push({ ...item, text }),
    closeShared: (id: string) => world.closed.push(id),
    showingShared: (id: string) => world.showing.includes(id),
  },
}))

vi.mock('./i18n.svelte', () => ({
  message: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}))

// Imported once, at module scope: a hook that re-imported the store graph would
// charge whichever test ran first for compiling it.
import { account } from './account.svelte'
import { rooms } from './rooms.svelte'
import { accentFor } from './accents'
import {
  addressesIn,
  canShare,
  canShareItem,
  canWriteAt,
  isShared,
  isSharedItem,
  looksLikeAddress,
  originOfDocument,
  othersIn,
  roleOf,
  share,
  sharedWithYou,
  trustsHtmlIn,
} from './sharing.svelte'
import type { RemoteSpace, SharedItem } from './api'
import type { NoteDoc } from './workspace/documents.svelte'

/** A space on the account, with only the fields any of this reads. */
function remote(
  id: string,
  role: 'owner' | 'write' | 'read',
  shared = false,
  sharedItems: string[] = [],
): RemoteSpace {
  return { id, name: id, role, shared, sharedItems } as RemoteSpace
}

/** One file somebody else shared on its own, as the account hands it over. */
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

beforeEach(() => {
  world.mirrors = {}
  world.sharing = {
    owner: { email: 'owner@example.com', name: 'Emil' },
    members: [],
    requests: [],
    link: null,
  }
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
  // The list asks again on its own while it holds anything; no test wants
  // yesterday's timer still running in it.
  sharedWithYou.stop()
  sharedWithYou.items = []

  account.token = 'session'
  account.user = { id: 'u1', email: 'owner@example.com', name: 'Emil' }
  account.spaces = []

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

/** The square with somebody's initial in it. Derived rather than picked, because
 *  two people looking at the same list have to see the same colours. */
describe('the colour somebody wears in the list', () => {
  test('is the same colour for the same person, every time', () => {
    expect(accentFor('ada@example.com', 'dark')).toBe(accentFor('ada@example.com', 'dark'))
    expect(accentFor('Ada@Example.com ', 'dark')).toBe(accentFor('ada@example.com', 'dark'))
  })

  test('and a different one for somebody else', () => {
    expect(accentFor('ada@example.com', 'dark')).not.toBe(accentFor('bob@example.com', 'dark'))
  })

  /** Which colour is theirs, which shade of it is the reader's; see accents.ts. */
  test('and the shade the scheme in front of the reader needs', () => {
    expect(accentFor('ada@example.com', 'dark')).not.toBe(accentFor('ada@example.com', 'light'))
  })

  test('and something, for somebody with nothing to name them yet', () => {
    expect(accentFor('', 'dark')).toMatch(/^#[0-9a-f]{6}$/)
  })
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

/** The mark on a note's row in the file list, which is the same mark a shared
 *  space wears in the switcher.
 *
 *  Asked of the rooms rather than of the account on purpose: a note in a shared
 *  space that nobody else has open is not a note being worked in with somebody,
 *  and one mark repeated down every row of a shared space says nothing about any
 *  row in it. */
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
    // A room is joined for an open file, so nothing on this machine knows who is
    // in a note it has never opened. That is the honest answer rather than a
    // guess from which space the note sits in.
    rooms.present = { k1: 3 }
    expect(othersIn('Notes/never-opened.md')).toBe(false)
  })

  test('and a note open in two panes is still one answer', () => {
    world.tabs = [open('Notes/plan.md', 'k1'), open('Notes/plan.md', 'k1')]
    rooms.present = { k1: 1 }

    expect(othersIn('Notes/plan.md')).toBe(true)
  })
})

/** Which is what decides whether the HTML in it is markup or is words. The rule
 *  itself is trust.ts; this is the app answering it about a real space. */
describe('where a document’s words came from', () => {
  /** As much of a document as any of this reads. */
  const document = (path: string | null, pasted = false) =>
    ({ path, key: 'k1', pasted }) as unknown as NoteDoc

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

  /** A space this account did not make is somebody else's whether or not the
   *  sheet has got round to saying it is shared. */
  test('is the space, for one somebody shared with the reader', () => {
    world.mirrors = { Notes: 'space-1' }
    account.spaces = [remote('space-1', 'read')]

    expect(originOfDocument(document('Notes/plan.md'))).toBe('space')
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

  /** The other device in a room is this same person's, unless somebody else can
   *  reach the space at all. */
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

  /** Every address in the field, at the role beside it: a list pasted out of a
   *  mail client is one press, not four. */
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

  /** What has not gone in stays where it can be seen. Three invited and one
   *  silently lost is the failure this is written against. */
  test('keeps whatever has not gone in when one of them is refused', async () => {
    share.email = 'ada@example.com, bob@example.com, grace@example.com'
    world.refuse = 'that is as many people as one space holds'
    await share.invite()

    expect(world.asked).toEqual(['invite ada@example.com as write to space-1'])
    expect(share.error).toBe('that is as many people as one space holds')
    expect(share.email).toBe('ada@example.com, bob@example.com, grace@example.com')
  })

  /** An at sign is not something to wait on a round trip for. */
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

  /** The same route the first invitation took, which mints a fresh link and
   *  writes a fresh mail; see services/sync/src/spaces/share.ts. */
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

  /** A new address for the space and the old one dead, under one press: the sheet
   *  never shows the moment in between where there is no link at all. */
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

  /** Every control on the sheet goes quiet while one of them is in the air, so a
   *  second press cannot ask for the same change twice. */
  test('takes one change at a time, and says which row it is about', async () => {
    world.sharing.members = [member('ada@example.com')]
    await share.show(local('Notes'))
    expect(share.busy).toBe(false)

    const removing = share.remove(member('ada@example.com'))
    expect(share.busy).toBe(true)
    expect(share.waiting('person:ada@example.com')).toBe(true)
    expect(share.waiting('person:bob@example.com')).toBe(false)

    // A second press, which the screen has already refused.
    expect(await share.remove(member('ada@example.com'))).toBe(false)
    await removing

    expect(share.busy).toBe(false)
    expect(world.asked.filter((one) => one.startsWith('remove'))).toEqual([
      'remove ada@example.com',
    ])
  })

  /** Somebody who is no longer in the space has already gone, which is what the
   *  press asked for. The list is simply older than the space. */
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

/** Sharing one file rather than the whole space. The same store, the same sheet
 *  and the same calls, with the note's id carried alongside: what a control asks
 *  for has to say which of the two it is about, or an owner changing who may read
 *  one note would be changing who may read the space. */
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

  /** Every control, because forgetting one is the bug that cannot be seen: the
   *  sheet would look right and be about the wrong thing. */
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

describe('the mark on a file shared on its own', () => {
  test('is drawn from the listing, by the id this machine holds for the path', () => {
    world.mirrors = { Notes: 'space-1' }
    world.notes = { 'Notes/plan.md': 'note-1', 'Notes/other.md': 'note-2' }
    account.spaces = [remote('space-1', 'owner', false, ['note-1'])]

    expect(isSharedItem('Notes/plan.md')).toBe(true)
    expect(isSharedItem('Notes/other.md')).toBe(false)
  })

  /** The two marks are about two things and neither implies the other. A space
   *  everybody is in says so on the space; one note handed to one person says so
   *  on the note. */
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

/** The other side of it: the files other people shared on their own, which sit
 *  in no space this account can reach and so live at the foot of the switcher. */
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
      { id: 'n1', name: 'meeting', canvas: false, text: '# the meeting' },
      { id: 'n3', name: 'b.canvas', canvas: true, text: '{}' },
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

  /** Revoking. The row goes on the next pass and the tab goes with it: the words
   *  were never this machine's, and a tab on a room that will not have it back is
   *  not a document. */
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
})
