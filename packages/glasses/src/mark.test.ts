import { describe, expect, test } from 'vitest'
import { draws, fold, width } from './firmware'
import { markLines, workDone } from './mark'
import { BODY_INNER } from './panel'

const lines = (source: string, inner = BODY_INNER) =>
  markLines(source, { inner }).map((one) => one.text)

const one = (source: string) => lines(source).join('\n')

/** Rule one, and it is Emil's: a mark that only styles words is dropped, and a
 *  mark that says what something is, is kept.
 *
 *  "It's about understanding the markdown. And for that it's not necessary to
 *  know whether text is bold or not. But it is necessary to know whether
 *  something is code or not." */
describe('marks that only style words', () => {
  test.each([
    ['bold', 'a **bold** word', 'a bold word'],
    ['italic', 'an *italic* word', 'an italic word'],
    ['both', 'a ***loud*** word', 'a loud word'],
    ['underscores', 'an _italic_ word', 'an italic word'],
    ['struck through', 'a ~~struck~~ word', 'a struck word'],
    ['highlighted', 'a ==lit== word', 'a lit word'],
    ['bold inside italic', '*a **very** loud word*', 'a very loud word'],
  ])('%s is its words and nothing else', (_what, source, want) => {
    expect(one(source)).toBe(want)
  })

  test('leaves no asterisk, underscore or tilde behind', () => {
    const set = one('**bold** *italic* ~~struck~~ ==lit== ^up^ ~down~')

    expect(set).not.toMatch(/[*_~=]/)
  })
})

/** Rule one the other way round: what a reader cannot work out for themselves is
 *  kept. On a panel with one font, code and prose look exactly alike. */
describe('marks that say what something is', () => {
  test('inline code keeps its ticks', () => {
    // Folded, because the firmware has no backtick; see firmware.ts.
    expect(one('call `readNote()` first')).toBe(fold('call `readNote()` first'))
    expect(one('call `readNote()` first')).toContain('‘readNote()‘')
  })

  test('a fence keeps the lines it was written between', () => {
    expect(one('```ts\nconst a = 1\n```\n')).toBe(['‘‘‘ts', 'const a = 1', '‘‘‘'].join('\n'))
  })

  test('a fence with no language still says it is one', () => {
    expect(lines('```\nplain\n```\n')).toEqual(['‘‘‘', 'plain', '‘‘‘'])
  })

  test('a fence keeps its code exactly, indentation and all', () => {
    const set = lines('```py\ndef go():\n    return 1\n```\n')

    expect(set[2]).toBe('    return 1')
  })

  test('a tab in a fence becomes the spaces it stood for', () => {
    // The firmware has no glyph for a tab at all, so this was a fence with no
    // indentation in it.
    expect(lines('```go\nfunc a() {\n\treturn 1\n}\n```\n')[2]).toBe('  return 1')
  })

  test('maths keeps its dollars, since its source is what there is to read', () => {
    expect(one('the value $E = mc^2$ here')).toBe('the value $E = mc^2$ here')
    expect(lines('$$\nE = mc^2\n$$\n')).toEqual(['$$', 'E = mc^2', '$$'])
  })
})

/** Headings, in a font with one size. Capitals throughout, and the level said by
 *  a rule under the first two and a chevron on the last three. */
