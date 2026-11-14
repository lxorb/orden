import { flushSync } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))
const histories = vi.hoisted(() => [] as string[])

const SPACES = [
  { name: 'Work', path: '/spaces/Work' },
  { name: 'Home', path: '/spaces/Home' },
  { name: 'Uni', path: '/spaces/Uni' },
]

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces') return Promise.resolve(SPACES)
    if (command.startsWith('terminal_history')) {
      histories.push(`${command.slice('terminal_history_'.length)} ${String(args?.space)}`)
      return Promise.resolve(null)
    }
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const { Disk } = await import('../disk')
disk.current = new Disk()

const { workspace } = await import('../../src/lib/workspace.svelte')
await import('../../src/lib/workspace/sets.svelte')
const { pane } = await import('../../src/lib/workspace/pane-tree')
const { moveToSpace } = await import('../../src/lib/workspace/moving-space')
const { written } = await import('../../src/lib/parting')

const PLAN = '/spaces/Work/Plan.md'
const IDEAS = '/spaces/Work/Ideas.md'
const FOOD = '/spaces/Home/Food.md'

const onScreen = () =>
  workspace.panes.all.flatMap((one) => workspace.tabsIn(one.id).map((tab) => tab.name))

const tabAt = (path: string) => {
  const found = workspace.tabs.find((tab) => tab.path === path)
  if (!found) throw new Error(`nothing open at ${path}`)
  return found
}

const blank = (words: string) => {
  workspace.openBlank()
  const draft = workspace.tabs.at(-1)
  if (!draft) throw new Error('no draft')
  draft.note.live.replace(words)
  return draft
}

const files = () => {
  if (!disk.current) throw new Error('no disk')
  return disk.current.files
}

beforeEach(async () => {
  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  one.files.set(PLAN, '# Plan\n')
  one.files.set(IDEAS, '# Ideas\n')
  one.files.set(FOOD, '# Food\n')
  histories.length = 0

  workspace.spaces = [
    { id: 'work', name: 'Work', root: '/spaces/Work' },
    { id: 'home', name: 'Home', root: '/spaces/Home' },
    { id: 'uni', name: 'Uni', root: '/spaces/Uni' },
  ]
  await workspace.showSpace('work')
  for (const tab of [...workspace.tabs]) workspace.close(tab.id, false)
  const first = pane('first')
  workspace.panes.restore(first, first.id)
  await workspace.loadTree()
  flushSync()
})

describe('a tab moved to another space', () => {
  test('leaves the strip, is in front of that space’s, and the window stays where it is', async () => {
    await workspace.openEntry(PLAN)
    await workspace.openEntry(IDEAS)
    const ideas = tabAt(IDEAS)

    await moveToSpace([ideas.id], 'home')
    expect(workspace.activeSpaceId).toBe('work')
    expect(onScreen()).toEqual(['Plan.md'])
    expect(workspace.active?.path).toBe(PLAN)

    await workspace.showSpace('home')
    expect(onScreen()).toEqual(['Ideas.md'])
    expect(workspace.activeTabId).toBe(ideas.id)
  })

  test('its file goes with it, into the root of that space', async () => {
    await workspace.openEntry(PLAN)
    const plan = tabAt(PLAN)

    await moveToSpace([plan.id], 'home')
    expect(files().has(PLAN)).toBe(false)
    expect(files().get('/spaces/Home/Plan.md')).toBe('# Plan\n')
    expect(plan.path).toBe('/spaces/Home/Plan.md')
    expect(workspace.tabs).toContain(plan)
  })

  test('an unsaved note keeps its words and is saved in its new space', async () => {
    const draft = blank('# Shopping\n\nmilk')

    await moveToSpace([draft.id], 'uni')
    expect(draft.note.home).toBe('uni')
    expect(draft.note.text).toBe('# Shopping\n\nmilk')
    expect(onScreen()).toEqual([])

    await workspace.showSpace('uni')
    expect(onScreen()).toEqual([draft.name])
    expect(workspace.spaceOf(draft.note)).toBe('uni')
  })

  test('a terminal is the same tab, its lines moved to the new space’s folder', async () => {
    workspace.openUnsaved(
      'terminal',
      JSON.stringify({ shell: 'cmd', folder: '/spaces/Work', key: 'k1' }),
      'Command Prompt',
    )
    const shell = workspace.tabs.at(-1)
    if (!shell) throw new Error('no terminal')
    const doc = shell.note

    await moveToSpace([shell.id], 'home')
    await written()
    expect(workspace.tabs).toContain(shell)
    expect(shell.note).toBe(doc)
    expect(shell.note.home).toBe('home')
    expect(histories).toEqual(['read work', 'forget work'])

    await workspace.showSpace('home')
    expect(onScreen()).toEqual(['Command Prompt'])
  })

  test('a preview moved is kept, and the pane it left falls back to the tab before', async () => {
    await workspace.openEntry(PLAN)
    await workspace.open(IDEAS, { preview: true })
    const ideas = tabAt(IDEAS)
    expect(workspace.previewTabId).toBe(ideas.id)

    await moveToSpace([ideas.id], 'home')
    expect(workspace.previewTabId).toBeNull()
    expect(workspace.active?.path).toBe(PLAN)
  })

  test('a file takes every view of it, and a pane left with nothing goes', async () => {
    await workspace.openEntry(PLAN)
    await workspace.openEntry(IDEAS)
    workspace.split('row', tabAt(IDEAS).id)
    expect(workspace.panes.count).toBe(2)

    await moveToSpace([tabAt(IDEAS).id], 'home')
    expect(workspace.panes.count).toBe(1)
    expect(onScreen()).toEqual(['Plan.md'])
  })
})

