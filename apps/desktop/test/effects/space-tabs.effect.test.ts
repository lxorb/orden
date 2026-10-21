import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { root, watch } from './runes.svelte'

/** A space's own tabs, on the real workspace: every space keeps its own (#674), a switch
 *  swaps them in one step, and a tab of a set out of sight comes forward with its space.
 *
 *  In the effects project because the store follows the list of spaces with an effect
 *  (a deleted space takes its set with it), and because "the first frame is the new
 *  set" is a question about what a watcher sees. The disk is a map; see test/disk.ts. */

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

const SPACES = [
  { name: 'Work', path: '/spaces/Work' },
  { name: 'Home', path: '/spaces/Home' },
  { name: 'Uni', path: '/spaces/Uni' },
]

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces') return Promise.resolve(SPACES)
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const { Disk } = await import('../disk')
disk.current = new Disk()

const { workspace } = await import('../../src/lib/workspace.svelte')
// The sets' store, fetched as the app fetches it with the first switch; it follows the
// list of spaces from then on.
await import('../../src/lib/workspace/sets.svelte')
const { pane } = await import('../../src/lib/workspace/pane-tree')

const PLAN = '/spaces/Work/Plan.md'
const IDEAS = '/spaces/Work/Ideas.md'
const FOOD = '/spaces/Home/Food.md'
const NOTES = '/spaces/Work/Notes.md'

/** The names of the tabs on screen, pane by pane, in strip order. */
const onScreen = () =>
  workspace.panes.all.flatMap((one) => workspace.tabsIn(one.id).map((tab) => tab.name))

const tabAt = (path: string) => {
  const found = workspace.tabs.find((tab) => tab.path === path)
  if (!found) throw new Error(`nothing open at ${path}`)
  return found
}

