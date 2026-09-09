import { measureTextWrap } from '@evenrealities/pretext'
import { describe, expect, test } from 'vitest'
import { fold, SPACE, width, wrap } from './firmware'
import { pageAt, pageOfLine, pagesOf, type Paging } from './pages'
import { BODY_INNER, BODY_ROWS } from './panel'

const paging = (over: Partial<Paging> = {}): Paging => ({
  breakAt: 2,
  gutter: 0,
  inner: BODY_INNER,
  rows: BODY_ROWS,
  ...over,
})

const pages = (source: string, over: Partial<Paging> = {}) => pagesOf(source, paging(over))

/** The column of line numbers, and the body beside it, as `panel.ts` sizes them
 *  when the reader has asked for numbers. */
const NUMS = 48
const NARROW = BODY_INNER - NUMS - 6

const PROSE = Array.from(
  { length: 30 },
  (_one, at) =>
    `Paragraph ${at} with enough words in it to run past the end of one line of the panel quite easily.`,
).join('\n\n')

/** The rule the whole reading experience turns on: a page is seven lines of the
 *  firmware's own measure, and never one more. */
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
    // Two models of the same font: ours, which breaks the lines, and pretext's
    // `measureTextWrap`, which is what the firmware's own shaping was measured
    // into. Every row we send has to be exactly one row when it lands.
    const note = `${PROSE}\n\n\`\`\`ts\nconst somethingRatherLong = aFunctionCall(withArguments, andMore)\n\`\`\`\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n`
    for (const page of pages(note, { gutter: NUMS, inner: NARROW })) {
      for (const row of page.words.split('\n')) {
        if (row.trim() === '') continue
        expect(measureTextWrap(row, NARROW).lineCount, JSON.stringify(row)).toBe(1)
      }
    }
  })

  test('fills the pages rather than leaving them half empty', () => {
    const all = pages(PROSE, { breakAt: 0 })
    // Every page but the last carries at least most of the panel.
    for (const page of all.slice(0, -1)) {
      expect(page.words.split('\n').length).toBeGreaterThanOrEqual(BODY_ROWS - 2)
    }
  })

  test('answers with nothing for a note with nothing in it', () => {
    expect(pages('')).toEqual([])
    expect(pages('   \n\n')).toEqual([])
  })
})

