import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The question a session asks about the notes already here, and what each answer
 *  does. What counts as meeting is sync/meeting.ts's, held to the real Worker in
 *  sync/relogin.test.ts; here it is whatever the test says. */

interface World {
  record: unknown
  met: { name: string; root: string }[]
  answer: string | null
  asked: number
  renamed: [string, string][]
  settled: number
}

const world = vi.hoisted((): World => ({
  record: null,
  met: [],
  answer: null,
  asked: 0,
  renamed: [],
  settled: 0,
}))

vi.mock('./account.svelte', () => ({
  account: {
    accountToken: 'token',
    user: { id: 'me' },
    spaces: [{ id: 's1', name: 'Plans', role: 'owner' }],
    settled: () => (world.settled += 1),
  },
}))

vi.mock('./stored', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stored')>()),
  stored: () => world.record,
}))

vi.mock('./sync/meeting', () => ({ meeting: () => Promise.resolve(world.met) }))

vi.mock('./prompt.svelte', () => ({
  prompt: {
    choose: () => {
      world.asked += 1
      return Promise.resolve(world.answer)
    },
  },
}))

vi.mock('./i18n.svelte', () => ({ t: (text: string) => text }))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    spaces: [
      { id: 'a', name: 'Plans', root: '/Plans' },
      { id: 'b', name: 'Plans 2', root: '/Plans 2' },
    ],
    renameSpace: (id: string, name: string) => {
      world.renamed.push([id, name])
      return Promise.resolve()
    },
  },
}))

const { settleLocalNotes } = await import('./settling')

const PLANS = { name: 'Plans', root: '/Plans' }
const MIRRORS = { '/Plans': { spaceId: 's1', cursor: 3, notes: {} } }

beforeEach(() => {
  Object.assign(world, { record: null, met: [], answer: null, asked: 0, renamed: [], settled: 0 })
})

describe('signing in', () => {
  test('asks nothing of a device back with its own account, however it would meet', async () => {
    world.record = { account: 'me', mirrors: MIRRORS }
    world.met = [PLANS]

    await settleLocalNotes()

    expect(world.asked).toBe(0)
    expect(world.settled).toBe(1)
  })

  test('asks nothing where nothing would meet', async () => {
    world.record = { account: 'them', mirrors: MIRRORS }

    await settleLocalNotes()

    expect(world.asked).toBe(0)
    expect(world.settled).toBe(1)
  })

  test('asks about another account’s notes that would meet, and Merge leaves them be', async () => {
    world.record = { account: 'them', mirrors: MIRRORS }
    world.met = [PLANS]
    world.answer = 'merge'

    await settleLocalNotes()

    expect(world.asked).toBe(1)
    expect(world.renamed).toEqual([])
    expect(world.settled).toBe(1)
  })

  test('Keep separate gives each space that would meet a name nobody has', async () => {
    world.met = [PLANS]
    world.answer = 'apart'

    await settleLocalNotes()

    expect(world.renamed).toEqual([['a', 'Plans 3']])
  })

  test('closing the question keeps them separate too', async () => {
    world.met = [PLANS]

    await settleLocalNotes()

    expect(world.asked).toBe(1)
    expect(world.renamed).toEqual([['a', 'Plans 3']])
    expect(world.settled).toBe(1)
  })
})
