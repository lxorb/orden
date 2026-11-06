import { beforeEach, describe, expect, test, vi } from 'vitest'

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const disk = new Map<string, string>()
const unreadable = new Set<string>()

vi.mock('../tauri', async (original) => ({
  ...(await original<typeof import('../tauri')>()),
  isDesktop: true,
  platform: () => 'macos',
  invoke: (command: string, args?: { path?: string }) => {
    if (command === 'path_exists') {
      const at = args?.path ?? ''
      return Promise.resolve(disk.has(at) || unreadable.has(at))
    }
    const held = disk.get(args?.path ?? '')
    if (command === 'read_note' && held !== undefined) return Promise.resolve(held)
    return Promise.reject(new Error('no such note'))
  },
}))

const {
  chosenInbox,
  ensureInbox,
  INBOX,
  inboxes,
  inboxOf,
  isInternalInbox,
  OLD_INBOX,
  setInbox,
  STORAGE_KEY,
} = await import('./inbox')

const ROOT = '/spaces/Work'

beforeEach(() => {
  localStorage.clear()
  disk.clear()
  unreadable.clear()
})

describe('the inbox of a space', () => {
  test("is Orden's own until the reader chooses a note, which is kept only then", () => {
    expect(INBOX).toBe('.Inbox.md')
    expect(isInternalInbox(INBOX)).toBe(true)
    expect(isInternalInbox(OLD_INBOX)).toBe(false)
    expect(inboxOf(ROOT)).toBe(INBOX)
    expect(chosenInbox(ROOT)).toBeNull()

    setInbox(ROOT, 'Capture/Later.md')
    expect(inboxOf(ROOT)).toBe('Capture/Later.md')

    setInbox(ROOT, INBOX)
    expect(inboxOf(ROOT)).toBe(INBOX)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()

    setInbox(ROOT, OLD_INBOX)
    expect(inboxOf(ROOT)).toBe(OLD_INBOX)
    expect(chosenInbox(ROOT)).toBe(OLD_INBOX)
  })

  test('follows its note when it is renamed or its folder moves, and nothing else', () => {
    inboxes.moved?.(`${ROOT}/Inbox.md`, `${ROOT}/Triage.md`, ROOT)
    expect(inboxOf(ROOT)).toBe(INBOX)

    setInbox(ROOT, 'Inbox.md')
    inboxes.moved?.(`${ROOT}/Inbox.md`, `${ROOT}/Triage.md`, ROOT)
    expect(inboxOf(ROOT)).toBe('Triage.md')

    inboxes.moved?.(`${ROOT}/Other.md`, `${ROOT}/Else.md`, ROOT)
    expect(inboxOf(ROOT)).toBe('Triage.md')

    setInbox(ROOT, 'Capture/Triage.md')
    inboxes.moved?.(`${ROOT}/Capture`, `${ROOT}/Desk`, ROOT)
    expect(inboxOf(ROOT)).toBe('Desk/Triage.md')
  })

  test("is Orden's own again once the note chosen for it is deleted or moved to another space", () => {
    setInbox(ROOT, 'Capture/Triage.md')
    inboxes.gone?.(`${ROOT}/Capture/Other.md`, ROOT)
    expect(inboxOf(ROOT)).toBe('Capture/Triage.md')
    inboxes.gone?.(`${ROOT}/Capture`, ROOT)
    expect(inboxOf(ROOT)).toBe(INBOX)

    setInbox(ROOT, 'Triage.md')
    inboxes.gone?.(`${ROOT}/Triage.md`, ROOT)
    expect(chosenInbox(ROOT)).toBeNull()

    setInbox(ROOT, 'Triage.md')
    inboxes.moved?.(`${ROOT}/Triage.md`, '/spaces/Home/Triage.md', ROOT, '/spaces/Home')
    expect(inboxOf(ROOT)).toBe(INBOX)
  })

  test('goes with its space when the space is renamed, and is forgotten with it', () => {
    setInbox(ROOT, 'Triage.md')
    inboxes.spaceMoved?.(ROOT, '/spaces/Job')
    expect(inboxOf('/spaces/Job')).toBe('Triage.md')
    expect(inboxOf(ROOT)).toBe(INBOX)

    inboxes.forget?.('/spaces/Job')
    expect(inboxOf('/spaces/Job')).toBe(INBOX)
  })

  test('is made the first time it is needed, and never over one that is there', async () => {
    const made: string[] = []
    const make = (path: string) => {
      made.push(path)
      disk.set(path, '')
      return Promise.resolve()
    }

    expect(await ensureInbox(ROOT, make)).toBe(`${ROOT}/.Inbox.md`)
    disk.set(`${ROOT}/.Inbox.md`, '- [ ] already here\n')
    expect(await ensureInbox(ROOT, make)).toBe(`${ROOT}/.Inbox.md`)
    expect(made).toEqual([`${ROOT}/.Inbox.md`])
    expect(disk.has(`${ROOT}/Inbox.md`)).toBe(false)
  })

  test('that is there and will not read is refused, never made again over itself', async () => {
    unreadable.add(`${ROOT}/.Inbox.md`)
    const made: string[] = []
    const make = (path: string) => {
      made.push(path)
      return Promise.resolve()
    }

    await expect(ensureInbox(ROOT, make)).rejects.toThrow(/would not read/)
    expect(made).toEqual([])
  })
})
