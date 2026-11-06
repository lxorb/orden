import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

vi.mock('./tauri', async (actual) => ({
  ...(await actual<typeof import('./tauri')>()),
  isDesktop: true,
}))

const saved = vi.hoisted(() => [] as unknown[])
vi.mock('./api', async (actual) => ({
  ...(await actual<typeof import('./api')>()),
  api: {
    saveSettings: (_token: string, patch: unknown) => {
      saved.push(patch)
      return Promise.resolve({ settings: {} })
    },
  },
}))

const opened = vi.hoisted(() => [] as unknown[])
vi.mock('./explorer/open', () => ({
  openExplorer: () => {
    opened.push('explorer')
    return Promise.resolve()
  },
}))

const { hiddenKinds, kindsHere, KINDS_KEY } = await import('./settings.svelte')
const { receive, setKind } = await import('./kind-choice')
const { offeredKinds } = await import('./new-kinds')
const { kindOfLetter } = await import('./new-kind-keys')
const { kindsPane } = await import('./settings/kinds-pane')
const { BY_ID } = await import('./shortcuts/registry')
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
  opened.length = 0
  hiddenKinds.restore()
})

afterEach(() => {
  viewport.device = was
  token = null
})

function field() {
  const found = kindsPane()
    .groups.flatMap((group) => group.fields)
    .find((one) => one.key === 'kinds.explorer')
  if (found?.kind !== 'switch') throw new Error('no switch for the file explorer')
  return found
}

const offered = () => offeredKinds().map((one) => one.kind)
const lettered = () => kindOfLetter(offeredKinds(), { key: 'f' })?.kind ?? null

async function pressed() {
  BY_ID.get('app.explorer')?.run?.({ palette: () => undefined, fullscreen: () => undefined })
  await vi.dynamicImportSettled()
  return opened.length > 0
}

describe('the file explorer, as a kind a new tab can be', () => {
  test('is on a desktop, but not offered until it is turned on', async () => {
    expect(kindsHere()).toContain('explorer')
    expect(hiddenKinds.offers('explorer')).toBe(false)
    expect(offered()).not.toContain('explorer')
    expect(offered()).toContain('note')
    expect(lettered()).toBeNull()
    expect(await pressed()).toBe(false)
  })

  test('shows in Settings as off, and off is its default', () => {
    expect(field().get()).toBe(false)
    expect(field().initial).toBe(false)
    expect(field().locked?.()).toBe(false)
  })

  test('stays off for a reader who chose other kinds before', () => {
    store.set(KINDS_KEY, JSON.stringify(['canvas']))
    hiddenKinds.restore()

    expect(hiddenKinds.offers('explorer')).toBe(false)
    expect(hiddenKinds.offers('canvas')).toBe(false)
    expect(hiddenKinds.offers('note')).toBe(true)
  })

  test('is offered once Settings turns it on, with its letter and its key', async () => {
    field().set(true)

    expect(field().get()).toBe(true)
    expect(offered()).toContain('explorer')
    expect(lettered()).toBe('explorer')
    expect(await pressed()).toBe(true)
  })

  test('stays on for the next run, and goes back to nothing stored when off', () => {
    field().set(true)
    expect(JSON.parse(store.get(KINDS_KEY) ?? '[]')).toEqual(['shown-explorer'])

    hiddenKinds.hidden = []
    hiddenKinds.restore()
    expect(hiddenKinds.offers('explorer')).toBe(true)

    field().set(false)
    expect(hiddenKinds.offers('explorer')).toBe(false)
    expect(store.has(KINDS_KEY)).toBe(false)
  })

  test('keeps what else the reader chose when it is turned on and off', () => {
    store.set(KINDS_KEY, JSON.stringify(['canvas', 'explorer']))
    hiddenKinds.restore()

    setKind('explorer', true)
    expect(hiddenKinds.hidden).toEqual(['canvas', 'shown-explorer'])
    expect(hiddenKinds.offers('canvas')).toBe(false)

    setKind('explorer', false)
    expect(hiddenKinds.hidden).toEqual(['canvas'])
  })

  test('is told to the account, and followed from it', () => {
    token = 'token'
    setKind('explorer', true)
    expect(saved).toEqual([{ hiddenKinds: ['shown-explorer'] }])

    receive({ hiddenKinds: null })
    expect(hiddenKinds.offers('explorer')).toBe(false)

    receive({ hiddenKinds: ['web', 'shown-explorer'] })
    expect(hiddenKinds.offers('explorer')).toBe(true)
    expect(hiddenKinds.offers('web')).toBe(false)
  })
})
