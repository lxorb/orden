import { beforeEach, describe, expect, test, vi } from 'vitest'

const ROOT = '/spaces/Work'

const kept = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  removeItem: (key: string) => void kept.delete(key),
  clear: () => kept.clear(),
})

const disk = new Map<string, string>()
const listed: string[] = []
const came: string[] = []

vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))
vi.mock('../workspace.svelte', () => ({
  workspace: {
    loadTree: () => {
      listed.push('tree')
      return Promise.resolve()
    },
    fileCame: (path: string) => {
      came.push(path)
      return Promise.resolve()
    },
  },
}))
vi.mock('../workspace/write-file', () => ({
  writeFile: (path: string, content: string) => {
    disk.set(path, content)
    return Promise.resolve()
  },
}))
vi.mock('../tauri', async (original) => ({
  ...(await original<typeof import('../tauri')>()),
  invoke: (command: string, args?: { path?: string }) => {
    const held = disk.get(args?.path ?? '')
    if (command === 'read_note' && held !== undefined) return Promise.resolve(held)
    if (command === 'path_exists' || command === 'file_stamp') return Promise.resolve(null)
    return Promise.reject(new Error('no such note'))
  },
}))

const { inboxNote } = await import('./inbox-note')
const { setInbox } = await import('./inbox')

beforeEach(() => {
  disk.clear()
  listed.length = 0
  came.length = 0
  localStorage.clear()
})

describe('the inbox a task with no place goes to', () => {
  test('is made inside Orden’s own folder, and nothing at the root of the space', async () => {
    expect(await inboxNote(ROOT)).toBe(`${ROOT}/.Inbox.md`)
    expect([...disk.keys()]).toEqual([`${ROOT}/.Inbox.md`])
    expect(listed).toEqual([])
    expect(came).toEqual([`${ROOT}/.Inbox.md`])

    disk.set(`${ROOT}/.Inbox.md`, '- [ ] Call the bank\n')
    expect(await inboxNote(ROOT)).toBe(`${ROOT}/.Inbox.md`)
    expect(disk.get(`${ROOT}/.Inbox.md`)).toBe('- [ ] Call the bank\n')
    expect(came).toHaveLength(1)
  })

  test('is the note the reader chose, where they chose one, put in the list when made', async () => {
    setInbox(ROOT, 'Lists/Todo.md')
    expect(await inboxNote(ROOT)).toBe(`${ROOT}/Lists/Todo.md`)
    expect([...disk.keys()]).toEqual([`${ROOT}/Lists/Todo.md`])
    expect(listed).toEqual(['tree'])
  })
})
