import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../../versions', () => ({
  versionsOf: () => Promise.resolve([{ at: 1, size: 20, path: null, by: '' }]),
  versionText: () => Promise.resolve('what nobody may read'),
}))

const { workspace } = await import('../../../workspace.svelte')
const { unlocks } = await import('../../../protect/src/unlocked.svelte')
const { appCommands, exportCommands } = await import('../../../commands')
const { appMenu } = await import('../../../app-menu')
const { openTarget } = await import('../../../export/context')
const { settings } = await import('../../../settings.svelte')
const { menu } = await import('../../../menu.svelte')
const { DIVIDER } = await import('../../../ui-kit/src/menu-item')
const History = (await import('../../../History.svelte')).default
type MenuItem = import('../../../ui-kit/src/menu-item').MenuItem

const ROOT = '/space'
const NOTE = `${ROOT}/Diary.md`
const LOCK = { root: ROOT, key: 'Diary.md', way: 'password' as const }

beforeEach(() => {
  workspace.spaces = [{ id: 'space', name: 'Space', root: ROOT }]
  workspace.protection.set(ROOT, NOTE, 'password')
  unlocks.lockAll()
  vi.spyOn(workspace, 'active', 'get').mockReturnValue({
    id: 'diary',
    kind: 'note',
    path: NOTE,
    doc: 'what nobody may read\n\n---\n\nnor this',
    name: 'Diary.md',
    note: { path: NOTE, kind: 'note', text: 'what nobody may read', latest: '' },
  } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  menu.hide()
  unlocks.lockAll()
  workspace.protection.set(ROOT, NOTE, null)
  settings.pandoc = false
})

const rows = (groups: ReturnType<typeof appMenu>): MenuItem[] =>
  groups.flatMap((group) => group.rows).filter((one): one is MenuItem => one !== DIVIDER)

describe('a shut note in front', () => {
  test('offers no export, with Pandoc or without', () => {
    expect(exportCommands().filter((one) => !one.disabled)).toEqual([])
    settings.pandoc = true
    expect(exportCommands().filter((one) => !one.disabled)).toEqual([])
  })

  test('offers neither printing nor its version history', () => {
    const open = appCommands().filter((one) => ['print', 'history'].includes(one.id))
    expect(open.every((one) => one.disabled)).toBe(true)
    const file = rows(appMenu({ view: undefined } as never)).filter((one) =>
      ['Print', 'Version history'].includes(one.label),
    )
    expect(file.map((one) => [one.label, one.disabled])).toEqual([
      ['Print', true],
      ['Version history', true],
    ])
  })

  test('gives its words to nothing that was offered before it shut', () => {
    expect(() => openTarget()).toThrow()
    unlocks.unlock([LOCK])
    expect(openTarget().source).toContain('what nobody may read')
  })

  test('takes away the editor menu that was open when it locked', async () => {
    unlocks.unlock([LOCK])
    const { showEditorMenu } = await import('../../../editor-menu')
    showEditorMenu(new MouseEvent('contextmenu'), undefined, NOTE)
    expect(menu.open).toBe(true)
    unlocks.close([LOCK])
    expect(menu.open).toBe(false)
  })

  test('closes its version history, and reads no version', async () => {
    const target = document.createElement('div')
    document.body.append(target)
    const shown = mount(History, { target, props: { open: true }, intro: false })
    for (let i = 0; i < 5; i++) {
      await new Promise((done) => setTimeout(done, 10))
      flushSync()
    }
    expect(document.body.textContent).not.toContain('what nobody may read')
    expect(document.querySelector('[role=dialog]')).toBeNull()
    void unmount(shown)
    target.remove()
  })
})
