import { describe, expect, test, vi } from 'vitest'

const watching = vi.hoisted(() => ({ roots: [] as string[][], stops: 0 }))
vi.mock('../native', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../native')>()),
  Channel: class {
    onmessage: unknown = null
  },
  invoke: (command: string, args?: { roots?: string[] }) => {
    if (command === 'space_watch') watching.roots.push(args?.roots ?? [])
    if (command === 'space_unwatch') watching.stops++
    return Promise.resolve(undefined)
  },
}))
vi.mock('../sync-client/src/lead', () => ({
  leadSync: () => Promise.resolve({ release: () => undefined }),
}))
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: () => Promise.resolve(undefined),
}))

const { memoryStorage } = await import('../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('../workspace.svelte')
const { account } = await import('../account.svelte')
const { sync } = await import('../sync.svelte')
const { onUnwatched, unwatchSpaces } = await import('../space-watch')
const { hearsUnwatched, TheWatch } = await import('./outside.svelte')

const settle = async () => {
  for (let turn = 0; turn < 5; turn++) await new Promise((go) => setTimeout(go, 0))
}

describe('the watch of the spaces', () => {
  test('signed out it runs, once, and follows the spaces', async () => {
    const watch = new TheWatch()
    workspace.spaces = [{ id: 'S', name: 's', root: '/s' }]
    watch.settle()
    await settle()
    expect(watching.roots).toEqual([['/s']])

    workspace.spaces = [...workspace.spaces, { id: 'T', name: 't', root: '/t' }]
    watch.settle()
    await settle()
    expect(watching.roots).toEqual([['/s'], ['/s', '/t']])

    watch.settle()
    await settle()
    expect(watching.roots.length).toBe(2)
  })

  test('the engine has it signed in, and it comes back when the engine lets go', async () => {
    watching.roots.length = 0
    const watch = new TheWatch()
    const stop = onUnwatched(() => watch.letGoOfByEngine())
    account.user = { id: 'u', syncVersion: 2 } as NonNullable<typeof account.user>
    sync.version = 2
    watch.settle()
    await settle()
    expect(watching.roots).toEqual([])
    expect(watching.stops).toBe(0)

    account.user = null
    watch.settle()
    await settle()
    expect(watching.roots).toEqual([['/s', '/t']])

    await unwatchSpaces()
    await settle()
    expect(watching.roots).toEqual([
      ['/s', '/t'],
      ['/s', '/t'],
    ])
    stop()
  })

  test('the engine letting go in another window is heard here', async () => {
    watching.roots.length = 0
    const said: Record<string, () => void> = {}
    const line = {
      say: (kind: string) => said[kind]?.(),
      hear: (kind: string, listener: () => void) => {
        said[kind] = listener
        return () => true
      },
    }
    const watch = new TheWatch()
    watch.settle()
    await settle()
    const first = watching.roots.length
    const stop = hearsUnwatched(watch, line)
    line.say('spaces-unwatched')
    await settle()
    expect(watching.roots.length).toBe(first + 1)
    stop()
  })

  test('a space Orden keeps is not handed to the watcher, so the folders beside it are still watched', async () => {
    watching.roots.length = 0
    account.user = null
    const watch = new TheWatch()
    workspace.spaces = [
      { id: 'S', name: 's', root: '/s' },
      { id: 'K', name: 'K', root: '/n/.orden/K/K' },
    ]
    watch.settle()
    await settle()
    expect(watching.roots).toEqual([['/s']])
  })
})