describe('what is never lost', () => {
  test('a file whose name is taken there stays, and so does its tab', async () => {
    files().set('/spaces/Home/Plan.md', '# Another plan\n')
    await workspace.openEntry(PLAN)
    const plan = tabAt(PLAN)

    await moveToSpace([plan.id], 'home')
    expect(files().get(PLAN)).toBe('# Plan\n')
    expect(files().get('/spaces/Home/Plan.md')).toBe('# Another plan\n')
    expect(plan.path).toBe(PLAN)
    expect(onScreen()).toEqual(['Plan.md'])
  })

  test('words typed a moment before the move are in the file where it went', async () => {
    await workspace.openEntry(PLAN)
    const plan = tabAt(PLAN)
    plan.note.live.replace('# Plan\n\nfresh words')

    await moveToSpace([plan.id], 'home')
    await workspace.writeNow()
    expect(files().get('/spaces/Home/Plan.md')).toBe('# Plan\n\nfresh words')
  })

  test('the space it is in already is no move at all', async () => {
    await workspace.openEntry(PLAN)
    const plan = tabAt(PLAN)

    await moveToSpace([plan.id], 'work')
    expect(plan.path).toBe(PLAN)
    expect(files().has(PLAN)).toBe(true)
  })
})

describe('a move taken back', () => {
  test('undone, the tab goes back with its file; redone, it follows again', async () => {
    await workspace.openEntry(IDEAS)
    await workspace.openEntry(PLAN)
    await moveToSpace([tabAt(PLAN).id], 'home')
    expect(onScreen()).not.toContain('Plan.md')

    await workspace.undoFileAction()
    expect(files().has(PLAN)).toBe(true)
    expect(onScreen()).toContain('Plan.md')

    await workspace.redoFileAction()
    expect(files().has('/spaces/Home/Plan.md')).toBe(true)
    expect(onScreen()).not.toContain('Plan.md')
    await workspace.showSpace('home')
    expect(onScreen()).toContain('Plan.md')
  })

  test('a move within a space stays the tab’s own business', async () => {
    files().set('/spaces/Work/Old/x.md', '# x\n')
    await workspace.loadTree()
    await workspace.openEntry(PLAN)
    await workspace.move(PLAN, '/spaces/Work/Old')
    await workspace.undoFileAction()
    expect(onScreen()).toContain('Plan.md')
  })
})

describe('a move that was refused', () => {
  test('says so, with the way to try again, and answers that nothing moved', async () => {
    const { failed } = await import('../../src/lib/views/failed.svelte')
    failed.dismiss()
    files().set('/spaces/Home/Plan.md', '# theirs\n')
    await workspace.openEntry(PLAN)
    expect(await moveToSpace([tabAt(PLAN).id], 'home')).toBe(false)
    expect(failed.retry).not.toBe(null)
    expect(onScreen()).toContain('Plan.md')
    failed.dismiss()

    files().delete('/spaces/Home/Plan.md')
    expect(await moveToSpace([tabAt(PLAN).id], 'home')).toBe(true)
    expect(failed.retry).toBe(null)
  })
})

