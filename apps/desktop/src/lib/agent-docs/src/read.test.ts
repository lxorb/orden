import { describe, expect, test } from 'vitest'
import { applied } from '@orden/scan/search/replace'
import { plan, readEdits } from './edits'
import { resolve } from './anchors'
import { readNote } from './read'
import { deskWith } from './test-desk'

const NOTE = [
  '---',
  'tags: plan',
  '---',
  '# Plan',
  '- [ ] Buy milk',
  '- [x] Call Anna',
  '',
  '## Later',
  'An idea worth keeping ^idea',
  '',
  '# Log',
  '## Later',
  '- [ ] Buy milk',
  '',
].join('\n')

describe('a note, read', () => {
  test('is the words as the reader has them, unsaved ones and all', async () => {
    const { desk, panes } = deskWith({ 'plan.md': 'saved' }, ['plan.md'])
    panes['plan.md']?.type(5, ' and typed')

    const read = await readNote(desk, { path: 'plan.md' })

    expect(read).toMatchObject({
      path: 'plan.md',
      space: 'Space',
      open: true,
      text: 'saved and typed',
    })
    expect(read.typing).toBe(true)
  })

  test('carries a rev that is the same open or closed, and not across one keystroke', async () => {
    const closed = await readNote(deskWith({ 'plan.md': 'words' }).desk, { path: 'plan.md' })
    const open = deskWith({ 'plan.md': 'words' }, ['plan.md'])
    const first = await readNote(open.desk, { path: 'plan.md' })
    open.panes['plan.md']?.type(0, 'x')
    const second = await readNote(open.desk, { path: 'plan.md' })

    expect(first.rev).toBe(closed.rev)
    expect(second.rev).not.toBe(first.rev)
  })

  test('with the one line ending the editor holds, whatever the file has', async () => {
    const read = await readNote(deskWith({ 'crlf.md': 'a\r\nb\r\n' }).desk, { path: 'crlf.md' })
    expect(read.text).toBe('a\nb\n')
  })

  test('hands an anchor for every heading, task and block, each naming exactly it', async () => {
    const read = await readNote(deskWith({ 'plan.md': NOTE }).desk, { path: 'plan.md' })

    expect(read.outline?.map((row) => row.anchor)).toEqual([
      { heading: 'Plan' },
      { heading: 'Plan/Later' },
      { heading: 'Log' },
      { heading: 'Log/Later' },
    ])
    expect(read.tasks?.map((row) => [row.anchor, row.done])).toEqual([
      [{ task: 'Buy milk', nth: 1 }, false],
      [{ task: 'Call Anna' }, true],
      [{ task: 'Buy milk', nth: 2 }, false],
    ])
    expect(read.blocks).toEqual([{ anchor: { block: 'idea' }, line: 7, text: 'Later' }])

    const lines = NOTE.split('\n')
    const rows = [...(read.outline ?? []), ...(read.tasks ?? []), ...(read.blocks ?? [])]
    for (const row of rows) {
      const place = resolve(row.anchor, NOTE)
      expect(NOTE.slice(place.from).startsWith(lines[row.line] ?? '')).toBe(true)
    }
  })

  test('says only what it was asked', async () => {
    const read = await readNote(deskWith({ 'plan.md': NOTE }).desk, { path: 'plan.md' }, [
      'properties',
    ])

    expect(Object.keys(read).sort()).toEqual([
      'meta',
      'open',
      'path',
      'properties',
      'rev',
      'space',
      'typing',
    ])
    expect(read.properties?.map((one) => one.key)).toEqual(['tags'])
  })

  test('where the reader is only for the note in front of them', async () => {
    const { desk } = deskWith({ 'plan.md': NOTE }, ['plan.md'])
    const read = await readNote(desk, { path: 'plan.md' }, ['selection'])
    expect(read.selection).toBeNull()
  })

  test('refuses a list of parts it does not know', async () => {
    await expect(
      readNote(deskWith({ 'plan.md': '' }).desk, { path: 'plan.md' }, ['everything']),
    ).rejects.toThrow('include is some of')
  })
})

