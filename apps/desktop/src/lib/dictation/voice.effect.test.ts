import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  token: null as string | null,
  provider: null as null | { id: string; kind: string; name: string; baseUrl?: string },
  started: [] as { engine: string; words: readonly string[] }[],
  finished: 0,
  cancelled: 0,
  slow: false,
  done: [] as (() => void)[],
  stored: new Map<string, string>(),
  local: { fits: false, ready: false, keepsUp: true, fetched: 0 },
}))

vi.mock('./listening', () => ({
  listen: (_field: unknown, engine: string, words: readonly string[]) => {
    world.started.push({ engine, words })
    return Promise.resolve({
      finish: () => {
        world.finished++
        return world.slow
          ? new Promise<void>((resolve) => world.done.push(resolve))
          : Promise.resolve()
      },
      cancel: () => world.cancelled++,
    })
  },
}))
vi.mock('./local.svelte', () => ({
  local: {
    get fits() {
      return world.local.fits
    },
    get ready() {
      return world.local.ready
    },
    get keepsUp() {
      return world.local.keepsUp
    },
    machine: { fit: 'fits', model: { id: 'parakeet', name: 'Parakeet', bytes: 670_000_000 } },
    fetch: () => {
      world.local.fetched++
      return Promise.resolve()
    },
  },
}))
vi.mock('./device', () => ({
  listenOnDevice: () => {
    world.started.push({ engine: 'device', words: [] })
    return Promise.resolve({
      finish: () => {
        world.finished++
        return Promise.resolve()
      },
      cancel: () => world.cancelled++,
    })
  },
}))
vi.mock('../account.svelte', () => ({
  account: {
    get accountToken() {
      return world.token
    },
  },
}))
vi.mock('../ai/hears', () => ({ transcriberNow: () => world.provider }))
vi.mock('../stored', () => ({
  storedText: (key: string) => world.stored.get(key) ?? null,
  keep: (key: string, value: string) => world.stored.set(key, value),
  forget: (key: string) => world.stored.delete(key),
}))
vi.mock('../settings.svelte', () => ({ settings: { error: null } }))
vi.mock('../shortcuts.svelte', () => ({
  shortcuts: {
    pressed: (id: string, event: KeyboardEvent) =>
      id === 'field.dictate' && event.altKey && event.key.toLowerCase() === 'v',
    tooltip: (name: string) => name,
  },
}))
vi.mock('../i18n.svelte', () => ({
  t: (text: string, values: Record<string, string> = {}) =>
    text.replace(/\{(\w+)\}/g, (_whole, key: string) => values[key] ?? key),
  key: (text: string) => text,
  message: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}))

const { engines } = await import('./engines.svelte')
const { voice } = await import('./voice.svelte')
const { dictating, HOLD } = await import('./keys')
const DictateButton = (await import('./DictateButton.svelte')).default

let target: HTMLElement
let field: HTMLTextAreaElement
let drawn: ReturnType<typeof mount> | undefined
let action: { destroy: () => void } | undefined
let entered: number
const owner = { field: () => field, words: () => ['Sync Worker'] }

const settle = async () => {
  for (let one = 0; one < 3; one++) await new Promise((resolve) => setTimeout(resolve, 0))
  flushSync()
}

function button(): HTMLButtonElement {
  return target.querySelector<HTMLButtonElement>('button.mic')!
}

function press(held: number) {
  const at = performance.now()
  vi.spyOn(performance, 'now').mockReturnValue(at)
  button().dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }))
  vi.spyOn(performance, 'now').mockReturnValue(at + held)
  button().dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }))
  vi.restoreAllMocks()
}

function key(type: 'keydown' | 'keyup', init: KeyboardEventInit) {
  field.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }))
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  field = document.createElement('textarea')
  target.append(field)
  entered = 0
  target.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') entered++
  })
  action = dictating(field, owner)
  drawn = mount(DictateButton, { target, props: { owner } })
  world.token = 'a token'
  world.provider = null
  world.started = []
  world.finished = 0
  world.cancelled = 0
  world.slow = false
  world.done = []
  world.stored.clear()
  world.local = { fits: false, ready: false, keepsUp: true, fetched: 0 }
  engines.choose(null)
})

afterEach(() => {
  voice.cancel()
  voice.asking = null
  action?.destroy()
  if (drawn) void unmount(drawn)
  target.remove()
})

describe('with no engine chosen', () => {
  test('a press asks where the voice goes, and opens nothing', async () => {
    press(0)
    await settle()
    expect(world.started).toEqual([])
    expect(target.querySelector('[role="dialog"]')?.textContent).toContain('Orden account')
  })

  test('the key asks too', async () => {
    key('keydown', { key: 'v', altKey: true })
    await settle()
    expect(world.started).toEqual([])
    expect(voice.asking).toBe(owner)
  })

  test('the chooser offers the provider first, and says where audio goes', async () => {
    world.provider = {
      id: 'p',
      kind: 'compatible',
      name: 'Whisper here',
      baseUrl: 'http://localhost:8080',
    }
    press(0)
    await settle()
    const rows = [...target.querySelectorAll('[role="dialog"] button')].map(
      (one) => one.textContent,
    )
    expect(rows[0]).toContain('Whisper here')
    expect(rows[0]).toContain('Stays on this computer')
    expect(rows[1]).toContain('Orden account')
  })

  test('a choice is kept for this device and starts listening on that road', async () => {
    press(0)
    await settle()
    target.querySelector<HTMLElement>('[role="dialog"] button')!.click()
    await settle()
    expect(world.stored.get('orden:dictation-engine')).toBe('account')
    expect(world.started).toEqual([{ engine: 'account', words: ['Sync Worker'] }])
  })
})

