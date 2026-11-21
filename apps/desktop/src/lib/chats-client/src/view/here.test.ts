import { expect, test } from 'vitest'
import type { ChatEntry } from '../shapes'
import { chatsHere, holdsIn, onlyHere } from './here'

const chat = (id: string, root: string | null): ChatEntry => ({
  id,
  space: root ?? 'far',
  root,
  path: root ? `${root}/${id}.chat` : null,
  name: id,
  role: 'write',
  members: 2,
  lastSeq: 0,
  lastAt: 0,
  lastBy: null,
  readSeq: 0,
  unread: 0,
  mentions: 0,
  notify: null,
  mutedUntil: null,
  meta: { topic: '', posting: 'writers', slowmode: 0 },
})
const CHATS = [chat('general', '/spaces/Lab'), chat('family', '/spaces/Home/'), chat('far', null)]
test('a space holds the chats made in it alone, and no space holds none (#2364)', () => {
  expect(chatsHere(CHATS, '/spaces/Lab').map((one) => one.id)).toEqual(['general'])
  expect(chatsHere(CHATS, '/spaces/Home').map((one) => one.id)).toEqual(['family'])
  expect(chatsHere(CHATS, null)).toEqual([])
  expect(['/spaces/Lab', '/spaces/Home', '/spaces/Empty'].map((root) => holdsIn(CHATS, root))).toEqual([
    true,
    true,
    false,
  ])
  const found = [
    { chat: 'general', n: 1 },
    { chat: 'family', n: 2 },
    { chat: 'gone', n: 3 },
  ]
  expect(onlyHere(found, chatsHere(CHATS, '/spaces/Lab'))).toEqual([{ chat: 'general', n: 1 }])
})
