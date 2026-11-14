import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../../test/disk').Disk | null }))

vi.mock('../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    if (command === 'list_spaces') {
      return Promise.resolve(
        [...disk.current.folders]
          .filter((path) => /^\/spaces\/[^/]+$/.test(path))
          .map((path) => ({ name: path.split('/').pop(), path })),
      )
    }
    return disk.current.invoke(command, args)
  },
}))

const ending = vi.hoisted(() => ({ answer: true, asked: [] as string[][] }))
vi.mock('../terminal/src/closing', () => ({
  mayEnd: (tabs: readonly { kind: string }[]) => {
    ending.asked.push(tabs.map((one) => one.kind))
    return Promise.resolve(ending.answer)
  },
}))

const { Disk, memoryStorage } = await import('../../../test/disk')
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())

const WORK = { id: 'work', name: 'Work', root: '/spaces/Work' }
const FOOD = { id: 'food', name: 'Food', root: '/spaces/Food' }

async function window(spaces: (typeof WORK)[], active: string | null, setsRead?: unknown) {
  await vi.dynamicImportSettled()
  vi.resetModules()
  const { workspace } = await import('../workspace.svelte')
  workspace.spaces = spaces.map((one) => ({ ...one }))
  workspace.activeSpaceId = active
  workspace.setsRead = setsRead
  return workspace
}

const fetched = async () => (await import('./sets.svelte')).sets

const names = (tabs: readonly { kind: string; path: string | null }[]) =>
  tabs.map((one) => one.path ?? one.kind).sort()

beforeEach(() => {
  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  one.folders.add(WORK.root).add(FOOD.root)
  one.files.set(`${WORK.root}/Plan.md`, '# Plan\n')
  one.files.set(`${FOOD.root}/Food.md`, '# Food\n')
})

afterEach(() => vi.dynamicImportSettled())

describe('the space on screen deleted', () => {
  test('closes its tabs that are no file, and the next space’s stay', async () => {
    const workspace = await window([WORK, FOOD], 'work')
    await fetched()
    await workspace.selectSpace('food')
    await workspace.open(`${FOOD.root}/Food.md`)
    await workspace.selectSpace('work')
    await workspace.open(`${WORK.root}/Plan.md`)
    workspace.openWebsite()
    expect(names(workspace.tabs)).toEqual([`${FOOD.root}/Food.md`, `${WORK.root}/Plan.md`, 'web'])

    await workspace.deleteSpace('work')

    expect(workspace.activeSpaceId).toBe('food')
    expect(names(workspace.tabs)).toEqual([`${FOOD.root}/Food.md`])
  })

  test('closes them too where it is the first thing to fetch the sets', async () => {
    const workspace = await window([WORK, FOOD], 'work')
    workspace.openWebsite()
    expect(names(workspace.tabs)).toEqual(['web'])

    await workspace.deleteSpace('work')

    expect(workspace.activeSpaceId).toBe('food')
    expect(names(workspace.tabs)).toEqual([])
  })

  test('leaves nothing for the next launch', async () => {
    const workspace = await window([WORK, FOOD], 'work')
    await fetched()
    workspace.openWebsite()

    await workspace.deleteSpace('work')

    expect(Object.keys((workspace.setsWritten() as { aside: object }).aside)).toEqual([])
  })
})

describe('a space missing from the listing, which may be a drive not mounted', () => {
  test('keeps what was on screen at the switch away from it', async () => {
    const workspace = await window([WORK, FOOD], 'work')
    await fetched()
    workspace.openWebsite()

    workspace.spaces = workspace.spaces.filter((one) => one.id !== 'work')
    await workspace.selectSpace('food')

    expect(names(workspace.tabs)).toEqual(['web'])
    expect(Object.keys((workspace.setsWritten() as { aside: object }).aside)).toEqual(['work'])
  })

  test('keeps its set through a launch, words and running shells with it', async () => {
    const before = await window([WORK, FOOD], 'work')
    await fetched()
    before.openWebsite()
    await before.selectSpace('food')
    const written: unknown = JSON.parse(JSON.stringify(before.setsWritten()))

    const after = await window([FOOD], 'food', written)
    await (await fetched()).wake()

    expect(names(after.tabs)).toEqual(['web'])
    expect(Object.keys((after.setsWritten() as { aside: object }).aside)).toEqual(['work'])
  })
})

