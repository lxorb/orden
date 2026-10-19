import { describe, expect, test } from 'vitest'

import type { ImportPlan } from './plan'
import { detect } from './read'
import { sourceOf, type Source } from './sources'
import { readTomboy, tomboyMarkdown } from './tomboy'

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

function noteAt(plan: ImportPlan, path: string): string {
  const found = plan.files.find((one) => one.path === path)
  if (found?.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
}

function note(title: string, content: string, extra = ''): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<note version="0.3" xmlns:link="http://beatniksoftware.com/tomboy/link" xmlns="http://beatniksoftware.com/tomboy">
  <title>${title}</title>
  <text xml:space="preserve"><note-content version="0.1">${content}</note-content></text>
  <last-change-date>2026-03-04T09:00:00.0000000+01:00</last-change-date>
  <create-date>2026-01-02T10:00:00.0000000+01:00</create-date>
  ${extra}
</note>`
}

describe('a Tomboy note', () => {
  test('becomes a note with its dates', async () => {
    const plan = await readTomboy([
      file('abc.note', note('Start Here', 'Start Here\n\nSome words')),
    ])

    const text = noteAt(plan, 'Start Here.md')
    expect(text).toContain('date: 2026-01-02')
    expect(text).toContain('updated: 2026-03-04')
    expect(text).toContain('# Start Here')
    expect(text).toContain('Some words')
    // The content repeats the title as its first line, which would otherwise be
    // said twice: once as the heading and once again under it.
    expect(text.match(/Start Here/g)).toHaveLength(1)
  })

  test('a notebook is a folder and a tag is a tag', async () => {
    const plan = await readTomboy([
      file(
        'abc.note',
        note('Plan', 'Words', '<tags><tag>system:notebook:Work</tag><tag>urgent</tag></tags>'),
      ),
    ])

    expect(plan.files[0]?.path).toBe('Work/Plan.md')
    expect(noteAt(plan, 'Work/Plan.md')).toContain('tags: [urgent]')
  })

  test('a link to another note is a wikilink', async () => {
    const plan = await readTomboy([
      file('abc.note', note('A', 'See <link:internal>The other note</link:internal> for more')),
    ])

    expect(noteAt(plan, 'A.md')).toContain('See [[The other note]] for more')
  })
})

describe("Tomboy's own markup", () => {
  test('is the emphasis markdown has words for', () => {
    expect(
      tomboyMarkdown('<bold>a</bold> <italic>b</italic> <strikethrough>c</strikethrough>'),
    ).toBe('**a** *b* ~~c~~')
    expect(tomboyMarkdown('<highlight>lit</highlight> and <monospace>code</monospace>')).toBe(
      '==lit== and `code`',
    )
  })

  test('a list is a list, however deep', () => {
    const content =
      'Before<list><list-item dir="ltr">one<list><list-item dir="ltr">under</list-item></list></list-item><list-item dir="ltr">two</list-item></list>'

    // A blank line before the first item, so it is a list whatever came before.
    expect(tomboyMarkdown(content).split('\n')).toEqual([
      'Before',
      '',
      '- one',
      '  - under',
      '- two',
    ])
  })

  test('a tag it does not know keeps its words', () => {
    expect(tomboyMarkdown('a <size:large>big</size:large> word')).toBe('a big word')
  })

  test('entities are the characters they stand for', () => {
    expect(tomboyMarkdown('a &lt; b &amp; c')).toBe('a < b & c')
  })

  test("a list as Tomboy writes it, each item's line ending inside it, is one tight list", () => {
    const content =
      'Before\n\n<list><list-item dir="ltr">one\n<list><list-item dir="ltr">under\n</list-item></list></list-item><list-item dir="ltr">two</list-item></list>\n\nAfter'

    expect(tomboyMarkdown(content).split('\n')).toEqual([
      'Before',
      '',
      '- one',
      '  - under',
      '- two',
      '',
      'After',
    ])
  })

  test('tomboy-ng writes every item as a list of its own, which is still one list', () => {
    const content =
      'From here:\n<list><list-item dir="ltr">one</list-item></list>\n<list><list-item dir="ltr">two</list-item></list>\nAfter'

    expect(tomboyMarkdown(content).split('\n')).toEqual([
      'From here:',
      '',
      '- one',
      '- two',
      '',
      'After',
    ])
  })

  test('emphasis keeps its spaces outside, and marks nothing where there are no words', () => {
    expect(tomboyMarkdown('a <bold>fett </bold>b')).toBe('a **fett** b')
    expect(tomboyMarkdown('like <highlight> "John Smith" name </highlight> will')).toBe(
      'like  =="John Smith" name==  will',
    )
    expect(tomboyMarkdown('John.</italic><italic></italic>\nNext')).toBe('John.\nNext')
    expect(tomboyMarkdown('<monospace>\n</monospace>x')).toBe('x')
  })

  test('emphasis over a line break is marked a line at a time', () => {
    expect(tomboyMarkdown('<bold>Topic\n\n</bold>Words')).toBe('**Topic**\n\nWords')
    expect(tomboyMarkdown('<italic>one\ntwo</italic>')).toBe('*one*\n*two*')
  })

  test("tomboy-ng's strikeout is a line through, and code may hold a backtick", () => {
    expect(tomboyMarkdown('<strikeout>gone</strikeout>')).toBe('~~gone~~')
    expect(tomboyMarkdown('<monospace>a`b</monospace>')).toBe('``a`b``')
  })
})

describe('links between Tomboy notes', () => {
  test('reach a note whose title a file name cannot hold', async () => {
    const plan = await readTomboy([
      file('a.note', note('ZugFerd / factur-x #4343', 'ZugFerd / factur-x #4343\n\nWords')),
      file('b.note', note('Index', 'See <link:internal>ZugFerd / factur-x #4343</link:internal>')),
    ])

    expect(plan.files.map((one) => one.path)).toContain('ZugFerd factur-x #4343.md')
    // A `#` in a wikilink would point at a heading, so this one is a markdown link.
    expect(noteAt(plan, 'Index.md')).toContain(
      'See [ZugFerd / factur-x #4343](ZugFerd%20factur-x%20%234343.md)',
    )
  })

  test('name the file and show the title, when the two differ', async () => {
    const plan = await readTomboy([
      file('a.note', note('Plans: 2026', 'Words')),
      file('b.note', note('Index', 'See <link:internal>plans: 2026</link:internal>')),
    ])

    expect(noteAt(plan, 'Index.md')).toContain('See [[Plans 2026|plans: 2026]]')
  })

  test('name the folder too where two notebooks hold a note of that name', async () => {
    const plan = await readTomboy([
      file('a.note', note('Plan', 'x', '<tags><tag>system:notebook:Work</tag></tags>')),
      file('b.note', note('Plan.', 'y', '<tags><tag>system:notebook:Home</tag></tags>')),
      file('c.note', note('Index', '<link:internal>Plan.</link:internal>')),
    ])

    expect(noteAt(plan, 'Index.md')).toContain('[[Home/Plan|Plan.]]')
  })

  test('keep their words when Tomboy marked them up inside the link', async () => {
    const plan = await readTomboy([
      file('a.note', note('Other', 'x')),
      file('b.note', note('Index', 'See <link:internal><bold>Other</bold></link:internal>.')),
    ])

    expect(noteAt(plan, 'Index.md')).toContain('See [[Other]].')
  })
})

