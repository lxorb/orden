import { describe, expect, test } from 'vitest'
import { lineAt, lineStarts, Matcher, type SearchNote } from './match'
import { parseQuery } from './query'

/** The twin of this file is the tests in query.rs: the same notes, the same
 *  queries, the same answers. A case added here belongs there too. */

const NOTE = `---
status: done
project: Nib
---

# Meeting notes #work/2026

Alpha met Beta on Monday.
Gamma was away.

## Later

Beta wrote it up. #done

\`\`\`
#notatag
\`\`\`
`

const note = (over: Partial<SearchNote> = {}): SearchNote => ({
  path: '/space/Work/Meeting.md',
  relative: 'Work/Meeting.md',
  name: 'Meeting.md',
  body: NOTE,
  ...over,
})

/** Does the note answer the query at all. */
function answers(source: string, over: Partial<SearchNote> = {}): boolean {
  return new Matcher(parseQuery(source)).spans(note(over)) !== null
}

/** The lines a query finds, as the words the rows would show. */
function lines(source: string, over: Partial<SearchNote> = {}): string[] {
  return new Matcher(parseQuery(source)).hits(note(over), 50).map((hit) => hit.text)
}

/** The words each hit emphasises. */
function marked(source: string, over: Partial<SearchNote> = {}): string[] {
  return new Matcher(parseQuery(source))
    .hits(note(over), 50)
    .flatMap((hit) => hit.ranges.map((range) => hit.text.slice(range.from, range.to)))
}

describe('words', () => {
  test('match anywhere in the note, folded', () => {
    expect(answers('alpha')).toBe(true)
    expect(answers('ALPHA')).toBe(true)
    expect(answers('zeta')).toBe(false)
  })

  test('all have to match, in any order', () => {
    expect(answers('alpha gamma')).toBe(true)
    expect(answers('gamma alpha')).toBe(true)
    expect(answers('alpha zeta')).toBe(false)
  })

  test('bring back the line they were found on', () => {
    expect(lines('gamma')).toEqual(['Gamma was away.'])
  })

  test('mark where they were found', () => {
    expect(marked('gamma')).toEqual(['Gamma'])
  })

  test('bring back one row per line, however often they sit on it', () => {
    expect(lines('beta')).toEqual(['Alpha met Beta on Monday.', 'Beta wrote it up. #done'])
  })
})

describe('phrases', () => {
  test('match exactly', () => {
    expect(answers('"met Beta"')).toBe(true)
    expect(answers('"Beta met"')).toBe(false)
  })
})

describe('excluding', () => {
  test('turns a match into a miss', () => {
    expect(answers('alpha -gamma')).toBe(false)
    expect(answers('alpha -zeta')).toBe(true)
  })

  test('on its own keeps every note that does not say it', () => {
    expect(answers('-zeta')).toBe(true)
    expect(answers('-alpha')).toBe(false)
  })
})

describe('OR', () => {
  test('takes either side', () => {
    expect(answers('zeta OR gamma')).toBe(true)
    expect(answers('zeta OR omega')).toBe(false)
  })

  test('brings back the lines of whichever side answered', () => {
    expect(lines('gamma OR zeta')).toEqual(['Gamma was away.'])
  })
})

describe('case', () => {
  test('folds until it is told not to', () => {
    expect(answers('ALPHA')).toBe(true)
    expect(answers('case: ALPHA')).toBe(false)
    expect(answers('case: Alpha')).toBe(true)
  })
})

describe('path and file', () => {
  test('read where the note is, relative to the space', () => {
    expect(answers('path:Work/')).toBe(true)
    expect(answers('path:work/')).toBe(true)
    expect(answers('path:Drafts/')).toBe(false)
  })

  test('read the note name', () => {
    expect(answers('file:Meeting')).toBe(true)
    expect(answers('file:Agenda')).toBe(false)
  })

  test('find a note nothing in the text says', () => {
    expect(lines('file:Meeting')).toEqual(['---'])
    expect(marked('file:Meeting')).toEqual([])
  })
})

describe('tags', () => {
  test('match the tag itself', () => {
    expect(answers('tag:done')).toBe(true)
    expect(answers('tag:#done')).toBe(true)
    expect(answers('tag:missing')).toBe(false)
  })

  test('match their children', () => {
    expect(answers('tag:work')).toBe(true)
    expect(answers('tag:work/2026')).toBe(true)
    expect(answers('tag:work/2025')).toBe(false)
  })

  test('do not come out of a code fence', () => {
    expect(answers('tag:notatag')).toBe(false)
  })

  test('are not headings', () => {
    expect(answers('tag:Meeting')).toBe(false)
  })
})

