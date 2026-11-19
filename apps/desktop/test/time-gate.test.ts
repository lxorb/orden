import { beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

const { hiddenKinds, KINDS_KEY, TIME_WORD, EXPERIMENTAL_WORD, timeOn } = await import('../src/lib/gates/src/api')
const { receive } = await import('../src/lib/gates/src/api')
const { runnable } = await import('../src/lib/shortcuts/src/registry')
const { experimentalPane } = await import('../src/lib/settings/src/experimental-pane')

beforeEach(() => {
  store.clear()
  store.set(KINDS_KEY, JSON.stringify([EXPERIMENTAL_WORD]))
  hiddenKinds.restore()
})

function field() {
  const found = experimentalPane()
    .groups.flatMap((group) => group.fields)
    .find((one) => one.key === 'experimental.timeTracker')
  if (found?.kind !== 'switch') throw new Error('no switch for the time tracker')
  return found
}

const COMMANDS = ['app.time', 'time.tab', 'time.start', 'time.stop']

describe('the time tracker, until it is turned on', () => {
  test('is off, with none of its commands to run', () => {
    expect(timeOn()).toBe(false)
    expect(COMMANDS.filter(runnable)).toEqual([])
    expect(field().get()).toBe(false)
    expect(field().initial).toBe(false)
  })

  test('is there with its commands once Settings turns it on, and kept for the next run', () => {
    field().set(true)
    expect(timeOn()).toBe(true)
    expect(COMMANDS.filter(runnable)).toEqual(COMMANDS)
    expect(JSON.parse(store.get(KINDS_KEY) ?? '[]')).toEqual([EXPERIMENTAL_WORD, TIME_WORD])

    hiddenKinds.hidden = []
    hiddenKinds.restore()
    expect(timeOn()).toBe(true)

    field().set(false)
    expect(timeOn()).toBe(false)
    expect(JSON.parse(store.get(KINDS_KEY) ?? '[]')).toEqual([EXPERIMENTAL_WORD])
  })

  test('keeps the kinds the reader turned off, and follows the account', () => {
    store.set(KINDS_KEY, JSON.stringify([EXPERIMENTAL_WORD, 'canvas']))
    hiddenKinds.restore()
    hiddenKinds.hidden = [...hiddenKinds.hidden, TIME_WORD]
    expect(hiddenKinds.hidden).toEqual([EXPERIMENTAL_WORD, 'canvas', TIME_WORD])
    expect(hiddenKinds.offers('canvas')).toBe(false)

    receive({ hiddenKinds: [EXPERIMENTAL_WORD, 'canvas'] })
    expect(timeOn()).toBe(false)
    receive({ hiddenKinds: [EXPERIMENTAL_WORD, TIME_WORD] })
    expect(timeOn()).toBe(true)
  })
})
