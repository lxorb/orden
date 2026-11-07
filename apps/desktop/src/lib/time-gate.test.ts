import { beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

const { hiddenKinds, KINDS_KEY, TIME_WORD, timeOn } = await import('./settings.svelte')
const { setWord, receive } = await import('./kind-choice')
const { runnable } = await import('./shortcuts/registry')
const { generalPane } = await import('./settings/general-pane')

beforeEach(() => {
  store.clear()
  hiddenKinds.restore()
})

function field() {
  const found = generalPane()
    .groups.flatMap((group) => group.fields)
    .find((one) => one.key === 'general.timeTracker')
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
    expect(JSON.parse(store.get(KINDS_KEY) ?? '[]')).toEqual([TIME_WORD])

    hiddenKinds.hidden = []
    hiddenKinds.restore()
    expect(timeOn()).toBe(true)

    field().set(false)
    expect(timeOn()).toBe(false)
    expect(store.has(KINDS_KEY)).toBe(false)
  })

  test('keeps the kinds the reader turned off, and follows the account', () => {
    store.set(KINDS_KEY, JSON.stringify(['canvas']))
    hiddenKinds.restore()
    setWord(TIME_WORD, true)
    expect(hiddenKinds.hidden).toEqual(['canvas', TIME_WORD])
    expect(hiddenKinds.offers('canvas')).toBe(false)

    receive({ hiddenKinds: ['canvas'] })
    expect(timeOn()).toBe(false)
    receive({ hiddenKinds: [TIME_WORD] })
    expect(timeOn()).toBe(true)
  })
})
