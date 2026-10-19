import { afterEach, describe, expect, test, vi } from 'vitest'

/** Which web build a page says it is, and the move to the other (#424). The build says
 *  it, never the cookie; the Worker sets the cookie and serves the page again, so the
 *  switch is an address. See services/sync/src/channel.ts. */

const where = vi.hoisted(() => ({ native: false }))
vi.mock('./tauri', () => ({
  get isNative() {
    return where.native
  },
  isDesktop: false,
  invoke: () => Promise.resolve(null),
}))

const went: string[] = []
vi.stubGlobal('location', {
  set href(to: string) {
    went.push(to)
  },
})

async function loaded(channel: string | undefined, native = false) {
  vi.resetModules()
  where.native = native
  vi.stubEnv('VITE_ORDEN_CHANNEL', channel)
  return import('./updater')
}

afterEach(() => {
  vi.unstubAllEnvs()
  went.length = 0
})

describe('the web build', () => {
  test('is the release unless it was built for the edge', async () => {
    expect((await loaded(undefined)).webChannel).toBe('stable')
    expect((await loaded('nightly')).webChannel).toBe('stable')
    expect((await loaded('unstable')).webChannel).toBe('unstable')
  })

  test('is no channel at all in the desktop and phone apps', async () => {
    expect((await loaded('unstable', true)).webChannel).toBeNull()
  })

  test('goes to the edge through the Worker, and back from it', async () => {
    ;(await loaded(undefined)).switchWebChannel('unstable')
    ;(await loaded('unstable')).switchWebChannel('stable')
    expect(went).toEqual(['/?channel=unstable', '?channel=stable'])
  })

  test('stays where it is when the build already is the one chosen', async () => {
    ;(await loaded(undefined)).switchWebChannel('stable')
    ;(await loaded('unstable')).switchWebChannel('unstable')
    expect(went).toEqual([])
  })
})
