import { measureTextWrap } from '@evenrealities/pretext'
import { describe, expect, test } from 'vitest'
import { SPACE, width, wrap } from './firmware'
import { pageAt, pageOfLine, pagesOf, type Paging } from './pages'
import { BODY_INNER, BODY_ROWS, GUTTER } from './panel'
import { costOf, NOTE, PAGING, typed } from '../test/cost'

const paging = (over: Partial<Paging> = {}): Paging => ({
  breakAt: 2,
  gutter: 0,
  inner: BODY_INNER,
  rows: BODY_ROWS,
  ...over,
})

const pages = (source: string, over: Partial<Paging> = {}) => pagesOf(source, paging(over))

const NUMS = GUTTER

const PROSE = Array.from(
  { length: 30 },
  (_one, at) =>
    `Paragraph ${at} with enough words in it to run past the end of one line of the panel quite easily.`,
).join('\n\n')

describe('a page holds what the panel holds', () => {
  test('never puts more lines on a page than the body has', () => {
    for (const page of pages(PROSE)) {
      expect(page.words.split('\n').length).toBeLessThanOrEqual(BODY_ROWS)
    }
  })

  test('and never a line wider than the body', () => {
    for (const page of pages(PROSE)) {
      for (const row of page.words.split('\n')) expect(width(row)).toBeLessThanOrEqual(BODY_INNER)
    }
  })

  test('agrees with the firmware about how many rows a row is', () => {
    const note = `${PROSE}\n\n\`\`\`ts\nconst somethingRatherLong = aFunctionCall(withArguments, andMore)\n\`\`\`\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n`
    for (const page of pages(note, { gutter: NUMS })) {
      for (const row of page.words.split('\n')) {
        if (row.trim() === '') continue
        expect(measureTextWrap(row, BODY_INNER).lineCount, JSON.stringify(row)).toBe(1)
      }
    }
  })

  test('fills the pages rather than leaving them half empty', () => {
    const all = pages(PROSE, { breakAt: 0 })
    for (const page of all.slice(0, -1)) {
      expect(page.words.split('\n').length).toBeGreaterThanOrEqual(BODY_ROWS - 2)
    }
  })

  test('answers with nothing for a note with nothing in it', () => {
    expect(pages('')).toEqual([])
    expect(pages('   \n\n')).toEqual([])
  })
})

describe('a page starts at a heading', () => {
  const note = [
    '# The title',
    '',
    'Some words under the title.',
    '',
    '## First section',
    '',
    'Words in the first section.',
    '',
    '### Not a break by default',
    '',
    'More words.',
    '',
    '## Second section',
    '',
    'Words in the second.',
    '',
  ].join('\n')

  test('breaks at H1 and H2 by default, and not at H3', () => {
    const all = pages(note)

    expect(all.map((page) => page.section)).toEqual([
      'THE TITLE',
      'FIRST SECTION',
      'SECOND SECTION',
    ])
  })

  test('breaks only at H1 when asked for one', () => {
    const all = pages(note, { breakAt: 1 })

    expect([...new Set(all.map((page) => page.section))]).toEqual(['THE TITLE'])
    expect(all.map((page) => page.words).join('\n')).toContain('FIRST SECTION')
  })

  test('breaks at H3 as well when asked for three', () => {
    expect(pages(note, { breakAt: 3 }).map((page) => page.section)).toEqual([
      'THE TITLE',
      'FIRST SECTION',
      'NOT A BREAK BY DEFAULT',
      'SECOND SECTION',
    ])
  })

  test('breaks at no heading at all when asked for none', () => {
    const all = pages(note, { breakAt: 0 })

    expect([...new Set(all.map((page) => page.section))]).toEqual([''])
    const set = all.map((page) => page.words).join('\n')
    expect(set).toContain('THE TITLE')
    expect(set).toContain('═'.repeat(28))
    expect(set).toContain('SECOND SECTION')
  })

  test('takes the heading out of the body and into the head band', () => {
    const [first] = pages(note)

    expect(first?.section).toBe('THE TITLE')
    expect(first?.words).not.toContain('THE TITLE')
    expect(first?.words).not.toContain('═')
  })

  test('says which rule the head band wears, by the level of the heading', () => {
    const all = pages(note)

    expect(all[0]?.rule).toBe('═')
    expect(all[1]?.rule).toBe('─')
  })

  test('keeps the heading up for every page of a long section', () => {
    const long = `## A long section\n\n${PROSE}\n`
    const all = pages(long)

    expect(all.length).toBeGreaterThan(3)
    for (const page of all) expect(page.section).toBe('A LONG SECTION')
  })

  test('leaves a rule the author wrote in the body', () => {
    const [first] = pages('## A section\n\n---\n\nwords\n')

    expect(first?.words).toContain('─'.repeat(28))
  })

  test('starts a page even when the one before it had room', () => {
    const all = pages('## One\n\nshort\n\n## Two\n\nshort\n')

    expect(all).toHaveLength(2)
  })

  test('says nothing for a note that opens without a heading', () => {
    const [first] = pages('Just words.\n')

    expect(first?.section).toBe('')
  })
})