describe('what is not a Tomboy note', () => {
  test('a .note somebody wrote among their markdown does not make the folder Tomboy', async () => {
    const sources = [file('notes/a.md', '# A\n\nhello'), file('notes/b.note', 'just text I wrote')]

    expect(await detect(sources)).toBe('markdown')
  })

  test('a file with neither a title nor words is counted, not made an empty note', async () => {
    const plan = await readTomboy([
      file('a.note', ''),
      file('b.note', 'not xml'),
      file('c.note', note('Here', 'Words')),
    ])

    expect(plan.files.map((one) => one.path)).toEqual(['Here.md'])
    expect(plan.lost[0]?.values).toEqual({ count: 2 })
  })
})

describe('what a Tomboy note says about itself', () => {
  test('a title Tomboy drew underlined is still not said twice', async () => {
    const plan = await readTomboy([
      file('a.note', note('Help', '<underline>Help</underline>\n\nWords')),
    ])

    expect(noteAt(plan, 'Help.md').match(/Help/g)).toHaveLength(1)
  })

  test("Tomboy's own tags lose their prefix", async () => {
    const plan = await readTomboy([
      file('a.note', note('New template', 'x', '<tags><tag>system:template</tag></tags>')),
    ])

    expect(noteAt(plan, 'New template.md')).toContain('tags: [template]')
  })
})