/** Item two of the brief: a heading level at which a new page starts. */
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

    // One section, however many pages it takes: every lower heading is then a
    // line of the note like any other.
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

    // No page has a section, because no heading opened one.
    expect([...new Set(all.map((page) => page.section))]).toEqual([''])
    // Every heading is then a line of the note like any other, underline
    // included, and nothing has been lost.
    const set = all.map((page) => page.words).join('\n')
    expect(set).toContain('THE TITLE')
    expect(set).toContain('═'.repeat(28))
    expect(set).toContain('SECOND SECTION')
  })

  test('takes the heading out of the body and into the head band', () => {
    const [first] = pages(note)

    expect(first?.section).toBe('THE TITLE')
    expect(first?.words).not.toContain('THE TITLE')
    // And its underline with it, so it is not drawn twice.
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

/** Item two again: the line numbers.
 *
 *  They live in a column of their own rather than in front of the body's own
 *  text, because a text container has no alignment of any kind: padded into the
 *  words, the words of each row start at a slightly different pixel. See
 *  `panel.ts`. */
describe('line numbers', () => {
  const note = 'one\n\ntwo\n\nthree\n'

  test('are nothing at all unless asked for', () => {
    const [page] = pages(note, { gutter: 0 })

    expect(page?.words).toBe('one\ntwo\nthree')
    expect(page?.numbers).toBe('')
  })

  test('are a column beside the body, one number to a line', () => {
    const [page] = pages(note, { gutter: NUMS, inner: NARROW })

    expect(page?.words).toBe('one\ntwo\nthree')
    expect(page?.numbers.split('\n').map((row) => row.trim())).toEqual(['1', '3', '5'])
  })

  test('have exactly as many lines as the body has rows', () => {
    const long = Array.from({ length: 30 }, (_one, at) => `paragraph ${at} of this note`).join(
      '\n\n',
    )

    for (const page of pages(long, { gutter: NUMS, inner: NARROW, breakAt: 0 })) {
      expect(page.numbers.split('\n')).toHaveLength(page.words.split('\n').length)
    }
  })

  test('say nothing on the rows a long line wrapped to', () => {
    const long = `a ${'word '.repeat(60)}\n`
    const [page] = pages(long, { gutter: NUMS, inner: NARROW })
    const rows = page?.numbers.split('\n') ?? []

    expect(rows.length).toBeGreaterThan(1)
    expect(rows[0]?.trim()).toBe('1')
    // The rest are the same line of the note, and saying so twice is a lie about
    // where you are.
    for (const row of rows.slice(1)) expect(row.trim()).toBe('')
  })

  test('sit against the right of their column, whatever their digits', () => {
    const long = Array.from({ length: 60 }, (_one, at) => `word ${at}`).join('\n\n')

    for (const page of pages(long, { gutter: NUMS, inner: NARROW, breakAt: 0 })) {
      for (const row of page.numbers.split('\n')) {
        // Never wider than the column, so a number can never run into the words.
        expect(width(row)).toBeLessThanOrEqual(NUMS)
        if (row.trim() === '') continue
        // And within one space of its right hand edge.
        expect(width(row)).toBeGreaterThan(NUMS - SPACE - 1)
      }
    }
  })

  test('cost the note some width, so it takes more pages', () => {
    const wide = pages(PROSE, { gutter: 0, inner: BODY_INNER, breakAt: 0 })
    const narrow = pages(PROSE, { gutter: NUMS, inner: NARROW, breakAt: 0 })

    expect(narrow.length).toBeGreaterThanOrEqual(wide.length)
    for (const page of narrow) {
      for (const row of page.words.split('\n')) expect(width(row)).toBeLessThanOrEqual(NARROW)
    }
  })
})

/** A line is never split across a page. */
describe('what moves whole', () => {
  test('keeps a fence together with the line that opens it', () => {
    const note = `${'filler paragraph that takes a line\n\n'.repeat(6)}\`\`\`ts\nconst a = 1\nconst b = 2\n\`\`\`\n`
    const all = pages(note, { breakAt: 0 })
    const opens = all.find((page) => page.words.includes('‘‘‘ts'))

    // Wherever the fence went, its body went with it.
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

/** Where a page is in the note, which is what binds the glasses to the phone. */
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
    // Past the end of the note is the last page rather than nothing.
    expect(pageOfLine(all, 10_000)).toBe(all.length - 1)
  })

  test('says which lines of the note it shows', () => {
    const [first, second] = pages('one\n\ntwo\n\nthree\n\nfour\n\nfive\n\nsix\n\nseven\n\neight\n')

    expect(first?.firstLine).toBe(1)
    expect(first?.lastLine).toBe(13)
    expect(second?.firstLine).toBeGreaterThan(first?.lastLine ?? 0)
  })
})

/** A page that has not changed is not sent again. */
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

/** Speed, which is the whole reason the glasses are written to rather than drawn
 *  on. Item three of the brief asks for a keystroke inside one frame. */
describe('what a page costs', () => {
  const note = Array.from(
    { length: 160 },
    (_one, at) =>
      `## Section ${at}\n\nProse about section ${at}, long enough to wrap across the panel more than once and then some.\n\n- a point\n- another point\n\n`,
  ).join('')

  /** How long a piece of work takes, at its worst over a few rounds.
   *
   *  The worst rather than the mean, because a keystroke that is quick four times
   *  in five is a keystroke that stutters. */
  const worstOf = (rounds: number, work: (round: number) => unknown) => {
    let worst = 0
    for (let round = 0; round < rounds; round++) {
      const at = performance.now()
      work(round)
      worst = Math.max(worst, performance.now() - at)
    }

    return worst
  }

  const typed = (round: number) =>
    note.replace('Prose about section 7,', `Prose about section 7${'x'.repeat(round)},`)

  test('pages a note of twenty thousand characters when it is first opened', () => {
    expect(note.length).toBeGreaterThan(20_000)
    expect(pagesOf(note, paging({ gutter: NUMS, inner: NARROW })).length).toBeGreaterThan(100)
  })

  /** What actually happens while somebody types: the note is paged again from the
   *  top and one line of it has changed. Every other line was broken before and is
   *  not broken again; see the cache in firmware.ts.
   *
   *  Asserted as a ratio rather than in milliseconds. The brief asks for a keystroke
   *  inside one frame and a quiet machine gives about 1 ms of the 16.7 there are, but
   *  a wall clock in a suite running seven packages at once measures the queue in
   *  front of it as much as the work, and a test that fails when the machine is busy
   *  is a test nobody trusts. The ratio is the property: a keystroke costs a fraction
   *  of a cold open, and if the cache ever stops working it costs all of one. */
  test('re-pages a note after a keystroke for a fraction of what opening it cost', () => {
    // Cold, with nothing in the cache: what a keystroke would cost without one.
    const cold = worstOf(3, (round) => pagesOf(typed(round + 900), paging({ gutter: NUMS })))
    const warm = worstOf(20, (round) => pagesOf(typed(round), paging({ gutter: NUMS })))

    expect(warm).toBeLessThan(cold / 2)
  })
})

/** The wrap itself, which everything above stands on. */
describe('wrapping a line', () => {
  test('breaks at a space and throws the space away', () => {
    const rows = wrap('one two three four five six seven eight nine ten', 100)

    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) {
      expect(row.startsWith(' ')).toBe(false)
      expect(width(row)).toBeLessThanOrEqual(100)
    }
    expect(rows.join(' ')).toBe('one two three four five six seven eight nine ten')
  })

  test('hangs the rows after the first under the words of the first', () => {
    const rows = wrap('• a list item with quite a lot of words in it indeed', 120, '   ')

    expect(rows.length).toBeGreaterThan(1)
    expect(rows[0]?.startsWith('• ')).toBe(true)
    for (const row of rows.slice(1)) expect(row.startsWith('   ')).toBe(true)
  })

  test('keeps a quote bar down every row of a wrapped quote', () => {
    const rows = wrap('│ a quoted line with a good many words in it', 120, '│ ')

    for (const row of rows) expect(row.startsWith('│ ')).toBe(true)
  })

  test('breaks a word too long for a row rather than running off the glass', () => {
    const rows = wrap('x'.repeat(300), 100)

    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) expect(width(row)).toBeLessThanOrEqual(100)
    expect(rows.join('')).toBe('x'.repeat(300))
  })

  test('gives an empty line one row', () => {
    expect(wrap('', 560)).toEqual([''])
  })

  test('folds what it is given, so nothing measured is invisible', () => {
    expect(wrap('a `tick`', 560)).toEqual([fold('a `tick`')])
  })

  test('breaks between two CJK characters, which have no spaces to break at', () => {
    const rows = wrap('日本語のノートを書いています。'.repeat(6), 200)

    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) expect(width(row)).toBeLessThanOrEqual(200)
  })
})
