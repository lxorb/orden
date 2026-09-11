import { describe, expect, test } from 'vitest'

import type { ImportPlan } from './plan'
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
})
