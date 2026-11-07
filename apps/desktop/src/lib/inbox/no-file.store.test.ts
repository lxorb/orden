import { beforeEach, describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../../test/disk').Disk | null }))
const asked = vi.hoisted(() => [] as string[])
const shown = vi.hoisted(() => [] as string[])
const INBOX = vi.hoisted(() => '/home/.orden-inbox.md')

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

vi.mock('./start.svelte', () => ({ inboxPath: () => INBOX }))

vi.mock('../views/open', () => ({
  openBuiltin: (builtin: string) => void shown.push(builtin),
}))

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
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('../workspace.svelte')
const { accountInbox } = await import('./account.svelte')
const { toggleTaskAt } = await import('../workspace/note-text')
const { addTask } = await import('../quick-add/write')
const { readIfThere } = await import('../read-if-there')
const { writeFile } = await import('../workspace/write-file')

beforeEach(async () => {
  disk.current?.reset()
  disk.current?.folders.add('/home')
  disk.current?.files.set('/home/Plan.md', '# Plan\n')
  workspace.spaces = [{ id: 'home', name: 'Home', root: '/home' }]
  workspace.activeSpaceId = 'home'
  workspace.tabs = []
  workspace.undone.stack = []
  asked.length = 0
  shown.length = 0
  await workspace.loadTree()
  await accountInbox.write('')
})

const files = () => [...(disk.current?.files.keys() ?? [])]

describe('the account inbox is read and written as records, never as a file', () => {
  test('quick add, ticking, undo and a whole write all reach the records', async () => {
    const landed = await addTask({ text: 'Buy milk', fields: { tags: [], remind: [] } })
    expect(landed?.path).toBe(INBOX)
    expect(await accountInbox.text()).toContain('- [ ] Buy milk')
    expect(await workspace.noteText(INBOX)).toContain('- [ ] Buy milk')
    expect(await readIfThere(INBOX)).toContain('- [ ] Buy milk')

    expect(await toggleTaskAt(workspace, INBOX, 0)).toBe(true)
    expect(await accountInbox.text()).toMatch(/- \[x\] Buy milk/)

    await workspace.undoFileAction()
    expect(await accountInbox.text()).toContain('- [ ] Buy milk')

    await writeFile(INBOX, '- [ ] Buy milk\n- [ ] Call Ana\n')
    expect(await accountInbox.text()).toContain('- [ ] Call Ana')

    expect(asked).toEqual([])
    expect(files().filter((one) => one.includes('inbox'))).toEqual([])
  })

  test('opening it shows the Inbox view and makes no tab', async () => {
    await workspace.open(INBOX)
    expect(shown).toEqual(['inbox'])
    expect(workspace.tabs).toEqual([])
    expect(asked).toEqual([])
  })
})
