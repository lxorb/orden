import { describe, expect, test } from 'vitest'
import { logseqNote, readLogseq } from './logseq'
import { file, noteAt } from './fixtures'

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

  test('a page with a block of its own keeps one block', async () => {
    const plan = await readLogseq([
      file('logseq/config.edn', '{}'),
      file('pages/What%3F.md', '---\ntags: x\n---\n- words\n'),
    ])
    const text = plan.files.find((one) => one.kind === 'note')
    const note = text?.kind === 'note' ? text.text : ''

    expect(note.match(/^---$/gm)).toHaveLength(2)
    expect(note.startsWith('---\ntags: x\n')).toBe(true)
    expect(note).toMatch(/^aliases:/m)
    expect(note).toContain('- words')
  })

  test('a page dated twice keeps both, each under a key of its own', async () => {
    const plan = await readLogseq([
      file(
        'pages/A.md',
        'created-at:: 1700000000000\ndate:: [[Someday]]\nDue Date:: x\ndue-date:: y\n\n- hi\n',
      ),
      file('pages/B.md', 'created-at:: 1700000000000\ndate:: 2026-05-01\n\n- hi\n'),
    ])

    const a = noteAt(plan, 'A.md')
    expect(a.match(/^date:/gm)).toHaveLength(1)
    expect(a.match(/^due-date:/gm)).toHaveLength(1)
    expect(a).toContain('date-2:')
    expect(a).toContain('Someday')
    expect(a).toContain('due-date: x')
    expect(a).toContain('due-date-2: y')

    const b = noteAt(plan, 'B.md')
    expect(b.match(/^date:/gm)).toHaveLength(1)
    expect(b).toContain('date-2: 2026-05-01')
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
    expect(plan.lost[0]).toBe('1 block references were written out as the words they pointed at')
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

  test('references, embeds and links written as code stay as they were written', async () => {
    const id = '650c1a2b-1111-2222-3333-444455556666'
    const code = [
      `\`((${id}))\``,
      `\`[words](((${id})))\``,
      `\`{{embed ((${id}))}}\``,
      '`{{embed [[Sep 11th, 2026]]}}`',
      '`[words]([[Sep 11th, 2026]])`',
      '``[[Sep 11th, 2026]]``',
      '`![a](b.png){:height 10}`',
    ].join(' ')
    const plan = await readLogseq([
      file('journals/2026_09_11.md', `- Woke up\n  id:: ${id}\n`),
      file('pages/A.md', `- ${code} but ((${id})) and [[Sep 11th, 2026]]\n`),
    ])

    expect(noteAt(plan, 'A.md')).toContain(`- ${code} but Woke up and [[2026-09-11]]`)
    expect(plan.lost).toEqual(['1 block references were written out as the words they pointed at'])
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
    expect(plan.lost[0]).toBe('2 block references were written out as the words they pointed at')
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

  test('a page name with a comma in it stays one tag and one alias', () => {
    const said = logseqNote(
      'alias:: [[Smith, John]], JS\ntags:: [[Guns, Germs, and Steel]], history, #[[Nov 15th, 2026]]\n\n- body\n',
    )

    expect(said.aliases).toEqual(['Smith, John', 'JS'])
    expect(said.meta.tags).toEqual(['Guns, Germs, and Steel', 'history', 'Nov 15th, 2026'])
  })

  test('a highlight is a highlight, and in code stays as it was written', () => {
    const said = logseqNote('- this is ^^important^^ now, and `^^not^^` in code\n')

    expect(said.body).toBe('- this is ==important== now, and `^^not^^` in code\n')
  })

  test('a block reference reads the page, not a copy Logseq keeps of it', async () => {
    const id = '650c1a2b-1111-2222-3333-444455556666'
    const plan = await readLogseq([
      file('journals/2026_11_15.md', `- Ship on Friday\n  id:: ${id}\n`),
      file(
        'logseq/bak/journals/2026_11_15/2026-11-14T10_00_00.000Z.Desktop.md',
        `- Ship on Monday\n  id:: ${id}\n`,
      ),
      file('logseq/version-files/base/journals/2026_11_15.md', `- Ship on Tuesday\n  id:: ${id}\n`),
      file('.recycle/pages/Old.md', `- Ship on Sunday\n  id:: ${id}\n`),
      file('pages/Plan.md', `- As agreed: ((${id}))\n`),
    ])

    expect(noteAt(plan, 'Plan.md')).toContain('As agreed: Ship on Friday')
  })

  test('a block reference in a graph zipped up whole skips the copies too', async () => {
    const id = '650c1a2b-1111-2222-3333-444455556666'
    const plan = await readLogseq([
      file('My graph/pages/Source.md', `- Ship on Friday\n  id:: ${id}\n`),
      file('My graph/logseq/bak/pages/Source/2026.md', `- Ship on Monday\n  id:: ${id}\n`),
      file('My graph/pages/Plan.md', `- As agreed: ((${id}))\n`),
    ])

    expect(noteAt(plan, 'Plan.md')).toContain('As agreed: Ship on Friday')
  })
})
