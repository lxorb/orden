import { describe, expect, test } from 'vitest'
import { compile } from './expr/compile'
import { contextAt, noteRow } from './fixtures/rows'
import { readProperties } from '@nib/markdown/properties'
import { withItem, writeList } from '@nib/markdown/property-edits'
import { parse } from 'yaml'
import { noteValues, scalarValue, taskHash } from './note-values'

describe('front matter as values', () => {
  test('reads every kind the Properties panel draws', () => {
    const values = noteValues(
      [
        '---',
        'title: Dune',
        'pages: 412',
        'read: true',
        'started: 2026-10-01',
        'finished: 2026-10-03T21:15',
        'author: "[[Frank Herbert]]"',
        'tags: [books, sf]',
        'related:',
        '  - "[[Foundation|Asimov]]"',
        '  - plain',
        'empty:',
        '---',
        'words',
      ].join('\n'),
    )
    expect(values).toEqual({
      title: 'Dune',
      pages: 412,
      read: true,
      started: { kind: 'date', iso: '2026-10-01' },
      finished: { kind: 'date', iso: '2026-10-03', time: '21:15' },
      author: { kind: 'link', target: 'Frank Herbert' },
      tags: ['books', 'sf'],
      related: [{ kind: 'link', target: 'Foundation', display: 'Asimov' }, 'plain'],
      empty: null,
    })
  })

  test('takes the block without its fences, as the scan carries it', () => {
    expect(noteValues('status: Doing\npriority: 2\n')).toEqual({ status: 'Doing', priority: 2 })
  })

  test('falls back to YAML for a block the panel leaves as source', () => {
    const values = noteValues('---\n# a comment\nstatus: Doing\nnested:\n  a:\n    - 1\n---\n')
    expect(values).toEqual({ status: 'Doing', nested: { a: [1] } })
  })

  test('is nothing for a note without front matter or with a block that is not YAML', () => {
    expect(noteValues('just words')).toEqual({})
    expect(noteValues('---\n: : :\n  - [\n---\n')).toEqual({})
  })

  test('a key named kind is a key like any other', () => {
    expect(noteValues('---\n# c\nkind: date\n---\n')).toEqual({ kind: 'date' })
  })

  test('a quoted value is the string it says, as YAML reads it', () => {
    const quoted = [
      "zip: '007'",
      'flag: "true"',
      "nothing: 'null'",
      'ids: [\'01\', "false", 2]',
      'more:',
      "  - '3'",
      'author: "[[Frank Herbert]]"',
    ]
    const expected = {
      zip: '007',
      flag: 'true',
      nothing: 'null',
      ids: ['01', 'false', 2],
      more: ['3'],
      author: { kind: 'link', target: 'Frank Herbert' },
    }
    expect(noteValues(`---\n${quoted.join('\n')}\n---\n`)).toEqual(expected)
    // The same block with a comment in it goes the YAML way, and has to agree.
    expect(noteValues(`---\n# c\n${quoted.join('\n')}\n---\n`)).toEqual(expected)
  })

  test('a filter on a quoted zip code finds it', () => {
    const row = noteRow('A.md', "---\nzip: '007'\n---\n")
    expect(compile('zip == "007"').evaluate(row, contextAt(), {})).toBe(true)
  })

  test('scalars', () => {
    expect(scalarValue('~')).toBeNull()
    expect(scalarValue('-3.5')).toBe(-3.5)
    expect(scalarValue('FALSE')).toBe(false)
    expect(scalarValue('2026-10-03T10:00:00Z')).toEqual({
      kind: 'date',
      iso: '2026-10-03',
      time: '10:00:00',
      zone: 'UTC',
    })
  })
})

describe('a task hash', () => {
  test('is stable and short, and differs with the words', () => {
    expect(taskHash('Call the bank')).toBe(taskHash('Call the bank'))
    expect(taskHash('Call the bank')).not.toBe(taskHash('Call the bunk'))
    expect(taskHash('')).toMatch(/^[0-9a-z]+$/)
  })
})

describe('a block list rewritten with a chip', () => {
  /** The note with `z` put on `ids`, as YAML reads it back. */
  function readBack(note: string): unknown {
    const ids = readProperties(note)?.find((one) => one.key === 'ids')
    const items = ids ? withItem(ids, 'z') : null
    const edit = writeList(note, 'ids', items ?? [])
    const after = edit ? note.slice(0, edit.from) + edit.insert + note.slice(edit.to) : note
    const body = after.split('---\n')[1] ?? ''
    return (parse(body) as { ids?: unknown }).ids
  }

  test('is YAML that holds the members it held and the one put on', () => {
    expect(readBack('---\nids:\n  - a\n  -\n  - b\n---\n')).toEqual(['a', null, 'b', 'z'])
    expect(readBack('---\nids:\n  - a\n  - e # note\n  - 007\n---\n')).toEqual(['a', 'e', 7, 'z'])
    expect(readBack('---\nids:\n- - x\n- b\n---\n')).toEqual([['x'], 'b', 'z'])
    expect(readBack('---\nids:\n  - a, b\n  - c: d\n---\n')).toEqual(['a, b', { c: 'd' }, 'z'])
  })
})
