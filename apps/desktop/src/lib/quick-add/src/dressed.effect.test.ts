import { flushSync, mount, unmount } from 'svelte'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

const CUSTOM = '.note { color: hotpink; }'
const DUSK = "[data-theme='light'] { --bg: #f4e9dc; } [data-theme='dark'] { --bg: #21140f; }"

const answers: Record<string, unknown> = {
  list_themes: [{ id: 'dusk', name: 'Dusk', path: '/themes/dusk.css' }],
  read_theme: DUSK,
  read_custom_css: CUSTOM,
}

vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  invoke: (command: string) => Promise.resolve(answers[command] ?? null),
}))

class Channel {
  static open: Channel[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  constructor() {
    Channel.open.push(this)
  }
  postMessage(said: unknown) {
    const copy = structuredClone(said)
    for (const other of Channel.open) {
      if (other !== this)
        queueMicrotask(() => other.onmessage?.(new MessageEvent('message', { data: copy })))
    }
  }
  close() {
    Channel.open = Channel.open.filter((one) => one !== this)
  }
}
vi.stubGlobal('BroadcastChannel', Channel)
vi.stubGlobal('matchMedia', (query: string) => ({
  media: query,
  matches: false,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
}))

let visible: DocumentVisibilityState = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible })

const { theme } = await import('../../theme/src/api')
const { listen } = await import('./anywhere.svelte')
const Window = (await import('./Window.svelte')).default

let stopAnswering: () => void = () => undefined
let target: HTMLDivElement | undefined
let shown: ReturnType<typeof mount> | undefined

beforeAll(async () => {
  theme.init()
  stopAnswering = listen()
  await settled()
})

afterAll(() => {
  if (shown) void unmount(shown)
  target?.remove()
  stopAnswering()
})

async function settled() {
  for (let turn = 0; turn < 10; turn++) await new Promise((later) => setTimeout(later, 0))
  flushSync()
}

function looks() {
  const root = document.documentElement
  const tokens = Array.from(root.style)
    .filter((name) => name.startsWith('--'))
    .sort()
    .map((name) => [name, root.style.getPropertyValue(name)])
  return {
    scheme: root.dataset.theme,
    sheet: document.getElementById('orden-user-theme')?.textContent ?? '',
    custom: document.getElementById('orden-custom-css')?.textContent ?? '',
    tokens: Object.fromEntries(tokens),
  }
}

function anotherWindow() {
  const root = document.documentElement
  document.getElementById('orden-user-theme')?.remove()
  document.getElementById('orden-custom-css')?.remove()
  for (const name of Array.from(root.style))
    if (name.startsWith('--')) root.style.removeProperty(name)
  root.dataset.theme = 'dark'
}

const turn = (state: DocumentVisibilityState) => {
  visible = state
  document.dispatchEvent(new Event('visibilitychange'))
  flushSync()
}

test('quick add opens in the theme, mode, accent and custom theme the app wears', async () => {
  theme.select('dusk')
  theme.setAccent('orange')
  theme.setScheme('light')
  await settled()
  const app = looks()
  expect(app.scheme).toBe('light')
  expect(app.sheet).toContain('#f4e9dc')
  expect(app.custom).toContain('hotpink')
  expect(Object.values(app.tokens)).toContain('#c44500')

  anotherWindow()
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(Window, { target })
  await settled()
  expect(looks()).toEqual(app)
})

test('and follows a theme changed while it was hidden', async () => {
  turn('hidden')
  theme.select('default')
  theme.setAccent('teal')
  theme.setScheme('dark')
  const app = looks()
  expect(app.scheme).toBe('dark')
  expect(app.sheet).toBe('')
  expect(Object.values(app.tokens)).toContain('#33c7ba')

  anotherWindow()
  await settled()
  turn('visible')
  await settled()
  expect(looks()).toEqual(app)
})
