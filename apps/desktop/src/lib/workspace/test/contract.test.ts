import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { providePort } from '@orden/contracts'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
  key: () => null,
  length: 0,
  clear: () => held.clear(),
})
const { firstVisiting, isHiddenTabs, movingOf, notices, ownerOf, spaceSets, spacesFor, workspace } =
  await import('../src/api')
const HERE = join(import.meta.dirname, '..')
const LIB = join(HERE, '..')
const own = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as {
  dependsOn: string[]
  pending?: string[]
}
function layerOf(name: string): string | null {
  const file = join(LIB, name, 'module.json')
  if (!existsSync(file)) return null
  return (JSON.parse(readFileSync(file, 'utf8')) as { layer: string }).layer
}
describe('the module stands on its own', () => {
  test('it leans on no content or feature module, which reach it through its services instead', () => {
    const above = own.dependsOn.filter((name) => {
      const layer = layerOf(name)
      return layer !== null && layer !== 'foundation' && layer !== 'shell'
    })
    expect(above).toEqual([])
  })
})
describe('the workspace', () => {
  test('a blank note opens as the active tab, beside the ones already open', () => {
    workspace.openBlank('Plan', '# Plan')
    const first = workspace.active
    workspace.openBlank('Notes', '# Notes')
    const second = workspace.active
    expect([first?.name, second?.name]).toEqual(['Plan', 'Notes'])
    expect(workspace.activeTabId).toBe(second?.id)
    expect(workspace.tabs.map((one) => one.id)).toEqual(expect.arrayContaining([first?.id, second?.id]))
  })
})
describe('its notices', () => {
  test('open through a door, and a failure told lingers until it is retried or dismissed', async () => {
    const { failed, gateNote } = await notices()
    let retried = 0
    failed.tell(() => retried++)
    expect(failed.retry).not.toBe(null)
    failed.again()
    expect(retried).toBe(1)
    expect(failed.retry).toBe(null)
    gateNote.show('Turned off')
    expect(gateNote.said).toBe('Turned off')
    gateNote.dismiss()
    expect(gateNote.said).toBe(null)
  })
  test('the first visit is fresh only once seeded and until it is answered', async () => {
    const { firstVisit } = await firstVisiting()
    expect(firstVisit.fresh).toBe(false)
    firstVisit.seeded()
    expect(firstVisit.fresh).toBe(true)
    firstVisit.answered()
    expect(firstVisit.fresh).toBe(false)
    firstVisit.seeded()
    expect(firstVisit.fresh).toBe(false)
  })
})
describe('where tabs may move', () => {
  const spaces = [
    { id: 'home', name: 'Home', root: '/notes/Home' },
    { id: 'work', name: 'Work', root: '/notes/Work' },
  ]
  const tab = (path: string | null) => movingOf({ path, note: { home: null, shared: null } })
  test('a file in one space is offered every other space it may be written to', () => {
    const where = { spaces, activeSpaceId: 'home' }
    expect(spacesFor([tab('/notes/Home/a.md')], where, () => true).map((one) => one.id)).toEqual(['work'])
  })
  test('nowhere, when the file itself may not be written', () => {
    const where = { spaces, activeSpaceId: 'home' }
    const writable = (path: string) => !path.endsWith('a.md')
    expect(spacesFor([tab('/notes/Home/a.md')], where, writable)).toEqual([])
  })
  test('nowhere, with only one space', () => {
    expect(
      spacesFor([tab('/notes/Home/a.md')], { spaces: spaces.slice(0, 1), activeSpaceId: 'home' }, () => true),
    ).toEqual([])
  })
  test('a path belongs to the space whose folder holds it, a tab without one to its home', () => {
    expect(ownerOf('/notes/Work/b.md', null, spaces)).toBe('work')
    expect(ownerOf('/elsewhere/b.md', null, spaces)).toBeNull()
    expect(ownerOf(null, 'home', spaces)).toBe('home')
  })
})
describe('the hidden tabs choice', () => {
  test('hidden tabs run, pause or ask, and nothing else', () => {
    expect(['run', 'pause', 'ask', 'sleep', 1].map(isHiddenTabs)).toEqual([true, true, true, false, false])
  })
})
describe('an archived space', () => {
  const OLD = { id: 'old', name: 'Old', root: '/notes/Old' }
  const WORK = { id: 'work', name: 'Work', root: '/notes/Work' }
  const ids = () => workspace.shownTabs.map((one) => one.id)
  test('keeps its tabs out of sight: choosing one leaves the window where it is, until it is unarchived', async () => {
    const { sets } = await spaceSets()
    workspace.spaces = [{ ...WORK }, { ...OLD }]
    await workspace.showSpace(OLD.id)
    workspace.openBlank('Trip', '# Trip')
    const trip = workspace.activeTabId ?? ''
    await workspace.showSpace(WORK.id)
    workspace.openBlank('Plan', '# Plan')
    const plan = workspace.activeTabId
    expect(ids()).toEqual(expect.arrayContaining([trip, plan]))
    workspace.archivedSpaces.set(OLD.root, true)
    expect(ids()).toContain(plan)
    expect(ids()).not.toContain(trip)
    workspace.activate(trip)
    await sets.reveal(trip)
    await vi.dynamicImportSettled()
    await new Promise((done) => setTimeout(done))
    expect([workspace.activeSpaceId, workspace.activeTabId]).toEqual([WORK.id, plan])
    workspace.archivedSpaces.set(OLD.root, false)
    expect(ids()).toContain(trip)
    workspace.activate(trip)
    await sets.reveal(trip)
    expect([workspace.activeSpaceId, workspace.activeTabId]).toEqual([OLD.id, trip])
  })
})
describe('the tab here', () => {
  const HOME = { id: 'home', name: 'Home', root: '/notes/Home' }
  const AWAY = { id: 'away', name: 'Away', root: '/notes/Away' }
  test('is one of the space in sight, never one another space holds', async () => {
    workspace.spaces = [{ ...HOME }, { ...AWAY }]
    await workspace.showSpace(AWAY.id)
    workspace.openBlank('Away note', '# Away')
    const away = workspace.activeTabId
    await workspace.showSpace(HOME.id)
    workspace.openBlank('Home note', '# Home')
    const home = workspace.activeTabId
    const either = (one: { id: string }) => one.id === away || one.id === home
    expect(workspace.tabHere(either)?.id).toBe(home)
    expect(workspace.tabHere((one) => one.id === away)).toBeNull()
    await workspace.showSpace(AWAY.id)
    expect(workspace.tabHere(either)?.id).toBe(away)
  })
})
describe('opening a note another space holds', () => {
  const ONE = { id: 'one', name: 'One', root: '/notes/One' }
  const TWO = { id: 'two', name: 'Two', root: '/notes/Two' }
  const PATH = '/notes/One/Plan.md'
  const here = () => workspace.tabHere((one) => one.path === PATH)
  test('opens it in the space in sight, and leaves the other its own tab, archived or not', async () => {
    const gone = providePort('backend.web', {
      invoke: <T>(command: string, args?: Record<string, unknown>) =>
        command === 'read_note' && args?.path === PATH
          ? Promise.resolve('# Plan\n' as T)
          : Promise.reject(new Error(`${command} is not here`)),
    })
    try {
      workspace.spaces = [{ ...ONE }, { ...TWO }]
      await workspace.showSpace(ONE.id)
      await workspace.open(PATH)
      const first = here()
      expect(first?.path).toBe(PATH)
      await workspace.showSpace(TWO.id)
      expect(here()).toBeNull()
      await workspace.open(PATH)
      const second = here()
      expect([workspace.activeSpaceId, workspace.activeTabId]).toEqual([TWO.id, second?.id])
      expect(second?.note).toBe(first?.note)
      expect(second?.id).not.toBe(first?.id)
      expect(workspace.tabs).toContain(first)
      workspace.closeEach([second?.id ?? ''], false)
      workspace.archivedSpaces.set(ONE.root, true)
      await workspace.open(PATH)
      expect(workspace.activeSpaceId).toBe(TWO.id)
      expect(workspace.activeTabId).toBe(here()?.id)
      expect(workspace.tabs).toContain(first)
    } finally {
      workspace.archivedSpaces.set(ONE.root, false)
      gone()
    }
  })
})
describe('a chat', () => {
  const ROOT = '/notes/Talk'
  const PLAN = `${ROOT}/Plan.md`
  const TEAM = `${ROOT}/Team.chat`
  const row = (path: string) => ({
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    is_dir: false,
    modified: 0,
    created: 0,
    children: [],
  })
  test('never reaches a note surface, and showing it opens Chats', () => {
    workspace.spaces = [{ id: 'talk', name: 'Talk', root: ROOT }]
    workspace.activeSpaceId = 'talk'
    workspace.tree = { ...row(ROOT), name: 'Talk', is_dir: true, children: [row(PLAN), row(TEAM)] }
    expect(workspace.shownFiles.map((one) => one.path)).toEqual([PLAN])
    expect(workspace.shownTree?.children.map((one) => one.path)).toEqual([PLAN])
    workspace.device.recent = [TEAM, PLAN]
    expect(workspace.recent).toEqual([PLAN])
    workspace.revealNote(TEAM)
    expect([workspace.panel, workspace.rightPanel]).toContain('chats')
    expect(workspace.revealing).not.toBe(TEAM)
  })
})
