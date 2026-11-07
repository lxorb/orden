import { expect, test, vi } from 'vitest'

const ROOT = '/spaces/Work'
const INBOX = `${ROOT}/.Inbox.md`
const TASK = '- [ ] Call the bank\n'

const shared = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  writes: [] as string[],
  reading: [] as (() => void)[],
  turn: Promise.resolve<unknown>(undefined),
}))

const kept = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  removeItem: (key: string) => void kept.delete(key),
  clear: () => kept.clear(),
})

vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))
vi.mock('../link-index.svelte', () => ({ links: { noteSaved: () => undefined } }))
vi.mock('../workspace.svelte', () => ({
  workspace: { loadTree: () => Promise.resolve(), fileCame: () => Promise.resolve() },
}))
vi.mock('../windows', () => ({
  windows: { alone: true, say: () => undefined },
  oneWriteAt: <T>(_path: string, run: () => Promise<T>) => {
    const going = shared.turn.then(run)
    shared.turn = going.catch(() => undefined)
    return going
  },
}))
vi.mock('../tauri', async (original) => ({
  ...(await original<typeof import('../tauri')>()),
  invoke: async (command: string, args: { path?: string; content?: string } = {}) => {
    const path = args.path ?? ''
    if (command === 'read_note') {
      await new Promise<void>((go) => {
        shared.reading.push(go)
        if (shared.reading.length === 2) for (const one of shared.reading) one()
      })
      const held = shared.disk.get(path)
      if (held === undefined) throw new Error('no such note')
      return held
    }
    if (command === 'path_exists') return shared.disk.has(path)
    if (command === 'write_note') {
      shared.writes.push(args.content ?? '')
      shared.disk.set(path, args.content ?? '')
      if (shared.writes.length === 1) shared.disk.set(path, TASK)
      return null
    }
    return null
  },
}))

async function aWindow() {
  vi.resetModules()
  return (await import('./inbox-note')).inboxNote
}

test('two windows making the inbox at once make it once, so a task the first wrote stays', async () => {
  const first = await aWindow()
  const second = await aWindow()

  const [one, two] = await Promise.all([first(ROOT), second(ROOT)])

  expect(one).toBe(INBOX)
  expect(two).toBe(INBOX)
  expect(shared.writes).toEqual([''])
  expect(shared.disk.get(INBOX)).toBe(TASK)
})
