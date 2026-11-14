import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  asked: [] as { command: string; args: unknown }[],
  keys: new Map<string, string>(),
  file: { text: null as string | null, stamp: 0 },
  chatgpt: null as { email: string } | null,
}))

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  openExternal: () => Promise.resolve(),
  invoke: (command: string, args: unknown) => {
    world.asked.push({ command, args })
    if (command === 'ai_cli_status') {
      return Promise.resolve({
        program: '/bin/fake',
        home: null,
        out: JSON.stringify({ loggedIn: true, subscriptionType: 'max', email: 'me@example.com' }),
        code: 0,
        err: '',
        timedOut: false,
      })
    }
    if (command === 'ai_cli_usage') {
      return Promise.resolve({
        rate_limits: { seven_day: { utilization: 42, resets_at: '2030-01-07T09:00:00Z' } },
      })
    }
    if (command === 'chatgpt_account') return Promise.resolve(world.chatgpt)
    if (command === 'chatgpt_sign_in') {
      world.chatgpt = { email: 'me@example.com' }
      return Promise.resolve(world.chatgpt)
    }
    return Promise.resolve(null)
  },
}))

vi.mock('../../src/lib/ai/accounts-file', () => ({
  COPY: 'orden:ai-accounts',
  STALE: 'stale',
  readKept: () => Promise.resolve({ text: world.file.text, stamp: String(world.file.stamp) }),
  writeKept: (text: string) => {
    world.file.text = text
    world.file.stamp += 1
    return Promise.resolve(String(world.file.stamp))
  },
  hearChanges: () => Promise.resolve(),
}))

vi.mock('../../src/lib/ai/keys', () => ({
  keysAreGuarded: () => true,
  keysInFile: () => Promise.resolve(false),
  keysMoved: () => () => undefined,
  hasKey: (id: string) => Promise.resolve(world.keys.has(id)),
  readKey: () => Promise.resolve(''),
  writeKey: (id: string, secret: string) => {
    world.keys.set(id, secret)
    return Promise.resolve()
  },
  forgetKey: (id: string) => {
    world.keys.delete(id)
    return Promise.resolve()
  },
  writeSecret: () => Promise.resolve(),
  readSecret: () => Promise.resolve(null),
}))

vi.mock('../../src/lib/ai/complete', () => ({
  listModels: () => Promise.resolve(['model-a']),
}))

vi.mock('../../src/lib/ai/vault/start.svelte', () => ({
  browserVault: { on: false },
  keepBrowserInVault: () => Promise.resolve(),
  vault: { standing: 'open', allowed: [], seen: {}, remove: () => Promise.resolve(true) },
  startVault: () => undefined,
}))

const { default: AiPane } = await import('../../src/lib/AiPane.svelte')
const { ai } = await import('../../src/lib/ai/store.svelte')
const { NONE, added } = await import('../../src/lib/ai/accounts')
const { usage } = await import('../../src/lib/ai/usage.svelte')

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
    set onfinish(done: (() => void) | null) {
      if (done) queueMicrotask(done)
    },
  }) as unknown as Animation

let host: HTMLElement
let shown: ReturnType<typeof mount> | null = null

async function settled() {
  for (let round = 0; round < 8; round++) await Promise.resolve()
  await vi.waitFor(() => undefined)
  flushSync()
}

function open() {
  shown = mount(AiPane, { target: host })
  flushSync()
}

const card = (id: string) => host.querySelector<HTMLElement>(`[data-account="${id}"]`)
const cards = () => [...host.querySelectorAll<HTMLElement>('[data-account]')]
const buttonIn = (root: ParentNode, words: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (one) => one.textContent.trim() === words,
  )
const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]')

function start(...kinds: Parameters<typeof added>[1][]) {
  ai.adopt(kinds.reduce((state, kind) => added(state, kind).state, NONE))
}

beforeEach(() => {
  world.asked = []
  world.keys = new Map()
  world.chatgpt = null
  for (const one of ai.accounts) usage.forget(one.id)
  ai.adopt(NONE)
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  if (shown) void unmount(shown)
  shown = null
  document.body.innerHTML = ''
})

