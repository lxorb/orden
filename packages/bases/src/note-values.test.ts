import { describe, expect, test } from 'vitest'
import { compile } from './expr/compile'
import { contextAt, noteRow } from './fixtures/rows'
import { readProperties } from '@orden/markdown/properties'
import { appliedEdits } from '@orden/markdown/edits'
import { withItem, writeList, writeProperty } from '@orden/markdown/property-edits'
import { parse } from 'yaml'
import { listAsWritten, noteValues, scalarValue, taskHash } from './note-values'

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
      zone: 'Z',
    })
  })
})

function inZone(zone: string, run: () => void): void {
  const was = process.env.TZ
  process.env.TZ = zone
  try {
    run()
  } finally {
    if (was === undefined) delete process.env.TZ
    else process.env.TZ = was
  }
}

describe('a date written with its offset', () => {
  const at = contextAt({ today: '2026-11-15', now: '2026-11-15T09:00:00' })
  const said = (row: ReturnType<typeof noteRow>, expression: string) =>
    compile(expression).evaluate(row, at, {})

  test('is the moment it names, on the clock of whoever reads it', () => {
    inZone('America/Los_Angeles', () => {
      const row = noteRow('Clips/Page.md', '---\nclipped: 2026-11-15T17:00:00.000Z\n---\n')
      expect(row.note.clipped).toEqual({
        kind: 'date',
        iso: '2026-11-15',
        time: '17:00:00',
        zone: 'Z',
      })
      expect(said(row, 'clipped.hour')).toBe(9)
      expect(said(row, 'clipped.relative()')).toBe('a few seconds ago')
      expect(said(row, 'clipped <= now()')).toBe(true)
      expect(said(row, 'clipped.format("YYYY-MM-DD HH:mm")')).toBe('2026-11-15 09:00')
    })
  })

  test('is earlier or later than another by the moments, not the numbers written', () => {
    inZone('America/Los_Angeles', () => {
      const row = noteRow(
        'A.md',
        '---\na: 2024-03-10T23:30:00+05:00\nb: 2024-03-10T20:00:00Z\n---\n',
      )
      expect(said(row, 'a < b')).toBe(true)
      expect(said(row, 'a.date() == date("2024-03-10")')).toBe(true)
    })
    inZone('Asia/Tokyo', () => {
      const row = noteRow('A.md', '---\na: 2026-01-01T20:00:00-0500\n---\n')
      expect(row.note.a).toEqual({
        kind: 'date',
        iso: '2026-01-01',
        time: '20:00:00',
        zone: '-0500',
      })
      expect(said(row, 'a.format("YYYY-MM-DD HH:mm")')).toBe('2026-01-02 10:00')
      expect(said(row, 'a.date() == date("2026-01-02")')).toBe(true)
    })
  })

  test('is read on the clock of the zone the reader is in, not the clock of the machine', () => {
    inZone('UTC', () => {
      const row = noteRow(
        'Trip.md',
        '---\nleaves: 2026-03-11T02:00:00+09:00\nlands: 2026-03-11T01:00:00\n---\n',
      )
      const tokyo = contextAt({
        today: '2026-03-11',
        now: '2026-03-11T01:30:00',
        zone: 'Asia/Tokyo',
      })
      const there = (expression: string) => compile(expression).evaluate(row, tokyo, {})
      expect(there('leaves.date() == date("2026-03-11")')).toBe(true)
      expect(there('leaves.hour')).toBe(2)
      expect(there('leaves > lands')).toBe(true)
      expect(there('leaves > now()')).toBe(true)
      expect(there('leaves.relative()')).toBe('in 30 minutes')
      expect(there('(leaves - lands).hours')).toBe(1)
      expect(there('[lands, leaves, date("2026-03-11T00:30")].sort()[2] == leaves')).toBe(true)
      expect(said(row, 'leaves.date() == date("2026-03-10")')).toBe(true)
    })
  })

  test('reads the same quoted or written in a list', () => {
    inZone('Europe/Berlin', () => {
      expect(
        noteValues('---\na: "2026-06-01T10:00Z"\nb:\n  - 2026-06-01T10:00:00+02:00\n---\n'),
      ).toEqual({
        a: { kind: 'date', iso: '2026-06-01', time: '10:00', zone: 'Z' },
        b: [{ kind: 'date', iso: '2026-06-01', time: '10:00:00', zone: '+02:00' }],
      })
    })
  })

  test('while one with no offset stays as it is written', () => {
    inZone('America/Los_Angeles', () => {
      expect(noteValues('---\na: 2026-11-15T17:00\nb: 2026-11-15\n---\n')).toEqual({
        a: { kind: 'date', iso: '2026-11-15', time: '17:00' },
        b: { kind: 'date', iso: '2026-11-15' },
      })
    })
  })
})

describe('a day no calendar has', () => {
  test('is words, not a date', () => {
    expect(
      noteValues('---\ndue: 2026-02-30\nleft: 2026-13-01T10:00\nleap: 2028-02-29\n---\n'),
    ).toEqual({
      due: '2026-02-30',
      left: '2026-13-01T10:00',
      leap: { kind: 'date', iso: '2028-02-29' },
    })
    expect(scalarValue('2027-02-29')).toBe('2027-02-29')
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
    expect(readBack('---\nids:\n  - "x" # see "y"\n  - b\n---\n')).toEqual(['x', 'b', 'z'])
    expect(readBack("---\nids:\n  - 'x' # it's 'y'\n  - b\n---\n")).toEqual(['x', 'b', 'z'])
  })
})

describe('a list in a block the rows cannot draw', () => {
  test('is read in a note whose lines end in CRLF, its span short of the line break', () => {
    const note = '---\r\n# kept\r\nids:\r\n  - 007\r\n  - "x"\r\ntitle: t\r\n---\r\n'
    const found = listAsWritten(note, 'ids')
    expect(found).not.toBeNull()
    expect(found).not.toBe('absent')
    if (!found || found === 'absent') return
    expect(note.slice(found.from, found.to)).toBe('ids:\r\n  - 007\r\n  - "x"')
    expect(found.property.items).toEqual(['007', 'x'])
    expect(found.property.writtenItems).toEqual(['007', '"x"'])
  })
})

describe('a key written twice', () => {
  test('reads the first, which is the one an edit writes', () => {
    const note = '---\nstatus: a\nstatus: b\n---\n'
    expect(noteValues(note).status).toBe('a')
    const edit = writeProperty(note, 'status', 'c', 'text')
    expect(edit && noteValues(appliedEdits(note, [edit])).status).toBe('c')
  })

  test('and keys keep the order they are written in', () => {
    expect(Object.keys(noteValues('---\nb: 1\na: 2\nb: 3\n---\n'))).toEqual(['b', 'a'])
  })
})
