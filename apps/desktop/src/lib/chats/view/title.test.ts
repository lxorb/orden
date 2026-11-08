import { type Conversation, UNKNOWN } from '@orden/chats/provider'
import { describe, expect, test } from 'vitest'
import { conversationTitle } from './title'

function conversation(extra: Partial<Conversation>): Conversation {
  return { id: 'c', title: null, kind: 'direct', people: [], lastAt: null, unread: 0, ...extra }
}

describe('a conversation title', () => {
  test('is its own title or the names of its people', () => {
    expect(conversationTitle(conversation({ title: 'Climbing' }))).toBe('Climbing')
    expect(
      conversationTitle(
        conversation({
          people: [
            { id: 'a', name: 'Anna' },
            { id: 'b', name: UNKNOWN },
          ],
        }),
      ),
    ).toBe('Anna, Unknown')
  })

  test('never falls back to a bare word for any chat', () => {
    expect(conversationTitle(conversation({}))).toBe('Unknown')
    expect(conversationTitle(conversation({ kind: 'group' }))).toBe('Unnamed group')
    expect(conversationTitle(conversation({ title: UNKNOWN }))).toBe('Unknown')
  })
})
