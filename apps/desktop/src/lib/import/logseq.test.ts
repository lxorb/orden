import { describe, expect, test } from 'vitest'

import { logseqNote, readLogseq } from './logseq'
import type { ImportPlan } from './plan'
import { sourceOf, type Source } from './sources'

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

function noteAt(plan: ImportPlan, path: string): string {
  const found = plan.files.find((one) => one.path === path)
  if (found?.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
}

describe('a Logseq graph', () => {
  test('keeps its pages and dates its journals properly', async () => {
    const plan = await readLogseq([
      file('pages/The plan.md', '- One thing\n- Another\n'),
      file('journals/2026_09_11.md', '- Woke up\n'),
      file('logseq/config.edn', '{:some :config}'),
      file('assets/shot_1234.png', 'PNG'),
    ])

    expect(plan.files.map((one) => one.path)).toEqual([
      'The plan.md',
      'Journals/2026-09-11.md',
      'assets/shot_1234.png',
    ])
  })

  test('properties become front matter', async () => {
    const plan = await readLogseq([
      file(
        'pages/A.md',
        'title:: A\ntags:: work, ideas\nid:: 01234567-89ab-cdef-0123-456789abcdef\n\n- Words\n',
      ),
    ])

    const text = noteAt(plan, 'A.md')
    expect(text).toContain('tags: [work, ideas]')
    expect(text).toContain('title: A')
    expect(text).not.toContain('tags::')
    expect(text).not.toContain('id::')
    expect(text).toContain('- Words')
  })

  test('a task marker is a task', async () => {
    const plan = await readLogseq([
      file('pages/A.md', '- TODO Ring the bank\n- DONE Buy milk\n  - LATER Sub task\n'),
    ])

    const text = noteAt(plan, 'A.md')
    expect(text).toContain('- [ ] Ring the bank')
    expect(text).toContain('- [x] Buy milk')
    expect(text).toContain('  - [ ] Sub task')
  })

  test('a block reference is written out as what it said', async () => {
    const plan = await readLogseq([
      file(
        'pages/Source.md',
        '- The quarter closed ahead of plan\n  id:: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n',
      ),
      file('pages/Other.md', '- As noted: ((aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee))\n'),
    ])

    expect(noteAt(plan, 'Other.md')).toContain('As noted: The quarter closed ahead of plan')
    expect(plan.lost[0]?.values).toEqual({ count: 1 })
  })

  test('a reference to a block nothing exported is left as it was', async () => {
    const plan = await readLogseq([
      file('pages/A.md', '- See ((99999999-8888-7777-6666-555555555555))\n'),
    ])

    expect(noteAt(plan, 'A.md')).toContain('((99999999-8888-7777-6666-555555555555))')
    expect(plan.lost).toHaveLength(0)
  })

  test('a page whose name held a slash is a note in a folder', async () => {
    const plan = await readLogseq([file('pages/home___kitchen.md', '- Tiles\n')])

    expect(plan.files[0]?.path).toBe('home/kitchen.md')
  })

  test('a page that opens with words rather than properties keeps them', () => {
    const said = logseqNote('- Not a property\n- Another line\n')

    expect(said.meta).toEqual({})
    expect(said.body).toContain('- Not a property')
  })
})
