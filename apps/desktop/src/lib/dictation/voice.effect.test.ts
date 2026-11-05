import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** The one dictation control every field draws (#1128), and which road it takes: the
 *  microphone button and the key read a tap and a hold the same way, Escape cancels,
 *  Enter finishes and is then the field's Enter, and nothing is opened - let alone sent
 *  - before the reader has chosen where a voice goes. The work itself is stood in for;
 *  listening.effect.test.ts is that. */

const world = vi.hoisted(() => ({
  token: null as string | null,
  provider: null as null | { id: string; kind: string; name: string; baseUrl?: string },
  started: [] as { engine: string; words: readonly string[] }[],
  finished: 0,
  cancelled: 0,
  stored: new Map<string, string>(),
}))

vi.mock('./listening', () => ({
  listen: (_field: unknown, engine: string, words: readonly string[]) => {
    world.started.push({ engine, words })
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

/** Long enough for the fetched half of dictation to arrive and answer. */
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
  // The host's own keys, where Svelte hears them: further up, as a delegated handler.
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
  world.stored.clear()
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
    expect(world.stored.get('nib:dictation-engine')).toBe('account')
    expect(world.started).toEqual([{ engine: 'account', words: ['Sync Worker'] }])
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

  test('Enter finishes, then is the field’s own Enter', async () => {
    press(0)
    await settle()
    key('keydown', { key: 'Enter' })
    // The press itself is held back until the final words are in.
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
