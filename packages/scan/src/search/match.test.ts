import { describe, expect, test } from 'vitest'
import { lineAt, lineStarts } from './lines'
import { Matcher, type SearchNote } from './match'
import { parseQuery } from './query'

const NOTE = `---
status: done
project: Orden
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

const answers = (source: string, over: Partial<SearchNote> = {}): boolean =>
  new Matcher(parseQuery(source)).spans(note(over)) !== null

const lines = (source: string, over: Partial<SearchNote> = {}): string[] =>
  new Matcher(parseQuery(source)).hits(note(over), 50).map((hit) => hit.text)

const marked = (source: string, over: Partial<SearchNote> = {}): string[] =>
  new Matcher(parseQuery(source))
    .hits(note(over), 50)
    .flatMap((hit) => hit.ranges.map((range) => hit.text.slice(range.from, range.to)))

describe('a note whose lines end in CRLF', () => {
  test('still has the block list its front matter holds', () => {
    const body = '---\r\nstatus:\r\n  - open\r\n---\r\nalpha here\r\n'
    expect(answers('[status:open] alpha', { body })).toBe(true)
    expect(answers('[status:null]', { body })).toBe(false)
  })
})

describe('case', () => {
  test('folds a capital sigma the same wherever it sits in a word', () => {
    expect(answers('ΟΔΟΣ', { body: 'οδοστρωμα\n' })).toBe(true)
    expect(answers('οδοσ', { body: 'ΟΔΟΣ\n' })).toBe(true)
  })
})

describe('path and file', () => {
  test('find a note nothing in the text says, and read like the note', () => {
    expect(lines('file:Meeting')).toEqual(['# Meeting notes #work/2026'])
    expect(marked('file:Meeting')).toEqual([])
  })

  test('and fall back to the first line where there is no front matter', () => {
    expect(lines('file:Meeting', { body: '\nthe first words\n' })).toEqual(['the first words'])
    expect(lines('file:Meeting', { body: '---\nstatus: done\n' })).toEqual(['---'])
  })
})

describe('content', () => {
  test('and brings back the line, folded like any other word', () => {
    expect(lines('content:GAMMA')).toEqual(['Gamma was away.'])
    expect(marked('content:gamma')).toEqual(['Gamma'])
  })

  test('reads a note with no front matter from the top', () => {
    expect(answers('content:first', { body: 'the first words\n' })).toBe(true)
    expect(answers('content:status', { body: '---\nstatus: done\n' })).toBe(true)
  })
})

describe('tags', () => {
  test('match at every depth, and narrow as the path grows', () => {
    const deep = { body: 'words #work/orden/canvas/edges more\n' }

    expect(answers('tag:work', deep)).toBe(true)
    expect(answers('tag:work/orden', deep)).toBe(true)
    expect(answers('tag:work/orden/canvas', deep)).toBe(true)
    expect(answers('tag:work/orden/canvas/edges', deep)).toBe(true)
    expect(answers('tag:work/ni', deep)).toBe(false)
    expect(answers('tag:work/orden/canvas/edges/deeper', deep)).toBe(false)
  })

  test('and come out of the front matter as well as the words', () => {
    const listed = { body: '---\ntags: [work/orden, other]\n---\n\nwords\n' }

    expect(answers('tag:work', listed)).toBe(true)
    expect(answers('tag:work/orden', listed)).toBe(true)
    expect(answers('tag:other', listed)).toBe(true)
    expect(answers('tag:missing', listed)).toBe(false)
  })

  test('read a slash nobody meant the way the tag tree does', () => {
    const doubled = { body: 'words #a//b more\n' }

    expect(answers('tag:a/b', doubled)).toBe(true)
    expect(answers('tag:a', doubled)).toBe(true)
  })

  test('written as items under the key, which is Obsidian’s other spelling', () => {
    const items = { body: '---\ntags:\n  - work/orden\n  - other\n---\n\nwords\n' }

    expect(answers('tag:work/orden', items)).toBe(true)
    expect(answers('tag:other', items)).toBe(true)
  })
})

describe('front matter', () => {
  test('is nothing at all in a note that has none', () => {
    expect(answers('[status]', { body: 'status: done\n' })).toBe(false)
  })

  test('is nothing at all in a block nobody closed', () => {
    const open = { body: '---\nstatus: done\n\n# Plan\n' }

    expect(answers('[status]', open)).toBe(false)
    expect(answers('[status:done]', open)).toBe(false)
    expect(lines('file:Meeting', open)).toEqual(['---'])
  })
})

describe('a regular expression that backtracks without end', () => {
  const RUN = `${'a'.repeat(27)}!`

  test('finds nothing, and at once, rather than hang the page', () => {
    const started = Date.now()
    expect(answers('/(a+)+b/', { body: RUN })).toBe(false)
    expect(Date.now() - started).toBeLessThan(1500)
  })

  test('leaves a pattern that runs in time alone', () => {
    expect(marked('/a+!/', { body: RUN })).toEqual([RUN])
  })

  test('is judged in the Unicode mode it runs in', () => {
    const started = Date.now()
    expect(answers('/(\\p{L}+)+;/', { body: RUN })).toBe(false)
    expect(answers('/(\\u{61}+)+;/', { body: RUN })).toBe(false)
    expect(Date.now() - started).toBeLessThan(1500)
    expect(answers('/\\p{L}+!/', { body: RUN })).toBe(true)
  })

  test('is judged with the case it was asked to ignore', () => {
    const started = Date.now()
    expect(answers('/(a|A)*b/i', { body: RUN })).toBe(false)
    expect(Date.now() - started).toBeLessThan(1500)
  })
})

describe('a regular expression over a note with one very long line', () => {
  const blob = `![shot](data:image/png;base64,${'iVBORw0KGgo'.repeat(16_000)})`
  const body = `# Shots\n\nfix the TODO here\n\n${blob}\n\nmail me at me@example.com\n`

  test('still finds what the other lines hold, and in time', () => {
    const started = Date.now()
    expect(lines('/.*TODO/', { body })).toEqual(['fix the TODO here'])
    expect(lines('/\\S+@\\S+\\.\\S+/', { body })).toEqual(['mail me at me@example.com'])
    expect(Date.now() - started).toBeLessThan(1500)
  })

  test('still looks inside that line when the pattern runs in time there', () => {
    expect(answers('/BORw0K/', { body })).toBe(true)
  })

  test('still looks inside a long paragraph of words', () => {
    const paragraph = `${'the quarter plan and the wind above the field, '.repeat(120)}thinking`
    expect(answers('/\\w+ing\\b/', { body: paragraph })).toBe(true)
    expect(answers('/\\w+ingz/', { body: paragraph })).toBe(false)
  })
})

