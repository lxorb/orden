import { describe, expect, test } from 'vitest'
import { clearPushed, takenOf, watchTaken } from './taken'

const CHAT = `c_${'a'.repeat(32)}`
describe('what was marked read on a notification while the app was away', () => {
  test('is read as chats and how far each was read, leaving out what is not that', () => {
    const said = JSON.stringify([
      { chat: CHAT, message: 'm1', seq: 7 },
      { chat: 'nope', message: 'm2', seq: 3 },
      { chat: CHAT, message: 'm3', seq: -1 },
      { chat: CHAT, seq: '9' },
      null,
    ])
    expect(takenOf(said)).toEqual([{ chat: CHAT, seq: 7 }])
  })
  test('is nothing when the phone hands over nothing that reads', () => {
    for (const said of ['', 'null', '{}', '[1, 2]']) expect(takenOf(said)).toEqual([])
  })
  test('is not asked for, nor is anything cleared, where there is no phone', async () => {
    const marked: string[] = []
    watchTaken((chat) => marked.push(chat))()
    await clearPushed(CHAT)
    expect(marked).toEqual([])
  })
})
