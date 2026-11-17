import { renderMarkdown } from '@orden/markdown'
import { blocksOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'

describe('the blocks offered after [[Week#^ in a note with a commented-out code block', () => {
  test('the reading view draws nothing of the code', () => {
    const note = 'Call the bank\n\n%%\n```js\nold()\n```\n%%\n\nPay rent\n'
    expect(renderMarkdown(note)).not.toContain('old()')
  })

  test('leave out code inside a percent comment', () => {
    const note = 'Call the bank\n\n%%\n```js\nold()\n```\n%%\n\nPay rent\n'
    expect(blocksOf(note).map((block) => block.text)).toEqual(['Call the bank', 'Pay rent'])
  })

  test('leave out code inside an HTML comment', () => {
    const note = 'Call the bank\n\n<!--\n```js\nold()\n```\n-->\n\nPay rent\n'
    expect(blocksOf(note).map((block) => block.text)).toEqual(['Call the bank', 'Pay rent'])
  })
})
