import { expect, test } from 'vitest'
import { findLinks } from '@orden/markdown/links'
import { encodeTarget, linksFollowed } from './rewrite'

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

test('a path written into a link keeps every blank encoded, so the link still reads as one', () => {
  for (const name of ['a\u00a0b.pdf', 'Shot 9.41\u202fAM.png', 'tab\there.pdf', 'a b.pdf']) {
    const text = `[p](${encodeTarget(name)})`
    expect(
      findLinks(text).map((link) => link.target),
      name,
    ).toEqual([name])
  }
  expect(encodeTarget('Café.md')).toBe('Café.md')
})
