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
      file(
        'pages/A.md',
        '- TODO Ring the bank\n- DONE Buy milk\n  - LATER Sub task\n- WAITING On them\n',
      ),
    ])

    const text = noteAt(plan, 'A.md')
    expect(text).toContain('- [ ] Ring the bank')
    expect(text).toContain('- [x] Buy milk')
    expect(text).toContain('  - [ ] Sub task')
    expect(text).toContain('- [ ] On them')
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

  test('a graph zipped up whole is read one folder down', async () => {
    const plan = await readLogseq([
      file('My graph/logseq/config.edn', '{}'),
      file('My graph/logseq/bak/pages/A.md', '- An old copy'),
      file('My graph/pages/home___kitchen.md', '- Tiles\n'),
      file('My graph/journals/2026_09_11.md', '- Woke up\n'),
    ])

    expect(plan.files.map((one) => one.path)).toEqual(['home/kitchen.md', 'Journals/2026-09-11.md'])
  })

  test('a graph kept in git leaves its history behind', async () => {
    const plan = await readLogseq([
      file('.git/HEAD', 'ref: refs/heads/main'),
      file('.gitignore', '.DS_Store'),
      file('pages/A.md', '- Words\n'),
    ])

    expect(plan.files.map((one) => one.path)).toEqual(['A.md'])
  })

  test('a page with a very long name is still a note', async () => {
    const plan = await readLogseq([file(`pages/${'Long '.repeat(30)}end.md`, '- Words\n')])

    expect(plan.files[0]?.kind).toBe('note')
    expect(plan.files[0]?.path).toMatch(/\.md$/)
  })

  test('a name that ends in a slash is named by what came before it', async () => {
    const plan = await readLogseq([file('pages/Tweet___Ten tips...___.md', '- Words\n')])

    expect(plan.files[0]?.path).toBe('Tweet/Ten tips.md')
  })

  test('properties are read from a file written with Windows line endings', async () => {
    const plan = await readLogseq([
      file('pages/A.md', 'type:: book\r\ntags:: [[deep work]], #focus\r\n\r\n- Words\r\n'),
    ])

    const text = noteAt(plan, 'A.md')
    expect(text).toContain('type: book')
    expect(text).toContain('tags: [deep-work, focus]')
    expect(text).not.toContain('type::')
  })

  test('a link to a journal follows it to the date it is now', async () => {
    const plan = await readLogseq([
      file('journals/2026_09_11.md', '- Woke up\n'),
      file('pages/A.md', '- On [[Sep 11th, 2026]] and [[sep 11th, 2026]]\n'),
    ])

    expect(noteAt(plan, 'A.md')).toContain('On [[2026-09-11]] and [[2026-09-11]]')
  })

  test("a journal is named and linked the way the graph's settings say", async () => {
    const plan = await readLogseq([
      file(
        'logseq/config.edn',
        '{:journal/page-title-format "EEEE, dd.MM.yyyy"\n :journal/file-name-format "dd_MM_yyyy"}',
      ),
      file('journals/11_09_2026.md', '- Woke up\n'),
      file('pages/A.md', '- See [[Friday, 11.09.2026]]\n'),
    ])

    expect(plan.files.map((one) => one.path)).toContain('Journals/2026-09-11.md')
    expect(noteAt(plan, 'A.md')).toContain('See [[2026-09-11]]')
  })

  test('a page answers to its aliases, and to the name its file could not hold', async () => {
    const plan = await readLogseq([
      file('pages/New to Logseq%3F.md', '- Start here\n'),
      file(
        'pages/config edn file.md',
        'title:: config.edn\nalias:: settings, [[the config]]\n\n- Words\n',
      ),
    ])

    expect(noteAt(plan, 'New to Logseq.md')).toContain('aliases: [New to Logseq?]')
    expect(noteAt(plan, 'config edn file.md')).toContain(
      'aliases: [config.edn, settings, the config]',
    )
  })

  test('embeds show what they embedded, and a reference with words keeps the words', async () => {
    const plan = await readLogseq([
      file(
        'pages/Source.md',
        '- The quarter closed ahead of plan\n  id:: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n',
      ),
      file(
        'pages/Other.md',
        [
          '- {{embed ((aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee))}}',
          '- {{embed [[Source]] }}',
          '- [as noted](((aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)))',
          '- [the source]([[Source]])',
        ].join('\n'),
      ),
    ])

    const text = noteAt(plan, 'Other.md')
    expect(text).toContain('- The quarter closed ahead of plan\n- ![[Source]]\n- as noted\n')
    expect(text).toContain('[[Source|the source]]')
    expect(plan.lost[0]?.values).toEqual({ count: 2 })
  })

  test("a block's fold and a picture's size are Logseq's own and do not come", async () => {
    const plan = await readLogseq([
      file(
        'pages/A.md',
        '- Parent\n  collapsed:: true\n  - ![shot](../assets/shot.png){:height 53, :width 42}\n',
      ),
      file('assets/shot.png', 'PNG'),
    ])

    const text = noteAt(plan, 'A.md')
    expect(text).not.toContain('collapsed')
    expect(text).toContain('![shot](assets/shot.png)\n')
  })

  test('code is kept exactly as it was written', () => {
    const code = '- ```\n  - TODO not a task\n  id:: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n  ```'

    expect(logseqNote(code).body).toBe(code)
  })

  test("a property's link to a file of the graph follows it to where it went", async () => {
    const plan = await readLogseq([
      file('pages/hls__paper.md', 'file:: [paper.pdf](../assets/my paper.pdf)\n\n- A highlight\n'),
      file('assets/my paper.pdf', '%PDF'),
    ])

    expect(noteAt(plan, 'hls__paper.md')).toContain('[paper.pdf](assets/my%20paper.pdf)')
  })

  test("Logseq's quotes, notes and source blocks are a quote, a callout and code", () => {
    const said = logseqNote(
      [
        '- #+BEGIN_WARNING',
        '  **Back up** first',
        '  #+END_WARNING',
        '- #+BEGIN_QUOTE',
        '  Said somebody',
        '  #+END_QUOTE',
        '  #+BEGIN_TIP',
        '  Right after',
        '  #+END_TIP',
        '- #+BEGIN_QUERY',
        '  {:query [:find ?b]}',
        '  #+END_QUERY',
        '- #+BEGIN_SRC clojure',
        '  (println "TODO")',
        '  #+END_SRC',
        '- #+BEGIN_NOTE never closed',
      ].join('\n'),
    )

    expect(said.body).toBe(
      [
        '- > [!warning]',
        '  > **Back up** first',
        '- >',
        '  > Said somebody',
        '',
        '  > [!tip]',
        '  > Right after',
        '- ```clojure',
        '  {:query [:find ?b]}',
        '  ```',
        '- ```clojure',
        '  (println "TODO")',
        '  ```',
        '- #+BEGIN_NOTE never closed',
      ].join('\n'),
    )
  })

  test("a task's clock is Logseq's bookkeeping and does not come", () => {
    const said = logseqNote(
      '- DONE Write it\n  :LOGBOOK:\n  CLOCK: [2024-01-01 Mon 10:00]--[2024-01-01 Mon 11:00] =>  01:00:00\n  :END:\n- Next\n',
    )

    expect(said.body).toBe('- [x] Write it\n- Next\n')
  })

  test('the filters Logseq keeps on a page for its references are not properties', () => {
    const said = logseqNote('filters:: {"journal" false}\ntype:: book\n\n- Words\n')

    expect(said.meta.extra).toEqual([['type', 'book']])
  })
})
