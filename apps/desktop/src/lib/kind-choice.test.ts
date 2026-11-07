import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

const saved = vi.hoisted(() => [] as [string, unknown][])
vi.mock('./api', async (actual) => ({
  ...(await actual<typeof import('./api')>()),
  api: {
    saveSettings: (token: string, patch: unknown) => {
      saved.push([token, patch])
      return Promise.resolve({ settings: {} })
    },
  },
}))

const { hiddenKinds, kindsHere, PASS_WORD, shownOf } = await import('./settings.svelte')
const { hiddenOf, locked, mayHide, receive, setKind, setWord } = await import('./kind-choice')
const { offeredKinds, newKinds } = await import('./new-kinds')
const { newFileRows } = await import('./row-menu')
const { account } = await import('./account.svelte')
const { viewport } = await import('./viewport.svelte')

let token: string | null = null
Object.defineProperty(account, 'accountToken', { get: () => token, configurable: true })

let was: 'phone' | 'tablet' | 'desktop'

beforeEach(() => {
  was = viewport.device
  viewport.device = 'desktop'
  store.clear()
  saved.length = 0
  hiddenKinds.restore()
})

afterEach(() => {
  viewport.device = was
  token = null
  vi.restoreAllMocks()
})

describe('the kinds offered', () => {
  const here = ['note', 'canvas', 'pages', 'web'] as const

  test('are every kind here that nobody turned off', () => {
    expect(shownOf(here, [])).toEqual(['note', 'canvas', 'pages', 'web'])
    expect(shownOf(here, ['canvas', 'web'])).toEqual(['note', 'pages'])
  })

  test('keep the first when another device turned all of these off', () => {
    expect(shownOf(here, ['note', 'canvas', 'pages', 'web'])).toEqual(['note'])
  })

  test('let any but the last one offered be turned off', () => {
    expect(mayHide('canvas', here, [])).toBe(true)
    expect(mayHide('note', here, ['canvas', 'pages'])).toBe(true)
    expect(mayHide('note', here, ['canvas', 'pages', 'web'])).toBe(false)
    expect(mayHide('web', here, ['web'])).toBe(false)
  })
})

describe('a stored list of kinds turned off', () => {
  test('keeps words, once each, in the order written', () => {
    expect(hiddenOf(['canvas', 'web', 'canvas'])).toEqual(['canvas', 'web'])
  })

  test('keeps a kind this version has never heard of', () => {
    expect(hiddenOf(['something-new'])).toEqual(['something-new'])
  })

  test('drops what could be no kind', () => {
    expect(hiddenOf(['Canvas', 3, '', 'web note', null, 'web'])).toEqual(['web'])
    expect(hiddenOf('canvas')).toEqual([])
    expect(hiddenOf(null)).toEqual([])
  })
})

describe('the kinds a device has', () => {
  test('are what is written, the online terminal and an application on a page in a browser', () => {
    expect(kindsHere()).toEqual(['note', 'canvas', 'pages', 'online', 'application', 'web'])
  })

  test('take Pass in once Settings turns the password manager on', () => {
    setWord(PASS_WORD, true)
    expect(kindsHere()).toEqual(['note', 'canvas', 'pages', 'online', 'application', 'pass', 'web'])
    setWord(PASS_WORD, false)
    expect(kindsHere()).not.toContain('pass')
  })

  test('take the chat in with an account', () => {
    token = 'token'
    expect(kindsHere()).toContain('chat')
  })

  test('leave the web out on a phone', () => {
    viewport.device = 'phone'
    expect(kindsHere()).not.toContain('web')
  })

  test('and on a tablet', () => {
    viewport.device = 'tablet'
    expect(kindsHere()).not.toContain('web')
  })
})

describe('turning a kind off', () => {
  test('takes it out of the chooser and the file list, and nothing else', () => {
    setKind('canvas', false)

    expect(offeredKinds().map((one) => one.kind)).toEqual([
      'note',
      'pages',
      'online',
      'application',
      'web',
    ])
    expect(newFileRows().map((one) => one?.label)).toEqual([
      'New note',
      'New page note',
      'New web note',
      'New database',
    ])
    expect(newKinds().map((one) => one.kind)).toContain('canvas')
  })

  test('is undone by turning it on, and the default is stored as nothing', () => {
    setKind('canvas', false)
    expect(JSON.parse(store.get('orden:hidden-kinds') ?? '[]')).toEqual(['canvas'])

    setKind('canvas', true)
    expect(hiddenKinds.offers('canvas')).toBe(true)
    expect(store.has('orden:hidden-kinds')).toBe(false)
  })

  test('is refused for the last kind offered', () => {
    for (const kind of ['note', 'canvas', 'pages', 'online', 'application', 'pass'] as const)
      setKind(kind, false)
    expect(hiddenKinds.shown).toEqual(['web'])

    setKind('web', false)
    expect(hiddenKinds.shown).toEqual(['web'])
    expect(locked('web')).toBe(true)
  })

  test('is read back by the next run', () => {
    setKind('pages', false)
    hiddenKinds.hidden = []

    hiddenKinds.restore()
    expect(hiddenKinds.offers('pages')).toBe(false)
  })
})

describe('the account', () => {
  test('is told, and told null for every kind back on', () => {
    token = 'token'

    setKind('web', false)
    setKind('web', true)

    expect(saved.map(([, patch]) => patch)).toEqual([
      { hiddenKinds: ['web'] },
      { hiddenKinds: null },
    ])
  })

  test('is followed, the last machine to change it winning', () => {
    receive({ hiddenKinds: ['canvas', 'something-new'] })
    expect(hiddenKinds.offers('canvas')).toBe(false)
    expect(hiddenKinds.hidden).toEqual(['canvas', 'something-new'])

    receive({ hiddenKinds: null })
    expect(hiddenKinds.offers('canvas')).toBe(true)
    expect(store.has('orden:hidden-kinds')).toBe(false)
  })

  test('that never heard of it takes this machine’s list', () => {
    setKind('pages', false)
    token = 'token'

    receive({})
    expect(saved).toEqual([['token', { hiddenKinds: ['pages'] }]])
  })
})
