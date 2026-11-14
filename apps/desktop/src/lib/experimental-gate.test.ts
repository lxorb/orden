import { beforeEach, describe, expect, test, vi } from 'vitest'

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

const asked = vi.hoisted(() => ({ answer: true, titles: [] as string[], details: [] as string[] }))
vi.mock('./prompt.svelte', () => ({
  prompt: {
    confirm: (options: { title: string; detail?: string }) => {
      asked.titles.push(options.title)
      asked.details.push(options.detail ?? '')
      return Promise.resolve(asked.answer)
    },
  },
}))

const settings = await import('./settings.svelte')
const {
  appsOn,
  basesOn,
  chatsOn,
  EXPERIMENTAL_WORD,
  experimentalOn,
  explorerOn,
  hiddenKinds,
  KINDS_KEY,
  kindsHere,
  passOn,
  timeOn,
} = settings
const { receive } = await import('./kind-choice')
const { experimentalPane } = await import('./settings/experimental-pane')
const { kindsPane } = await import('./settings/kinds-pane')
const { openApplication } = await import('./apps/open')
const { account } = await import('./accounts/src/account.svelte')

Object.defineProperty(account, 'accountToken', { get: () => 'token', configurable: true })

const FEATURES = [
  'chats',
  'applications',
  'explorer',
  'passwordManager',
  'timeTracker',
  'databases',
  'glasses',
] as const

const ON = [chatsOn, appsOn, explorerOn, passOn, timeOn, basesOn, settings.glassesOn]

function fields() {
  return experimentalPane().groups.flatMap((group) => group.fields)
}

function field(key: string) {
  const found = fields().find((one) => one.key === key)
  if (found?.kind !== 'switch') throw new Error(`no switch ${key}`)
  return found
}

const master = () => field('experimental.enabled')
const feature = (name: (typeof FEATURES)[number]) => field(`experimental.${name}`)
const anyOn = () => ON.some((on) => on())

beforeEach(() => {
  store.clear()
  hiddenKinds.restore()
  asked.answer = true
  asked.titles.length = 0
  asked.details.length = 0
})

describe('the Experimental section', () => {
  test('starts with everything off, the features locked until the master is on', () => {
    expect(master().get()).toBe(false)
    expect(master().initial).toBe(false)
    for (const name of FEATURES) {
      expect(feature(name).get()).toBe(false)
      expect(feature(name).initial).toBe(false)
      expect(feature(name).locked?.()).toBe(true)
    }
    expect(anyOn()).toBe(false)
  })

  test('asks before turning the master on, saying bugs will come, and Cancel leaves it off', async () => {
    asked.answer = false
    master().set(true)
    await vi.waitFor(() => expect(asked.titles).toHaveLength(1))
    expect(asked.details[0]).toContain('100%')
    expect(experimentalOn()).toBe(false)

    asked.answer = true
    master().set(true)
    await vi.waitFor(() => expect(experimentalOn()).toBe(true))
    for (const name of FEATURES) expect(feature(name).locked?.()).toBe(false)
  })

  test('turning the master off hides every feature, and turning it on brings back each choice', async () => {
    master().set(true)
    await vi.waitFor(() => expect(experimentalOn()).toBe(true))
    for (const name of FEATURES) feature(name).set(true)
    expect(ON.every((on) => on())).toBe(true)
    expect(kindsHere()).toEqual(expect.arrayContaining(['chat', 'application', 'explorer', 'pass']))

    master().set(false)
    expect(asked.titles).toHaveLength(1)
    expect(anyOn()).toBe(false)
    expect(kindsHere()).not.toContain('application')
    expect(openApplication('/s/Box.application')).toBeNull()
    for (const name of FEATURES) expect(feature(name).get()).toBe(true)

    master().set(true)
    await vi.waitFor(() => expect(experimentalOn()).toBe(true))
    expect(ON.every((on) => on())).toBe(true)
  })

  test('the features left Note types', async () => {
    master().set(true)
    await vi.waitFor(() => expect(experimentalOn()).toBe(true))
    for (const name of FEATURES) feature(name).set(true)
    const keys = kindsPane()
      .groups.flatMap((group) => group.fields)
      .map((one) => one.key)
    for (const kind of ['chat', 'application', 'explorer', 'pass']) {
      expect(keys).not.toContain(`kinds.${kind}`)
    }
  })

  test('an account that had all of them on before comes back with everything off', () => {
    const before = ['shown-chats', 'shown-pass', 'shown-explorer', 'shown-time', 'shown-bases']
    store.set(KINDS_KEY, JSON.stringify(before))
    hiddenKinds.restore()
    expect(experimentalOn()).toBe(false)
    expect(anyOn()).toBe(false)

    receive({ hiddenKinds: [...before, EXPERIMENTAL_WORD] })
    expect(experimentalOn()).toBe(true)
    expect(anyOn()).toBe(false)
    for (const name of FEATURES) expect(feature(name).get()).toBe(false)
  })

  test('follows the account, master and features alike', () => {
    receive({ hiddenKinds: [EXPERIMENTAL_WORD, settings.APPS_WORD, settings.CHATS_WORD] })
    expect(appsOn()).toBe(true)
    expect(chatsOn()).toBe(true)
    expect(passOn()).toBe(false)
    receive({ hiddenKinds: [settings.APPS_WORD, settings.CHATS_WORD] })
    expect(anyOn()).toBe(false)
  })
})
