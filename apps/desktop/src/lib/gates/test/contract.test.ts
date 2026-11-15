import { describe, expect, test, vi } from 'vitest'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
  key: () => null,
  length: 0,
  clear: () => held.clear(),
})

const gates = await import('../src/api')

describe('the kinds and the experiments that are on', () => {
  test('the gated kinds stay chosen whatever is hidden, the rest follow the hidden list', () => {
    expect(gates.chosenOn('chat', ['chat'])).toBe(true)
    expect(gates.chosenOn('canvas', ['canvas'])).toBe(false)
    expect(gates.shownOf(['note', 'canvas'], ['note', 'canvas'])).toEqual(['note'])
  })

  test('an experiment is on only while the experimental switch is on too', () => {
    gates.hiddenKinds.hidden = [gates.TIME_WORD]
    expect(gates.timeOn()).toBe(false)
    gates.hiddenKinds.hidden = [gates.EXPERIMENTAL_WORD, gates.TIME_WORD, gates.BASES_WORD]
    expect(gates.experimentalOn()).toBe(true)
    expect(gates.timeOn()).toBe(true)
    expect(gates.basesOn()).toBe(true)
    expect(gates.chatsOn()).toBe(false)
  })

  test('the hidden list comes back from what was kept', () => {
    localStorage.setItem(gates.KINDS_KEY, JSON.stringify(['canvas']))
    gates.hiddenKinds.restore()
    expect(gates.hiddenKinds.hidden).toEqual(['canvas'])
    expect(gates.hiddenKinds.offers('canvas')).toBe(false)
    expect(gates.hiddenKinds.offers('note')).toBe(true)
  })
})
