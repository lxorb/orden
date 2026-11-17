import { describe, expect, test } from 'vitest'
import type { ChatEntry } from '../shapes'
import { bySpace } from './by-space'

const chat = (id: string, name: string, root: string | null, lastAt = 0): ChatEntry => ({
  id,
  space: root ?? 'far',
  root,
  path: root ? `${root}/${name}.chat` : null,
  name,
  role: 'write',
  members: 2,
  lastSeq: 0,
  lastAt,
  lastBy: null,
  readSeq: 0,
  unread: 0,
  mentions: 0,
  notify: null,
  mutedUntil: null,
  meta: { topic: '', posting: 'writers', slowmode: 0 },
})

const SPACES = [
  { root: '/spaces/Lab', name: 'Lab' },
  { root: '/spaces/Home', name: 'Home' },
  { root: '/spaces/Empty', name: 'Empty' },
]

const shown = (groups: ReturnType<typeof bySpace>) =>
  groups.map((group) => `${group.name}: ${group.chats.map((one) => one.id).join(' ')}`)

describe('the chats in the sidebar, by space', () => {
  test('two chats with one name sit under the spaces they belong to', () => {
    const groups = bySpace(
      [
        chat('a', 'General', '/spaces/Home', 3),
        chat('b', 'General', '/spaces/Lab', 2),
        chat('c', 'Thesis', '/spaces/Lab', 1),
      ],
      SPACES,
    )

    expect(shown(groups)).toEqual(['Lab: b c', 'Home: a'])
  })

  test('a chat of a space this device does not hold comes last, under Other spaces', () => {
    const groups = bySpace(
      [chat('far', 'Chat', null), chat('near', 'General', '/spaces/Home')],
      SPACES,
    )

    expect(shown(groups)).toEqual(['Home: near', 'Other spaces: far'])
  })

  test('keeps the order it was given inside each space and leaves out empty spaces', () => {
    const groups = bySpace(
      [chat('x', 'One', '/spaces/Lab'), chat('y', 'Two', '/spaces/Lab')],
      SPACES,
    )

    expect(shown(groups)).toEqual(['Lab: x y'])
  })
})
