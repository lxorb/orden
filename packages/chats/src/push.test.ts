import { describe, expect, test } from 'vitest'
import { chatPushLink, chatPushLinkOf, chatPushOf, LONGEST_PUSH_TEXT, pushQuietOf, pushShows, pushText } from './push'

const CHAT = 'c_0123456789abcdef0123456789abcdef'
const PUSH = {
  kind: 'chat',
  v: '1',
  id: 'msg00000001',
  title: 'Ada',
  body: 'Lunch?',
  chat: CHAT,
  space: 's1',
  message: 'msg00000001',
  seq: '7',
  at: '1700000000000',
  from: 'user:u1',
  reason: 'mention',
  text: 'yes',
}
describe('the chat push a phone receives', () => {
  test('is read back as it was sent', () => {
    expect(chatPushOf(PUSH)).toEqual(PUSH)
  })
  test.each(['kind', 'v', 'chat', 'space', 'message', 'seq', 'at', 'from', 'reason', 'text', 'title', 'body', 'id'])(
    'is refused without its %s',
    (key) => {
      expect(chatPushOf({ ...PUSH, [key]: undefined })).toBeNull()
    },
  )
  test.each([
    ['kind', 'reminder'],
    ['v', '2'],
    ['chat', 'not a chat'],
    ['message', 'a/b'],
    ['seq', '-1'],
    ['from', 'nobody'],
    ['reason', 'because'],
    ['text', 'maybe'],
  ])('is refused with %s as %s', (key, value) => {
    expect(chatPushOf({ ...PUSH, [key]: value })).toBeNull()
  })
  test('is refused when it is not an object', () => {
    for (const one of [null, 'chat', 3, undefined]) expect(chatPushOf(one)).toBeNull()
  })
})
describe('the link a chat push opens', () => {
  test('names the chat and the message, and reads back', () => {
    expect(chatPushLink(CHAT, 'msg1')).toBe(`orden-chat://chat/${CHAT}?message=msg1`)
    expect(chatPushLinkOf(chatPushLink(CHAT, 'msg1'))).toEqual({ chat: CHAT, message: 'msg1' })
    expect(chatPushLinkOf(chatPushLink(CHAT))).toEqual({ chat: CHAT })
  })
  test('is refused for another scheme, another chat id or a message that is not an id', () => {
    expect(chatPushLinkOf(`orden://chat/${CHAT}`)).toBeNull()
    expect(chatPushLinkOf('orden-chat://chat/nope')).toBeNull()
    expect(chatPushLinkOf(`orden-chat://chat/${CHAT}?message=a/b`)).toBeNull()
    expect(chatPushLinkOf(`orden-chat://chat/${CHAT}?message=m?x=1`)).toBeNull()
  })
})
describe('the text a chat push carries', () => {
  test('is one line', () => {
    expect(pushText('  one\n\ntwo\tthree ')).toBe('one two three')
  })
  test('is cut with an ellipsis, and never inside a character', () => {
    const family = '👩‍👩‍👧'
    const cut = pushText(`${'a'.repeat(LONGEST_PUSH_TEXT - 2)}${family}${family}${family}`)
    expect(cut).toBe(`${'a'.repeat(LONGEST_PUSH_TEXT - 2)}${family}…`)
    expect(pushText('a'.repeat(LONGEST_PUSH_TEXT))).toBe('a'.repeat(LONGEST_PUSH_TEXT))
  })
  test('is empty for an empty body', () => {
    expect(pushText(' \n ')).toBe('')
  })
})
describe('what the page tells the phone about quiet times', () => {
  const QUIET = { hours: { days: [1, 2, 3, 4, 5], from: 540, to: 1080 }, dndUntil: null, previews: true, sound: false }
  const at = (day: number, minute: number, now = 1000) => ({ now, day, minute })
  test('is read back as it was told, and refused when a part is missing or wrong', () => {
    expect(pushQuietOf(JSON.parse(JSON.stringify(QUIET)))).toEqual(QUIET)
    expect(pushQuietOf({ ...QUIET, hours: null })).toEqual({ ...QUIET, hours: null })
    expect(pushQuietOf({ ...QUIET, hours: { days: [9], from: 0, to: 1 } })).toBeNull()
    expect(pushQuietOf({ ...QUIET, dndUntil: 'later' })).toBeNull()
    expect(pushQuietOf({ ...QUIET, previews: undefined })).toBeNull()
    expect(pushQuietOf(null)).toBeNull()
  })
  test('a push shows inside the hours and not outside them', () => {
    expect(pushShows(QUIET, at(1, 540))).toBe(true)
    expect(pushShows(QUIET, at(1, 1079))).toBe(true)
    expect(pushShows(QUIET, at(1, 1080))).toBe(false)
    expect(pushShows(QUIET, at(6, 600))).toBe(false)
    expect(pushShows({ ...QUIET, hours: null }, at(6, 600))).toBe(true)
  })
  test('hours past midnight belong to the day they began', () => {
    const late = { ...QUIET, hours: { days: [5], from: 1320, to: 120 } }
    expect(pushShows(late, at(5, 1400))).toBe(true)
    expect(pushShows(late, at(6, 60))).toBe(true)
    expect(pushShows(late, at(6, 121))).toBe(false)
    expect(pushShows(late, at(5, 60))).toBe(false)
  })
  test('nothing shows until do not disturb has run out', () => {
    expect(pushShows({ ...QUIET, dndUntil: 2000 }, at(1, 600, 1999))).toBe(false)
    expect(pushShows({ ...QUIET, dndUntil: 2000 }, at(1, 600, 2000))).toBe(true)
  })
})
