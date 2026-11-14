import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

vi.mock('./platform/src/tauri', async (actual) => ({
  ...(await actual<typeof import('./platform/src/tauri')>()),
  isDesktop: true,
}))

const saved = vi.hoisted(() => [] as unknown[])
vi.mock('./accounts/src/client', async (actual) => ({
  ...(await actual<typeof import('./accounts/src/client')>()),
  api: {
    saveSettings: (_token: string, patch: unknown) => {
      saved.push(patch)
      return Promise.resolve({ settings: {} })
    },
  },
}))

const opened = vi.hoisted(() => [] as unknown[])
vi.mock('./explorer/src/open', () => ({
  openExplorer: () => {
    opened.push('explorer')
    return Promise.resolve()
  },
}))

const { EXPERIMENTAL_WORD, EXPLORER_WORD, hiddenKinds, kindsHere, KINDS_KEY } =
  await import('./settings.svelte')
const { receive, setKind, setWord } = await import('./kind-choice')
const { offeredKinds } = await import('./new-kinds')
const { kindOfLetter } = await import('./new-kind-keys')
const { kindsPane } = await import('./settings/src/kinds-pane')
const { experimentalPane } = await import('./settings/src/experimental-pane')
const { BY_ID } = await import('./shortcuts/registry')
const { account } = await import('./accounts/src/account.svelte')
const { viewport } = await import('./ui-kit/src/viewport.svelte')

let token: string | null = null
Object.defineProperty(account, 'accountToken', { get: () => token, configurable: true })

let was: 'phone' | 'tablet' | 'desktop'

beforeEach(() => {
  was = viewport.device
  viewport.device = 'desktop'
  store.clear()
  saved.length = 0
  opened.length = 0
  store.set(KINDS_KEY, JSON.stringify([EXPERIMENTAL_WORD]))
  hiddenKinds.restore()
})

afterEach(() => {
  viewport.device = was
  token = null
})

function field() {
  const found = experimentalPane()
    .groups.flatMap((group) => group.fields)
    .find((one) => one.key === 'experimental.explorer')
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

describe('the file explorer, under Experimental', () => {
  test('is not there until it is turned on, and not among the note types', async () => {
    expect(kindsHere()).not.toContain('explorer')
    expect(hiddenKinds.offers('explorer')).toBe(false)
    expect(offered()).not.toContain('explorer')
    expect(offered()).toContain('note')
    expect(lettered()).toBeNull()
    expect(await pressed()).toBe(false)
    setWord(EXPLORER_WORD, true)
    expect(
      kindsPane()
        .groups.flatMap((group) => group.fields)
        .map((one) => one.key),
    ).not.toContain('kinds.explorer')
  })

  test('shows in Settings as off, and off is its default', () => {
    expect(field().get()).toBe(false)
    expect(field().initial).toBe(false)
    expect(field().locked?.()).toBe(false)
  })

  test('stays off for a reader who had it on before it was experimental', () => {
    store.set(KINDS_KEY, JSON.stringify(['canvas', 'shown-explorer']))
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

  test('stays on for the next run, and goes when turned off', () => {
    field().set(true)
    expect(JSON.parse(store.get(KINDS_KEY) ?? '[]')).toEqual([EXPERIMENTAL_WORD, EXPLORER_WORD])

    hiddenKinds.hidden = []
    hiddenKinds.restore()
    expect(hiddenKinds.offers('explorer')).toBe(true)

    field().set(false)
    expect(hiddenKinds.offers('explorer')).toBe(false)
    expect(JSON.parse(store.get(KINDS_KEY) ?? '[]')).toEqual([EXPERIMENTAL_WORD])
  })

  test('keeps what else the reader chose when it is turned on and off', () => {
    store.set(KINDS_KEY, JSON.stringify([EXPERIMENTAL_WORD, 'canvas']))
    hiddenKinds.restore()

    field().set(true)
    expect(hiddenKinds.hidden).toEqual([EXPERIMENTAL_WORD, 'canvas', EXPLORER_WORD])
    expect(hiddenKinds.offers('canvas')).toBe(false)
    setKind('explorer', false)
    expect(hiddenKinds.offers('explorer')).toBe(true)

    field().set(false)
    expect(hiddenKinds.hidden).toEqual([EXPERIMENTAL_WORD, 'canvas'])
  })

  test('is told to the account, and followed from it', () => {
    token = 'token'
    field().set(true)
    expect(saved).toEqual([{ hiddenKinds: [EXPERIMENTAL_WORD, EXPLORER_WORD] }])

    receive({ hiddenKinds: null })
    expect(hiddenKinds.offers('explorer')).toBe(false)

    receive({ hiddenKinds: ['web', EXPERIMENTAL_WORD, EXPLORER_WORD] })
    expect(hiddenKinds.offers('explorer')).toBe(true)
    expect(hiddenKinds.offers('web')).toBe(false)
  })
})