describe('a note whose front matter holds a comment like a heading', () => {
  const BOOKS = [
    '---',
    '# Reading list',
    'status: draft',
    '---',
    '# Reading list',
    '',
    '- Dune',
    '',
  ].join('\n')

  test('has in its outline only the headings of its words', async () => {
    const { desk } = deskWith({ 'books.md': BOOKS }, [])
    const read = await readNote(desk, { path: 'books.md' }, ['outline'])

    expect(read.outline).toEqual([
      { anchor: { heading: 'Reading list' }, level: 1, title: 'Reading list', line: 4 },
    ])
  })

  test('numbers its tasks and blocks among the words only', async () => {
    const note = [
      '---',
      'todo:',
      '  - [ ] Buy milk',
      'note: Later ^idea',
      '---',
      '- [ ] Buy milk',
      '',
      'Later ^idea',
      '',
    ].join('\n')
    const { desk } = deskWith({ 'list.md': note }, [])
    const read = await readNote(desk, { path: 'list.md' }, ['tasks', 'blocks'])

    expect(read.tasks?.map((row) => row.anchor)).toEqual([{ task: 'Buy milk' }])
    expect(read.blocks?.map((row) => row.line)).toEqual([7])
  })

  test('takes an addition under its one heading, and keeps the front matter whole', () => {
    const under = applied(
      BOOKS,
      plan(readEdits([{ at: { heading: 'Reading list' }, insert_after: '- Emma' }]), BOOKS).edits,
    )
    const before = applied(
      BOOKS,
      plan(
        readEdits([{ at: { heading: 'Reading list' }, insert_before: 'Started in May.' }]),
        BOOKS,
      ).edits,
    )

    expect(under).toContain('- Dune\n\n- Emma')
    expect(before.startsWith('---\n# Reading list\nstatus: draft\n---\n')).toBe(true)
  })
})

describe('an outline of headings that share a title at other depths or cases', () => {
  test('hands out anchors that each name exactly their heading', async () => {
    const NOTE =
      '# Notes\n\nweek\n\n# Monday\n\n## Notes\n\nmon\n\n# Tuesday\n\n## Notes\n\ntue\n\n# Plan\n\n# plan\n'
    const read = await readNote(deskWith({ 'week.md': NOTE }).desk, { path: 'week.md' })
    const rows = NOTE.split('\n')
    expect(read.outline?.length).toBe(7)
    for (const row of read.outline ?? []) {
      const place = resolve(row.anchor, NOTE)
      expect(
        NOTE.slice(place.from).startsWith(rows[row.line] ?? '\0'),
        JSON.stringify(row.anchor),
      ).toBe(true)
    }
  })
})

describe('a hand-written heading anchor with a count', () => {
  test('counts every heading of that name when fewer share its whole path', () => {
    const NOTE = '# Notes\n\nweek\n\n# Monday\n\n## Notes\n\nmon\n'
    const place = resolve({ heading: 'Notes', nth: 2 }, NOTE)
    expect(NOTE.slice(place.from).startsWith('## Notes')).toBe(true)
  })
})

describe('a task with subtasks under it', () => {
  const NOTE = '- [ ] Plan trip\n  - [ ] Book flights\n  - [ ] Book hotel\n- [ ] Pay rent\n'

  test('takes a task inserted after it below its subtasks', () => {
    const after = applied(
      NOTE,
      plan(readEdits([{ at: { task: 'Plan trip' }, insert_after: '- [ ] Pack' }]), NOTE).edits,
    )
    expect(after).toBe(
      '- [ ] Plan trip\n  - [ ] Book flights\n  - [ ] Book hotel\n- [ ] Pack\n- [ ] Pay rent\n',
    )
  })

  test('is deleted with its subtasks, and replaced without them', () => {
    expect(
      applied(NOTE, plan(readEdits([{ at: { task: 'Plan trip' }, delete: true }]), NOTE).edits),
    ).toBe('- [ ] Pay rent\n')
    expect(
      applied(
        NOTE,
        plan(readEdits([{ at: { task: 'Plan trip' }, replace: '- [ ] Plan the trip' }]), NOTE)
          .edits,
      ),
    ).toBe('- [ ] Plan the trip\n  - [ ] Book flights\n  - [ ] Book hotel\n- [ ] Pay rent\n')
  })
})
