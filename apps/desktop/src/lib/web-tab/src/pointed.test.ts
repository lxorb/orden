import { expect, test } from 'vitest'
import { pointedAt } from './pointed'

const pane = { x: 0, y: 40, width: 800, height: 600 }
const placed = (tab: string) => (tab === 't1' ? pane : null)

test('a pointer at the edge of a page lands at the same edge of the window', () => {
  expect(pointedAt({ tab: 't1', x: 0, y: 0.5 }, placed)).toEqual({ clientX: 0, clientY: 340 })
  expect(pointedAt({ tab: 't1', x: 1, y: 0 }, placed)).toEqual({ clientX: 800, clientY: 40 })
})

test('a page not placed, or a share outside it, points nowhere', () => {
  expect(pointedAt({ tab: 't2', x: 0, y: 0 }, placed)).toBeNull()
  for (const said of [null, {}, { tab: 't1', x: -0.1, y: 0 }, { tab: 't1', x: 0, y: 2 }, { tab: 't1', x: '0', y: 0 }])
    expect(pointedAt(said, placed)).toBeNull()
})
