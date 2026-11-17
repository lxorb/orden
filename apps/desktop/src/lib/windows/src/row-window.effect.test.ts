import { expect, test } from 'vitest'
import { measuredRow } from './row-window.svelte'

function sized(element: HTMLElement, height: number) {
  element.getBoundingClientRect = () => ({ height }) as DOMRect
  return element
}

function list(...children: HTMLElement[]) {
  const ul = document.createElement('ul')
  ul.append(...children)
  return ul
}

function li(height: number, row?: number) {
  const one = sized(document.createElement('li'), height)
  if (row !== undefined) one.dataset.row = String(row)
  return one
}

test('a row is measured on the first drawn row, never on the gap above it', () => {
  expect(measuredRow(list(li(0), li(46, 0), li(46, 1), li(0)), 40)).toBe(46)
  expect(measuredRow(list(li(2300), li(46, 50), li(46, 51), li(900)), 40)).toBe(46)
})

test('with no row drawn the least height stands', () => {
  expect(measuredRow(list(li(0), li(0)), 40)).toBe(40)
  expect(measuredRow(list(li(500), li(0, 3)), 40)).toBe(40)
})

test('a row pinned away from the window is not the one measured', () => {
  const away = li(46, 900)
  away.classList.add('away')
  expect(measuredRow(list(away, li(0), li(52, 0)), 40)).toBe(52)
})