describe('a heading', () => {
  test('is set in capitals, with a heavy rule under a first level one', () => {
    const set = lines('# The title\n\nWords.\n')

    expect(set[0]).toBe('THE TITLE')
    expect(set[1]).toBe('═'.repeat(28))
    expect(width(set[1] ?? '')).toBe(BODY_INNER)
  })

  test('has a light rule under a second level one', () => {
    expect(lines('## A section\n')[1]).toBe('─'.repeat(28))
  })

  test('is capitals alone at the third level', () => {
    expect(lines('### Deeper\n')).toEqual(['DEEPER'])
  })

  test('carries a chevron for each level past the third', () => {
    expect(lines('#### Four\n')).toEqual(['› FOUR'])
    expect(lines('##### Five\n')).toEqual(['›› FIVE'])
    expect(lines('###### Six\n')).toEqual(['››› SIX'])
  })

  test('says which level it is, so a page can start at one', () => {
    const marked = markLines('# One\n\n## Two\n\n### Three\n', { inner: BODY_INNER })

    expect(marked.filter((line) => line.level > 0).map((line) => line.level)).toEqual([1, 2, 3])
  })

  test('marks its own underline as furniture rather than as a line of the note', () => {
    const marked = markLines('## A section\n', { inner: BODY_INNER })

    expect(marked.map((line) => line.under)).toEqual([false, true])
  })

  test('keeps a rule the author wrote apart from an underline', () => {
    const marked = markLines('## A section\n\n---\n', { inner: BODY_INNER })

    // Two rules that look alike: the heading's, and the author's own.
    expect(marked.map((line) => line.under)).toEqual([false, true, false])
  })

  test('drops the marks inside it too', () => {
    expect(lines('### A *loud* `code` word\n')).toEqual(['A LOUD ‘CODE‘ WORD'])
  })
})

/** Lists, which is where the firmware's missing glyphs bit hardest: it has no
 *  ballot box and no check mark at all. */
describe('a list', () => {
  test('marks a bullet, and a deeper one differently', () => {
    expect(lines('- one\n- two\n')).toEqual(['• one', '• two'])
    expect(lines('- one\n  - inside\n')).toEqual(['• one', '   · inside'])
    expect(lines('- one\n  - two\n    - three\n')).toEqual(['• one', '   · two', '      - three'])
  })

  test('numbers an ordered list as it was numbered', () => {
    expect(lines('1. one\n2. two\n')).toEqual(['1. one', '2. two'])
    expect(lines('7. seven\n8. eight\n')).toEqual(['7. seven', '8. eight'])
  })

  test('draws a task as a box, filled or not', () => {
    expect(lines('- [ ] to do\n- [x] done\n')).toEqual(['□ to do', '■ done'])
  })

  test('never draws a task with a glyph the font lacks', () => {
    for (const letter of one('- [ ] a\n- [x] b\n')) {
      if (letter === '\n') continue
      expect(draws(letter.codePointAt(0) ?? 0), letter).toBe(true)
    }
  })

  /** Emil: "indentation is not forbidden, but not at the root level, that wastes
   *  space." A block inside a top level item is at the root level of the note, so
   *  it begins where the item does. A list inside a list still steps, because that
   *  step is what says which list an item belongs to. */
  test('sets what follows an item at the item’s own indent', () => {
    expect(lines('- one\n\n  more about one\n')).toEqual(['• one', 'more about one'])
    expect(lines('- one\n  - inside\n\n    under it\n')).toEqual([
      '• one',
      '   · inside',
      '   under it',
    ])
  })
})

/** Quotes and callouts. */
describe('a quote', () => {
  test('carries a bar down its left', () => {
    expect(lines('> quoted\n')).toEqual(['│ quoted'])
  })

  test('carries one bar for each level', () => {
    expect(lines('> one\n>\n> > two\n')).toEqual(['│ one', '│ │ two'])
  })

  test('says what kind of callout it is, in capitals', () => {
    expect(lines('> [!warning]\n> Mind the gap.\n')).toEqual(['│ WARNING', '│ Mind the gap.'])
  })

  test('drops the callout marker itself', () => {
    expect(one('> [!note]\n> Something.\n')).not.toContain('[!note]')
  })

  test('knows the kinds beyond the five it started with', () => {
    expect(lines('> [!danger]\n> Mind the gap.\n')).toEqual(['│ DANGER', '│ Mind the gap.'])
    expect(lines('> [!tldr]\n> The short of it.\n')).toEqual(['│ TLDR', '│ The short of it.'])
  })

  test('says a title of the writer’s own rather than the kind, as written', () => {
    // Capitals are the only emphasis one font has, and a whole sentence in
    // capitals is shouting. A one word kind is not.
    expect(lines('> [!tip] Mind the gap\n> Between the two.\n')).toEqual([
      '│ Mind the gap',
      '│ Between the two.',
    ])
  })

  test('swallows the fold sign, which is not words', () => {
    expect(one('> [!warning]- Shut\n> Behind it.\n')).not.toContain(']-')
  })

  test('says the name of a kind it has never heard of', () => {
    expect(lines('> [!recipe]\n> Flour and water.\n')).toEqual(['│ RECIPE', '│ Flour and water.'])
  })
})

