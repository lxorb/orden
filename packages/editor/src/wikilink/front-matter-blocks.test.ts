import { namedBlock } from '@orden/markdown/block-names'
import { blocksOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'

const NOTE = '---\ntitle: Week\ntags: [a]\n---\n\nCall the bank\n\nPay rent\n'

describe('the blocks offered after [[Week#^ in a note with front matter', () => {
  test('are only the blocks that can be named', () => {
    const offered = blocksOf(NOTE)
    const nameable = offered.filter((block) => namedBlock(NOTE, block.line, () => 'n1') !== null)
    expect(offered.map((block) => block.text)).toEqual(nameable.map((block) => block.text))
  })

  test('leave out the front matter', () => {
    expect(blocksOf(NOTE).map((block) => block.text)).toEqual(['Call the bank', 'Pay rent'])
  })
})
