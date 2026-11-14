import 'fake-indexeddb/auto'
import { blank } from '@orden/pass/envelope'
import type { Alias, Item } from '@orden/pass/types'
import { type Component, flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../ai/keys', () => ({
  keysAreGuarded: () => false,
  readSecret: () => Promise.resolve(null),
  writeSecret: () => Promise.resolve(),
  forgetKey: () => Promise.resolve(),
}))

vi.mock('../../protect/src/device', () => ({
  deviceCan: () => Promise.resolve(false),
  deviceSays: () => Promise.resolve(false),
  deviceName: () => 'Touch ID',
}))

const { configurePass, pass } = await import('../../pass-sync/src/store.svelte')
const { PassUi } = await import('../../pass-sync/src/ui.svelte')
const SettingsAliases = (await import('./SettingsAliases.svelte')).default
const ItemEdit = (await import('./ItemEdit.svelte')).default
const ItemView = (await import('./ItemView.svelte')).default

const FAST = { m: 64, t: 1, p: 1 }
configurePass({ kdf: FAST, pinKdf: FAST })

interface Asked {
  method: string
  url: string
  body: unknown
}

let asked: Asked[] = []
let answers: Record<string, [number, unknown]> = {}

const SL = 'https://app.simplelogin.io'

const OPTIONS: [number, unknown] = [
  200,
  {
    can_create: true,
    prefix_suggestion: '',
    suffixes: [
      { suffix: '.cat@slmail.me', signed_suffix: '.cat@slmail.me.SIG', is_premium: false },
    ],
  },
]

const MAILBOXES: [number, unknown] = [
  200,
  { mailboxes: [{ id: 1, email: 'me@example.com', default: true }] },
]

let target: HTMLElement
let shown: ReturnType<typeof mount> | undefined
let vault = ''

beforeAll(async () => {
  await pass.start()
  if (pass.state === 'new') await pass.setup('correct horse battery staple')
  vault = pass.vaults[0]?.id ?? ''
})

beforeEach(async () => {
  asked = []
  answers = {
    'GET /api/v5/alias/options': OPTIONS,
    'GET /api/v2/mailboxes': MAILBOXES,
  }
  vi.stubGlobal('fetch', (input: string, init: RequestInit) => {
    const method = init.method ?? 'GET'
    const url = new URL(input)
    asked.push({
      method,
      url: input,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
    })
    const [status, body] = answers[`${method} ${url.pathname}`] ?? [404, { error: 'not here' }]
    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  })
  await pass.setAliasProvider(null)
})

afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  target.remove()
  vi.unstubAllGlobals()
})

function showing<P extends Record<string, unknown>>(component: Component<P>, props: P) {
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(component, { target, props, intro: false })
  flushSync()
}

function typed(field: HTMLInputElement | null, text: string) {
  if (!field) throw new Error('no field')
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...target.querySelectorAll('button')].find(
    (one) => one.textContent.trim() === name,
  )
  if (!button) throw new Error(`no ${name}`)
  return button
}

describe('Settings > Aliases', () => {
  test('tests a key, connects it and keeps it sealed, then disconnects', async () => {
    showing(SettingsAliases, {})
    const key = await vi.waitFor(() => {
      const field = target.querySelector<HTMLInputElement>('input[type="password"]')
      if (!field) throw new Error('no key field')
      return field
    })
    typed(key, 'sl-key')
    buttonNamed('Test connection').click()
    await vi.waitFor(() => expect(target.textContent).toContain('Connected. 1 mailboxes.'))
    expect(await pass.aliasProvider()).toBeNull()

    target.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(buttonNamed('Disconnect')).toBeTruthy())
    expect(await pass.aliasProvider()).toMatchObject({ provider: 'simplelogin', key: 'sl-key' })
    await vi.waitFor(() => expect(target.textContent).toContain('me@example.com'))

    buttonNamed('Disconnect').click()
    await vi.waitFor(() => expect(target.querySelector('input[type="password"]')).not.toBeNull())
    expect(await pass.aliasProvider()).toBeNull()
  })

  test('says what a wrong key is told', async () => {
    answers['GET /api/v2/mailboxes'] = [401, { error: 'Wrong api key' }]
    showing(SettingsAliases, {})
    const key = await vi.waitFor(() => {
      const field = target.querySelector<HTMLInputElement>('input[type="password"]')
      if (!field) throw new Error('no key field')
      return field
    })
    typed(key, 'bad')
    target.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() =>
      expect(target.querySelector('[role="alert"]')?.textContent).toContain('Wrong api key'),
    )
    expect(await pass.aliasProvider()).toBeNull()
  })
})