/** A note to the writer is not read out to anybody, here either. Both spellings
 *  go, and the offsets every line carries do not move; see comments.ts. */
describe('a comment', () => {
  test('is not set on the panel, whichever way it is written', () => {
    expect(one('Words %% to myself %% here.\n')).not.toContain('to myself')
    expect(one('Words <!-- to myself --> here.\n')).not.toContain('to myself')
  })

  test('leaves the words around it where they were', () => {
    // Both spaces stay, the one before the comment and the one after it, which
    // is what the renderer does with them too.
    expect(lines('Words %% aside %% here.\n')).toEqual(['Words  here.'])
  })

  test('leaves the line it had to itself behind, so the note keeps its shape', () => {
    expect(lines('%% a note %%\nSecond line.\n')).toEqual(['Second line.'])
  })

  test('inside a fence is what the fence is showing', () => {
    expect(one('```\n%% kept %%\n```\n')).toContain('%% kept %%')
  })
})

/** Everything else a note can hold. Nothing here is allowed to disappear. */
describe('nothing in a note is dropped', () => {
  test('a table becomes columns that line up', () => {
    const set = lines('| Kind | Size |\n| --- | ---: |\n| Image | 288 |\n| Text | 27 |\n')

    expect(set).toHaveLength(4)
    expect(set[1]).toMatch(/^─+$/)
    expect(set[0]).toContain('Kind')
    expect(set[2]).toContain('Image')
    expect(set[3]).toContain('27')
    // The head and the rows start at the same pixel, which is what "lines up"
    // means when the font is proportional.
    expect(width(set[0]?.split(/ {2,}/)[0] ?? '')).toBeLessThanOrEqual(width('Image  '))
  })

  test('a right aligned column is set to the right', () => {
    const set = lines('| a | n |\n| --- | ---: |\n| x | 1 |\n| y | 1000 |\n')

    // Both numbers end at the same pixel.
    expect(width(set[2] ?? '')).toBeCloseTo(width(set[3] ?? ''), -1)
  })

  test('a table too wide for the panel is fitted, not dropped', () => {
    const wide = `| ${'a'.repeat(80)} | ${'b'.repeat(80)} |\n| --- | --- |\n| ${'c'.repeat(80)} | ${'d'.repeat(80)} |\n`
    const set = lines(wide)

    expect(set).toHaveLength(3)
    for (const row of set) expect(width(row)).toBeLessThanOrEqual(BODY_INNER)
    expect(set[2]).toContain('…')
  })

  test('a rule reaches the whole width', () => {
    expect(width(lines('---\n')[0] ?? '')).toBe(BODY_INNER)
  })

  test('a picture is what it was described as, with a mark to say it was one', () => {
    expect(lines('![A diagram](sketch.png)\n')).toEqual(['▤ A diagram'])
    // Nothing to describe it: its address, so the line is not a gap.
    expect(lines('![](sketch.png)\n')).toEqual(['▤ sketch.png'])
  })

  test('a picture in the middle of a sentence is its words', () => {
    expect(one('before ![a mark](m.png) after')).toBe('before a mark after')
  })

  test('a link is the words it shows', () => {
    expect(one('see [the docs](https://example.com)')).toBe('see the docs')
  })

  test('a link with nothing to show is its own address', () => {
    expect(one('see <https://example.com>')).toBe('see https://example.com')
  })

  test('a wikilink is the note it names', () => {
    expect(one('see [[Another note]]')).toBe('see Another note')
    expect(one('see [[Another note|this way]]')).toBe('see this way')
  })

  test('an embed reads as the note it names', () => {
    expect(one('![[Another note]]')).toBe('Another note')
  })

  test('a titled chart is its title, because a panel of one font cannot draw one', () => {
    expect(
      lines('```chart\ntype: bar\ntitle: Two quarters\nseries:\n  - data: [1, 2]\n```\n'),
    ).toEqual(['▤ Two quarters'])
  })

  test('and an untitled one stays its numbers, which are the part that can be read', () => {
    const said = lines('```chart\nseries:\n  - data: [1, 2]\n```\n')
    expect(said.join('\n')).toContain('data: [1, 2]')
  })

  test('an embedded file is its name behind the mark that says it is one', () => {
    // A panel of one font cannot play a recording or show a page of a paper, and
    // a line that merely said `clip.mp3` would read as prose about a file name.
    expect(lines('![[clip.mp3]]\n')).toEqual(['▤ clip.mp3'])
    expect(lines('![[demo.mp4]]\n')).toEqual(['▤ demo.mp4'])
    expect(lines('![[shot.png]]\n')).toEqual(['▤ shot.png'])
    expect(lines('![[paper.pdf#page=3]]\n')).toEqual(['▤ paper.pdf#page=3'])
    expect(lines('![[Board.canvas]]\n')).toEqual(['▤ Board.canvas'])
  })

  test('and a note embedded on its own line carries no such mark', () => {
    // There is nothing about a note this panel cannot show, so nothing to say.
    expect(lines('![[Another note]]\n')).toEqual(['Another note'])
  })

  test('a footnote is a superscript, and its note is set under the same mark', () => {
    const set = lines('A claim.[^1]\n\n[^1]: The evidence.\n')

    expect(set[0]).toBe('A claim.¹')
    expect(set).toContain('¹')
    expect(set.join('\n')).toContain('The evidence.')
  })

  test('a footnote named in words keeps its name', () => {
    expect(one('A claim.[^why]')).toBe('A claim.[^why]')
  })

  test('a superscript of digits is raised, and anything else is not', () => {
    expect(one('x^2^')).toBe('x²')
    expect(one('x^n^')).toBe('xn')
    expect(one('H~2~O')).toBe('H₂O')
  })

  test('a definition list keeps the colon that ties it together', () => {
    // At the margin, because the colon is the marker and the note is at its root
    // level; see the list case above.
    expect(lines('Term\n: what it means\n')).toEqual(['Term', ': what it means'])
  })

  test('an emoji written as a name is the emoji the font can draw', () => {
    // The firmware's emoji font has this one.
    expect(one('smile :grinning:')).toBe('smile 😀')
    // And not this one, so it comes back as the name it was written with rather
    // than as a hole in the line. See `fold` in firmware.ts.
    expect(one('ship it :rocket:')).toBe('ship it :rocket:')
  })

  test('html is the words inside it, without the tags', () => {
    expect(one('a <b>bold</b> word')).toBe('a bold word')
    expect(one('<div>block</div>')).toBe('block')
  })

  /** A single newline inside a paragraph is a space in markdown, and at the top
   *  compaction that is what it becomes. Read as a break it was two lines on the
   *  panel for every wrapped paragraph in every note, both numbered with the line the
   *  paragraph started on, and the panel held half of what it should.
   *
   *  Asked of `aggressive` by name, because the default is `collapse` now: Emil, who
   *  reads on a pair, would rather have the note's own breaks. See `Compaction`. */
  test('a paragraph hard wrapped in the file is one line at the top compaction', () => {
    const flowed = (source: string) =>
      markLines(source, { inner: BODY_INNER, compaction: 'aggressive' }).map((one) => one.text)

    expect(flowed('one two\nthree four\nfive six\n')).toEqual(['one two three four five six'])
    expect(flowed('- one two\n  three four\n')).toEqual(['• one two three four'])
    expect(flowed('> one two\n> three four\n')).toEqual(['│ one two three four'])

    // And at the default the reader gets the lines they wrote.
    expect(lines('one two\nthree four\n')).toEqual(['one two', 'three four'])
  })

  test('a hard break is two lines, the second under the words of the first', () => {
    // Three spaces, which is the fourteen pixels the bullet and its space took,
    // to the nearest five pixel space.
    expect(lines('- one  \n  two\n')).toEqual(['• one', '   two'])
    expect(lines('one  \ntwo\n')).toEqual(['one', 'two'])
  })

  test('front matter is not set, as it is not on a page either', () => {
    expect(one('---\ntitle: A note\n---\n\nWords.\n')).toBe('Words.')
  })

  test('leaves nothing of a note unaccounted for', () => {
    const note = [
      '# Everything',
      '',
      'Prose with **bold**, *italic*, `code`, $x^2$ and a [link](https://a.b).',
      '',
      '## A list',
      '',
      '- one',
      '- [ ] a task',
      '- [x] a done task',
      '',
      '1. first',
      '',
      '> quoted',
      '',
      '> [!tip]',
      '> a callout',
      '',
      '```ts',
      'const a = 1',
      '```',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '$$',
      'E = mc^2',
      '$$',
      '',
      '![a picture](p.png)',
      '',
      'A claim.[^1]',
      '',
      '---',
      '',
      'Term',
      ': meaning',
      '',
      '[^1]: because',
      '',
    ].join('\n')

    const set = one(note)

    // Every construct left a mark, and every character of it is drawable.
    for (const want of [
      'EVERYTHING',
      'bold',
      'italic',
      '‘code‘',
      '$x^2$',
      'link',
      'A LIST',
      '• one',
      '□ a task',
      '■ a done task',
      '1. first',
      '│ quoted',
      '│ TIP',
      '│ a callout',
      '‘‘‘ts',
      'const a = 1',
      '$$',
      'E = mc^2',
      '▤ a picture',
      'A claim.¹',
      ': meaning',
      'because',
    ]) {
      expect(set, want).toContain(want)
    }

    for (const letter of set) {
      if (letter === '\n') continue
      expect(draws(letter.codePointAt(0) ?? 0), JSON.stringify(letter)).toBe(true)
    }
  })
})

