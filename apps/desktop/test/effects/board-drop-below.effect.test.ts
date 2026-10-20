/** A card let go in the empty space under a board's column, which takes it.
 *
 *  A board's columns are only as tall as their cards, the way Notion's are, so under
 *  a short column there is nothing but the board. A card let go there went back where
 *  it was; in Notion, and on Orden's board before its columns shrank, the whole lane
 *  of a column takes the card. The column marks itself `data-drop-below` and the drag
 *  looks for one straight above the point, in the box the point is on. */

import type { Row } from '@nib/bases'
import { afterEach, expect, test } from 'vitest'
import { draggable, droppable, type Point } from '../../src/lib/views/drag.svelte'

const ROW = { kind: 'task' } as Row

afterEach(() => {
  document.body.replaceChildren()
})

/** A board of one column 272 wide and 100 tall at its top left, and a card to carry. */
function board() {
  const board = document.createElement('div')
  const column = document.createElement('div')
  column.dataset.dropBelow = ''
  column.getBoundingClientRect = () => new DOMRect(0, 0, 272, 100)
  const card = document.createElement('div')
  board.append(column)
  document.body.append(board, card)
  const taken: Point[] = []
  droppable(column, (_row, at) => taken.push(at))
  draggable(card, { row: ROW, label: 'Water the plants' })
  // jsdom lays nothing out: under every point is the board itself.
  document.elementFromPoint = () => board
  return { card, column, taken }
}

/** A press on the card, carried to a point and let go there. */
function carry(card: HTMLElement, x: number, y: number) {
  const at = { clientX: x, clientY: y, bubbles: true, pointerType: 'mouse' }
  card.dispatchEvent(new PointerEvent('pointerdown', { ...at, clientX: 400, clientY: 10 }))
  window.dispatchEvent(new PointerEvent('pointermove', { ...at, cancelable: true }))
  window.dispatchEvent(new PointerEvent('pointerup', at))
}

test('the space under a column takes a card let go there', () => {
  const { card, taken } = board()
  carry(card, 60, 220)
  expect(taken).toEqual([{ x: 60, y: 220 }])
})

test('and lights the column while the card is over it', () => {
  const { card, column } = board()
  card.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, clientY: 10 }))
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 220 }))
  expect(column.classList.contains('is-taking')).toBe(true)
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: 60, clientY: 220 }))
})

test('the space beside it does not', () => {
  const { card, taken } = board()
  carry(card, 300, 220)
  expect(taken).toEqual([])
})
