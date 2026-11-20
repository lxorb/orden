import { beforeEach, describe, expect, test, vi } from 'vitest'
import { scanNote, scanShortcut } from '@orden/scan/note'
import { memoryStorage } from '../../../../test/disk'

const KEPT = 'data:image/png;base64,iVBORw0KGgo='
const CHAT = 'c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e'
const SHORTCUT = '[InternetShortcut]\r\nURL=https://docs.dev/\r\nTitle=Docs\r\nOrden-Added=2026-01-01T00:00:00.000Z\r\n'
const SPACE: Record<string, string> = {
  '/space/Docs.url': `${SHORTCUT}Orden-Chosen-Icon=site:a.dev\r\n`,
  '/space/Away.url': `${SHORTCUT}Orden-Chosen-Icon=site:gone.dev\r\n`,
  '/space/Starred.md': '---\nicon: rocket\n---\n\n# Starred\n',
  '/space/Team.chat': `{"v":1,"chat":"${CHAT}","icon":"site:a.dev"}\n`,
  '/space/Server.term': '{"v":1,"machine":"m_1","session":"s_1","icon":"site:a.dev"}\n',
  '/space/Plain.chat': `{"v":1,"chat":"${CHAT}"}\n`,
}
let notes: Record<string, string> = { ...SPACE }
const pathOf = (args?: Record<string, unknown>) => (typeof args?.path === 'string' ? args.path : '')
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = pathOf(args)
    if (command === 'scan_links') {
      const held = Object.keys(notes).map((one) => one.slice('/space/'.length))
      return {
        notes: held.flatMap((one) => {
          const text = notes[`/space/${one}`] ?? ''
          if (one.endsWith('.md')) return [scanNote(one, text)]
          return one.endsWith('.url') ? [scanShortcut(one, text)] : []
        }),
        files: held.filter((one) => !/\.(md|chat|term)$/.test(one)),
      }
    }
    if (command === 'write_note') {
      notes[path] = typeof args?.content === 'string' ? args.content : ''
      return undefined
    }
    if (command !== 'read_note') return undefined
    const doc = notes[path]
    if (doc === undefined) throw new Error(`no such note: ${path}`)
    return doc
  },
}))
vi.mock('../../sync-store/src/api', () => ({ sync: { pushIcon: () => Promise.resolve() } }))
vi.stubGlobal('localStorage', memoryStorage())
const { keepWebIcons } = await import('./web-icons')
const { workspace } = await import('../../workspace/src/api')
const { links } = await import('../../link-index/src/api')
const { startup } = await import('../../launch/src/api')
const { ICON_KEY } = await import('../../ui-kit/src/api')
void startup.shown()
const asked: string[] = []
const keep = (site: string) => {
  asked.push(site)
  return Promise.resolve(site === 'a.dev' ? KEPT : null)
}
async function scanned() {
  const at = (path: string) => ({
    name: path.split('/').pop() ?? path,
    path,
    is_dir: false,
    modified: 0,
    created: 0,
    children: [],
  })
  workspace.tree = {
    name: 'space',
    path: '/space',
    is_dir: true,
    modified: 0,
    created: 0,
    children: Object.keys(notes).map(at),
  }
  await links.build('/space')
}
async function fresh() {
  notes = { ...SPACE }
  asked.length = 0
  workspace.spaces = [
    { id: 's', name: 'space', root: '/space' },
    { id: 'o', name: 'other', root: '/other' },
  ]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  workspace.itemMeta.forget('/space')
  workspace.folderIcons.forget('/space')
  workspace.applyIcon('/space', 'site:a.dev', null)
  workspace.applyIcon('/other', 'site:gone.dev', null)
  workspace.itemMeta.set('/space/notes/Plan.md', { [ICON_KEY]: 'site:a.dev' })
  workspace.itemMeta.set('/space/notes/Kept.md', { [ICON_KEY]: 'anchor' })
  workspace.folderIcons.set('/space/Work', 'site:a.dev')
  workspace.folderIcons.set('/space/Home', 'house')
  await scanned()
}
beforeEach(fresh)
describe('web icons chosen before they were kept (#2257)', () => {
  test('are kept as pictures wherever they are worn, asking for each site once', async () => {
    expect(await keepWebIcons('/space', keep)).toBe(false)
    expect(asked.sort()).toEqual(['a.dev', 'gone.dev'])
    expect(workspace.iconFor('s')).toBe(KEPT)
    expect(workspace.itemMeta.of('/space/notes/Plan.md')?.[ICON_KEY]).toBe(KEPT)
    expect(workspace.folderIcons.iconOf('/space/Work')).toBe(KEPT)
    expect(notes['/space/Docs.url']).toContain(`Orden-Chosen-Icon=${KEPT}\r\n`)
    expect(notes['/space/Docs.url']).not.toContain('site:')
    expect(JSON.parse(notes['/space/Team.chat'] ?? '')).toEqual({ v: 1, chat: CHAT, icon: KEPT })
    expect(JSON.parse(notes['/space/Server.term'] ?? '')).toEqual({
      v: 1,
      machine: 'm_1',
      session: 's_1',
      icon: KEPT,
    })
  })
  test('stay as they were while the site has no picture to keep, and every other icon is left alone', async () => {
    await keepWebIcons('/space', keep)
    expect(workspace.iconFor('o')).toBe('site:gone.dev')
    expect(notes['/space/Away.url']).toBe(SPACE['/space/Away.url'])
    expect(notes['/space/Starred.md']).toBe(SPACE['/space/Starred.md'])
    expect(notes['/space/Plain.chat']).toBe(SPACE['/space/Plain.chat'])
    expect(workspace.itemMeta.of('/space/notes/Kept.md')?.[ICON_KEY]).toBe('anchor')
    expect(workspace.folderIcons.iconOf('/space/Home')).toBe('house')
  })
  test('are done once every site had a picture', async () => {
    workspace.applyIcon('/other', null, null)
    notes['/space/Away.url'] = SHORTCUT
    await scanned()
    expect(await keepWebIcons('/space', keep)).toBe(true)
    asked.length = 0
    expect(await keepWebIcons('/space', keep)).toBe(true)
    expect(asked).toEqual([])
  })
  test('are not done for a space no longer in sight, whose files were never read', async () => {
    workspace.applyIcon('/space', null, null)
    workspace.applyIcon('/other', null, null)
    workspace.itemMeta.forget('/space')
    workspace.folderIcons.forget('/space')
    notes = { ...SPACE, '/space/Away.url': SHORTCUT }
    await scanned()
    workspace.activeSpaceId = 'o'
    expect(await keepWebIcons('/space', keep)).toBe(false)
    expect(notes['/space/Team.chat']).toBe(SPACE['/space/Team.chat'])
    workspace.activeSpaceId = 's'
    await scanned()
    await keepWebIcons('/space', keep)
    expect(JSON.parse(notes['/space/Team.chat'] ?? '')).toEqual({ v: 1, chat: CHAT, icon: KEPT })
  })
  test('ask for no site at all where none is worn', async () => {
    workspace.applyIcon('/space', null, null)
    workspace.applyIcon('/other', null, null)
    workspace.itemMeta.forget('/space')
    workspace.folderIcons.forget('/space')
    notes = { '/space/Starred.md': SPACE['/space/Starred.md'] ?? '' }
    await scanned()
    expect(await keepWebIcons('/space', keep)).toBe(true)
    expect(asked).toEqual([])
  })
})
