import { describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../../test/disk').Disk | null }))
const asked = vi.hoisted(() => [] as string[])

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = args?.path
    if (typeof path === 'string' && /(^|[\\/])\.orden-inbox\.md$/.test(path)) {
      asked.push(`${command} ${path}`)
      return Promise.reject(new Error('the account inbox is not a file'))
    }
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

vi.mock('./start.svelte', () => ({ inboxPath: () => '/home/.orden-inbox.md' }))

vi.mock('./account.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('./account.svelte')>()
  const { keptOver } = await import('./store')
  const kept = new Map<string, import('./store').Kept>()
  let cursor = 0
  const accountInbox = new real.AccountInbox(() =>
    Promise.resolve({
      items: () => Promise.resolve([...kept.values()]),
      put: (items: readonly import('./store').Kept[]) =>
        Promise.resolve(
          items.map((one) => {
            const merged = keptOver(kept.get(one.id), one)
            kept.set(one.id, merged)
            return merged
          }),
        ),
      cursor: () => Promise.resolve(cursor),
      keepCursor: (at: number) => {
        cursor = at
        return Promise.resolve()
      },
      clear: () => {
        kept.clear()
        return Promise.resolve()
      },
      close: () => undefined,
    }),
  )
  await accountInbox.opened({ owner: null, server: null, device: 'here' })
  return { ...real, accountInbox }
})

const { Disk, memoryStorage } = await import('../../../test/disk')
const d = new Disk()
disk.current = d
const storage = memoryStorage()
vi.stubGlobal('localStorage', storage)

const HOME = '/home'
const WORK = '/work'

const OLD = {
  [`${HOME}/.Inbox.md`]:
    '- [ ] Call the bank 📅 2026-11-09\n  - [ ] the form\n- [x] Water the plants ✅ 2026-11-01\n\nWords under the to-dos\n',
  [`${HOME}/Inbox.md`]: '- [ ] From the inbox Orden once made\n',
  [`${HOME}/Errands.md`]: '# Errands\n\nWhat to buy.\n\n- [ ] Buy milk\n- [ ] Buy milk\n',
  [`${WORK}/.Inbox.md`]: '- [ ] A work thing\n',
  [`${WORK}/Todo.md`]: '- [ ] Send the report\n\nWords kept in the note\n',
}

d.folders.add(HOME)
d.folders.add(WORK)
for (const [path, text] of Object.entries(OLD)) d.files.set(path, text)
storage.setItem('orden:inbox', JSON.stringify({ [HOME]: 'Errands.md' }))
storage.setItem(
  'orden:item-meta',
  JSON.stringify({
    [HOME]: { items: { 'Errands.md': { 'todo-list': 'yes' } } },
    [WORK]: { items: { 'Todo.md': { inbox: 'yes', 'todo-list': 'yes' } } },
  }),
)

const { workspace } = await import('../workspace.svelte')
const { accountInbox } = await import('./account.svelte')
const { lookAt } = await import('../rows/inbox-moving.svelte')

workspace.spaces = [
  { id: 'home', name: 'Home', root: HOME },
  { id: 'work', name: 'Work', root: WORK },
]
workspace.activeSpaceId = 'home'
await workspace.loadTree()

const todos = async () =>
  (await accountInbox.text())
    .split('\n')
    .filter((line) => /^- \[.\] /.test(line))
    .sort()

const WANTED = [
  '- [ ] A work thing',
  '- [ ] Buy milk',
  '- [ ] Buy milk',
  '- [ ] Call the bank 📅 2026-11-09',
  '- [ ] From the inbox Orden once made',
  '- [ ] Send the report',
  '- [x] Water the plants ✅ 2026-11-01',
]

async function started(): Promise<void> {
  lookAt(HOME)
  lookAt(WORK)
  await vi.waitFor(
    () => {
      expect(d.files.has(`${HOME}/.Inbox.md`)).toBe(false)
      expect(d.files.has(`${WORK}/.Inbox.md`)).toBe(false)
      expect(d.files.get(`${HOME}/Errands.md`)).not.toContain('Buy milk')
      expect(d.files.get(`${WORK}/Todo.md`)).not.toContain('Send the report')
    },
    { timeout: 5000, interval: 20 },
  )
}

describe('a profile from before the account inbox, started on this build', () => {
  test('every to-do of the old inbox files and of the picked inbox note lands once', async () => {
    await started()

    expect(await todos()).toEqual(WANTED)
    const text = await accountInbox.text()
    expect(text).toContain('Words under the to-dos')
    expect(text).toContain('  - [ ] the form')
    expect(d.files.has(`${HOME}/Inbox.md`)).toBe(false)
    expect(d.files.get(`${HOME}/Errands.md`)).toBe('# Errands\n\nWhat to buy.\n\n')
    expect(d.files.get(`${WORK}/Todo.md`)).toContain('Words kept in the note')
    expect(storage.getItem('orden:inbox')).toBeNull()
    expect(workspace.itemMeta.of(`${WORK}/Todo.md`, WORK)).toEqual({ 'todo-list': 'yes' })
    expect(workspace.itemMeta.of(`${HOME}/Errands.md`, HOME)).toEqual({ 'todo-list': 'yes' })
    expect([...d.files.keys()].filter((one) => one.includes('orden-inbox'))).toEqual([])
    expect(asked).toEqual([])
  })

  test('started again, or met by an old device writing the old files back, it makes nothing twice', async () => {
    await accountInbox.write(
      (await accountInbox.text()).replace('- [ ] Call the bank', '- [x] Call the bank'),
    )
    lookAt(HOME)
    lookAt(WORK)
    for (const [path, text] of Object.entries(OLD)) {
      if (path.endsWith('.Inbox.md')) d.files.set(path, text)
    }
    await started()

    const now = await todos()
    expect(now).toHaveLength(WANTED.length)
    expect(now.filter((one) => one.includes('Call the bank'))).toEqual([
      expect.stringMatching(/^- \[x\] Call the bank 📅 2026-11-09/),
    ])
    expect((await accountInbox.text()).match(/Words under the to-dos/g)).toHaveLength(1)
    expect(asked).toEqual([])
  })
})
