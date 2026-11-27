import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { chatsEnding, portProvided, type PortName, showQuickAdd } from '@orden/contracts'
import { leftOut } from '../app-build'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
const LIB = join(fileURLToPath(new URL('..', import.meta.url)), 'src', 'lib')
const WHOLE: readonly PortName[] = [
  'chats',
  'chats.demo',
  'chats.places',
  'terminal.going',
  'terminal.judge',
  'terminal.lines',
  'terminal.making',
  'explorer.show',
  'explorer.carry',
  'quit.terminal',
  'web.lending',
  'web.sites',
  'quick-add.show',
]
await import('../src/lib/chat-ports')
await import('../src/lib/terminal-ports')
await import('../src/lib/quit-ports')
await import('../src/lib/workspace-ports')
const { removeAsking } = await import('../src/lib/row-menu/src/row-menu')
const { workspace } = await import('../src/lib/workspace/src/api')
const { services } = await import('../src/lib/workspace/src/services')
type Entry = import('../src/lib/workspace/src/api').Entry
const entry = (path: string, children?: Entry[]): Entry => ({
  name: path.split('/').pop() ?? path,
  path,
  is_dir: children !== undefined,
  modified: 0,
  created: 0,
  children: children ?? [],
})
beforeEach(() => {
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/s' }]
  workspace.activeSpaceId = 's'
  workspace.tree = entry('/s', [entry('/s/Trip', [entry('/s/Trip/Plans.chat'), entry('/s/Trip/Notes.md')])])
})
describe('an app that leaves a part of Orden out (#2286)', () => {
  test('provides none of that part’s ports, so every reader takes its own answer for nothing here', () => {
    for (const name of WHOLE) expect(portProvided(name), name).toBe(false)
  })
  test('deletes a folder with a chat in it without asking, and ends no chat', async () => {
    const removing = vi.spyOn(workspace, 'removeMany').mockResolvedValue(undefined)
    await removeAsking(['/s/Trip'])
    expect(removing).toHaveBeenCalledWith(['/s/Trip'])
    removing.mockRestore()
    const ended = await chatsEnding(['/s/Trip/Plans.chat'])
    expect(ended).not.toThrow()
  })
  test('moves a note between spaces with no chat to carry and nothing to undo for one', async () => {
    const back = await services().chatsCarried('/s/Trip/Notes.md', '/other')
    await expect(back()).resolves.toBeUndefined()
  })
  test('closes tabs with no terminal to ask, and has nothing outside its spaces to undo', async () => {
    await expect(services().mayEnd([])).resolves.toBe(true)
    await expect(services().terminalMoved('', null, '/s')).resolves.toBeUndefined()
    await expect(
      services().undoOutside({ kind: 'outside' } as Parameters<ReturnType<typeof services>['undoOutside']>[0]),
    ).resolves.toBeUndefined()
  })
  test('opens a note that names a website as the note it is, and keeps no site apart', async () => {
    const { sites } = services()
    await expect(sites.asShortcut(workspace, '/s/Trip/Notes.md')).resolves.toBe(null)
    await expect(sites.webUrlOf('---\nurl: https://example.com\n---\n')).resolves.toBe(null)
    await expect(sites.convertWebsites(workspace)).resolves.toBe(0)
    await expect(sites.heldElsewhere('/s/Trip/Notes.md')).resolves.toBe(false)
  })
  test('has no terminal to stop before quitting and none to preview', async () => {
    const { rowsHere } = await import('../src/lib/quitting/src/rows')
    const { scrollbackOf } = await import('../src/lib/overview/src/previews')
    await expect(rowsHere('main', true)).resolves.toEqual([])
    await expect(scrollbackOf({ id: 't', doc: '', note: {} } as Parameters<typeof scrollbackOf>[0])).resolves.toBe(null)
  })
  test('refuses to list, add or change a todo for a reader, and still answers for a base', async () => {
    const { tasksReader } = await import('../src/lib/reader-verbs/src/reader')
    for (const verb of ['listTasks', 'addTask', 'updateTask'] as const)
      await expect(tasksReader[verb]({ title: 'Milk' }), verb).rejects.toMatchObject({ code: 'not_granted' })
  })
  test('shows no quick add for a todo', () => {
    expect(() => showQuickAdd({})).not.toThrow()
  })
  test('follows a chat link nowhere', async () => {
    const { followHref } = await import('../src/lib/workspace/src/open-link')
    const opening = vi.spyOn(workspace, 'openPage')
    followHref('orden://chat/abc', { button: 0, shiftKey: false, ctrlKey: false, metaKey: false })
    expect(opening).not.toHaveBeenCalled()
    opening.mockRestore()
  })
  test('gives those ports only in the whole Orden, behind the build constant', () => {
    const guarded = (file: string, port: string) => {
      const text = readFileSync(join(LIB, file), 'utf8')
      const at = text.indexOf(`providePort('${port}'`)
      expect(at, port).toBeGreaterThan(0)
      const before = text.slice(0, at)
      const opened = before.lastIndexOf("if (__ORDEN_APP__ === 'orden')")
      expect(opened, port).toBeGreaterThan(-1)
      expect(/^\}/m.test(before.slice(opened)), port).toBe(false)
    }
    for (const port of ['chats', 'chats.demo', 'chats.places', 'web.lending']) guarded('chat-ports.ts', port)
    for (const port of ['terminal.previews', 'terminal.making', 'terminal.judge', 'terminal.going', 'terminal.lines'])
      guarded('terminal-ports.ts', port)
    for (const port of ['explorer.show', 'explorer.carry', 'web.sites']) guarded('features.ts', port)
    guarded('quit-ports.ts', 'quit.terminal')
    guarded('features.ts', 'quick-add.show')
  })
  test('still forgets the secrets of the chat services gone, as the whole Orden does', async () => {
    const start = readFileSync(join(LIB, 'start.ts'), 'utf8')
    expect(start).toContain("\n  void startup\n    .turn('right')\n    .then(() => retireChats())\n")
    const { retireChats } = await import('../src/lib/accounts/src/api')
    expect(typeof (await retireChats()).forgetRetiredChatsHere).toBe('function')
  })
  test('is named in the one list the build and the guard both read', () => {
    const config = readFileSync(join(LIB, '..', '..', 'vite.config.ts'), 'utf8')
    expect(config).toContain('leftOut(app)')
    expect(config).toContain('this app leaves these modules out, yet')
    expect(leftOut('notes').length).toBeGreaterThan(5)
  })
})
