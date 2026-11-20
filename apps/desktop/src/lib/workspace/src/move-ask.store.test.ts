import { beforeEach, describe, expect, test, vi } from 'vitest'

const held = vi.hoisted(() => ({ disk: null as import('../../../../test/disk').Disk | null }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces') {
      return [
        { name: 'Work', path: '/spaces/Work' },
        { name: 'Home', path: '/spaces/Home' },
      ]
    }
    return held.disk?.invoke(command, args)
  },
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
held.disk = new Disk()
vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: '' })
vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
const WORK = { id: 'work', name: 'Work', root: '/spaces/Work' }
const HOME = { id: 'home', name: 'Home', root: '/spaces/Home' }
const PLAN = `${WORK.root}/Plan.md`
const LIST = `${HOME.root}/List.md`
async function launch() {
  await vi.dynamicImportSettled()
  vi.resetModules()
  const { startup } = await import('../../launch/src/api')
  const turn = startup.turn.bind(startup)
  startup.turn = (stage) => (stage === 'doors' ? new Promise(() => undefined) : turn(stage))
  const { workspace } = await import('./workspace.svelte')
  const { prompt } = await import('../../ui-kit/src/prompt.svelte')
  const { moveToSpace } = await import('./moving-space')
  const asked: string[] = []
  const answer = { now: 'tab' as string | null }
  vi.spyOn(prompt, 'choose').mockImplementation((asking) => {
    asked.push(asking.title)
    return Promise.resolve(answer.now)
  })
  return { workspace, moveToSpace, asked, answer }
}
async function opened() {
  const one = await launch()
  one.workspace.spaces = [{ ...WORK }, { ...HOME }]
  await one.workspace.showSpace(WORK.id)
  await (await import('./sets.svelte')).sets.wake()
  await one.workspace.open(PLAN)
  const tab = one.workspace.tabs.find((each) => each.path === PLAN)!
  return { ...one, tab }
}
beforeEach(() => {
  localStorage.clear()
  const disk = held.disk!
  disk.reset()
  disk.folders.add(WORK.root).add(HOME.root)
  disk.files.set(PLAN, '# Plan\n')
  disk.files.set(LIST, '# List\n')
})
describe('a saved tab moved to a space that does not hold its file', () => {
  test('asks once, naming the file and both spaces, and moves the file when told to', async () => {
    const { moveToSpace, asked, answer, tab } = await opened()
    answer.now = 'file'
    expect(await moveToSpace([tab.id], HOME.id)).toBe(true)
    expect(asked).toEqual(['Move "Plan.md" from Work to Home?'])
    expect(held.disk!.files.has(`${HOME.root}/Plan.md`)).toBe(true)
    expect(held.disk!.files.has(PLAN)).toBe(false)
  })
  test('moves only the tab when told to, and the tab is still there after a restart', async () => {
    const { workspace, moveToSpace, tab } = await opened()
    expect(await moveToSpace([tab.id], HOME.id)).toBe(true)
    expect(held.disk!.files.has(PLAN)).toBe(true)
    expect(workspace.spaceOfTab(tab)).toBe(HOME.id)
    expect(workspace.persist()).toBe(true)
    const again = await launch()
    await again.workspace.restore()
    await (await import('./sets.svelte')).sets.wake()
    const back = again.workspace.tabs.find((each) => each.path === PLAN)
    expect(back && again.workspace.spaceOfTab(back)).toBe(HOME.id)
    expect(await again.moveToSpace([back!.id], WORK.id)).toBe(true)
    expect(again.asked).toEqual([])
    expect(again.workspace.spaceOfTab(back!)).toBe(WORK.id)
  })
  test('changes nothing and says so when the question is turned away', async () => {
    const { workspace, moveToSpace, answer, tab } = await opened()
    answer.now = null
    expect(await moveToSpace([tab.id], HOME.id)).toBeNull()
    expect(held.disk!.files.has(PLAN)).toBe(true)
    expect(workspace.spaceOfTab(tab)).toBe(WORK.id)
  })
  test('asks nothing for a tab of no file, or one whose file is already there', async () => {
    const { workspace, moveToSpace, asked } = await opened()
    workspace.openBlank('Loose', 'words')
    const loose = workspace.tabs.find((each) => each.path === null)!
    expect(await moveToSpace([loose.id], HOME.id)).toBe(true)
    await workspace.open(LIST)
    const list = workspace.tabs.find((each) => each.path === LIST)!
    await moveToSpace([list.id], HOME.id)
    expect(asked).toEqual([])
  })
})
