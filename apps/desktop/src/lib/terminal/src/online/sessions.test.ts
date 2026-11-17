import { beforeEach, expect, test, vi } from 'vitest'
import type { Listed } from './calls'

let there: Listed[] = []
const ended: string[] = []
const listeners = new Map<string, () => void>()

vi.mock('./calls', () => ({
  listed: () => Promise.resolve(there),
  endSession: (id: string) => {
    ended.push(id)
    there = there.filter((one) => (one.term ?? one.session) !== id)
    return Promise.resolve()
  },
}))
vi.mock('../../../sync-client/src/hub.svelte', () => ({
  hub: {
    on: (type: string, listener: () => void) => {
      listeners.set(type, listener)
      return () => listeners.delete(type)
    },
  },
}))

const { sessions } = await import('./sessions.svelte')

function one(session: string, term: string | null): Listed {
  return {
    term,
    session,
    createdAt: 1,
    space: null,
    path: null,
    trashed: false,
    program: null,
    title: null,
    alive: true,
    at: null,
  }
}

beforeEach(() => {
  there = [one('s_1', 'note-1'), one('s_orphan', null)]
  ended.length = 0
  sessions.list = null
})

test('asks again when the hub says a session was made or ended elsewhere', async () => {
  await sessions.refresh()
  expect(sessions.list?.map((row) => row.session)).toEqual(['s_1', 's_orphan'])

  const stop = sessions.watch()
  there = [...there, one('s_2', 'note-2')]
  listeners.get('terms')?.()
  await vi.waitFor(() => {
    expect(sessions.list?.map((row) => row.session)).toEqual(['s_1', 's_orphan', 's_2'])
  })
  stop()
  expect(listeners.has('terms')).toBe(false)
})

test('End is said with the file’s id, or the session’s own where no file names it', async () => {
  await sessions.refresh()
  const [named, orphan] = sessions.list ?? []
  if (!named || !orphan) throw new Error('no sessions')
  await sessions.end(named)
  await sessions.end(orphan)
  expect(ended).toEqual(['note-1', 's_orphan'])
  expect(sessions.list).toEqual([])
})

test('a list asked for before a session ended does not bring it back', async () => {
  there = [one('a', 'term-a'), one('b', 'term-b')]
  await sessions.refresh()
  const before = there
  let answer: (list: Listed[]) => void = () => undefined
  const calls = await import('./calls')
  const listed = vi.spyOn(calls, 'listed')
  listed.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))

  const stale = sessions.refresh()
  await sessions.end(one('a', 'term-a'))
  answer(before)
  await stale

  expect(sessions.list?.map((each) => each.session)).toEqual(['b'])
  listed.mockRestore()
})