describe('regular expressions', () => {
  test('take a character outside the basic plane whole', () => {
    expect(marked('/x./', { body: 'x😀 end' })).toEqual(['x😀'])
    expect(marked('/[^a]/', { body: '😀' })).toEqual(['😀'])
  })

  test('still read the escapes and braces a looser reading allows', () => {
    expect(marked('/a\\-b/', { body: 'a-b' })).toEqual(['a-b'])
    expect(marked('/{x/', { body: 'a{x' })).toEqual(['{x'])
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

  test('does not end at a comment inside a code fence', () => {
    const body = '# One\nalpha\n```sh\n# comment\n```\nbeta\n'
    expect(answers('section:(alpha beta)', { body })).toBe(true)
  })

  test('line: ends a line before its carriage return', () => {
    expect(lines('line:/done$/', { body: 'a done\r\nb\r\n' })).toEqual(['a done'])
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
    expect(hit?.bare).toBeUndefined()
  })

  test('found by the note rather than by a line has no words to replace', () => {
    const [hit] = new Matcher(parseQuery('path:Meeting')).hits(note({ body: 'beta\n' }), 10)
    expect(hit?.bare).toBe(true)
  })

  test('counts lines from zero', () => {
    expect(new Matcher(parseQuery('gamma')).hits(note(), 10)[0]?.line).toBe(8)
  })

  test('stops at the number of rows it was asked for', () => {
    const body = 'beta\n'.repeat(20)
    expect(new Matcher(parseQuery('beta')).hits(note({ body }), 3)).toHaveLength(3)
  })
})

describe('tasks', () => {
  const TASKS = `# This week

- [ ] write the plan
- [x] read the paper
- [ ] send the ledger
    - [X] a nested one that is done
- not a task at all
`

  const asked = (source: string) => lines(source, { body: TASKS })

  test('are found by their words', () => {
    expect(asked('task:plan')).toEqual(['- [ ] write the plan'])
  })

  test('and by the state their box is in', () => {
    expect(asked('task-todo:the')).toEqual(['- [ ] write the plan', '- [ ] send the ledger'])
    expect(asked('task-done:the')).toEqual(['- [x] read the paper'])
  })

  test('and with nothing said about them at all', () => {
    expect(asked('task-todo:')).toEqual(['- [ ] write the plan', '- [ ] send the ledger'])
    expect(asked('task:').length).toBe(4)
  })

  test('and a row with no words to replace says so', () => {
    const rows = (source: string) =>
      new Matcher(parseQuery(source))
        .hits(note({ body: `${TASKS}milk here\n` }), 50)
        .map((hit) => [hit.text, hit.bare ?? false])

    expect(rows('task-todo:')).toEqual([
      ['- [ ] write the plan', true],
      ['- [ ] send the ledger', true],
    ])
    expect(rows('task-todo: milk')).toEqual([
      ['- [ ] write the plan', true],
      ['- [ ] send the ledger', true],
      ['milk here', false],
    ])
    expect(rows('task:plan')).toEqual([['- [ ] write the plan', false]])
  })

  test('where a nested one is still a task', () => {
    expect(asked('task-done:nested')).toEqual(['- [X] a nested one that is done'])
  })

  test('and a box inside a code fence is not one', () => {
    expect(answers('task:', { body: '```md\n- [ ] an example\n```\n' })).toBe(false)
  })

  test('and a line with no box is not one', () => {
    expect(answers('task:"not a task"', { body: TASKS })).toBe(false)
  })

  test('and the box itself is not words to search', () => {
    expect(answers('task-done:x', { body: TASKS })).toBe(false)
  })

  test('and two terms have to be in the one task', () => {
    expect(asked('task:(write plan)')).toEqual(['- [ ] write the plan'])
    expect(answers('task:(write ledger)', { body: TASKS })).toBe(false)
  })
})

describe('front matter held against a value', () => {
  const NUMBERS = `---
duration: 4
due: 2026-09-01
pages: 150
status: done
empty:
---

Words.
`

  const asked = (source: string) => answers(source, { body: NUMBERS })

  test('compares numbers as numbers', () => {
    expect(asked('[duration:<5]')).toBe(true)
    expect(asked('[duration:<4]')).toBe(false)
    expect(asked('[duration:<=4]')).toBe(true)
    expect(asked('[duration:>3]')).toBe(true)
    expect(asked('[duration:>=5]')).toBe(false)
  })

  test('and dates as dates, which words would get wrong', () => {
    expect(asked('[due:>2026-08-31]')).toBe(true)
    expect(asked('[due:<2026-10-01]')).toBe(true)
    expect(asked('[due:>2026-09-02]')).toBe(false)
  })

  test('and a bare day as the whole of that day, against a time written on it', () => {
    const at = (source: string, due: string) =>
      answers(source, { body: `---\ndue: ${due}\n---\n\nWords.\n` })

    expect(at('[due:<=2026-11-15]', '2026-11-15 10:00')).toBe(true)
    expect(at('[due:2026-11-01..2026-11-15]', '2026-11-15 10:00')).toBe(true)
    expect(at('[due:=2026-11-15]', '2026-11-15 10:00')).toBe(true)
    expect(at('[due:>2026-11-15]', '2026-11-15 10:00')).toBe(false)
    expect(at('[due:<2026-11-16]', '2026-11-15T23:59')).toBe(true)
    expect(at('[due:>=2026-11-15 10:00]', '2026-11-15')).toBe(true)
    expect(at('[due:<2026-11-15 10:00]', '2026-11-15T09:00:00Z')).toBe(true)
    expect(at('[due:>2026-11-15 10:00]', '2026-11-15t11:30:00.250+02:00')).toBe(true)
    expect(at('[due:<2026-11-15 10:00]', '2026-11-15 10:30')).toBe(false)
  })

  test('and a number written another way as the same number', () => {
    expect(answers('[n:=5]', { body: '---\nn: 5.0\n---\n' })).toBe(true)
    expect(answers('[n:=5]', { body: '---\nn: 50\n---\n' })).toBe(false)
  })

  test('and takes a range with both ends in it', () => {
    expect(asked('[pages:100..200]')).toBe(true)
    expect(asked('[pages:150..150]')).toBe(true)
    expect(asked('[pages:151..200]')).toBe(false)
  })

  test('and a value that is exactly this, where the bare form takes a part of it', () => {
    expect(asked('[status:don]')).toBe(true)
    expect(asked('[status:=don]')).toBe(false)
    expect(asked('[status:=done]')).toBe(true)
  })

  test('and asks for a key the note has not got', () => {
    expect(asked('[missing:null]')).toBe(true)
    expect(asked('[status:null]')).toBe(false)
    expect(asked('[empty:null]')).toBe(true)
  })

  test('and a key YAML reads as null holds nothing', () => {
    for (const written of ['null', 'Null', 'NULL', '~']) {
      expect(answers('[n:null]', { body: `---\nn: ${written}\n---\n` })).toBe(true)
    }
    expect(answers('[n:null]', { body: '---\nn: nullable\n---\n' })).toBe(false)
    for (const asked of ['[n:>2026-01-01]', '[n:<5]', '[n:>5]', '[n:0..9]']) {
      expect(answers(asked, { body: '---\nn: null\n---\n' })).toBe(false)
    }
  })

  test('and reads a list on past a comment line between its items', () => {
    const body = '---\ntags:\n  - a\n  # later\n  - b\n---\n'
    expect(answers('[tags:b]', { body })).toBe(true)
  })

  test('and falls back to the words where the two are not the same kind of thing', () => {
    expect(asked('[status:>a]')).toBe(true)
    expect(asked('[status:>z]')).toBe(false)
    expect(asked('[due:>5]')).toBe(false)
    expect(asked('[due:<5]')).toBe(true)
  })
})

describe('front matter read the way the properties read it', () => {
  const held = (source: string, front: string) =>
    answers(source, { body: `---\n${front}\n---\n\nWords.\n` })

  test('looks at each item of a list, under the key or in brackets', () => {
    expect(held('[authors:Herbert]', 'authors:\n  - Herbert\n  - Asimov')).toBe(true)
    expect(held('[authors:=Asimov]', 'authors:\n  - Herbert\n  - Asimov')).toBe(true)
    expect(held('[authors:Clarke]', 'authors:\n  - Herbert\n  - Asimov')).toBe(false)
    expect(held('[tags:=a]', 'tags: [a, b]')).toBe(true)
    expect(held('[tags:=b]', 'tags: [a, b]')).toBe(true)
    expect(held('[tags:=c]', 'tags: [a, b]')).toBe(false)
    expect(held('[authors]', 'authors:\n  - Herbert')).toBe(true)
  })

  test('takes the quotes off a value', () => {
    expect(held('[status:=done]', 'status: "done"')).toBe(true)
    expect(held('[status:=done]', "status: 'done'")).toBe(true)
    expect(held('[rating:>3]', 'rating: "5"')).toBe(true)
    expect(held('[rating:<3]', 'rating: "5"')).toBe(false)
  })

  test('leaves a comment after the value out of it', () => {
    expect(held('[status:=done]', 'status: done # finished')).toBe(true)
    expect(held('[status:finished]', 'status: done # finished')).toBe(false)
    expect(held('[rating:>3]', 'rating: 5 # out of five')).toBe(true)
  })

  test('counts a list with nothing in it as nothing', () => {
    expect(held('[tags:null]', 'tags: []')).toBe(true)
    expect(held('[tags:null]', 'tags: [a]')).toBe(false)
    expect(held('[status:null]', 'status: ""')).toBe(true)
  })

  test('in a note that opens with a byte order mark', () => {
    const body = '\uFEFF---\nauthors:\n  - Herbert\n---\n\nWords.\n'
    expect(answers('[authors:=Herbert]', { body })).toBe(true)
  })

  test('still answers a key in any case', () => {
    expect(held('[status:=done]', 'Status: done')).toBe(true)
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

test.each<[unknown, ...Parameters<typeof answers>]>([
  [true, 'alpha'],
  [true, 'ALPHA'],
  [false, 'zeta'],
  [true, 'alpha gamma'],
  [true, 'gamma alpha'],
  [false, 'alpha zeta'],
  [true, '"met Beta"'],
  [false, '"Beta met"'],
  [false, 'alpha -gamma'],
  [true, 'alpha -zeta'],
  [true, '-zeta'],
  [false, '-alpha'],
  [true, 'zeta OR gamma'],
  [false, 'zeta OR omega'],
  [true, 'ALPHA'],
  [false, 'case: ALPHA'],
  [true, 'case: Alpha'],
  [true, 'path:Work/'],
  [true, 'path:work/'],
  [false, 'path:Drafts/'],
  [true, 'file:Meeting'],
  [false, 'file:Agenda'],
  [true, 'orden'],
  [false, 'content:orden'],
  [true, 'status'],
  [false, 'content:status'],
  [true, 'content:alpha'],
  [true, 'case: content:Alpha'],
  [false, 'case: content:alpha'],
  [true, 'line:(content:alpha content:beta)'],
  [false, 'line:(content:alpha content:gamma)'],
  [true, 'tag:done'],
  [true, 'tag:#done'],
  [false, 'tag:missing'],
  [true, 'tag:work'],
  [true, 'tag:work/2026'],
  [false, 'tag:work/2025'],
  [false, 'tag:notatag'],
  [false, 'tag:Meeting'],
  [true, '[status]'],
  [false, '[due]'],
  [true, '[status:done]'],
  [false, '[status:open]'],
  [false, '[later]'],
  [true, '/G[a-z]+a/'],
  [false, '/Z[a-z]+a/'],
  [false, '/gamma/'],
  [true, '/gamma/i'],
  [false, '/([a-/'],
  [false, 'task-todo:'],
])('%j from %j', (expected, ...args) => {
  expect(answers(...args)).toBe(expected)
})

test.each<[unknown, ...Parameters<typeof lines>]>([
  [['Gamma was away.'], 'gamma'],
  [['Alpha met Beta on Monday.', 'Beta wrote it up. #done'], 'beta'],
  [['Gamma was away.'], 'gamma OR zeta'],
])('%j from %j', (expected, ...args) => {
  expect(lines(...args)).toEqual(expected)
})

test.each<[unknown, ...Parameters<typeof marked>]>([
  [['Gamma'], 'gamma'],
  [['Beta on'], '/B[a-z]+a on/'],
])('%j from %j', (expected, ...args) => {
  expect(marked(...args)).toEqual(expected)
})