describe('on a computer that can hear on its own (#1151)', () => {
  beforeEach(() => {
    world.local.fits = true
  })

  test('the chooser offers Auto first, saying where the voice goes until the model is here', async () => {
    press(0)
    await settle()
    const rows = [...target.querySelectorAll('[role="dialog"] button')].map(
      (one) => one.textContent,
    )
    expect(rows[0]).toContain('Auto')
    expect(rows[0]).toContain('670 MB')
    expect(rows[0]).toContain('until then Orden account')
    expect(rows[1]).toContain('This computer')
    expect(rows[1]).toContain('Stays on this computer')
    expect(rows[2]).toContain('Orden account')
    expect(world.local.fetched).toBe(0)
  })

  test('Auto downloads the model and listens on the network road meanwhile', async () => {
    press(0)
    await settle()
    target.querySelector<HTMLElement>('[role="dialog"] button')!.click()
    await settle()
    expect(world.stored.get('orden:dictation-engine')).toBe('auto')
    expect(world.local.fetched).toBe(1)
    expect(world.started).toEqual([{ engine: 'account', words: ['Sync Worker'] }])
  })

  test('and on this computer once the model is here', async () => {
    world.local.ready = true
    engines.choose('auto')
    press(0)
    await settle()
    expect(world.started).toEqual([{ engine: 'local', words: ['Sync Worker'] }])
  })
})

describe('with an engine chosen', () => {
  beforeEach(() => engines.choose('account'))

  test('a click starts and a second click finishes', async () => {
    press(0)
    await settle()
    expect(voice.of(owner)).toBe('listening')
    expect(button().getAttribute('aria-pressed')).toBe('true')
    press(0)
    await settle()
    expect(world.finished).toBe(1)
    expect(voice.of(owner)).toBe('idle')
  })

  test('a press held is push-to-talk: letting go finishes', async () => {
    press(HOLD + 50)
    await settle()
    expect(world.started).toHaveLength(1)
    expect(world.finished).toBe(1)
  })

  test('the key reads a tap and a hold the same way', async () => {
    key('keydown', { key: 'v', altKey: true })
    key('keyup', { key: 'v', altKey: true })
    await settle()
    expect(voice.of(owner)).toBe('listening')
    key('keydown', { key: 'v', altKey: true })
    await settle()
    expect(world.finished).toBe(1)

    const at = performance.now()
    vi.spyOn(performance, 'now').mockReturnValue(at)
    key('keydown', { key: 'v', altKey: true })
    await settle()
    vi.spyOn(performance, 'now').mockReturnValue(at + HOLD + 10)
    key('keyup', { key: 'v', altKey: true })
    vi.restoreAllMocks()
    await settle()
    expect(world.finished).toBe(2)
  })

  test('Escape cancels, and is spent', async () => {
    press(0)
    await settle()
    let reached = false
    target.addEventListener('keydown', () => (reached = true))
    key('keydown', { key: 'Escape' })
    expect(world.cancelled).toBe(1)
    expect(voice.of(owner)).toBe('idle')
    expect(reached).toBe(false)
  })

  test('a finish still writing down when Escape and a new start come leaves the new listening alone', async () => {
    world.slow = true
    press(0)
    await settle()
    key('keydown', { key: 'v', altKey: true })
    await settle()
    expect(voice.of(owner)).toBe('finishing')
    key('keydown', { key: 'Escape' })
    expect(voice.of(owner)).toBe('idle')
    press(0)
    await settle()
    expect(voice.of(owner)).toBe('listening')
    const cancelled = world.cancelled

    for (const done of world.done) done()
    await settle()

    expect(voice.of(owner)).toBe('listening')
    expect(world.cancelled).toBe(cancelled)
  })

  test('Enter finishes, then is the field’s own Enter', async () => {
    press(0)
    await settle()
    key('keydown', { key: 'Enter' })
    expect(entered).toBe(0)
    await settle()
    expect(world.finished).toBe(1)
    expect(entered).toBe(1)
  })

  test('a chosen road that cannot be taken any more asks again', async () => {
    world.token = null
    world.provider = { id: 'p', kind: 'openai', name: 'OpenAI' }
    press(0)
    await settle()
    expect(world.started).toEqual([])
    expect(voice.asking).toBe(owner)
  })

  test('a field going away takes its dictation with it', async () => {
    press(0)
    await settle()
    action?.destroy()
    action = undefined
    expect(world.cancelled).toBe(1)
  })
})

describe('the device’s own recogniser', () => {
  afterEach(() => {
    delete (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  })

  test('is offered where there is one, saying whose it is', async () => {
    Object.assign(globalThis, { webkitSpeechRecognition: vi.fn() })
    press(0)
    await settle()
    const rows = [...target.querySelectorAll('[role="dialog"] button')].map(
      (one) => one.textContent,
    )
    expect(rows.at(-1)).toContain('This device')
    expect(rows.at(-1)).toContain('maker’s servers')
  })

  test('is the road taken once chosen, and none of Whisper’s', async () => {
    Object.assign(globalThis, { webkitSpeechRecognition: vi.fn() })
    engines.choose('device')
    press(0)
    await settle()
    expect(world.started).toEqual([{ engine: 'device', words: [] }])
  })
})