test('a space out of sight deleted closes its set, built or not', async () => {
  const before = await window([WORK, FOOD], 'work')
  await fetched()
  before.openWebsite()
  await before.selectSpace('food')
  const written: unknown = JSON.parse(JSON.stringify(before.setsWritten()))
  await before.deleteSpace('work')
  expect(before.tabs).toEqual([])

  const after = await window([WORK, FOOD], 'food', written)
  await after.deleteSpace('work')
  await (await fetched()).wake()

  expect(after.tabs).toEqual([])
  expect(Object.keys((after.setsWritten() as { aside: object } | undefined)?.aside ?? {})).toEqual(
    [],
  )
})

test('the last space deleted leaves its tabs the window’s, for the next space made', async () => {
  const workspace = await window([WORK], 'work')
  await fetched()
  workspace.openWebsite()

  await workspace.deleteSpace('work')
  expect(workspace.activeSpaceId).toBeNull()
  expect(workspace.tabs.every((tab) => workspace.panes.at(tab.paneId))).toBe(true)
  expect(names(workspace.tabs)).toEqual(['web'])

  disk.current?.folders.add(FOOD.root)
  workspace.spaces = [{ ...FOOD }]
  await workspace.selectSpace('food')

  expect(workspace.tabs.every((tab) => workspace.panes.at(tab.paneId))).toBe(true)
  expect(names(workspace.tabs)).toEqual(['web'])
})

test('the shared set of older builds is not given to the space being deleted', async () => {
  const before = await window([WORK], 'work')
  const sets = await fetched()
  before.openWebsite()
  await sets.toSpace('food')
  const { aside } = JSON.parse(JSON.stringify(before.setsWritten())) as {
    aside: Record<string, unknown>
  }

  const after = await window([WORK, FOOD], 'food', { on: 'food', aside: { global: aside.work } })
  await after.deleteSpace('work')
  await (await fetched()).wake()

  expect(names(after.tabs)).toEqual(['web'])
  expect(after.tabs.every((tab) => after.panes.at(tab.paneId))).toBe(true)
})

describe('a running shell in the space being deleted, which the sheet says nothing about', () => {
  async function asked(answer: boolean) {
    const workspace = await window([WORK, FOOD], 'work')
    await fetched()
    workspace.openWebsite()
    const tab = workspace.tabs[0]
    if (tab) Object.defineProperty(tab, 'kind', { value: 'terminal' })
    ending.answer = answer
    ending.asked = []
    const { prompt } = await import('../ui-kit/src/prompt.svelte')
    vi.spyOn(prompt, 'confirm').mockResolvedValue(true)
    const { deleteSpace } = await import('../space-actions')
    await deleteSpace(workspace.spaces[0] ?? WORK)
    return workspace
  }

  test('asks as closing its tab does, and no leaves the space and the shell', async () => {
    const workspace = await asked(false)

    expect(ending.asked).toEqual([['terminal']])
    expect(workspace.spaces.map((one) => one.id)).toEqual(['work', 'food'])
    expect(names(workspace.tabs)).toEqual(['terminal'])
  })

  test('and yes goes on with the delete', async () => {
    const workspace = await asked(true)

    expect(ending.asked).toEqual([['terminal']])
    expect(workspace.spaces.map((one) => one.id)).toEqual(['food'])
    expect(workspace.tabs).toEqual([])
  })
})

test('a space that is still there keeps its set through a launch', async () => {
  const before = await window([WORK, FOOD], 'work')
  await fetched()
  before.openWebsite()
  await before.selectSpace('food')
  const written: unknown = JSON.parse(JSON.stringify(before.setsWritten()))

  const after = await window([WORK, FOOD], 'food', written)
  await (await fetched()).wake()

  expect(names(after.tabs)).toEqual(['web'])
})

describe('the set older builds shared, in a window with no space to give it to', () => {
  async function sharedSet(on: string) {
    const before = await window([WORK], 'work')
    const sets = await fetched()
    before.openWebsite()
    await sets.toSpace('food')
    const { aside } = JSON.parse(JSON.stringify(before.setsWritten())) as {
      aside: Record<string, unknown>
    }
    return { on, aside: { global: aside.work } }
  }

  test('comes on screen at that launch, none of it lost', async () => {
    const written = await sharedSet('work')

    const after = await window([], null, written)
    await (await fetched()).wake()

    expect(names(after.tabs)).toEqual(['web'])
    expect(after.tabs.every((tab) => after.panes.at(tab.paneId))).toBe(true)
  })

  test('kept for the next launch, where the window itself shows the shared set', async () => {
    const written = await sharedSet('global')

    const after = await window([], null, written)
    await (await fetched()).wake()

    expect(Object.keys((after.setsWritten() as { aside: object }).aside)).toEqual(['global'])
  })
})