describe('a tab closed in another space, reopened', () => {
  test('goes back to its space, not into the strip on screen', async () => {
    await workspace.showSpace('home')
    await workspace.openEntry(FOOD)
    workspace.close(tabAt(FOOD).id)
    await workspace.showSpace('work')
    await workspace.openEntry(PLAN)

    await workspace.reopenClosed()
    expect(workspace.activeSpaceId).toBe('home')
    expect(onScreen()).toContain('Food.md')
    expect(workspace.active?.path).toBe(FOOD)
    await workspace.showSpace('work')
    expect(onScreen()).toEqual(['Plan.md'])
  })

  test('one closed in the space on screen stays where it is', async () => {
    await workspace.openEntry(PLAN)
    workspace.close(tabAt(PLAN).id)
    await workspace.reopenClosed()
    expect(workspace.activeSpaceId).toBe('work')
    expect(onScreen()).toContain('Plan.md')
  })
})

describe('a tab with nowhere to come back to', () => {
  test('closed in another space and deleted since: no switch for nothing', async () => {
    await workspace.showSpace('home')
    await workspace.openEntry(FOOD)
    workspace.close(tabAt(FOOD).id)
    files().delete(FOOD)
    await workspace.showSpace('work')
    await workspace.openEntry(PLAN)

    const went: (string | null)[] = []
    const show = vi.spyOn(workspace, 'showSpace').mockImplementation((id) => {
      went.push(id)
      return Promise.resolve()
    })
    await workspace.reopenClosed()
    show.mockRestore()
    expect(went).toEqual([])
    expect(workspace.activeSpaceId).toBe('work')
    expect(onScreen()).toEqual(['Plan.md'])
  })

  test('closed in a space archived since: stays closed, and says so', async () => {
    const { busy } = await import('../../src/lib/busy.svelte')
    busy.clear()
    await workspace.showSpace('home')
    await workspace.openEntry(FOOD)
    workspace.close(tabAt(FOOD).id)
    await workspace.showSpace('work')
    await workspace.openEntry(PLAN)
    workspace.archivedSpaces.set('/spaces/Home', true)

    await workspace.reopenClosed()
    workspace.archivedSpaces.set('/spaces/Home', false)
    expect(onScreen()).toEqual(['Plan.md'])
    expect(busy.trouble).toBeTruthy()
  })

  test('a move whose space is archived since: not undone, file and tab together, and said', async () => {
    const { failed } = await import('../../src/lib/views/failed.svelte')
    failed.dismiss()
    await workspace.openEntry(PLAN)
    await moveToSpace([tabAt(PLAN).id], 'home')
    workspace.archivedSpaces.set('/spaces/Work', true)
    await workspace.undoFileAction()
    workspace.archivedSpaces.set('/spaces/Work', false)
    expect(files().has('/spaces/Home/Plan.md')).toBe(true)
    expect(failed.retry).not.toBe(null)
    failed.dismiss()
    workspace.undone.stack = []
  })

  test('a redo into a space archived since: not done, and said', async () => {
    const { failed } = await import('../../src/lib/views/failed.svelte')
    failed.dismiss()
    await workspace.openEntry(PLAN)
    await moveToSpace([tabAt(PLAN).id], 'home')
    await workspace.undoFileAction()
    workspace.archivedSpaces.set('/spaces/Home', true)
    await workspace.redoFileAction()
    workspace.archivedSpaces.set('/spaces/Home', false)
    expect(files().has(PLAN)).toBe(true)
    expect(onScreen()).toContain('Plan.md')
    expect(failed.retry).not.toBe(null)
    failed.dismiss()
    workspace.undone.ahead = []
  })
})

describe('the session', () => {
  test('writes the tab under the space it went to', async () => {
    const draft = blank('notes')

    await moveToSpace([draft.id], 'uni')
    workspace.persist()
    const written = localStorage.getItem('orden:workspace') ?? ''
    expect(written).toContain('"space":"uni"')
  })
})
