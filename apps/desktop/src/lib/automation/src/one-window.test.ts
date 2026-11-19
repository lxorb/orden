import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

interface Heard {
  on: string | null
  event: string
  then: (event: { payload: unknown }) => void
}
const world = vi.hoisted(() => ({
  here: 'main',
  listeners: [] as Heard[],
  ran: [] as string[],
  claims: true,
  hangs: false,
  deadlines: [] as (AbortSignal | undefined)[],
  results: [] as { id: number; result: unknown }[],
}))
function sendTo(label: string, event: string, payload: unknown) {
  for (const one of world.listeners) {
    if (one.event === event && (one.on === null || one.on === label)) one.then({ payload })
  }
}
vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, then: Heard['then']) => {
    world.listeners.push({ on: null, event, then })
    return Promise.resolve(() => undefined)
  },
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => {
    const on = world.here
    return {
      label: on,
      listen: (event: string, then: Heard['then']) => {
        world.listeners.push({ on, event, then })
        return Promise.resolve(() => undefined)
      },
    }
  },
}))
vi.mock('../../platform/src/tauri', () => ({
  isNative: true,
  isDesktop: true,
  invoke: (command: string, args?: { id: number; result: unknown }) => {
    if (command === 'automation_result' && args) world.results.push(args)
    return Promise.resolve(command === 'automation_claim' ? world.claims : [])
  },
  openExternal: () => Promise.resolve(),
}))
vi.mock('../../ui-kit/src/busy.svelte', () => ({ busy: { failed: () => undefined } }))
vi.mock('../../platform/src/log', () => ({ log: () => undefined }))
vi.mock('./caller', () => ({ callerOf: () => undefined }))
vi.mock('./verbs', () => ({
  dispatch: (
    verb: string,
    _args: unknown,
    _rest: unknown,
    _road: unknown,
    _caller: unknown,
    deadline?: AbortSignal,
  ) => {
    world.ran.push(verb)
    world.deadlines.push(deadline)
    if (world.hangs) return new Promise(() => undefined)
    return Promise.resolve({ ok: true, value: {} })
  },
  isVerb: () => true,
  linkHearsFrom: () => false,
  verbForAction: (action: string) => action,
}))
async function openWindow(label: string) {
  world.here = label
  vi.resetModules()
  const { startAutomation } = await import('./start')
  await startAutomation()
}
describe('with two windows open', () => {
  beforeEach(async () => {
    Object.assign(world, { listeners: [], ran: [], claims: true, hangs: false })
    Object.assign(world, { deadlines: [], results: [] })
    await openWindow('main')
    await openWindow('orden-2')
  })
  test('a request of the endpoint runs once, in the window it was sent to', async () => {
    sendTo('main', 'orden://automation', { id: 1, verb: 'run_terminal' })
    await vi.waitFor(() => expect(world.ran).toEqual(['run_terminal']))
  })
  test('one the crate has given up on and asked of another does not run', async () => {
    world.claims = false
    sendTo('main', 'orden://automation', { id: 1, verb: 'run_terminal' })
    await new Promise((settled) => setTimeout(settled, 0))
    expect(world.ran).toEqual([])
  })
  describe('with a verb that hangs', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      world.hangs = true
    })
    afterEach(() => vi.useRealTimers())
    test('it is told when to stop working, a moment before the endpoint stops waiting', async () => {
      sendTo('main', 'orden://automation', { id: 1, verb: 'append_note', within_ms: 25_000 })
      await vi.advanceTimersByTimeAsync(23_900)
      const deadline = world.deadlines[0]
      expect(deadline?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(200)
      expect(deadline?.aborted).toBe(true)
    })
    test('it is answered for, in words, when the time is up', async () => {
      sendTo('main', 'orden://automation', { id: 7, verb: 'sync.now', within_ms: 25_000 })
      await vi.advanceTimersByTimeAsync(24_900)
      expect(world.results).toEqual([])
      await vi.advanceTimersByTimeAsync(200)
      expect(world.results).toEqual([{ id: 7, result: expect.objectContaining({ ok: false, code: 'timeout' }) }])
    })
  })
  test('a request with no time given has no deadline to stop by', async () => {
    sendTo('main', 'orden://automation', { id: 1, verb: 'run_terminal' })
    await vi.waitFor(() => expect(world.deadlines).toHaveLength(1))
    expect(world.deadlines[0]).toBeUndefined()
  })
  test('a link runs once, in the window it was sent to', async () => {
    sendTo('main', 'orden://open-url', ['orden://new?title=x'])
    await Promise.resolve()
    expect(world.ran).toEqual(['new'])
  })
})
const here = join(import.meta.dirname, '..')
const crate = join(here, '../../../src-tauri/src')
const crates = join(here, '../../../src-tauri/crates')
function filesUnder(dir: string, ending: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return filesUnder(full, ending)
    return ending.test(name) && !name.endsWith('.test.ts') ? [full] : []
  })
}
function sentToOneWindow(): Set<string> {
  const events = new Set<string>()
  for (const file of [crate, crates].flatMap((dir) => filesUnder(dir, /\.rs$/))) {
    const source = readFileSync(file, 'utf8')
    for (const [, name] of source.matchAll(/emit_to\(\s*[^,]+,\s*([A-Z_]+|"orden:[^"]+")\s*,/g)) {
      if (name?.startsWith('"')) {
        events.add(name.replaceAll('"', ''))
        continue
      }
      const value = new RegExp(`const ${name}: &str = "(orden://[^"]+)"`).exec(source)?.[1]
      if (value) events.add(value)
    }
  }
  return events
}
describe('the audit of every event a window hears', () => {
  test('a file that names an event sent to one window hears it on that window alone', () => {
    const events = sentToOneWindow()
    expect(events).toContain('orden://automation')
    expect(events).toContain('orden://web-key')
    const wrong: string[] = []
    for (const file of filesUnder(here, /\.(ts|svelte)$/)) {
      const source = readFileSync(file, 'utf8')
      const named = [...events].filter((event) => source.includes(`'${event}'`))
      const hearsAny = /import\((['"])@tauri-apps\/api\/event\1\)/.test(source)
      if (named.length && hearsAny) wrong.push(`${file}: ${named.join(', ')}`)
    }
    expect(wrong).toEqual([])
  })
  test('what a window acts on is never sent to every window', () => {
    const all = [crate, crates].flatMap((dir) => filesUnder(dir, /\.rs$/))
    const bare = (file: string) =>
      readFileSync(all.find((path) => path.split(/[\\/]/).at(-1) === file) ?? join(crate, file), 'utf8')
    expect(bare('uris.rs')).not.toMatch(/\.emit\(OPENED/)
    expect(bare('reminders.rs')).not.toMatch(/\.emit\(PRESSED/)
    expect(bare('search.rs')).not.toMatch(/\.emit\(\s*HITS/)
  })
})
