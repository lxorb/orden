import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { type Entry, providePort } from '@orden/contracts'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
  key: () => null,
  length: 0,
  clear: () => held.clear(),
})
const ending = vi.hoisted(() => ({ refuse: false, asked: [] as string[][] }))
vi.mock('../src/services', async (original) => {
  const real = await original<typeof import('../src/services')>()
  return {
    ...real,
    services: () => ({
      ...real.services(),
      mayEnd: (closing: readonly { id: string }[]) => {
        ending.asked.push(closing.map((one) => one.id))
        return Promise.resolve(!ending.refuse)
      },
    }),
  }
})
const { firstVisiting, isHiddenTabs, movingOf, notices, ownerOf, spaceSets, sameName, spacesFor, titleOf, workspace } =
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
describe('another window', () => {
  const MINE = { id: 'mine', name: 'Mine', root: '/notes/Mine' }
  const STAYS = { id: 'stays', name: 'Stays', root: '/notes/Stays' }
  const saved = (key: string): unknown => JSON.parse(localStorage.getItem(key) ?? 'null')
  test('keeps what it wrote when this window writes, the icons and open folders it chose included', () => {
    localStorage.setItem('orden:icons', JSON.stringify({ '/notes/Theirs': 'Book' }))
    localStorage.setItem('orden:expanded', JSON.stringify({ '/notes/Theirs/A': true }))
    workspace.device.setIcon('/notes/Mine', 'Star')
    workspace.device.toggleFolder('/notes/Mine/B')
    expect(saved('orden:icons')).toEqual({ '/notes/Theirs': 'Book', '/notes/Mine': 'Star' })
    expect(saved('orden:expanded')).toEqual({ '/notes/Theirs/A': true, '/notes/Mine/B': true })
    expect(workspace.device.iconOf('/notes/Theirs')).toBe('Book')
    expect(workspace.device.isExpanded('/notes/Theirs/A')).toBe(true)
  })
  test('archiving the space open here moves this window off it', async () => {
    workspace.spaces = [{ ...MINE }, { ...STAYS }]
    await workspace.showSpace(MINE.id)
    workspace.archivedSpaces.set(MINE.root, true)
    await workspace.leaveArchived()
    expect(workspace.activeSpaceId).toBe(STAYS.id)
    expect(workspace.archivedSpaces.has(MINE.root)).toBe(true)
    workspace.archivedSpaces.set(MINE.root, false)
  })
})
describe('the files of every space', () => {
  const HERE = { id: 'f-here', name: 'Here', root: '/files/Here' }
  const THERE = { id: 'f-there', name: 'There', root: '/files/There' }
  const SHUT = { id: 'f-shut', name: 'Shut', root: '/files/Shut' }
  const AWAY = { id: 'f-away', name: 'Away', root: '/files/Away' }
  const row = (path: string, children: Entry[] = []): Entry => ({
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    is_dir: children.length > 0,
    modified: 0,
    created: 0,
    children,
  })
  const listed = () => workspace.spaceFiles.all.map((one) => [one.space.id, one.files.map((file) => file.path)])
  test('lists each space in sight once asked, the open one as its tree changes, and never an archived one', async () => {
    const asked: string[] = []
    const gone = providePort('backend.web', {
      invoke: <T>(command: string, args?: Record<string, unknown>) => {
        if (command !== 'read_tree') return Promise.reject(new Error(`${command} is not here`))
        asked.push(String(args?.root))
        if (args?.root !== THERE.root) return Promise.reject(new Error('no such folder'))
        const trip = `${THERE.root}/Trip/Trip.md`
        return Promise.resolve(
          row(THERE.root, [row(`${THERE.root}/Trip`, [row(trip)]), row(`${THERE.root}/AGENTS.md`)]) as T,
        )
      },
    })
    try {
      workspace.spaces = [{ ...HERE }, { ...THERE }, { ...SHUT }, { ...AWAY }]
      workspace.activeSpaceId = HERE.id
      workspace.archivedSpaces.set(SHUT.root, true)
      workspace.tree = row(HERE.root, [row(`${HERE.root}/Plan.md`)])
      expect(asked).toEqual([])
      workspace.spaceFiles.want()
      await vi.waitFor(() =>
        expect(listed()).toEqual([
          [HERE.id, [`${HERE.root}/Plan.md`]],
          [THERE.id, [`${THERE.root}/Trip/Trip.md`]],
          [AWAY.id, []],
        ]),
      )
      expect(asked.sort()).toEqual([AWAY.root, THERE.root])
      workspace.tree = row(HERE.root, [row(`${HERE.root}/Plan.md`), row(`${HERE.root}/Food.md`)])
      expect(listed()[0]).toEqual([HERE.id, [`${HERE.root}/Plan.md`, `${HERE.root}/Food.md`]])
    } finally {
      workspace.archivedSpaces.set(SHUT.root, false)
      gone()
    }
  })
})
describe('a tab of another space, opened here', () => {
  const ONE = { id: 'h-one', name: 'One', root: '/here/One' }
  const TWO = { id: 'h-two', name: 'Two', root: '/here/Two' }
  test('opens a view of it in the space in sight, a note and a web page alike, and a tab here is only brought forward', async () => {
    workspace.spaces = [{ ...ONE }, { ...TWO }]
    await workspace.showSpace(ONE.id)
    workspace.openBlank('Away', '# Away')
    const note = workspace.active
    workspace.openWebsite()
    const page = workspace.active
    await workspace.showSpace(TWO.id)
    workspace.openBlank('Home', '# Home')
    const home = workspace.active
    if (!note || !page || !home) throw new Error('nothing opened')
    expect([workspace.spaceOfTab(note), workspace.spaceOfTab(page), workspace.spaceOfTab(home)]).toEqual([
      ONE.id,
      ONE.id,
      TWO.id,
    ])
    for (const one of [note, page]) {
      workspace.openHere(one.id)
      expect(workspace.activeSpaceId).toBe(TWO.id)
      expect(workspace.tabHere((tab) => tab.id === workspace.activeTabId)?.note).toBe(one.note)
      expect(workspace.activeTabId).not.toBe(one.id)
      expect(workspace.spaceOfTab(one)).toBe(ONE.id)
    }
    const views = workspace.tabs.length
    workspace.openHere(note.id)
    expect(workspace.tabs).toHaveLength(views)
    workspace.openHere(home.id)
    expect([workspace.activeSpaceId, workspace.activeTabId]).toEqual([TWO.id, home.id])
  })
})
describe('a tab and its twin', () => {
  const SHELL = { kind: 'terminal' as const, words: '', title: 'Shell' }
  function three() {
    workspace.openBlank('One', '')
    workspace.openBlank('Two', '')
    const two = workspace.active
    workspace.openBlank('Three', '')
    if (!two) throw new Error('nothing opened')
    workspace.activate(two.id)
    return two
  }
  test('turn in the same place, active as it was, and turn back to the very same tab', () => {
    const two = three()
    const strip = () => workspace.tabsIn(two.paneId).map((one) => one.id)
    const before = strip()
    const shell = workspace.turn(two.id, SHELL)
    if (!shell) throw new Error('no twin')
    expect(strip()).toEqual(before.map((id) => (id === two.id ? shell.id : id)))
    expect([workspace.activeTabId, shell.kind, shell.name]).toEqual([shell.id, 'terminal', 'Shell'])
    expect(workspace.twinOf(shell.id)).toBe(two)
    expect(workspace.tucked).toContain(two)
    expect(workspace.tabs).not.toContain(two)
    expect(workspace.turn(two.id)).toBeNull()
    expect(workspace.turn(shell.id)).toBe(two)
    expect(strip()).toEqual(before)
    expect(workspace.activeTabId).toBe(two.id)
    expect(workspace.twinOf(two.id)).toBe(shell)
    expect(workspace.tucked).toContain(shell)
    expect(workspace.turn(before[0] ?? '')).toBeNull()
  })
  test('is kept with its tab in the session, and comes back tucked behind it', async () => {
    const two = three()
    const shell = workspace.turn(two.id, { ...SHELL, words: '{"key":"k1"}' })
    if (!shell) throw new Error('no twin')
    workspace.turn(shell.id)
    const written = JSON.parse(JSON.stringify(workspace.layout())) as ReturnType<typeof workspace.layout>
    const { made } = await workspace.built(written)
    const back = made.filter((one) => one.name === 'Two').at(-1)
    if (!back) throw new Error('the tab did not come back')
    const twin = workspace.twinOf(back.id)
    expect([twin?.kind, twin?.name, twin?.doc]).toEqual(['terminal', 'Shell', '{"key":"k1"}'])
    expect(made).not.toContain(twin)
  })
  test('closes with its tab, asked as itself would be, and a no keeps both', async () => {
    const two = three()
    const shell = workspace.turn(two.id, SHELL)
    if (!shell) throw new Error('no twin')
    workspace.turn(shell.id)
    ending.refuse = true
    await workspace.closeMany([two.id])
    expect(ending.asked.at(-1)).toContain(shell.id)
    expect(workspace.tabs).toContain(two)
    expect(workspace.tucked).toContain(shell)
    ending.refuse = false
    await workspace.closeMany([two.id])
    expect(workspace.tabs).not.toContain(two)
    expect(workspace.tucked).not.toContain(shell)
  })
})
describe('an archived space opened to look at', () => {
  const KEPT = { id: 'o-kept', name: 'Kept', root: '/open/Kept' }
  const AWAY = { id: 'o-away', name: 'Away', root: '/open/Away' }
  const ELSE = { id: 'o-else', name: 'Else', root: '/open/Else' }
  const shown = () => workspace.shownSpaces.map((one) => one.id)
  test('is a space like any other while open, stays archived, and is out of sight once left', async () => {
    const { sets } = await spaceSets()
    workspace.spaces = [{ ...KEPT }, { ...AWAY }, { ...ELSE }]
    await workspace.showSpace(AWAY.id)
    workspace.openBlank('Trip', '')
    const trip = workspace.activeTabId ?? ''
    await workspace.showSpace(KEPT.id)
    workspace.openBlank('Plan', '')
    const plan = workspace.activeTabId
    workspace.archivedSpaces.set(AWAY.root, true)
    try {
      await workspace.openArchived(AWAY.id)
      expect([workspace.activeSpaceId, workspace.openedArchived]).toEqual([AWAY.id, AWAY.id])
      expect(shown()).toContain(AWAY.id)
      expect(workspace.archivedSpaces.has(AWAY.root)).toBe(true)
      workspace.archivedSpaces.set(ELSE.root, true)
      await workspace.leaveArchived()
      workspace.activate(trip)
      await sets.reveal(trip)
      expect([workspace.activeSpaceId, workspace.activeTabId]).toEqual([AWAY.id, trip])
      workspace.archivedSpaces.set(ELSE.root, false)
      await workspace.showSpace(KEPT.id)
      expect(workspace.openedArchived).toBeNull()
      expect(shown()).not.toContain(AWAY.id)
      workspace.activate(trip)
      await sets.reveal(trip)
      expect([workspace.activeSpaceId, workspace.activeTabId]).toEqual([KEPT.id, plan])
      workspace.archivedSpaces.set(KEPT.root, true)
      await workspace.leaveArchived()
      expect(workspace.activeSpaceId).toBe(ELSE.id)
    } finally {
      workspace.archivedSpaces.set(KEPT.root, false)
      workspace.archivedSpaces.set(AWAY.root, false)
    }
  })
})
describe("a note's title and its file name", () => {
  test('the title is a first # heading, after any front matter, and nothing else', () => {
    expect(titleOf('# Plan\n\nWords')).toEqual({ from: 2, to: 6, words: 'Plan' })
    expect(titleOf('---\na: 1\n---\n#  Road  \nmore')?.words).toBe('Road')
    expect([titleOf('## Plan\n'), titleOf('Plan\n# Plan'), titleOf('#Plan'), titleOf('# \n')]).toEqual([
      null,
      null,
      null,
      null,
    ])
  })
  test('is the same as a file name it would make', () => {
    expect(sameName('What? Now', 'What Now')).toBe(true)
    expect(sameName('Plan', 'Plan')).toBe(true)
    expect(sameName('Plan', 'Road')).toBe(false)
  })
})
describe('the spaces every window shares', () => {
  const NOTES = { id: 'w-notes', name: 'Notes', root: '/w/Notes' }
  const WORK = { id: 'w-work', name: 'Work', root: '/w/Work' }
  const FRESH = { id: 'w-fresh', name: 'Fresh', root: '/w/Fresh' }
  const shared = () => JSON.parse(localStorage.getItem('orden:spaces') ?? '[]') as { id: string; root: string }[]
  const elsewhere = (spaces: readonly object[]) => localStorage.setItem('orden:spaces', JSON.stringify(spaces))
  function listing(roots: () => readonly { name: string; root: string }[]) {
    return providePort('backend.web', {
      invoke: <T>(command: string, args?: Record<string, unknown>) =>
        command === 'list_spaces'
          ? Promise.resolve(roots().map((one) => ({ name: one.name, path: one.root })) as T)
          : command === 'read_note' && args?.path === '/w/Work/Plan.md'
            ? Promise.resolve('# Plan\n' as T)
            : Promise.reject(new Error(`${command} is not here`)),
    })
  }
  test('a space another window made has its id here too, and keeps it once that window is gone', async () => {
    workspace.spaces = [{ ...NOTES }]
    let listed = [NOTES]
    const gone = listing(() => listed)
    try {
      elsewhere([NOTES, FRESH])
      listed = [NOTES, FRESH]
      await workspace.loadSpaces()
      expect(workspace.spaces.map((one) => one.id)).toEqual([NOTES.id, FRESH.id])
      await workspace.loadSpaces()
      expect(shared().map((one) => one.id)).toEqual([NOTES.id, FRESH.id])
    } finally {
      gone()
    }
  })
  test('the order another window set is followed here, and kept for the next launch', async () => {
    workspace.spaces = [{ ...NOTES }, { ...WORK }, { ...FRESH }]
    const gone = listing(() => [NOTES, WORK, FRESH])
    try {
      elsewhere([FRESH, NOTES, WORK])
      await workspace.loadSpaces()
      expect(workspace.spaces.map((one) => one.id)).toEqual([FRESH.id, NOTES.id, WORK.id])
      workspace.moveSpace(WORK.id, FRESH.id)
      expect(shared().map((one) => one.id)).toEqual([WORK.id, FRESH.id, NOTES.id])
    } finally {
      gone()
    }
  })
  test('a space deleted and put back comes back under the id it had, in every window', async () => {
    workspace.spaces = [{ ...NOTES }, { ...FRESH }]
    let listed = [NOTES, FRESH]
    const gone = listing(() => listed)
    try {
      workspace.spaces = [{ ...NOTES }]
      listed = [NOTES]
      await workspace.loadSpaces()
      listed = [NOTES, FRESH]
      await workspace.loadSpaces()
      expect(workspace.spaces.map((one) => one.id)).toEqual([NOTES.id, FRESH.id])
      expect(shared().map((one) => one.id)).toEqual([NOTES.id, FRESH.id])
    } finally {
      gone()
    }
  })
  test('a space another window renamed keeps its id, its place and the window in it here', async () => {
    const JOB = { ...WORK, name: 'Job', root: '/w/Job' }
    workspace.spaces = [{ ...NOTES }, { ...WORK }]
    workspace.activeSpaceId = WORK.id
    let listed = [NOTES, WORK]
    const gone = listing(() => listed)
    try {
      await workspace.open('/w/Work/Plan.md')
      elsewhere([NOTES, JOB])
      listed = [NOTES, JOB]
      await workspace.fileOps.tell({
        op: 'moved',
        kind: 'space',
        from: WORK.root,
        to: JOB.root,
        root: WORK.root,
        into: JOB.root,
      })
      await workspace.loadSpaces()
      expect(workspace.tabHere((one) => one.path === '/w/Job/Plan.md')).not.toBeNull()
      expect(workspace.spaces.map((one) => [one.id, one.root])).toEqual([
        [NOTES.id, NOTES.root],
        [WORK.id, JOB.root],
      ])
      expect([workspace.activeSpaceId, workspace.activeSpace?.root]).toEqual([WORK.id, JOB.root])
    } finally {
      gone()
    }
  })
})