beforeEach(async () => {
  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  one.files.set(PLAN, '# Plan\n')
  one.files.set(IDEAS, '# Ideas\n')
  one.files.set(FOOD, '# Food\n')
  one.files.set(NOTES, '# Notes\n')

  workspace.spaces = [
    { id: 'work', name: 'Work', root: '/spaces/Work' },
    { id: 'home', name: 'Home', root: '/spaces/Home' },
    { id: 'uni', name: 'Uni', root: '/spaces/Uni' },
  ]
  // Back in Work, then nothing open in any space: every tab of every set is in the one
  // strip, and a set left with none comes back as one empty pane.
  await workspace.showSpace('work')
  for (const tab of [...workspace.tabs]) workspace.close(tab.id, false)
  const first = pane('first')
  workspace.panes.restore(first, first.id)
  await workspace.loadTree()
  flushSync()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('every space', () => {
  test('keeps its own tabs, and shows them again when it is shown', async () => {
    await workspace.openEntry(PLAN)
    await workspace.showSpace('home')
    expect(onScreen()).toEqual([])
    await workspace.openEntry(FOOD)
    expect(onScreen()).toEqual(['Food.md'])

    await workspace.showSpace('work')
    expect(onScreen()).toEqual(['Plan.md'])
    expect(workspace.active?.path).toBe(PLAN)

    await workspace.showSpace('home')
    expect(onScreen()).toEqual(['Food.md'])
  })

  test('a space never shown starts with an empty pane', async () => {
    await workspace.openEntry(PLAN)
    await workspace.showSpace('uni')

    expect(onScreen()).toEqual([])
    expect(workspace.panes.count).toBe(1)
    // Nothing closed: Plan is in Work's set, out of sight.
    expect(workspace.tabs.map((tab) => tab.name)).toEqual(['Plan.md'])
  })

  test('comes back arranged as it was left: panes, focus and the tab in front', async () => {
    await workspace.openEntry(PLAN)
    await workspace.openEntry(IDEAS)
    workspace.split('row', tabAt(IDEAS).id)
    const focused = workspace.panes.focusedId
    const front = workspace.activeTabId

    await workspace.showSpace('home')
    expect(workspace.panes.count).toBe(1)

    await workspace.showSpace('work')
    expect(workspace.panes.count).toBe(2)
    expect(workspace.panes.focusedId).toBe(focused)
    expect(workspace.activeTabId).toBe(front)
  })

  /** Emil, 2026-10-03: a space switched away from and back came back on another note.
   *  Every pane's tab in front, the pane the keyboard was in and a pane put down with
   *  Ctrl+D, each exactly as left - with several tabs to a pane, the one in front not
   *  the last opened, and the focus in the first pane rather than the newest. */
  test('comes back exactly: each pane’s tab in front, the focused pane, a pane put down', async () => {
    for (const path of [PLAN, IDEAS, NOTES]) await workspace.openEntry(path)
    workspace.split('row', tabAt(NOTES).id)
    const [left, right] = workspace.panes.all
    if (!left || !right) throw new Error('no split')
    workspace.activate(tabAt(PLAN).id)
    const fronts = () => workspace.panes.all.map((one) => workspace.showing(one.id)?.name ?? null)
    expect(fronts()).toEqual(['Plan.md', 'Notes.md'])
    expect(workspace.panes.focusedId).toBe(left.id)

    for (const way of ['showSpace', 'selectSpace'] as const) {
      await workspace[way]('home')
      await workspace.openEntry(FOOD)
      await workspace[way]('work')
      expect(fronts(), way).toEqual(['Plan.md', 'Notes.md'])
      expect(workspace.panes.focusedId, way).toBe(left.id)
    }

    workspace.deselect(right.id)
    await workspace.showSpace('home')
    await workspace.showSpace('work')
    expect(fronts()).toEqual(['Plan.md', null])
    expect(workspace.panes.focusedId).toBe(left.id)
  })

  test('the first state anything sees after a switch is the new set, whole', async () => {
    await workspace.openEntry(PLAN)
    await workspace.showSpace('home')
    await workspace.openEntry(FOOD)
    await workspace.showSpace('work')
    flushSync()

    const seen: string[] = []
    const stop = root(() => {
      watch(() => {
        seen.push(`${String(workspace.activeSpaceId)}: ${onScreen().join(', ')}`)
      })
    })
    flushSync()

    await workspace.showSpace('home')
    flushSync()
    await workspace.showSpace('work')
    flushSync()
    stop()

    expect(seen).toEqual(['work: Plan.md', 'home: Food.md', 'work: Plan.md'])
  })
})

describe('what is open in a set out of sight', () => {
  test('a tab of it brought to the front brings its space', async () => {
    await workspace.openEntry(PLAN)
    await workspace.showSpace('home')
    const plan = tabAt(PLAN)

    workspace.activate(plan.id)
    await vi.waitFor(() => expect(workspace.activeSpaceId).toBe('work'))
    await vi.waitFor(() => expect(workspace.activeTabId).toBe(plan.id))
  })

  test('opening it again goes to where it is, and makes no second tab', async () => {
    await workspace.openEntry(PLAN)
    await workspace.showSpace('home')

    await workspace.openEntry(PLAN)
    await vi.waitFor(() => expect(workspace.activeSpaceId).toBe('work'))
    expect(workspace.tabs.filter((tab) => tab.path === PLAN)).toHaveLength(1)
  })

  test('a deleted space takes its set with it', async () => {
    await workspace.openEntry(PLAN)
    workspace.openBlank()
    await workspace.showSpace('home')
    expect(workspace.tabs).toHaveLength(2)

    workspace.spaces = workspace.spaces.filter((one) => one.id !== 'work')
    flushSync()
    expect(workspace.tabs).toHaveLength(0)
  })
})

describe('the session', () => {
  test('writes the set on screen and every set put aside', async () => {
    await workspace.openEntry(PLAN)
    await workspace.showSpace('home')
    await workspace.openEntry(FOOD)
    workspace.persist()

    const written = JSON.parse(localStorage.getItem('nib:workspace') ?? '{}') as {
      sets?: { on: string; aside: Record<string, { layout: { frame: unknown } }> }
    }
    expect(written.sets?.on).toBe('home')
    expect(JSON.stringify(written.sets?.aside.work?.layout.frame)).toContain(PLAN)
    expect(JSON.stringify(written.sets?.aside.work?.layout.frame)).not.toContain(FOOD)
  })
})
