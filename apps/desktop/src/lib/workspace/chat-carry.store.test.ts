import { chatText } from '@nib/chats'
import { beforeEach, expect, test, vi } from 'vitest'

/** A chat's pointer carried into another space (B193).
 *
 *  Moving a `.chat` file into another space moves its chat on the account, and the
 *  account lets a writer who is not the space's owner move it only into another space of
 *  that owner (services/sync, `PATCH /v2/chats/:id`). The file used to move first and the
 *  account's refusal was let go of: the pointer was in the owner's Recently deleted, the
 *  chat stayed where it was with nothing pointing at it, and emptying the trash ended it.
 *  So no such space is offered, and the account is asked before the file moves: refused,
 *  nothing moves and the toast says so. The disk is a map; see test/disk.ts. */

const CHAT = `c_${'1'.repeat(32)}`
const disk = vi.hoisted(() => ({ current: null as import('../../../test/disk').Disk | null }))
const asked = vi.hoisted(() => ({
  moves: [] as [string, string][],
  answer: (): Promise<boolean> => Promise.resolve(true),
}))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

vi.mock('../chats/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chats/http')>()),
  moveChat: (chat: string, space: string) => {
    asked.moves.push([chat, space])
    return asked.answer()
  },
}))

const { Disk, memoryStorage } = await import('../../../test/disk')
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('../workspace.svelte')
const { account } = await import('../account.svelte')
const { sync } = await import('../sync.svelte')
const { ApiError } = await import('../api')
const { failed } = await import('../views/failed.svelte')
const { spacesOfPaths } = await import('../tab-strip/to-space')

/** The owner's space the reader writes in, another of that owner's, and the reader's
 *  own. */
const SHARED = '/spaces/Team'
const OWNERS = '/spaces/Lab'
const MINE = '/spaces/Mine'
const POINTER = `${SHARED}/Plans.chat`

const space = (id: string, role: 'owner' | 'write', people: string[] = []) =>
  ({ id, name: id, role, shared: role !== 'owner', people }) as never

beforeEach(async () => {
  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  for (const root of [SHARED, OWNERS, MINE]) one.folders.add(root)
  one.files.set(POINTER, chatText({ v: 1, chat: CHAT }))
  one.files.set(`${SHARED}/Plan.md`, '# Plan\n')

  workspace.spaces = [
    { id: 'team', name: 'Team', root: SHARED },
    { id: 'lab', name: 'Lab', root: OWNERS },
    { id: 'mine', name: 'Mine', root: MINE },
  ]
  workspace.activeSpaceId = 'team'
  workspace.tabs = []
  workspace.undone.stack = []
  account.user = { id: 'u-me', email: 'me@example.com' } as never
  account.spaces = [
    space('r-team', 'write', ['u-owner']),
    space('r-lab', 'write', ['u-owner', 'u-other']),
    space('r-mine', 'owner'),
  ]
  const remote: Record<string, string> = { [SHARED]: 'r-team', [OWNERS]: 'r-lab', [MINE]: 'r-mine' }
  vi.spyOn(sync, 'remoteIdFor').mockImplementation((root: string) => remote[root] ?? null)
  asked.moves = []
  asked.answer = () => Promise.resolve(true)
  failed.dismiss()
  await workspace.loadTree()
})

const there = (path: string) => disk.current?.files.has(path) ?? false

test('a writer is offered only the owner’s other spaces for a chat, any for a note', () => {
  expect(spacesOfPaths([POINTER]).map((one) => one.id)).toEqual(['lab'])
  expect(spacesOfPaths([`${SHARED}/Plan.md`]).map((one) => one.id)).toEqual(['lab', 'mine'])
})

test('carried into the writer’s own space anyway, nothing moves and nothing is asked', async () => {
  await workspace.moveMany([POINTER], MINE).catch(() => undefined)
  expect(there(POINTER)).toBe(true)
  expect(there(`${MINE}/Plans.chat`)).toBe(false)
  expect(asked.moves).toEqual([])
  expect(failed.retry).not.toBeNull()
})

test('the account refusing a move the device thought fine, the pointer stays', async () => {
  asked.answer = () => Promise.reject(new ApiError(403, 'only the owner can do that'))
  await workspace.moveMany([POINTER], OWNERS).catch(() => undefined)
  expect(asked.moves).toEqual([[CHAT, 'r-lab']])
  expect(there(POINTER)).toBe(true)
  expect(there(`${OWNERS}/Plans.chat`)).toBe(false)
  expect(failed.retry).not.toBeNull()
})

test('into another of the owner’s spaces, the chat moves on the account, then the file', async () => {
  await workspace.moveMany([POINTER], OWNERS)
  expect(asked.moves).toEqual([[CHAT, 'r-lab']])
  expect(there(POINTER)).toBe(false)
  expect(there(`${OWNERS}/Plans.chat`)).toBe(true)
  expect(failed.retry).toBeNull()
})

test('a folder holding a pointer is a pointer carried', async () => {
  disk.current?.folders.add(`${SHARED}/Projects`)
  disk.current?.files.set(`${SHARED}/Projects/Plans.chat`, chatText({ v: 1, chat: CHAT }))
  disk.current?.files.delete(POINTER)
  await workspace.loadTree()
  expect(spacesOfPaths([`${SHARED}/Projects`]).map((one) => one.id)).toEqual(['lab'])
  await workspace.moveMany([`${SHARED}/Projects`], MINE).catch(() => undefined)
  expect(there(`${SHARED}/Projects/Plans.chat`)).toBe(true)
})

test('a name already taken there, the account is not asked and nothing moves', async () => {
  disk.current?.files.set(`${OWNERS}/Plans.chat`, chatText({ v: 1, chat: `c_${'2'.repeat(32)}` }))
  await workspace.loadTree()
  await workspace.moveMany([POINTER], OWNERS).catch(() => undefined)
  expect(asked.moves).toEqual([])
  expect(there(POINTER)).toBe(true)
})

test('the file refused after the chat moved, the chat is moved back', async () => {
  // Taken in the moment between the look and the move, so only the move finds it.
  const one = disk.current
  if (!one) throw new Error('no disk')
  const real = one.invoke.bind(one)
  vi.spyOn(one, 'invoke').mockImplementation((command, args) => {
    if (command === 'rename_note') throw new Error('something already lives there')
    return real(command, args)
  })
  await workspace.moveMany([POINTER], OWNERS).catch(() => undefined)
  vi.mocked(one.invoke).mockRestore()
  expect(asked.moves).toEqual([
    [CHAT, 'r-lab'],
    [CHAT, 'r-team'],
  ])
  expect(there(POINTER)).toBe(true)
})
