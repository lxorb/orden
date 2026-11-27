import { beforeEach, describe, expect, test, vi } from 'vitest'

interface Said {
  type: string
  [key: string]: unknown
}
const world = vi.hoisted(() => ({
  status: {
    version: '1.19.6',
    installed: false,
    usable: false,
    bytes: 79341311,
    source: 'registry.npmjs.org',
    background: false,
    downloading: false,
  },
  calls: [] as [string, unknown][],
  script: [] as Said[],
  ends: undefined as { kind: string; detail: string } | undefined,
  heard: null as ((event: { payload: Said }) => void) | null,
}))
vi.mock('../../crate/src/api', () => ({
  Channel: class {
    onmessage: ((said: Said) => void) | null = null
  },
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (_name: string, heard: (event: { payload: Said }) => void) => {
    world.heard = heard
    return Promise.resolve(() => undefined)
  },
}))
vi.mock('../../platform/src/tauri', () => ({
  isDesktop: true,
  invoke: (command: string, args?: { events?: { onmessage: (said: Said) => void }; on?: boolean }) => {
    world.calls.push([command, args?.on])
    if (command === 'opencode_engine') return Promise.resolve({ ...world.status })
    if (command === 'opencode_background') {
      world.status.background = args?.on === true
      return Promise.resolve(world.status.background)
    }
    if (command === 'opencode_download') {
      for (const said of world.script) args?.events?.onmessage(said)
      if (world.script.at(-1)?.type === 'done') world.status = { ...world.status, installed: true, usable: true }
      return world.ends === undefined
        ? Promise.resolve(null)
        : Promise.reject(Object.assign(new Error('stopped'), world.ends))
    }
    return Promise.resolve(null)
  },
}))
async function fresh() {
  vi.resetModules()
  const { engine, stoppedLine } = await import('./engine.svelte')
  await engine.look()
  return { engine, stoppedLine }
}
beforeEach(() => {
  world.status = { ...world.status, installed: false, usable: false, background: false, downloading: false }
  world.calls = []
  world.script = []
  world.ends = undefined
})
describe('the OpenCode engine Orden downloads', () => {
  test('is not usable before it is downloaded, and knows its size', async () => {
    const { engine } = await fresh()
    expect(engine.usable).toBe(false)
    expect(engine.status?.bytes).toBe(79341311)
  })
  test('the first Download turns the quiet updates on, follows the progress and is usable once done', async () => {
    const { engine } = await fresh()
    world.script = [
      { type: 'progress', received: 1000, total: 79341311 },
      { type: 'progress', received: 40000000, total: 79341311 },
      { type: 'done', version: '1.19.6' },
    ]
    await engine.download()
    expect(world.calls.filter(([command]) => command === 'opencode_background')).toEqual([
      ['opencode_background', true],
    ])
    expect(engine.trouble).toBeNull()
    expect(engine.going).toBe(false)
    await vi.waitFor(() => expect(engine.usable).toBe(true))
  })
  test('shows how far it got while it downloads', async () => {
    const { engine } = await fresh()
    engine.heard({ type: 'progress', received: 40000000, total: 79341311 })
    expect(engine.going).toBe(true)
    expect(engine.received).toBe(40000000)
  })
  test.each([
    ['offline', 'No connection. Try again.'],
    ['cancelled', 'Download stopped.'],
    ['disk_full', 'Not enough disk space.'],
    ['checksum', 'The download was damaged.'],
    ['http', 'Download unavailable. Try later.'],
    ['failed', 'Download unavailable. Try later.'],
  ] as const)('says in one line why it stopped: %s', async (kind, line) => {
    const { engine, stoppedLine } = await fresh()
    world.script = [
      { type: 'progress', received: 1000, total: 2000 },
      { type: 'failed', kind, detail: '' },
    ]
    world.ends = { kind, detail: '' }
    await engine.download()
    expect(engine.trouble).toBe(kind)
    expect(engine.going).toBe(false)
    expect(stoppedLine(kind)).toBe(line)
  })
  test('a download already under way is followed, not shown as a failure', async () => {
    const { engine } = await fresh()
    world.ends = { kind: 'busy', detail: '' }
    await engine.download()
    expect(engine.trouble).toBeNull()
    world.heard?.({ payload: { type: 'progress', received: 5, total: 10 } })
    expect(engine.received).toBe(5)
  })
  test('Cancel asks the app to stop the download', async () => {
    const { engine } = await fresh()
    await engine.cancel()
    expect(world.calls.map(([command]) => command)).toContain('opencode_download_cancel')
  })
  test('does not turn the quiet updates on again once they are', async () => {
    world.status.background = true
    const { engine } = await fresh()
    world.script = [{ type: 'done', version: '1.19.6' }]
    await engine.download()
    expect(world.calls.filter(([command]) => command === 'opencode_background')).toEqual([])
  })
})