/** Where a line came from, which is what the position map, the scroll binding and
 *  "go to line" all stand on. */
describe('where a line came from', () => {
  test('says which line of the note each one is', () => {
    const marked = markLines('one\n\ntwo\n\nthree\n', { inner: BODY_INNER })

    expect(marked.map((line) => line.at)).toEqual([1, 3, 5])
  })

  test('counts front matter, because a reader taken there means the file', () => {
    const marked = markLines('---\na: b\n---\n\nwords\n', { inner: BODY_INNER })

    expect(marked[0]?.at).toBe(5)
  })

  test('gives every line of a fence its own place in the file', () => {
    const marked = markLines('```\nalpha\nbeta\n```\n', { inner: BODY_INNER })

    expect(marked.map((line) => line.at)).toEqual([1, 2, 3, 4])
  })

  test('only ever moves forwards through the note', () => {
    const marked = markLines(
      '# One\n\ntext\n\n- a\n- b\n\n> q\n\n```\nc\n```\n\n| h |\n| --- |\n| r |\n',
      { inner: BODY_INNER },
    )

    let last = -1
    for (const line of marked) {
      expect(line.from).toBeGreaterThanOrEqual(last)
      last = line.from
    }
  })

  test('glues what must not be parted from the line above it', () => {
    const marked = markLines('```\nalpha\n```\n', { inner: BODY_INNER })

    expect(marked.map((line) => line.glued)).toEqual([false, true, true])
  })

  test('glues a table to its head', () => {
    const marked = markLines('| a |\n| --- |\n| 1 |\n| 2 |\n', { inner: BODY_INNER })

    expect(marked.map((line) => line.glued)).toEqual([false, true, true, true])
  })
})

