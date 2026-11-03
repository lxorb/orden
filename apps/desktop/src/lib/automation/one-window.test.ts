import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A verb and a link run once, however many windows are open.
 *
 *  Each document window starts its own automation. The runtime hands an event sent to one
 *  label to that window's listeners and to every listener in any window whose target was
 *  left at Any, which is what `listen` from the event module registers: so a `run_terminal`
 *  sent to `main` ran once per window, for one call answered. The stand-in below keeps
 *  that rule, and two windows are two loads of the module. */

interface Heard {
  /** The label it listens on; null is the runtime's Any. */
  on: string | null
  event: string
  then: (event: { payload: unknown }) => void
}

const world = vi.hoisted(() => ({
  here: 'main',
  listeners: [] as Heard[],
  ran: [] as string[],
  /** What the crate answers a window that takes a request. */
  claims: true,
}))

/** What `emit_to` does in the runtime. */
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
vi.mock('../tauri', () => ({
  isNative: true,
  isDesktop: true,
  invoke: (command: string) =>
    Promise.resolve(command === 'automation_claim' ? world.claims : []),
  openExternal: () => Promise.resolve(),
}))
vi.mock('../web-tab/handed', () => ({ hearPages: () => Promise.resolve(() => undefined) }))
vi.mock('../pdf/handed', () => ({ hearPdfs: () => Promise.resolve(() => undefined) }))
vi.mock('../busy.svelte', () => ({ busy: { failed: () => undefined } }))
vi.mock('../i18n.svelte', () => ({ t: (words: string) => words }))
vi.mock('../log', () => ({ log: () => undefined }))
vi.mock('./caller', () => ({ callerOf: () => undefined }))
vi.mock('./verbs', () => ({
  dispatch: (verb: string) => {
    world.ran.push(verb)
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
    world.listeners.length = 0
    world.ran.length = 0
    world.claims = true
    await openWindow('main')
    await openWindow('nib-2')
  })

  test('a request of the endpoint runs once, in the window it was sent to', async () => {
    sendTo('main', 'nib://automation', { id: 1, verb: 'run_terminal' })
    await vi.waitFor(() => expect(world.ran).toEqual(['run_terminal']))
  })

  test('one the crate has given up on and asked of another does not run', async () => {
    world.claims = false
    sendTo('main', 'nib://automation', { id: 1, verb: 'run_terminal' })
    await new Promise((settled) => setTimeout(settled, 0))
    expect(world.ran).toEqual([])
  })

  test('a link runs once, in the window it was sent to', async () => {
    sendTo('main', 'nib://open-url', ['nib://new?title=x'])
    await Promise.resolve()
    expect(world.ran).toEqual(['new'])
  })
})

/** The crate's constants that it sends with `emit_to`, or may not send to all. */
const here = join(import.meta.dirname, '..')
const crate = join(here, '../../src-tauri/src')

function filesUnder(dir: string, ending: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return filesUnder(full, ending)
    return ending.test(name) && !name.endsWith('.test.ts') ? [full] : []
  })
}

/** Every event some file of the crate sends to one window by name. */
function sentToOneWindow(): Set<string> {
  const events = new Set<string>()
  for (const file of filesUnder(crate, /\.rs$/)) {
    const source = readFileSync(file, 'utf8')
    for (const [, name] of source.matchAll(/emit_to\(\s*[^,]+,\s*([A-Z_]+|"nib:[^"]+")\s*,/g)) {
      if (name?.startsWith('"')) {
        events.add(name.replaceAll('"', ''))
        continue
      }
      const value = new RegExp(`const ${name}: &str = "(nib://[^"]+)"`).exec(source)?.[1]
      if (value) events.add(value)
    }
  }
  return events
}

describe('the audit of every event a window hears', () => {
  test('a file that names an event sent to one window hears it on that window alone', () => {
    const events = sentToOneWindow()
    // The list itself is what this test stands on: an edit that stopped finding them
    // would pass everything.
    expect(events).toContain('nib://automation')
    expect(events).toContain('nib://web-key')

    const wrong: string[] = []
    for (const file of filesUnder(here, /\.(ts|svelte)$/)) {
      const source = readFileSync(file, 'utf8')
      const named = [...events].filter((event) => source.includes(`'${event}'`))
      // `import type` is no listener.
      const hearsAny = /import\((['"])@tauri-apps\/api\/event\1\)/.test(source)
      if (named.length && hearsAny) wrong.push(`${file}: ${named.join(', ')}`)
    }
    expect(wrong).toEqual([])
  })

  test('what a window acts on is never sent to every window', () => {
    const bare = (file: string) => readFileSync(join(crate, file), 'utf8')
    expect(bare('uris.rs')).not.toMatch(/\.emit\(OPENED/)
    expect(bare('reminders.rs')).not.toMatch(/\.emit\(PRESSED/)
    expect(bare('search.rs')).not.toMatch(/\.emit\(\s*HITS/)
  })
})
