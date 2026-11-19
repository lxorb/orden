import { describe, expect, test } from 'vitest'
import { linearly } from '../../../scripts/growth'
import { draws, fold, width } from './firmware'
import { markLines, MARKS, workDone } from './mark'
import { BODY_INNER } from './panel'
import fenceTable from '../../markdown/src/fence-table.json'

const lines = (source: string, inner = BODY_INNER) => markLines(source, { inner }).map((one) => one.text)
const one = (source: string) => lines(source).join('\n')
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
describe('marks that say what something is', () => {
  test('inline code keeps its ticks', () => {
    expect(one('call `readNote()` first')).toBe(fold('call `readNote()` first'))
    expect(one('call `readNote()` first')).toContain('‘readNote()‘')
  })
  test('a fence says what it is called, above it, and names its language alone', () => {
    expect(lines('```ts src/main.ts\nconst a = 1\n```\n')).toEqual(['src/main.ts', '‘‘‘ts', 'const a = 1', '‘‘‘'])
  })
  test('and reads a caption written the way other editors write one', () => {
    expect(lines('```ts title="What it does"\nconst a = 1\n```\n')[0]).toBe('What it does')
    expect(lines("```ts title='What it does'\nconst a = 1\n```\n")[0]).toBe('What it does')
  })
  test('and the caption is glued to the block it names', () => {
    const marked = markLines('```ts src/main.ts\nconst a = 1\n```\n', { inner: BODY_INNER })
    expect(marked.map((line) => line.glued)).toEqual([false, true, true, true])
  })
  test('and the caption is there even with the fence lines turned off', () => {
    const marked = markLines('```ts src/main.ts\nconst a = 1\n```\n', {
      inner: BODY_INNER,
      marks: { ...MARKS, fence: false },
    })
    expect(marked.map((line) => line.text)).toEqual(['src/main.ts', 'const a = 1'])
  })
  test('a fence keeps its code exactly, indentation and all', () => {
    const set = lines('```py\ndef go():\n    return 1\n```\n')
    expect(set[2]).toBe('    return 1')
  })
  test('a tab in a fence becomes the spaces it stood for', () => {
    expect(lines('```go\nfunc a() {\n\treturn 1\n}\n```\n')[2]).toBe('  return 1')
  })
  test('maths keeps its dollars, since its source is what there is to read', () => {
    expect(one('the value $E = mc^2$ here')).toBe('the value $E = mc^2$ here')
    expect(lines('$$\nE = mc^2\n$$\n')).toEqual(['$$', 'E = mc^2', '$$'])
  })
})
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
    expect(marked.map((line) => line.under)).toEqual([false, true, false])
  })
})
describe('a list', () => {
  test('never draws a task with a glyph the font lacks', () => {
    for (const letter of one('- [ ] a\n- [x] b\n')) {
      if (letter === '\n') continue
      expect(draws(letter.codePointAt(0) ?? 0), letter).toBe(true)
    }
  })
  test('sets what follows an item at the item’s own indent', () => {
    expect(lines('- one\n\n  more about one\n')).toEqual(['• one', 'more about one'])
    expect(lines('- one\n  - inside\n\n    under it\n')).toEqual(['• one', '   · inside', '   under it'])
  })
})
describe('a quote', () => {
  test('drops the callout marker itself', () => {
    expect(one('> [!note]\n> Something.\n')).not.toContain('[!note]')
  })
  test('says a title of the writer’s own rather than the kind, as written', () => {
    expect(lines('> [!tip] Mind the gap\n> Between the two.\n')).toEqual(['│ Mind the gap', '│ Between the two.'])
  })
  test('swallows the fold sign, which is not words', () => {
    expect(one('> [!warning]- Shut\n> Behind it.\n')).not.toContain(']-')
  })
  test('takes a marker line with a rule under it for the callout it opens', () => {
    for (const source of [
      '> [!note] Title\n> ---\n> body\n',
      '> [!note]\n> Heading\n> ---\n> body\n',
      '> [!note] Title\n> ===\n',
    ]) {
      expect(one(source)).not.toContain('[!')
      expect(lines(source)[0]).toMatch(/^│ (Title|NOTE)$/)
    }
  })
  test('reads code that starts with a marker as the code it is', () => {
    for (const source of ['>     [!note] T\n', '> ```md\n> [!note] x\n> ```\n']) {
      expect(lines(source).join('\n')).toContain('[!note]')
      expect(lines(source)).not.toContain('│ NOTE')
    }
  })
})
describe('a comment', () => {
  test('is not set on the panel, whichever way it is written', () => {
    expect(one('Words %% to myself %% here.\n')).not.toContain('to myself')
    expect(one('Words <!-- to myself --> here.\n')).not.toContain('to myself')
  })
  test('inside a fence is what the fence is showing', () => {
    expect(one('```\n%% kept %%\n```\n')).toContain('%% kept %%')
  })
})
describe('nothing in a note is dropped', () => {
  test('a table becomes columns that line up', () => {
    const set = lines('| Kind | Size |\n| --- | ---: |\n| Image | 288 |\n| Text | 27 |\n')
    expect(set).toHaveLength(4)
    expect(set[1]).toMatch(/^─+$/)
    expect(set[0]).toContain('Kind')
    expect(set[2]).toContain('Image')
    expect(set[3]).toContain('27')
    expect(width(set[0]?.split(/ {2,}/)[0] ?? '')).toBeLessThanOrEqual(width('Image  '))
  })
  test('a right aligned column is set to the right', () => {
    const set = lines('| a | n |\n| --- | ---: |\n| x | 1 |\n| y | 1000 |\n')
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
  test('a titled chart is its title, because a panel of one font cannot draw one', () => {
    expect(lines('```chart\ntype: bar\ntitle: Two quarters\nseries:\n  - data: [1, 2]\n```\n')).toEqual([
      '▤ Two quarters',
    ])
  })
  test('and an untitled one stays its numbers, which are the part that can be read', () => {
    const said = lines('```chart\nseries:\n  - data: [1, 2]\n```\n')
    expect(said.join('\n')).toContain('data: [1, 2]')
  })
  test('a footnote is a superscript, and its note is set under the same mark', () => {
    const set = lines('A claim.[^1]\n\n[^1]: The evidence.\n')
    expect(set[0]).toBe('A claim.¹')
    expect(set).toContain('¹')
    expect(set.join('\n')).toContain('The evidence.')
  })
  test('a paragraph hard wrapped in the file is one line at the top compaction', () => {
    const flowed = (source: string) =>
      markLines(source, { inner: BODY_INNER, compaction: 'aggressive' }).map((one) => one.text)
    expect(flowed('one two\nthree four\nfive six\n')).toEqual(['one two three four five six'])
    expect(flowed('- one two\n  three four\n')).toEqual(['• one two three four'])
    expect(flowed('> one two\n> three four\n')).toEqual(['│ one two three four'])
    expect(lines('one two\nthree four\n')).toEqual(['one two', 'three four'])
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
    const marked = markLines('# One\n\ntext\n\n- a\n- b\n\n> q\n\n```\nc\n```\n\n| h |\n| --- |\n| r |\n', {
      inner: BODY_INNER,
    })
    let last = -1
    for (const line of marked) {
      expect(line.from).toBeGreaterThanOrEqual(last)
      last = line.from
    }
  })
  test.each([
    ['fenced', 'Intro\n\n```\ncode one\ncode two\n```\n\nAfter\n'],
    ['indented', 'Intro\n\n    code one\n    code two\n\nAfter\n'],
    ['fenced in a list', '- a\n\n  ```\n  code one\n  code two\n  ```\n\nAfter\n'],
    ['indented in a list', '- a\n\n        code one\n        code two\n\nAfter\n'],
    ['with a blank line', '- a\n\n  ```\n  code one\n\n  code two\n  ```\n\nAfter\n'],
  ])('puts each line of a %s code block where it stands in the note', (_what, note) => {
    const marked = markLines(note, { inner: BODY_INNER })
    const at = (text: string) => marked.find((line) => line.text.trim() === text)
    for (const text of ['code one', 'code two', 'After']) {
      expect(at(text)?.from).toBe(note.lastIndexOf('\n', note.indexOf(text)) + 1)
      expect(at(text)?.at).toBe(note.slice(0, note.indexOf(text)).split('\n').length)
    }
    let last = -1
    for (const line of marked) {
      expect(line.from).toBeGreaterThanOrEqual(last)
      last = line.from
    }
  })
  test('never places a line before the one above it, however a list or quote swallows lines', () => {
    const note =
      '- a\n\n  ```\n  <b> ' +
      'x'.repeat(80) +
      '\n  ```\r\na .. b\r\n###### c\r\n\r\n\r\n$$\nd\n$$\n' +
      '```\n```\n> <b>' +
      'x'.repeat(80) +
      '|\n        - .. <b> ' +
      'x'.repeat(80) +
      '\n![[pic.png]] <b> ' +
      'x'.repeat(80) +
      '\n'
    const fences = '  ```\n  ```\n  ```\n  ```\n- a\n  ```\n\n'
    for (const source of [note, fences]) {
      for (const compaction of ['none', 'collapse', 'aggressive'] as const) {
        let last = -1
        for (const line of markLines(source, { inner: BODY_INNER, compaction })) {
          expect(line.from).toBeGreaterThanOrEqual(last)
          last = line.from
        }
      }
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
describe('what it costs', () => {
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
    expect(marked).toHaveLength(work.lines)
    expect(marked.length).toBeGreaterThan(800)
    expect(work.blocks).toBeGreaterThan(marked.length)
    expect(work.blocks).toBeLessThan(marked.length * 2)
    expect(work.folded).toBeGreaterThan(note.length / 2)
    expect(work.folded).toBeLessThan(note.length * 1.5)
    expect(work.searched).toBeLessThan(note.length * 2)
  })
  test('and twice the note is twice the work, not four times', () => {
    const once = marking(note)
    const twice = marking([note, note].join('\n'))
    expect(twice.work.lines).toBe(once.work.lines * 2)
    expect(twice.work.folded).toBe(once.work.folded * 2)
    expect(twice.work.blocks).toBeLessThan(once.work.blocks * 2 + 10)
    expect(twice.work.searched).toBeLessThan(once.work.searched * 2 + 100)
  })
  test('and does the whole of it in time in step with its length', () => {
    const sections = note.split(/(?=^## )/m)
    const marked = linearly(
      (count) => markLines(sections.slice(0, count).join(''), { inner: BODY_INNER }),
      sections.length,
    )
    expect(marked.length).toBeGreaterThan(800)
  })
})
describe('where a fence ends', () => {
  test('its closing line says its own line of the note', () => {
    const lines = markLines('```\na\nb\n```\n\nafter', { inner: 576 })
    expect(lines.map((line) => line.at)).toEqual([1, 2, 3, 4, 6])
  })
  test('with a longer fence and nothing after it', () => {
    const lines = markLines('````\na\n````', { inner: 576 })
    expect(lines.map((line) => line.at)).toEqual([1, 2, 3])
  })
})
describe('a fence, as every parser of a note reads it', () => {
  test.each(fenceTable as [string, string, string[]][])('%j', (note, shape, ids) => {
    const said = lines(note).join('\n')
    for (const id of ids) expect(said).not.toContain(id)
    const last = shape.lastIndexOf('c')
    if (shape.endsWith('w') && last !== -1) expect(said.trimEnd().endsWith('words')).toBe(true)
  })
})
describe('a word the front matter says as well', () => {
  test('is found where the page has it', () => {
    const note = '---\ntitle: Same\n---\n\nSame\n\n> q\n> r\n'
    const marked = markLines(note, { inner: BODY_INNER })
    expect(marked[0]?.at).toBe(5)
    expect(marked[0]?.from).toBe(note.indexOf('Same\n\n'))
    expect(marked.map((line) => line.at)).toEqual([5, 7, 8])
  })
})
describe('a block name', () => {
  test('is no words of the note', () => {
    expect(lines('words ^abc123\n\nmore')).toEqual(['words', 'more'])
    expect(lines('| a |\n| - |\n\n^abc123\n\nmore').at(-1)).toBe('more')
    expect(lines('a\n\n^abc123\n\nb')).toEqual(['a', 'b'])
  })
  test('in code it is code', () => {
    expect(lines('```\nx ^abc123\n```').join('\n')).toContain('x ^abc123')
  })
})
describe('a block name', () => {
  test('moves no line, however many there are', () => {
    const note = Array.from({ length: 60 }, (_, at) => `Paragraph ${at} ^blk${at}\n`).join('\n')
    const marked = markLines(note, { inner: BODY_INNER })
    for (const line of marked.filter((one) => one.text.startsWith('Paragraph'))) {
      expect(note.slice(line.from).startsWith(line.text.trimEnd())).toBe(true)
    }
    expect(marked.map((one) => one.text).join('\n')).not.toContain('^blk')
  })
  test('moves no line in a list, or in a paragraph that goes on under it', () => {
    const list = Array.from({ length: 6 }, (_, at) => `- item ${at} ^blk00${at}\n`).join('')
    const items = markLines(list, { inner: BODY_INNER })
    expect(items.map((one) => one.from)).toEqual([0, 17, 34, 51, 68, 85])
    const paragraph = 'one ^abc\ntwo\n'
    for (const compaction of ['aggressive', undefined] as const) {
      const marked = markLines(paragraph, {
        inner: BODY_INNER,
        ...(compaction ? { compaction } : {}),
      })
      expect(marked.map((one) => one.text).join(' ')).toBe('one two')
    }
    expect(markLines(paragraph, { inner: BODY_INNER }).at(-1)?.from).toBe(paragraph.indexOf('two'))
  })
  test('is set the same as with it cut, and in every kind of block', () => {
    const shown = (source: string) => markLines(source, { inner: BODY_INNER }).map((one) => one.text.trimEnd())
    for (const [named, plain] of [
      ['# Title ^abc\n\nWords\n', '# Title\n\nWords\n'],
      ['- one ^abc\n- two\n', '- one\n- two\n'],
      ['> quoted ^abc\n\nWords\n', '> quoted\n\nWords\n'],
      ['one ^abc\ntwo\n', 'one\ntwo\n'],
      ['```ts\ncode\n``` ^abc\n', '```ts\ncode\n```\n'],
    ] as const) {
      expect(shown(named)).toEqual(shown(plain))
    }
  })
})
describe('a front matter value with a comment sign in it', () => {
  test('leaves the note under it', () => {
    for (const value of ['50%% off', '<!-- x', 'a %% b %% c']) {
      const texts = markLines(`---\nnote: ${value}\n---\nWords here\n\nMore\n`, {
        inner: BODY_INNER,
      }).map((one) => one.text)
      expect(texts).toContain('Words here')
      expect(texts).toContain('More')
      expect(texts.join('\n')).not.toContain('note:')
    }
  })
})
test.each<[unknown, ...Parameters<typeof one>]>([
  [['‘‘‘ts', 'const a = 1', '‘‘‘'].join('\n'), '```ts\nconst a = 1\n```\n'],
  ['before a mark after', 'before ![a mark](m.png) after'],
  ['see the docs', 'see [the docs](https://example.com)'],
  ['see https://example.com', 'see <https://example.com>'],
  ['see Another note', 'see [[Another note]]'],
  ['see this way', 'see [[Another note|this way]]'],
  ['Another note', '![[Another note]]'],
  ['A claim.[^why]', 'A claim.[^why]'],
  ['x²', 'x^2^'],
  ['xn', 'x^n^'],
  ['H₂O', 'H~2~O'],
  ['smile 😀', 'smile :grinning:'],
  ['ship it :rocket:', 'ship it :rocket:'],
  ['a bold word', 'a <b>bold</b> word'],
  ['block', '<div>block</div>'],
  ['Words.', '---\ntitle: A note\n---\n\nWords.\n'],
])('%j from %j', (expected, ...args) => {
  expect(one(...args)).toBe(expected)
})
test.each<[unknown, ...Parameters<typeof lines>]>([
  [['‘‘‘', 'plain', '‘‘‘'], '```\nplain\n```\n'],
  [['DEEPER'], '### Deeper\n'],
  [['› FOUR'], '#### Four\n'],
  [['›› FIVE'], '##### Five\n'],
  [['››› SIX'], '###### Six\n'],
  [['A LOUD ‘CODE‘ WORD'], '### A *loud* `code` word\n'],
  [['• one', '• two'], '- one\n- two\n'],
  [['• one', '   · inside'], '- one\n  - inside\n'],
  [['• one', '   · two', '      - three'], '- one\n  - two\n    - three\n'],
  [['1. one', '2. two'], '1. one\n2. two\n'],
  [['7. seven', '8. eight'], '7. seven\n8. eight\n'],
  [['□ to do', '■ done'], '- [ ] to do\n- [x] done\n'],
  [['│ quoted'], '> quoted\n'],
  [['│ one', '│ │ two'], '> one\n>\n> > two\n'],
  [['│ WARNING', '│ Mind the gap.'], '> [!warning]\n> Mind the gap.\n'],
  [['│ DANGER', '│ Mind the gap.'], '> [!danger]\n> Mind the gap.\n'],
  [['│ TLDR', '│ The short of it.'], '> [!tldr]\n> The short of it.\n'],
  [['│ RECIPE', '│ Flour and water.'], '> [!recipe]\n> Flour and water.\n'],
  [['Words  here.'], 'Words %% aside %% here.\n'],
  [['Second line.'], '%% a note %%\nSecond line.\n'],
  [['▤ A diagram'], '![A diagram](sketch.png)\n'],
  [['▤ sketch.png'], '![](sketch.png)\n'],
  [['▤ clip.mp3'], '![[clip.mp3]]\n'],
  [['▤ demo.mp4'], '![[demo.mp4]]\n'],
  [['▤ shot.png'], '![[shot.png]]\n'],
  [['▤ paper.pdf#page=3'], '![[paper.pdf#page=3]]\n'],
  [['▤ Board.canvas'], '![[Board.canvas]]\n'],
  [['Another note'], '![[Another note]]\n'],
  [['Term', ': what it means'], 'Term\n: what it means\n'],
  [['• one', '   two'], '- one  \n  two\n'],
  [['one', 'two'], 'one  \ntwo\n'],
  [lines('- a'), '- a ^xyz'],
  [['│ a', '│ b'], '> a\n> b\n'],
  [['│ │ a', '│ │ b'], '> > a\n> > b\n'],
])('%j from %j', (expected, ...args) => {
  expect(lines(...args)).toEqual(expected)
})