describe('Settings > AI accounts', () => {
  test('are one flat list of cards, each naming its provider', async () => {
    start('claude-code', 'anthropic', 'codex')
    open()
    await settled()
    expect(host.querySelector('[data-vendor]')).toBeNull()
    expect(cards().map((one) => one.dataset.account)).toEqual(['claude-code', 'anthropic', 'codex'])
    for (const one of cards()) expect(one.querySelector('.mark')).not.toBeNull()
    expect(card('anthropic')?.textContent).toContain('Claude')
    expect(card('codex')?.textContent).toContain('OpenAI')
  })

  test('mark exactly one default, and Make default moves it', async () => {
    start('claude-code', 'anthropic', 'codex')
    open()
    await settled()
    const defaults = () => cards().filter((one) => one.classList.contains('fallback'))
    expect(defaults().map((one) => one.dataset.account)).toEqual(['claude-code'])
    expect(buttonIn(card('claude-code')!, 'Make default')).toBeUndefined()

    buttonIn(card('codex')!, 'Make default')?.click()
    flushSync()
    expect(defaults().map((one) => one.dataset.account)).toEqual(['codex'])
    expect(ai.defaultAccount?.id).toBe('codex')
    expect(buttonIn(card('claude-code')!, 'Make default')).toBeDefined()

    buttonIn(card('anthropic')!, 'Make default')?.click()
    flushSync()
    expect(defaults().map((one) => one.dataset.account)).toEqual(['anthropic'])
    expect(host.textContent).not.toContain('In use')
  })

  test('hold no model field, model list or the removed sentences', async () => {
    start('claude-code', 'anthropic', 'chatgpt', 'compatible')
    open()
    await settled()
    expect(host.textContent).not.toContain('Model')
    expect(host.textContent).not.toContain('List models')
    expect(host.textContent).not.toContain('AI can be wrong')
    expect(host.textContent).not.toContain('end-to-end encrypted')
  })

  test('show a plan’s weekly usage with when it resets', async () => {
    start('claude-code', 'anthropic')
    open()
    await vi.waitFor(() => {
      if (!card('claude-code')?.querySelector('[data-week]')) throw new Error('no usage yet')
    })
    const bar = card('claude-code')!.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-valuenow')).toBe('42')
    expect(card('claude-code')?.textContent).toContain('42% used this week')
    expect(card('claude-code')?.textContent).toContain('Resets ')
    expect(card('anthropic')?.querySelector('[data-week]')).toBeNull()
  })

  test('put the three task switches under Permissions', async () => {
    open()
    await vi.waitFor(() => {
      if (!host.querySelector('[data-permissions]')) throw new Error('not drawn yet')
    })
    const permissions = host.querySelector('[data-permissions]')!
    expect(permissions.previousElementSibling?.textContent).toBe('Permissions')
    expect(permissions.querySelectorAll('[role="switch"]')).toHaveLength(3)
  })
})

describe('Add', () => {
  async function through(maker: string, road: string | null) {
    open()
    await settled()
    expect(host.querySelectorAll('[data-add-account]')).toHaveLength(1)
    host.querySelector<HTMLButtonElement>('[data-add-account]')!.click()
    flushSync()
    sheet()!.querySelector<HTMLButtonElement>(`[data-maker="${maker}"]`)!.click()
    flushSync()
    if (road) {
      sheet()!.querySelector<HTMLButtonElement>(`[data-road="${road}"]`)!.click()
      flushSync()
    }
    return sheet()!.querySelector<HTMLFormElement>('[data-step="connect"]')!
  }

  function type(form: HTMLElement, at: number, words: string) {
    const field = form.querySelectorAll('input')[at]!
    field.value = words
    field.dispatchEvent(new Event('input'))
    flushSync()
  }

  async function submit(form: HTMLFormElement) {
    form.requestSubmit()
    await vi.waitFor(() => {
      if (sheet()) throw new Error('still open')
    })
    await settled()
  }

  test('offers the providers as tiles, then only their ways', async () => {
    open()
    await settled()
    host.querySelector<HTMLButtonElement>('[data-add-account]')!.click()
    flushSync()
    const makers = [...sheet()!.querySelectorAll<HTMLElement>('[data-maker]')]
    expect(makers.map((one) => one.dataset.maker)).toEqual([
      'anthropic',
      'openai',
      'google',
      'compatible',
    ])
    makers[1]!.click()
    flushSync()
    const roads = [...sheet()!.querySelectorAll<HTMLElement>('[data-road]')]
    expect(roads.map((one) => one.dataset.road)).toEqual(['chatgpt', 'codex', 'openai'])
    buttonIn(sheet()!, 'Back')!.click()
    flushSync()
    expect(sheet()!.querySelectorAll('[data-maker]')).toHaveLength(4)
  })

  for (const [maker, road] of [
    ['anthropic', 'anthropic'],
    ['openai', 'openai'],
    ['google', 'gemini'],
  ] as const) {
    test(`connects ${maker} by an API key, asking only the key`, async () => {
      const form = await through(maker, road)
      expect(form.querySelectorAll('input')).toHaveLength(1)
      expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
      type(form, 0, 'secret-key')
      await submit(form)
      const made = ai.accounts.find((one) => one.kind === road)
      expect(made).toBeDefined()
      expect(world.keys.get(made!.id)).toBe('secret-key')
      expect(made!.model).toBe('model-a')
    })
  }

  for (const [maker, road] of [
    ['anthropic', 'claude-code'],
    ['openai', 'codex'],
    ['google', 'gemini-cli'],
  ] as const) {
    test(`connects ${maker} through ${road} with no field at all`, async () => {
      const form = await through(maker, road)
      expect(form.querySelectorAll('input')).toHaveLength(0)
      await submit(form)
      expect(ai.accounts.map((one) => one.kind)).toEqual([road])
      expect(world.asked.some((one) => one.command === 'ai_cli_status')).toBe(true)
    })
  }

  test('signs in to ChatGPT before adding it', async () => {
    const form = await through('openai', 'chatgpt')
    expect(form.querySelectorAll('input')).toHaveLength(0)
    await submit(form)
    expect(world.asked.some((one) => one.command === 'chatgpt_sign_in')).toBe(true)
    expect(ai.accounts.map((one) => one.kind)).toEqual(['chatgpt'])
  })

  test('connects an OpenAI-compatible server by its URL, the key optional', async () => {
    const form = await through('compatible', null)
    expect(form.querySelectorAll('input')).toHaveLength(3)
    type(form, 0, 'Home')
    type(form, 1, 'http://localhost:11434')
    await submit(form)
    const made = ai.accounts.find((one) => one.kind === 'compatible')
    expect(made).toMatchObject({ name: 'Home', baseUrl: 'http://localhost:11434' })
    expect(world.keys.size).toBe(0)
  })
})
