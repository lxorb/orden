import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'

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
vi.mock('../platform/src/tauri', () => ({
  isNative: true,
  isDesktop: true,
  invoke: (command: string) => Promise.resolve(command === 'automation_claim' ? world.claims : []),
  openExternal: () => Promise.resolve(),
}))
vi.mock('../web-tab/src/api', () => ({
  pagesHanded: () => Promise.resolve({ hearPages: () => Promise.resolve(() => undefined) }),
}))
vi.mock('../pdf/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/src/api')>()),
  handed: () => Promise.resolve({ hearPdfs: () => Promise.resolve(() => undefined) }),
}))
vi.mock('../ui-kit/src/busy.svelte', () => ({ busy: { failed: () => undefined } }))
vi.mock('../platform/src/log', () => ({ log: () => undefined }))
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

  test('a link runs once, in the window it was sent to', async () => {
    sendTo('main', 'orden://open-url', ['orden://new?title=x'])
    await Promise.resolve()
    expect(world.ran).toEqual(['new'])
  })
})

const here = join(import.meta.dirname, '..')
const crate = join(here, '../../src-tauri/src')

function filesUnder(dir: string, ending: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return filesUnder(full, ending)
    return ending.test(name) && !name.endsWith('.test.ts') ? [full] : []
  })
}

function sentToOneWindow(): Set<string> {
  const events = new Set<string>()
  for (const file of filesUnder(crate, /\.rs$/)) {
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
    const bare = (file: string) => readFileSync(join(crate, file), 'utf8')
    expect(bare('uris.rs')).not.toMatch(/\.emit\(OPENED/)
    expect(bare('reminders.rs')).not.toMatch(/\.emit\(PRESSED/)
    expect(bare('search.rs')).not.toMatch(/\.emit\(\s*HITS/)
  })
})
