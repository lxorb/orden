import { describe, expect, test } from 'vitest'

import { delimiterOf, readCsv, recordsOf } from './csv'

describe('reading a CSV', () => {
  test('splits plain rows', () => {
    expect(readCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  test('keeps a comma, a quote and a newline that are inside a cell', () => {
    const text = 'Name,Note\n"Smith, John","He said ""no""\nand left"\n'

    expect(readCsv(text)).toEqual([
      ['Name', 'Note'],
      ['Smith, John', 'He said "no"\nand left'],
    ])
  })

  test('reads a file whose lines end the Windows way, and one with no last newline', () => {
    expect(readCsv('a,b\r\n1,2\r\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  test('drops the mark Excel writes in front of the header', () => {
    const [head] = readCsv(`${String.fromCharCode(0xfeff)}Name,Tags\nA,b\n`)

    expect(head?.[0]).toBe('Name')
  })

  test('finds the separator the file actually used', () => {
    expect(delimiterOf('a;b;c\n1;2;3')).toBe(';')
    expect(delimiterOf('a\tb\tc\n1\t2\t3')).toBe('\t')
    // A table of prose has commas in the cells but is still tab separated.
    expect(delimiterOf('Title\tNote\nA\tone, two, three')).toBe('\t')
    expect(delimiterOf('one value\nanother')).toBe(',')
  })

  test('a separator inside quotes is not one', () => {
    expect(delimiterOf('"a;b;c;d",second\n1,2')).toBe(',')
  })
})

describe('the rows as records', () => {
  test('names every cell after its column', () => {
    const { columns, rows } = recordsOf('Name,Status,Pages\nPlan,Done,12\n')

    expect(columns).toEqual(['Name', 'Status', 'Pages'])
    expect(rows).toEqual([{ Name: 'Plan', Status: 'Done', Pages: '12' }])
  })

  test('leaves out a blank line and a column with no name', () => {
    const { columns, rows } = recordsOf('Name,,Status\nPlan,x,Done\n\n')

    expect(columns).toEqual(['Name', 'Status'])
    expect(rows).toHaveLength(1)
  })

  test('a row with fewer cells than the header says still answers for each', () => {
    const { rows } = recordsOf('Name,Status\nPlan\n')

    expect(rows[0]).toEqual({ Name: 'Plan', Status: '' })
  })

  test('answers nothing for a file with nothing in it', () => {
    expect(recordsOf('')).toEqual({ columns: [], rows: [] })
  })
})