describe('a new alias', () => {
  test('is made at the alias service from a prefix and a suffix', async () => {
    await pass.setAliasProvider({ provider: 'simplelogin', key: 'k', mailbox: null, suffix: null })
    answers['POST /api/v3/alias/custom/new'] = [
      201,
      {
        id: 9,
        email: 'shop.cat@slmail.me',
        enabled: true,
        name: '',
        note: null,
        mailboxes: [{ id: 1, email: 'me@example.com' }],
      },
    ]
    const ui = new PassUi(null)
    await ui.newItem(blank('alias'))
    showing(ItemEdit, { ui })
    const prefix = await vi.waitFor(() => {
      const field = [...target.querySelectorAll<HTMLInputElement>('input')].find(
        (one) => one.placeholder === 'shop',
      )
      if (!field) throw new Error('no prefix')
      return field
    })
    typed(target.querySelector('input.is-big'), 'Shop')
    typed(prefix, 'Shop!')
    expect(target.querySelector('[data-alias-preview]')?.textContent).toBe('shop.cat@slmail.me')
    target.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(ui.editing).toBeNull())
    const made = asked.find((one) => one.method === 'POST')
    expect(made?.body).toMatchObject({
      alias_prefix: 'shop',
      signed_suffix: '.cat@slmail.me.SIG',
      mailbox_ids: [1],
    })
    const item = pass.items.find((one) => one.content.title === 'Shop')
    expect(item?.content).toMatchObject({
      kind: 'alias',
      address: 'shop.cat@slmail.me',
      provider: 'simplelogin',
      remoteId: '9',
      enabled: true,
      mailboxes: ['me@example.com'],
    })
  })

  test('without a service is written by hand', async () => {
    const ui = new PassUi(null)
    await ui.newItem(blank('alias'))
    showing(ItemEdit, { ui })
    await vi.waitFor(() =>
      expect(target.textContent).toContain('Connect an alias service in Settings > Aliases'),
    )
    expect(target.querySelector('input[inputmode="email"]')).not.toBeNull()
  })
})

describe('an alias from a service', () => {
  async function made(): Promise<Item> {
    await pass.setAliasProvider({ provider: 'simplelogin', key: 'k', mailbox: null, suffix: null })
    const content: Alias = {
      ...blank('alias'),
      title: 'News',
      address: 'news.cat@slmail.me',
      provider: 'simplelogin',
      remoteId: '9',
      enabled: true,
      mailboxes: ['me@example.com'],
    }
    return await pass.create(vault, content)
  }

  test('shows where it forwards and its last 14 days, and is turned off at the service', async () => {
    const now = Date.now() / 1000
    answers['GET /api/aliases/9/activities'] = [
      200,
      {
        activities: [
          { action: 'forward', timestamp: now - 60 },
          { action: 'block', timestamp: now - 120 },
          { action: 'forward', timestamp: now - 30 * 86_400 },
        ],
      },
    ]
    answers['POST /api/aliases/9/toggle'] = [200, { enabled: false }]
    const item = await made()
    showing(ItemView, { ui: new PassUi(null), item })
    expect(target.textContent).toContain('me@example.com')
    await vi.waitFor(() =>
      expect(target.querySelector('[data-alias-stats]')?.textContent).toMatch(
        /Last 14 days.*1 forwarded.*0 replied.*1 blocked/,
      ),
    )
    const toggle = target.querySelector<HTMLButtonElement>('button[role="switch"]')
    expect(toggle?.getAttribute('aria-checked')).toBe('true')
    toggle?.click()
    await vi.waitFor(() => {
      const after = pass.items.find((one) => one.id === item.id)?.content
      expect(after?.kind === 'alias' && after.enabled).toBe(false)
    })
    expect(asked.filter((one) => one.url.endsWith('/toggle'))).toHaveLength(1)
  })

  test('copies its address', async () => {
    const item = await made()
    showing(ItemView, { ui: new PassUi(null), item })
    expect(target.querySelector('[data-field="Alias address"]')?.textContent).toContain(
      'news.cat@slmail.me',
    )
    expect(asked.every((one) => one.url.startsWith(SL))).toBe(true)
  })
})