describe('line numbers', () => {
  const note = 'one\n\ntwo\n\nthree\n'

  test('are nothing at all unless asked for', () => {
    const [page] = pages(note, { gutter: 0 })

    expect(page?.words).toBe('one\ntwo\nthree')
    expect(page?.numbers).toBe('')
  })

  test('are a column over the body, one number to a line', () => {
    const [page] = pages(note, { gutter: NUMS })

    expect(page?.words.split('\n').map((row) => row.trim())).toEqual(['one', 'two', 'three'])
    expect(page?.numbers.split('\n').map((row) => row.trim())).toEqual(['1', '3', '5'])
    for (const row of page?.words.split('\n') ?? []) {
      expect(width(row) - width(row.trimStart())).toBeGreaterThanOrEqual(NUMS)
    }
  })

  test('have exactly as many lines as the body has rows', () => {
    const long = Array.from({ length: 30 }, (_one, at) => `paragraph ${at} of this note`).join(
      '\n\n',
    )

    for (const page of pages(long, { gutter: NUMS, breakAt: 0 })) {
      expect(page.numbers.split('\n')).toHaveLength(page.words.split('\n').length)
    }
  })

  test('say nothing on the rows a long line wrapped to', () => {
    const long = `a ${'word '.repeat(60)}\n`
    const [page] = pages(long, { gutter: NUMS })
    const rows = page?.numbers.split('\n') ?? []

    expect(rows.length).toBeGreaterThan(1)
    expect(rows[0]?.trim()).toBe('1')
    for (const row of rows.slice(1)) expect(row.trim()).toBe('')
  })

  test('sit against the right of their column, whatever their digits', () => {
    const long = Array.from({ length: 60 }, (_one, at) => `word ${at}`).join('\n\n')

    const room = NUMS - 10

    for (const page of pages(long, { gutter: NUMS, breakAt: 0 })) {
      for (const row of page.numbers.split('\n')) {
        expect(width(row)).toBeLessThanOrEqual(room)
        if (row.trim() === '') continue
        expect(width(row)).toBeGreaterThan(room - SPACE - 1)
      }
    }
  })

  test('cost the note some of its width, and never more than it has', () => {
    const wide = pages(PROSE, { gutter: 0, breakAt: 0 })
    const narrow = pages(PROSE, { gutter: NUMS, breakAt: 0 })
    const widest = (all: ReturnType<typeof pages>) =>
      Math.max(
        ...all.flatMap((page) => page.words.split('\n').map((row) => width(row.trimStart()))),
      )

    expect(widest(narrow)).toBeLessThan(widest(wide))
    expect(narrow.length).toBeGreaterThanOrEqual(wide.length)
    for (const page of [...wide, ...narrow]) {
      for (const row of page.words.split('\n')) expect(width(row)).toBeLessThanOrEqual(BODY_INNER)
    }
  })
})

describe('what moves whole', () => {
  test('keeps a fence together with the line that opens it', () => {
    const note = `${'filler paragraph that takes a line\n\n'.repeat(6)}\`\`\`ts\nconst a = 1\nconst b = 2\n\`\`\`\n`
    const all = pages(note, { breakAt: 0 })
    const opens = all.find((page) => page.words.includes('‘‘‘ts'))

    expect(opens?.words).toContain('const a = 1')
    expect(opens?.words).toContain('const b = 2')
  })

  test('keeps a table together with its head', () => {
    const note = `${'filler paragraph that takes a line\n\n'.repeat(6)}| Kind | Size |\n| --- | --- |\n| Image | 288 |\n`
    const all = pages(note, { breakAt: 0 })
    const head = all.find((page) => page.words.includes('Kind'))

    expect(head?.words).toContain('Image')
  })

  test('breaks a run longer than a page rather than losing it', () => {
    const code = Array.from({ length: 30 }, (_one, at) => `line ${at}`).join('\n')
    const all = pages(`\`\`\`\n${code}\n\`\`\`\n`, { breakAt: 0 })

    expect(all.length).toBeGreaterThan(1)
    const set = all.map((page) => page.words).join('\n')
    for (let at = 0; at < 30; at++) expect(set).toContain(`line ${at}`)
  })

  test('loses no line of the note across the pages', () => {
    const note = [
      '# Title',
      '',
      ...Array.from({ length: 20 }, (_one, at) => `Paragraph ${at}.\n`),
      '## Section',
      '',
      '- a',
      '- b',
      '',
      '```',
      'code',
      '```',
      '',
    ].join('\n')

    const set = pages(note)
      .map((page) => `${page.section}\n${page.words}`)
      .join('\n')

    for (let at = 0; at < 20; at++) expect(set).toContain(`Paragraph ${at}.`)
    for (const want of ['TITLE', 'SECTION', '• a', '• b', '‘‘‘', 'code']) {
      expect(set, want).toContain(want)
    }
  })
})

