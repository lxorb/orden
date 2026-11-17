import { afterEach, describe, expect, test } from 'vitest'
import { wholeRows } from './whole-rows'

const BOTTOMS = [27, 55, 83, 106, 134, 162, 190]
const TOP = 100

function list(scale: number, room: number): HTMLElement {
  const list = document.createElement('ul')
  list.style.paddingBottom = '4px'
  for (const bottom of BOTTOMS) {
    const row = document.createElement('li')
    row.getBoundingClientRect = () => new DOMRect(0, TOP, 300, bottom * scale)
    list.append(row)
  }
  Object.defineProperty(list, 'clientHeight', { get: () => room })
  Object.defineProperty(list, 'offsetHeight', { get: () => room })
  Object.defineProperty(list, 'scrollHeight', { get: () => BOTTOMS.at(-1)! + 4 })
  list.getBoundingClientRect = () => new DOMRect(0, TOP, 300, room * scale)
  document.body.append(list)
  return list
}

afterEach(() => document.body.replaceChildren())

describe('a list cut between two rows', () => {
  test('is cut where it would be at its full size while its layer still grows into place', () => {
    const still = list(1, 188)
    wholeRows(still).destroy()
    expect(still.style.maxHeight).toBe('166px')

    const growing = list(0.97, 188)
    wholeRows(growing).destroy()
    expect(growing.style.maxHeight).toBe('166px')
  })
})
