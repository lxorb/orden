import { beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

const { hiddenKinds, KINDS_KEY, PASS_WORD, EXPERIMENTAL_WORD, passOn, kindsHere } =
  await import('./settings.svelte')
const { setKind, setWord, receive } = await import('./kind-choice')
const { runnable, SHORTCUTS } = await import('./shortcuts/registry')
const { experimentalPane } = await import('./settings/experimental-pane')
const { appCommands } = await import('./commands')
const { offeredKinds } = await import('./new-kinds')
const { openPass } = await import('./pass-sync/src/open')
const { workspace } = await import('./workspace.svelte')

beforeEach(() => {
  store.clear()
  store.set(KINDS_KEY, JSON.stringify([EXPERIMENTAL_WORD]))
  hiddenKinds.restore()
  for (const tab of workspace.tabs.filter((one) => one.kind === 'pass'))
    workspace.close(tab.id, false)
})

function field() {
  const found = experimentalPane()
    .groups.flatMap((group) => group.fields)
    .find((one) => one.key === 'experimental.passwordManager')
  if (found?.kind !== 'switch') throw new Error('no switch for the password manager')
  return found
}

const COMMANDS = ['pass', 'pass-lock', 'pass-new-login', 'pass-generate']

function palette(): string[] {
  return appCommands()
    .map((one) => one.id)
    .filter((id) => COMMANDS.includes(id))
}

function shortcuts(): string[] {
  return SHORTCUTS.filter((one) => one.id.startsWith('pass.') || one.id === 'app.pass')
    .filter((one) => one.shown?.() !== false)
    .map((one) => one.id)
}

describe('the password manager, until it is turned on', () => {
  test('is off, with no tab, command, shortcut or new-tab kind of its own', () => {
    expect(passOn()).toBe(false)
    expect(field().get()).toBe(false)
    expect(field().initial).toBe(false)
    expect(palette()).toEqual([])
    expect(runnable('app.pass')).toBe(false)
    expect(shortcuts()).toEqual([])
    expect(kindsHere()).not.toContain('pass')
    expect(offeredKinds().map((one) => one.kind)).not.toContain('pass')
    expect(openPass()).toBeNull()
    expect(workspace.tabs.some((one) => one.kind === 'pass')).toBe(false)
  })

  test('is there with all of it once Settings turns it on, and kept for the next run', () => {
    field().set(true)
    expect(passOn()).toBe(true)
    expect(palette()).toEqual(COMMANDS)
    expect(runnable('app.pass')).toBe(true)
    expect(shortcuts()).toEqual(['app.pass', 'pass.search', 'pass.new-login'])
    expect(offeredKinds().map((one) => one.kind)).toContain('pass')
    expect(openPass()?.kind).toBe('pass')
    expect(JSON.parse(store.get(KINDS_KEY) ?? '[]')).toEqual([EXPERIMENTAL_WORD, PASS_WORD])

    hiddenKinds.hidden = []
    hiddenKinds.restore()
    expect(passOn()).toBe(true)

    field().set(false)
    expect(passOn()).toBe(false)
    expect(palette()).toEqual([])
    expect(JSON.parse(store.get(KINDS_KEY) ?? '[]')).toEqual([EXPERIMENTAL_WORD])
  })

  test('once on, is offered in the new tab, whatever Note types had for it before', () => {
    setWord(PASS_WORD, true)
    setKind('pass', false)
    hiddenKinds.hidden = [...hiddenKinds.hidden, 'pass']
    expect(passOn()).toBe(true)
    expect(offeredKinds().map((one) => one.kind)).toContain('pass')
    expect(palette()).toEqual(COMMANDS)
  })

  test('follows the account', () => {
    receive({ hiddenKinds: [EXPERIMENTAL_WORD, PASS_WORD] })
    expect(passOn()).toBe(true)
    receive({ hiddenKinds: [EXPERIMENTAL_WORD] })
    expect(passOn()).toBe(false)
  })
})
