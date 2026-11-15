import { expect, test } from 'vitest'
import { linksFollowed } from './rewrite'

test('a wikilink to a name holding a dollar sign keeps the name it was written with', () => {
  const out = linksFollowed(
    'See [[/Projects/$$ Plan]] and [[/Projects/A$&B]].',
    'Home.md',
    new Map(),
    ['Home.md', 'Projects/$$ Plan.md', 'Projects/A$&B.md'],
    'Inbox',
  )
  expect(out).toBe('See [[/Inbox/Projects/$$ Plan]] and [[/Inbox/Projects/A$&B]].')
})
