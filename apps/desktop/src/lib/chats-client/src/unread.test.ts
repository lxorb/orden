import { describe, expect, test } from 'vitest'
import { unreadCount, unreadIn } from './unread'

const NOW = 1_000
const chat = (root: string | null, unread: number, mutedUntil: number | null = null) => ({ root, unread, mutedUntil })
describe('the unread count of a space (#2273)', () => {
  test('adds its chats, leaving out muted ones and the chats of other spaces', () => {
    const list = [
      chat('/spaces/Lab', 3),
      chat('/spaces/Lab', 2, NOW + 1),
      chat('/spaces/Lab', 1, NOW - 1),
      chat('/spaces/Home', 7),
      chat(null, 5),
    ]
    expect(unreadIn(list, '/spaces/Lab', NOW)).toBe(4)
    expect(unreadIn(list, '/spaces/Home', NOW)).toBe(7)
    expect(unreadIn(list, '/spaces/Empty', NOW)).toBe(0)
  })
  test('falls as its chats are read, the same number a chat row shows', () => {
    const one = chat('/spaces/Lab', 3)
    expect(unreadCount(one, NOW)).toBe(3)
    one.unread = 0
    expect([unreadCount(one, NOW), unreadIn([one], '/spaces/Lab', NOW)]).toEqual([0, 0])
    expect(unreadCount(chat('/spaces/Lab', 3, NOW + 1), NOW)).toBe(0)
  })
})