describe('a line longer than a page', () => {
  const LONG = 'long '.repeat(400).trim()

  test('is cut between its rows, so all of it can be read', () => {
    const all = pages(LONG)

    expect(all.length).toBeGreaterThan(1)
    for (const page of all) {
      expect(page.words.split('\n').length).toBeLessThanOrEqual(BODY_ROWS)
    }
    expect(
      all
        .map((page) => page.words)
        .join(' ')
        .split(/\s+/u).length,
    ).toBe(400)
  })

  test('says its number on its first row only', () => {
    const all = pages(LONG, { gutter: NUMS })

    expect(all[0]?.numbers.split('\n')[0]).toContain('1')
    expect(all[1]?.numbers.trim()).toBe('')
    expect(all[1]?.numbers.split('\n').length).toBe(all[1]?.words.split('\n').length)
  })

  test('goes forwards, so an offset in it finds the page it is on', () => {
    const all = pages(`before\n\n${LONG}\n\nafter`)

    for (const [at, page] of all.entries()) {
      if (at > 0) expect(page.from).toBeGreaterThan(all[at - 1]?.from ?? -1)
      expect(page.to).toBeGreaterThan(page.from)
      expect(pageAt(all, page.from)).toBe(at)
    }
    expect(all.at(-1)?.words).toContain('after')
  })
})

describe('a heading with nothing under it', () => {
  test('takes the next heading into its page rather than opening on a blank one', () => {
    const all = pages('# Title\n\n## Section\n\nbody')

    expect(all.map((page) => page.section)).toEqual(['TITLE'])
    expect(all[0]?.words).toContain('SECTION')
    expect(all[0]?.words).toContain('body')
    expect(all[0]).toMatchObject({ from: 0, firstLine: 1 })
  })

  test('every one of a run of them is read, in order', () => {
    const [page] = pages('## A\n\n## B\n\n## C\n\ntext')

    expect(page?.section).toBe('A')
    expect(page?.words.indexOf('B')).toBeLessThan(page?.words.indexOf('C') ?? 0)
    expect(page?.words).toContain('text')
  })

  test('a long section under it wears its own heading on the next page', () => {
    const all = pages(`# Title\n\n## Section\n\n${PROSE}`)

    expect(all[0]?.section).toBe('TITLE')
    expect(all[1]?.section).toBe('SECTION')
  })

  test('at the end of a note, or as the whole of it, still makes a page', () => {
    expect(pages('text\n\n## Empty at end').at(-1)?.section).toBe('EMPTY AT END')
    const only = pages('# Just a title')
    expect(only.map((page) => page.section)).toEqual(['JUST A TITLE'])
    expect(only[0]).toMatchObject({ words: '', from: 0, firstLine: 1, lastLine: 1 })
  })
})

describe('a table longer than a page', () => {
  const rows = Array.from({ length: 30 }, (_one, at) => `| r${at} | ${at} |`)
  const note = ['| a | b |', '| - | - |', ...rows, ''].join('\n')

  test('holds each row at its own line, so an offset finds the row', () => {
    const all = pages(note, { breakAt: 0, gutter: NUMS })

    expect(all.length).toBeGreaterThan(1)
    expect(pageAt(all, 0)).toBe(0)
    expect(all[0]).toMatchObject({ from: 0, firstLine: 1, lastLine: BODY_ROWS })
    expect(all[0]?.numbers.split('\n').map((one) => one.trim())[1]).toBe('2')
    const last = note.indexOf('| r29 |')
    expect(pageAt(all, last)).toBe(all.length - 1)
    expect(all[1]?.from).toBe(note.indexOf(`| r${BODY_ROWS - 2} |`))
  })
})