describe('front matter', () => {
  test('answers whether the key is there', () => {
    expect(answers('[status]')).toBe(true)
    expect(answers('[due]')).toBe(false)
  })

  test('answers what the value says', () => {
    expect(answers('[status:done]')).toBe(true)
    expect(answers('[status:open]')).toBe(false)
  })

  test('is only the front matter, not a colon further down', () => {
    expect(answers('[later]')).toBe(false)
  })

  test('is nothing at all in a note that has none', () => {
    expect(answers('[status]', { body: 'status: done\n' })).toBe(false)
  })
})

describe('regular expressions', () => {
  test('match what they describe', () => {
    expect(answers('/G[a-z]+a/')).toBe(true)
    expect(answers('/Z[a-z]+a/')).toBe(false)
  })

  test('mind case unless the i flag says otherwise', () => {
    expect(answers('/gamma/')).toBe(false)
    expect(answers('/gamma/i')).toBe(true)
  })

  test('mark exactly what they matched', () => {
    expect(marked('/B[a-z]+a on/')).toEqual(['Beta on'])
  })

  test('that will not compile match nothing rather than complaining', () => {
    expect(answers('/([a-/')).toBe(false)
  })
})

describe('nearness', () => {
  const CLOSE = 'alpha here\nbeta there\n\nalpha and beta\n'

  test('line: wants both on one line', () => {
    expect(answers('line:(alpha beta)', { body: CLOSE })).toBe(true)
    expect(lines('line:(alpha beta)', { body: CLOSE })).toEqual(['alpha and beta'])
  })

  test('line: is not satisfied by two lines between them', () => {
    expect(answers('line:(alpha there)', { body: CLOSE })).toBe(false)
  })

  test('block: wants both in one paragraph', () => {
    expect(answers('block:(alpha there)', { body: CLOSE })).toBe(true)
    expect(answers('block:(there and)', { body: CLOSE })).toBe(false)
  })

  test('section: wants both under one heading', () => {
    const body = '# One\n\nalpha\n\nbeta\n\n# Two\n\ngamma\n'
    expect(answers('section:(alpha beta)', { body })).toBe(true)
    expect(answers('section:(beta gamma)', { body })).toBe(false)
  })

  test('takes what is before the first heading as a section of its own', () => {
    const body = 'alpha beta\n\n# One\n\ngamma\n'
    expect(answers('section:(alpha beta)', { body })).toBe(true)
    expect(answers('section:(beta gamma)', { body })).toBe(false)
  })

  test('excludes within the line it is given', () => {
    expect(answers('line:(alpha -beta)', { body: CLOSE })).toBe(true)
    expect(answers('line:(beta -alpha)', { body: 'alpha beta\n' })).toBe(false)
  })
})

describe('a row', () => {
  test('trims the line and moves the mark with it', () => {
    const body = '   indented Beta here\n'
    expect(lines('beta', { body })).toEqual(['indented Beta here'])
    expect(marked('beta', { body })).toEqual(['Beta'])
  })

  test('cuts a very long line short', () => {
    const body = `${'x'.repeat(400)} beta\n`
    const [hit] = new Matcher(parseQuery('beta')).hits(note({ body }), 10)
    expect(hit?.text).toHaveLength(200)
    expect(hit?.ranges).toEqual([])
  })

  test('counts lines from zero', () => {
    expect(new Matcher(parseQuery('gamma')).hits(note(), 10)[0]?.line).toBe(8)
  })

  test('stops at the number of rows it was asked for', () => {
    const body = 'beta\n'.repeat(20)
    expect(new Matcher(parseQuery('beta')).hits(note({ body }), 3)).toHaveLength(3)
  })
})

describe('line offsets', () => {
  test('start at the top of every line', () => {
    expect(lineStarts('a\nbb\n\nc')).toEqual([0, 2, 5, 6])
  })

  test('find the line an offset is on', () => {
    const starts = lineStarts('a\nbb\n\nc')
    expect(lineAt(starts, 0)).toBe(0)
    expect(lineAt(starts, 1)).toBe(0)
    expect(lineAt(starts, 2)).toBe(1)
    expect(lineAt(starts, 4)).toBe(1)
    expect(lineAt(starts, 5)).toBe(2)
    expect(lineAt(starts, 6)).toBe(3)
  })
})
