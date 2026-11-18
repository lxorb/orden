import { describe, expect, test } from 'vitest'
import { applied } from '@orden/scan/search/replace'
import { blocksOf } from '@orden/markdown/links'
import { resolve } from './anchors'
import { plan, readEdits } from './edits'

function edited(text: string, edits: unknown): string {
  return applied(text, plan(readEdits(edits), text).edits)
}

const TABLE = 'x\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n^tbl\n\ny'

describe('a block named on its own line after a blank, as Orden names tables', () => {
  test('starts where the read hands its line', () => {
    const listed = blocksOf(TABLE).find((one) => one.id === 'tbl')
    const place = resolve({ block: 'tbl' }, TABLE)
    expect(listed?.line).toBe(2)
    expect(TABLE.slice(place.from).startsWith('| a | b |')).toBe(true)
  })

  test('replaced leaves no copy of the old table', () => {
    const after = edited(TABLE, [{ at: { block: 'tbl' }, replace: '| c |\n| - |\n| 3 |' }])
    expect(after).toContain('| 3 |')
    expect(after).toContain('^tbl')
    expect(after).not.toContain('| 1 | 2 |')
  })

  test('deleted takes the table with it', () => {
    expect(edited(TABLE, [{ at: { block: 'tbl' }, delete: true }])).not.toContain('| 1 | 2 |')
  })

  test('replaced in a list leaves no copy of the old list', () => {
    const text = 'x\n\n- a\n- b\n\n^lst\n\ny'
    const after = edited(text, [{ at: { block: 'lst' }, replace: '- c' }])
    expect(after).not.toContain('- a')
  })
})

describe('a block named at the end of a list item', () => {
  test('is the whole item when the name ends its second line', () => {
    const text = '- a\n  more ^it\n- b'
    expect(edited(text, [{ at: { block: 'it' }, replace: '- A' }])).toBe('- A ^it\n- b')
  })

  test('replaced with its sub-items keeps one copy of them and the name on the item', () => {
    const text = '- a ^it\n    - child\n- b'
    const after = edited(text, [{ at: { block: 'it' }, replace: '- A\n    - child' }])
    expect(after.split('child').length - 1).toBe(1)
    expect(after).not.toContain('child ^it')
  })
})
