import { beforeEach, describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../../test/disk').Disk | null }))
vi.mock('../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'explorer_rename') {
      const path = String(args.path)
      return Promise.resolve(`${path.slice(0, path.lastIndexOf('/'))}/${String(args.name)}`)
    }
    if (command === 'explorer_put') {
      const pairs = args.pairs as { from: string; to: string }[]
      return Promise.resolve({
        done: pairs,
        replaced: [],
        skipped: [],
        failed: [],
        cancelled: false,
      })
    }
    if (command === 'explorer_transfer') {
      const folder = String(args.folder)
      const staying = args.staying as string[]
      const done = (args.sources as string[]).map((from) => ({
        from,
        to: `${folder}/${from.slice(from.lastIndexOf('/') + 1)}`,
        ...(staying.includes(from) ? { stayed: true } : {}),
      }))
      return Promise.resolve({ done, replaced: [], skipped: [], failed: [], cancelled: false })
    }
    return disk.current!.invoke(command, args)
  },
}))

const { Disk, memoryStorage } = await import('../../../test/disk')
const d = new Disk()
disk.current = d
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('../workspace.svelte')
const { places } = await import('./places.svelte')
const { put, renameTo, transfer } = await import('./commands')
const { openExplorer } = await import('./open')
const { readSpec } = await import('./spec')
const { viewOf } = await import('./view.svelte')

function pinned(...paths: string[]) {
  for (const one of [...places.pinned]) places.unpin(one)
  for (const one of paths) places.pin(one)
}

function kept(): unknown {
  return JSON.parse(localStorage.getItem('orden:explorer-pinned') ?? 'null')
}

describe('a pinned folder follows a rename or move made in Orden', () => {
  beforeEach(async () => {
    await workspace.writesSettled()
    d.reset()
    d.folders.add('/s')
    d.folders.add('/s/Trips')
    d.folders.add('/s/Trips/Rome')
    d.files.set('/s/Trips/Rome/plan.md', 'go')
    workspace.tabs = []
    workspace.spaces = [{ id: 'S', name: 's', root: '/s' }]
    workspace.activeSpaceId = 'S'
    await workspace.loadTree()
  })

  test('renaming a pinned folder outside a space', async () => {
    pinned('/home/me/Projects', '/home/me/Music')
    await renameTo('/home/me/Projects', 'Work')
    expect(places.pinned).toEqual(['/home/me/Work', '/home/me/Music'])
    expect(kept()).toEqual(['/home/me/Work', '/home/me/Music'])
  })

  test('renaming the folder that holds a pinned one', async () => {
    pinned('/home/me/Projects/orden')
    await renameTo('/home/me/Projects', 'Work')
    expect(places.pinned).toEqual(['/home/me/Work/orden'])
  })

  test('moving a pinned folder, and taking the move back', async () => {
    pinned('/home/me/Projects')
    await transfer('job', ['/home/me/Projects'], '/mnt/disk', 'move', 'keep')
    expect(places.pinned).toEqual(['/mnt/disk/Projects'])
    await put('job', [{ from: '/mnt/disk/Projects', to: '/home/me/Projects' }], 'move')
    expect(places.pinned).toEqual(['/home/me/Projects'])
  })

  test('a copy, or a move that stayed, leaves the pin where it is', async () => {
    pinned('/home/me/Projects')
    await transfer('job', ['/home/me/Projects'], '/mnt/disk', 'copy', 'keep')
    await transfer('job', ['/home/me/Projects'], '/mnt/disk', 'move', 'keep', ['/home/me/Projects'])
    expect(places.pinned).toEqual(['/home/me/Projects'])
  })

  test('renaming a pinned folder in a space', async () => {
    pinned('/s/Trips/Rome')
    await workspace.rename('/s/Trips', 'Travel')
    expect(places.pinned).toEqual(['/s/Travel/Rome'])
    expect(kept()).toEqual(['/s/Travel/Rome'])
  })

  test('renaming the space that holds a pinned folder', async () => {
    pinned('/s/Trips')
    await workspace.fileMoved('/s', '/t', 'space')
    expect(places.pinned).toEqual(['/t/Trips'])
  })

  test('a pin moved onto one already pinned is kept once', async () => {
    pinned('/home/me/A', '/home/me/B')
    await renameTo('/home/me/A', 'B')
    expect(places.pinned).toEqual(['/home/me/B'])
  })

  test('an explorer tab in or past a renamed folder goes along, its way back too', async () => {
    const tab = await openExplorer('/home/me/Projects/orden', false)
    tab.note.replace(
      JSON.stringify({
        folder: '/home/me/Projects/orden',
        back: ['/home/me/Projects', '/tmp'],
        ahead: [],
      }),
      false,
    )
    const view = viewOf(tab)
    await renameTo('/home/me/Projects', 'Work')
    expect(readSpec(tab.doc)).toEqual({
      folder: '/home/me/Work/orden',
      back: ['/home/me/Work', '/tmp'],
      ahead: [],
    })
    expect(view.folder).toBe('/home/me/Work/orden')
    expect(tab.name).toBe('orden')
  })

  test('an explorer tab in a renamed space folder goes along', async () => {
    const tab = await openExplorer('/s/Trips/Rome', false)
    await workspace.rename('/s/Trips', 'Travel')
    expect(readSpec(tab.doc)?.folder).toBe('/s/Travel/Rome')
  })
})
