import { beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})
vi.mock('../src/lib/platform/src/tauri', async (actual) => ({
  ...(await actual<typeof import('../src/lib/platform/src/tauri')>()),
  isDesktop: true,
}))
const asked = vi.hoisted(() => ({ answer: true, titles: [] as string[], details: [] as string[] }))
vi.mock('../src/lib/ui-kit/src/prompt.svelte', () => ({
  prompt: {
    confirm: (options: { title: string; detail?: string }) => {
      asked.titles.push(options.title)
      asked.details.push(options.detail ?? '')
      return Promise.resolve(asked.answer)
    },
  },
}))
const settings = await import('../src/lib/gates/src/api')
const {
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
const { receive } = await import('../src/lib/gates/src/api')
const { experimentalPane } = await import('../src/lib/settings/src/experimental-pane')
const { kindsPane } = await import('../src/lib/settings/src/kinds-pane')
const { account } = await import('../src/lib/accounts/src/account.svelte')
Object.defineProperty(account, 'accountToken', { get: () => 'token', configurable: true })
const FEATURES = ['chats', 'explorer', 'passwordManager', 'timeTracker', 'databases'] as const
const ON = [chatsOn, explorerOn, passOn, timeOn, basesOn]
function fields() {
  return experimentalPane().groups.flatMap((group) => group.fields)
}
function field(key: string) {
  const found = fields().find((one) => one.key === key)
  if (found?.kind !== 'switch') throw new Error(`no switch ${key}`)
  return found
}
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
  test('is one list of features with no master switch, all off and none locked', () => {
    const pane = experimentalPane()
    expect(pane.groups).toHaveLength(1)
    expect(pane.groups[0]?.title).toBe('')
    expect(fields().some((one) => one.key === 'experimental.enabled')).toBe(false)
    for (const name of FEATURES) {
      expect(feature(name).get()).toBe(false)
      expect(feature(name).initial).toBe(false)
      expect(feature(name).locked?.()).toBeFalsy()
    }
    expect(anyOn()).toBe(false)
  })
  test('asks once before the first feature, saying bugs will come, and Cancel changes nothing', async () => {
    asked.answer = false
    feature('chats').set(true)
    await vi.waitFor(() => expect(asked.titles).toEqual(['Turn on experimental features?']))
    expect(asked.details[0]).toContain('100%')
    expect(experimentalOn()).toBe(false)
    expect(hiddenKinds.hidden).toEqual([])
    asked.answer = true
    feature('chats').set(true)
    await vi.waitFor(() => expect(chatsOn()).toBe(true))
    expect(experimentalOn()).toBe(true)
    feature('timeTracker').set(true)
    expect(timeOn()).toBe(true)
    expect(asked.titles).toHaveLength(2)
  })
  test('each feature turns on and off on its own, and the warning is not asked again', async () => {
    feature('databases').set(true)
    await vi.waitFor(() => expect(basesOn()).toBe(true))
    for (const name of FEATURES) feature(name).set(true)
    expect(ON.every((on) => on())).toBe(true)
    expect(kindsHere()).toEqual(expect.arrayContaining(['chat', 'explorer', 'pass']))
    for (const name of FEATURES) feature(name).set(false)
    expect(anyOn()).toBe(false)
    expect(kindsHere()).not.toContain('chat')
    expect(hiddenKinds.hidden).toEqual([EXPERIMENTAL_WORD])
    feature('passwordManager').set(true)
    expect(passOn()).toBe(true)
    expect(asked.titles).toHaveLength(1)
  })
  test('accepting the warning leaves stale features from before off', async () => {
    store.set(KINDS_KEY, JSON.stringify([settings.CHATS_WORD, settings.PASS_WORD, 'canvas']))
    hiddenKinds.restore()
    for (const name of FEATURES) expect(feature(name).get()).toBe(false)
    feature('timeTracker').set(true)
    await vi.waitFor(() => expect(timeOn()).toBe(true))
    expect(chatsOn()).toBe(false)
    expect(passOn()).toBe(false)
    expect(hiddenKinds.hidden).toEqual(expect.arrayContaining(['canvas', EXPERIMENTAL_WORD, settings.TIME_WORD]))
    expect(hiddenKinds.hidden).not.toContain(settings.CHATS_WORD)
  })
  test('the features left Note types', async () => {
    feature('chats').set(true)
    await vi.waitFor(() => expect(experimentalOn()).toBe(true))
    for (const name of FEATURES) feature(name).set(true)
    const keys = kindsPane()
      .groups.flatMap((group) => group.fields)
      .map((one) => one.key)
    for (const kind of ['chat', 'explorer', 'pass']) {
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
  test('follows the account, the warning and features alike', () => {
    receive({ hiddenKinds: [EXPERIMENTAL_WORD, settings.CHATS_WORD] })
    expect(chatsOn()).toBe(true)
    expect(feature('chats').get()).toBe(true)
    expect(passOn()).toBe(false)
    receive({ hiddenKinds: [settings.CHATS_WORD] })
    expect(anyOn()).toBe(false)
    expect(feature('chats').get()).toBe(false)
  })
})
