import { describe, expect, test } from 'vitest'
import { dragsSelection } from './dragging'

describe('which presses hold the reveal still', () => {
  test.each([
    [0, true, 'mouse'],
    [2, false, 'mouse'],
    [0, false, 'touch'],
    [0, false, 'pen'],
  ])('%j', (input, wanted, extra) => expect(dragsSelection(input, extra)).toEqual(wanted))
})
