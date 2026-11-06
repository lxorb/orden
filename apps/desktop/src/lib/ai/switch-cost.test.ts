import { describe, expect, test } from 'vitest'
import { noUsage } from './chat/usage'
import { ASK_FROM, switchCost } from './switch-cost'

const used = (input: number, output = 0) => ({ ...noUsage(200_000), input, output })
const claude = { provider: 'a', model: 'claude-sonnet' }

describe('what a switch of model costs', () => {
  test('is the conversation sent again, where it is long enough to ask about', () => {
    expect(
      switchCost(used(40_000, 2_000), claude, { provider: 'b', model: 'gpt', window: 400_000 }),
    ).toEqual({
      tokens: 42_000,
      compacts: false,
    })
  })

  test('and another model of the same provider reads it again too', () => {
    expect(
      switchCost(used(40_000), claude, { provider: 'a', model: 'claude-opus', window: 200_000 }),
    ).toEqual({ tokens: 40_000, compacts: false })
  })

  test('nothing for the same model, or a short chat', () => {
    expect(switchCost(used(90_000), claude, { ...claude, window: 200_000 })).toBeNull()
    expect(
      switchCost(used(ASK_FROM - 1), claude, { provider: 'b', model: 'gpt', window: 400_000 }),
    ).toBeNull()
  })

  test('and says where the conversation is compacted first, to fit', () => {
    expect(
      switchCost(used(150_000), claude, { provider: 'b', model: 'small', window: 128_000 }),
    ).toEqual({ tokens: 150_000, compacts: true })
    expect(
      switchCost(used(150_000), claude, { provider: 'b', model: 'small', window: 128_000 }, 'off')
        ?.compacts,
    ).toBe(false)
  })
})
