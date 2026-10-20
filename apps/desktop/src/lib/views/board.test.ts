import { type Group, orderId, type Row } from '@nib/bases'
import { describe, expect, it } from 'vitest'
import {
  cardKey,
  indexWithout,
  mergedOrder,
  nextCard,
  nextLaned,
  orderAfter,
  type Pending,
  withOrder,
  withPending,
} from './board'
import { noteRow } from './fixture'

const row = (name: string): Row => noteRow(`${name}.md`)
const names = (rows: readonly Row[]) => rows.map((one) => one.file.basename)
const group = (key: string, rows: Row[], sub?: Group[]): Group => ({
  key,
  rows,
  summaries: {},
  ...(sub ? { sub } : {}),
})

describe('orderAfter and indexWithout', () => {
  it('lands a card carried down its own column where it was let go', () => {
    // A between B and C: the slot under the pointer is 2 counting A's own.
    const ids = ['A', 'B', 'C']
    expect(orderAfter(ids, 'A', indexWithout(2, 0))).toEqual(['B', 'A', 'C'])
    expect(orderAfter(ids, 'A', indexWithout(3, 0))).toEqual(['B', 'C', 'A'])
  })

  it('leaves a card carried up, or in from elsewhere, where it was let go', () => {
    expect(orderAfter(['A', 'B', 'C'], 'C', indexWithout(1, 2))).toEqual(['A', 'C', 'B'])
    expect(orderAfter(['A', 'B'], 'X', indexWithout(1, -1))).toEqual(['A', 'X', 'B'])
  })
})

describe('mergedOrder', () => {
  it('keeps the other lanes where they were', () => {
    // Lane one holds A and C, lane two B and D; lane one turned round.
    expect(mergedOrder(['A', 'B', 'C', 'D'], ['C', 'A'])).toEqual(['C', 'B', 'A', 'D'])
  })

  it('takes in a card new to the column beside its lane neighbour', () => {
    expect(mergedOrder(['A', 'B', 'C'], ['A', 'X', 'C'])).toEqual(['A', 'X', 'B', 'C'])
    expect(mergedOrder(['A', 'B'], ['X', 'B'])).toEqual(['A', 'X', 'B'])
    expect(mergedOrder(['A'], ['X'])).toEqual(['A', 'X'])
  })

  it('takes a card from another lane of the column into this one', () => {
    // B was in lane two and is put first in lane one (A, C).
    expect(mergedOrder(['A', 'B', 'C'], ['B', 'A', 'C'])).toEqual(['B', 'A', 'C'])
  })
})

describe('withPending', () => {
  const [a, b, c, d] = [row('A'), row('B'), row('C'), row('D')]
  const moving = (extra: Partial<Pending>): Pending => ({
    card: cardKey(a),
    row: a,
    from: 'todo',
    to: 'done',
    key: 'done',
    index: 0,
    ...extra,
  })

  it('moves a card between columns', () => {
    const out = withPending([group('todo', [a, b]), group('done', [c])], [moving({ index: 1 })])
    expect(names(out[0]?.rows ?? [])).toEqual(['B'])
    expect(names(out[1]?.rows ?? [])).toEqual(['C', 'A'])
  })

  it('moves a card into its lane of the other column, and the column with it', () => {
    const groups = [
      group('todo', [a, b], [group('one', [a]), group('two', [b])]),
      group('done', [c, d], [group('one', [c]), group('two', [d])]),
    ]
    const out = withPending(groups, [moving({ fromLane: 'one', lane: 'two', index: 0 })])
    expect(names(out[0]?.rows ?? [])).toEqual(['B'])
    expect(out[0]?.sub?.map((lane) => names(lane.rows))).toEqual([[], ['B']])
    expect(names(out[1]?.rows ?? [])).toEqual(['C', 'A', 'D'])
    expect(out[1]?.sub?.map((lane) => names(lane.rows))).toEqual([['C'], ['A', 'D']])
  })

  it('moves a card to another lane of its own column', () => {
    const groups = [group('todo', [a, b], [group('one', [a]), group('two', [b])])]
    const out = withPending(groups, [
      moving({ to: 'todo', key: 'todo', fromLane: 'one', lane: 'two', index: 1 }),
    ])
    expect(names(out[0]?.rows ?? [])).toEqual(['B', 'A'])
    expect(out[0]?.sub?.map((lane) => names(lane.rows))).toEqual([[], ['B', 'A']])
  })

  it('opens a lane a column had no card in', () => {
    const groups = [
      group('todo', [a], [group('one', [a])]),
      group('done', [c], [group('one', [c])]),
    ]
    const out = withPending(groups, [moving({ fromLane: 'one', lane: 'two', index: 0 })])
    expect(out[1]?.sub?.map((lane) => [lane.key, names(lane.rows)])).toEqual([
      ['one', ['C']],
      ['two', ['A']],
    ])
    expect(names(out[1]?.rows ?? [])).toEqual(['C', 'A'])
  })
})

describe('withOrder', () => {
  it('draws a column and its lanes in an order not read back yet', () => {
    const [a, b, c] = [row('A'), row('B'), row('C')]
    const groups = [group('todo', [a, b, c], [group('one', [a, c]), group('two', [b])])]
    const out = withOrder(groups, 'todo', [c, b, a].map(orderId), orderId)
    expect(names(out[0]?.rows ?? [])).toEqual(['C', 'B', 'A'])
    expect(out[0]?.sub?.map((lane) => names(lane.rows))).toEqual([['C', 'A'], ['B']])
  })
})

describe('nextCard and nextLaned', () => {
  it('walks a column and across to the same height', () => {
    expect(nextCard([3, 1], { column: 0, index: 2 }, 'ArrowRight')).toEqual({
      column: 1,
      index: 0,
    })
    expect(nextCard([3, 0], { column: 0, index: 2 }, 'ArrowRight')).toEqual({
      column: 1,
      index: 0,
    })
    expect(nextCard([3], { column: 0, index: 2 }, 'ArrowDown')).toBeNull()
  })

  it('goes on to the next lane with cards in the column', () => {
    // Three lanes of two columns: the middle lane has none in the first column.
    const counts = [
      [2, 1],
      [0, 3],
      [1, 0],
    ]
    expect(nextLaned(counts, { lane: 0, column: 0, index: 1 }, 'ArrowDown')).toEqual({
      lane: 2,
      column: 0,
      index: 0,
    })
    expect(nextLaned(counts, { lane: 2, column: 0, index: 0 }, 'ArrowUp')).toEqual({
      lane: 0,
      column: 0,
      index: 1,
    })
    expect(nextLaned(counts, { lane: 2, column: 0, index: 0 }, 'ArrowDown')).toBeNull()
    expect(nextLaned(counts, { lane: 0, column: 1, index: 0 }, 'ArrowLeft')).toEqual({
      lane: 0,
      column: 0,
      index: 0,
    })
    expect(nextLaned(counts, { lane: 1, column: 1, index: 2 }, 'ArrowLeft')).toEqual({
      lane: 1,
      column: 0,
      index: 0,
    })
  })
})
