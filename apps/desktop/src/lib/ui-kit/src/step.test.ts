import { expect, test } from 'vitest'
import { stepped } from './step'

test.each([
  ['ArrowDown', 0, 4, false, 1],
  ['ArrowUp', 2, 4, false, 1],
  ['Home', 2, 4, false, 0],
  ['End', 1, 4, false, 3],
  ['ArrowDown', 3, 4, false, 3],
  ['ArrowUp', 0, 4, false, 0],
  ['ArrowDown', 3, 4, true, 0],
  ['ArrowUp', 0, 4, true, 3],
  ['ArrowDown', null, 4, false, 0],
  ['ArrowUp', null, 4, false, 3],
  ['Home', null, 4, false, 0],
  ['End', null, 4, false, 3],
  ['Enter', 1, 4, false, null],
  ['a', 1, 4, false, null],
  ['ArrowRight', 1, 4, false, null],
  ['PageDown', 1, 4, false, null],
  ['ArrowDown', null, 0, false, null],
  ['End', null, 0, false, null],
  ['ArrowDown', 0, 1, true, 0],
  ['ArrowUp', 0, 1, true, 0],
])(
  '%s from %s of %i (wrapping: %s) walks to %s: steps, ends, stops or wraps, and leaves other keys alone',
  (key, from, count, wraps, to) => {
    expect(stepped(key, from, count, wraps)).toBe(to)
  },
)