describe('where a page is', () => {
  test('numbers the pages in order and only goes forwards', () => {
    const all = pages(PROSE)

    expect(all.map((page) => page.index)).toEqual(all.map((_one, at) => at))
    let last = -1
    for (const page of all) {
      expect(page.from).toBeGreaterThanOrEqual(last)
      last = page.from
    }
  })

  test('ends the last page at the end of the note', () => {
    expect(pages(PROSE).at(-1)?.to).toBe(PROSE.length)
  })

  test('maps an offset back to the page it is on', () => {
    const all = pages(PROSE)

    expect(pageAt(all, 0)).toBe(0)
    expect(pageAt(all, PROSE.length)).toBe(all.length - 1)
    for (const page of all) expect(pageAt(all, page.from)).toBe(page.index)
  })

  test('maps a line of the note to the page it is on', () => {
    const note = Array.from({ length: 60 }, (_one, at) => `line ${at + 1}`).join('\n\n')
    const all = pages(note, { breakAt: 0 })

    expect(pageOfLine(all, 1)).toBe(0)
    for (const page of all) {
      expect(pageOfLine(all, page.firstLine)).toBe(page.index)
      expect(pageOfLine(all, page.lastLine)).toBe(page.index)
    }
    expect(pageOfLine(all, 10_000)).toBe(all.length - 1)
  })

  test('says which lines of the note it shows', () => {
    const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
    const [first, second] = pages(`${words.join('\n\n')}\n`)

    expect(first?.firstLine).toBe(1)
    expect(first?.lastLine).toBe(15)
    expect(second?.firstLine).toBeGreaterThan(first?.lastLine ?? 0)
  })
})

describe('telling two pages apart', () => {
  test('hashes a page by everything the panel would show', () => {
    const [first] = pages(PROSE)
    const [again] = pages(PROSE)

    expect(first?.hash).toBe(again?.hash)
  })

  test('changes the hash when the words change', () => {
    expect(pages(PROSE)[0]?.hash).not.toBe(pages(`x. ${PROSE}`)[0]?.hash)
  })

  test('changes the hash when only the heading over it changed', () => {
    const one = pages('## One\n\nsame words\n')[0]
    const two = pages('## Two\n\nsame words\n')[0]

    expect(one?.words).toBe(two?.words)
    expect(one?.hash).not.toBe(two?.hash)
  })

  test('leaves a page alone when an edit further down the note moved nothing', () => {
    const note = `## One\n\nwords one\n\n## Two\n\nwords two\n`
    const before = pages(note)
    const after = pages(note.replace('words two', 'words two, edited'))

    expect(after[0]?.hash).toBe(before[0]?.hash)
    expect(after[1]?.hash).not.toBe(before[1]?.hash)
  })
})

describe('what a page costs', () => {
  test('pages a note of twenty thousand characters', () => {
    expect(NOTE.length).toBeGreaterThan(20_000)
    expect(pagesOf(NOTE, PAGING).length).toBeGreaterThan(100)
  })

  test('breaks a line once and remembers it, which is what a keystroke costs nothing', () => {
    const line = 'a line of a note, long enough to wrap across the panel more than once over'

    expect(wrap(line, 400)).toBe(wrap(line, 400))
    expect(wrap(line, 400)).not.toBe(wrap(line, 300))
    expect(wrap(line, 400)).not.toBe(wrap(line, 400, '  '))
  })

  test('re-pages a note after a keystroke without breaking its lines again', () => {
    const first = pagesOf(typed(0), PAGING)
    const after = pagesOf(typed(1), PAGING)

    const moved = after.filter((page, index) => page.hash !== first[index]?.hash)
    expect(moved.length).toBeLessThanOrEqual(2)
    expect(first.length).toBe(after.length)
  })

  test('pages a long note again and again without slowing down', () => {
    const round = (at: number) => {
      let pages = 0
      const cost = costOf(() => (pages = pagesOf(typed(at, 'k'), PAGING).length))
      return { pages, ...cost }
    }

    const first = round(0)
    let last = first
    for (let at = 1; at < 8; at++) last = round(at)

    expect(first.set.broken).toBe(1)
    expect(first.set.cached).toBeGreaterThan(400)

    expect(last.set).toEqual(first.set)
    expect(last.paged).toEqual(first.paged)
    expect(last.pages).toBe(first.pages)
  })
})
