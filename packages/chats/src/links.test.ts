import { describe, expect, it } from 'vitest'
import { chatLink, chatLinkOf } from './links'

const CHAT = 'c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e'
const MESSAGE = '01K6Z8Q3V8A0000000000000AB'

describe('a chat link', () => {
  it('names a chat, or a message in it', () => {
    expect(chatLink(CHAT)).toBe(`orden://chat/${CHAT}`)
    expect(chatLink(CHAT, MESSAGE)).toBe(`orden://chat/${CHAT}/${MESSAGE}`)
  })

  it('reads back what it wrote', () => {
    expect(chatLinkOf(chatLink(CHAT))).toEqual({ chat: CHAT })
    expect(chatLinkOf(chatLink(CHAT, MESSAGE))).toEqual({ chat: CHAT, message: MESSAGE })
  })

  it('still reads one written before the rename', () => {
    expect(chatLinkOf(`nib://chat/${CHAT}/${MESSAGE}`)).toEqual({ chat: CHAT, message: MESSAGE })
  })

  it.each([
    'https://orden.so',
    'orden://chat/',
    'orden://chat/c_123',
    `orden://chat/${CHAT}/`,
    `orden://chat/${CHAT}/${MESSAGE}/0`,
    `orden://chat/${CHAT}/a b`,
    `orden://note/${CHAT}`,
  ])('is not a chat link: %s', (url) => {
    expect(chatLinkOf(url)).toBeNull()
  })
})
