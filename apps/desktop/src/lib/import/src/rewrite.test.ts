import { expect, test } from 'vitest'
import { encodeTarget, findLinks } from '@orden/markdown/links'
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

test('a path written into a link reads back as the same path, blanks and marks and all', () => {
  for (const name of [
    'a\u00a0b.pdf',
    'Shot 9.41\u202fAM.png',
    'tab\there.pdf',
    'a b.pdf',
    'a\\_b.pdf',
    'what?.pdf',
    '<x>.pdf',
    '50%.pdf',
  ]) {
    const text = `[p](${encodeTarget(name)})`
    expect(
      findLinks(text).map((link) => link.target),
      name,
    ).toEqual([name])
  }
  expect(encodeTarget('Café.md')).toBe('Café.md')
})

test('links are found as the app finds them: over two lines, in a definition, never in maths', () => {
  const out = linksFollowed(
    'A [two\nlines](Old.md) and $[x](Old.md)$.\n\n[d]: Old.md "Old"\n',
    'Home.md',
    new Map([['Old.md', 'New.md']]),
    ['Home.md', 'Old.md'],
  )
  expect(out).toBe('A [two\nlines](New.md) and $[x](Old.md)$.\n\n[d]: New.md "Old"\n')
})
