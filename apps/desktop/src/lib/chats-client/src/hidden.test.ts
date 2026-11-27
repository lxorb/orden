import type { Who } from '@orden/chats'
import { describe, expect, test } from 'vitest'
import { everything, seenBy } from './hidden'
import { messageOf } from './test-account'

const BEN: Who = 'user:ben'
const seen = seenBy((who) => who === BEN)
describe('what somebody who blocked a person sees', () => {
  test('is none of that person’s messages', () => {
    expect(seen(messageOf(1, { author: BEN }))).toBeNull()
    expect(seen(messageOf(2, { author: BEN, parent: 'm1' }))).toBeNull()
  })
  test('is everybody else’s messages as they are, the same object when nothing of that person is on them', () => {
    const plain = messageOf(1, { reactions: { '👍': ['user:ana'] } })
    expect(seen(plain)).toBe(plain)
    expect(everything(plain)).toBe(plain)
  })
  test('is a message without that person’s reactions, and without a reaction only they gave', () => {
    const reacted = messageOf(1, { reactions: { '👍': ['user:ana', BEN], '🎉': [BEN] } })
    expect(seen(reacted)?.reactions).toEqual({ '👍': ['user:ana'] })
    expect(reacted.reactions).toEqual({ '👍': ['user:ana', BEN], '🎉': [BEN] })
  })
  test('is a poll without that person’s vote', () => {
    const poll = { question: 'When?', answers: ['Mon', 'Tue'], several: false, votes: { 'user:ana': [0], [BEN]: [1] } }
    expect(seen(messageOf(1, { poll }))?.poll?.votes).toEqual({ 'user:ana': [0] })
  })
})