/** What it costs, because speed is the reason text mode exists.
 *
 *  Counted rather than timed. This block held a stopwatch to a note of twenty
 *  thousand characters and asked for under 120 ms; a runner with the rest of the
 *  suite on it answered 123.25 and failed a test that had found nothing wrong -
 *  the same commit had passed minutes earlier. A timing is a proxy for the work
 *  done and a poor one: what it measures is partly the queue in front of the code.
 *
 *  So `workDone` in mark.ts counts the four things marking a note actually does -
 *  the blocks walked, the lines made, the characters folded into them and the
 *  characters read looking for where each block begins - and those are the same
 *  numbers on a loaded machine as on an idle one. Each of them names a way this
 *  could get slower: a block walked twice, a line folded twice, a locator that
 *  starts again from the top.
 *
 *  One clock is left, on the whole pass, with a margin no real regression could
 *  hide in: a count cannot tell code that got slower from code that did not, and
 *  code that has changed shape misses a margin like that by a factor rather than by
 *  a percent. */
describe('what it costs', () => {
  /** Two hundred sections: a heading, a paragraph and a list of two, which is about
   *  twenty four thousand characters and a thousand lines of panel. */
  const note = Array.from(
    { length: 200 },
    (_one, at) =>
      `## Section ${at}\n\nSome prose about section ${at}, long enough to wrap across the panel more than once.\n\n- a point\n- another\n`,
  ).join('\n')

  function marking(source: string) {
    workDone()
    const marked = markLines(source, { inner: BODY_INNER })
    return { marked, work: workDone() }
  }

  test('marks a note of twenty thousand characters, and counts what that took', () => {
    const { marked, work } = marking(note)

    // Every line that came out was counted as it was made.
    expect(marked).toHaveLength(work.lines)
    expect(marked.length).toBeGreaterThan(800)

    // Every block of the note, at every depth: the sections, their prose, the lists
    // and the items in them. More blocks than lines, because a list is a block that
    // holds blocks; not many more, because nothing is walked twice.
    expect(work.blocks).toBeGreaterThan(marked.length)
    expect(work.blocks).toBeLessThan(marked.length * 2)

    // What is written to the panel is the note with its marks taken off and its
    // indents put on, once. A multiple of the note would be a note folded twice.
    expect(work.folded).toBeGreaterThan(note.length / 2)
    expect(work.folded).toBeLessThan(note.length * 1.5)

    // The locator searches forward from where the last block ended, so the whole
    // note costs about one read of it - 31,779 characters for a note of 23,979,
    // because a block that holds others is looked for once and read again by its
    // children.
    expect(work.searched).toBeLessThan(note.length * 2)
  })

  /** The regression this is really for. Every count above is linear in the note, and
   *  the one that could stop being linear is the locator: a change that sent it back
   *  to the start of the note for each block would read the note squared - about
   *  three hundred million characters for this one rather than thirty thousand - and
   *  would still pass every test in this file that is about what a note looks like. */
  test('and twice the note is twice the work, not four times', () => {
    const once = marking(note)
    const twice = marking([note, note].join('\n'))

    expect(twice.work.lines).toBe(once.work.lines * 2)
    expect(twice.work.folded).toBe(once.work.folded * 2)
    expect(twice.work.blocks).toBeLessThan(once.work.blocks * 2 + 10)
    expect(twice.work.searched).toBeLessThan(once.work.searched * 2 + 100)
  })

  /** The one clock in this file. Twenty five milliseconds on the machine this was
   *  written on and a hundred and twenty three on the loaded runner that failed the
   *  old assertion, against a ceiling of a second: this is not a measurement of
   *  speed, it is the line past which the shape of the code has changed. */
  test('and does the whole of it in well under a second', () => {
    const at = performance.now()
    const marked = markLines(note, { inner: BODY_INNER })
    const took = performance.now() - at

    expect(marked.length).toBeGreaterThan(800)
    expect(took).toBeLessThan(1_000)
  })
})
