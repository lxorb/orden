import { blocksOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'

describe('the blocks offered after [[Week#^ in a note with comments', () => {
  test('leave out a commented-out HTML block', () => {
    const note = 'Call the bank\n\n<!--\nold plan\n\nmore old\n-->\n\nPay rent\n'
    expect(blocksOf(note).map((block) => block.text)).toEqual(['Call the bank', 'Pay rent'])
  })

  test('leave out a percent comment', () => {
    const note = 'Call the bank\n\n%%\nold plan\n%%\n\nPay rent\n'
    expect(blocksOf(note).map((block) => block.text)).toEqual(['Call the bank', 'Pay rent'])
  })
})
