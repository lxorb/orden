import { beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

const {
  hiddenKinds,
  KINDS_KEY,
  CHATS_WORD,
  EXPERIMENTAL_WORD,
  TIME_WORD,
  PASS_WORD,
  chatsOn,
  kindsHere,
} = await import('./settings.svelte')
const { setWord, receive } = await import('./kind-choice')
const { runnable, SHORTCUTS } = await import('./shortcuts/registry')
const { experimentalPane } = await import('./settings/src/experimental-pane')
const { account } = await import('./accounts/src/account.svelte')
await import('./chats-client/src/api')
await (await import('@orden/contracts')).registered()

beforeEach(() => {
  store.clear()
  store.set(KINDS_KEY, JSON.stringify([EXPERIMENTAL_WORD]))
  hiddenKinds.restore()
  Object.defineProperty(account, 'accountToken', { get: () => 'token', configurable: true })
})

function field() {
  const found = experimentalPane()
    .groups.flatMap((group) => group.fields)
    .find((one) => one.key === 'experimental.chats')
  if (found?.kind !== 'switch') throw new Error('no switch for chats')
  return found
}

function labels(): string[] {
  return experimentalPane()
    .groups.flatMap((group) => group.fields)
    .map((one) => ('label' in one ? one.label : ''))
}

const shown = () => SHORTCUTS.filter((one) => one.id === 'app.chats' && one.shown?.() !== false)

describe('Chats, until it is turned on', () => {
  test('is off, with no panel shortcut, new-tab kind or chat settings', () => {
    expect(chatsOn()).toBe(false)
    expect(field().get()).toBe(false)
    expect(field().initial).toBe(false)
    expect(runnable('app.chats')).toBe(false)
    expect(shown()).toEqual([])
    expect(kindsHere()).not.toContain('chat')
    expect(labels()).not.toContain('My keywords')
  })

  test('is off for someone who chose other features before, here and from the account', () => {
    store.set(
      KINDS_KEY,
      JSON.stringify([EXPERIMENTAL_WORD, 'terminal', TIME_WORD, PASS_WORD, 'chat']),
    )
    hiddenKinds.restore()
    expect(chatsOn()).toBe(false)
    receive({ hiddenKinds: [EXPERIMENTAL_WORD, 'terminal', TIME_WORD] })
    expect(chatsOn()).toBe(false)
  })

  test('is there once Settings turns it on, kept for the next run, and gone when turned off', () => {
    field().set(true)
    expect(chatsOn()).toBe(true)
    expect(runnable('app.chats')).toBe(true)
    expect(kindsHere()).toContain('chat')
    expect(labels()).toContain('My keywords')
    expect(JSON.parse(store.get(KINDS_KEY) ?? '[]')).toEqual([EXPERIMENTAL_WORD, CHATS_WORD])

    hiddenKinds.hidden = []
    hiddenKinds.restore()
    expect(chatsOn()).toBe(true)

    field().set(false)
    expect(chatsOn()).toBe(false)
    expect(runnable('app.chats')).toBe(false)
    expect(JSON.parse(store.get(KINDS_KEY) ?? '[]')).toEqual([EXPERIMENTAL_WORD])
  })

  test('follows the account', () => {
    receive({ hiddenKinds: [EXPERIMENTAL_WORD, CHATS_WORD] })
    expect(chatsOn()).toBe(true)
    setWord(CHATS_WORD, false)
    expect(chatsOn()).toBe(false)
  })
})
