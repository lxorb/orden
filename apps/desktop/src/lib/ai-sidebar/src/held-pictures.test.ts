import { describe, expect, test } from 'vitest'
import { answerHtml } from './drawn'

describe('a picture from elsewhere in an answer, written without its two slashes', () => {
  test('an address with one slash after the scheme is held until asked', () => {
    const held = answerHtml('![a cat](https:/example.com/cat.png?q=secret)')
    expect(held).not.toContain('<img')
  })

  test('an address with no slash after the scheme is held until asked', () => {
    const held = answerHtml('![a cat](https:example.com/cat.png?q=secret)')
    expect(held).not.toContain('<img')
  })

  test('a raw picture tag with no slash after the scheme is held until asked', () => {
    const held = answerHtml('<img src="https:example.com/cat.png?q=secret" alt="a cat">')
    expect(held).not.toContain('<img')
  })
})
