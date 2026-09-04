import { describe, expect, test } from 'vitest'
import { insertLink, toggleWrap } from '../commands'
import { runInCell } from './shortcuts'

describe('inline commands in a cell', () => {
  test('wrap a selection the way the editor does', () => {
    expect(runInCell(toggleWrap('**'), 'a word b', 2, 6)).toEqual({ text: 'a **word** b', from: 4, to: 8 })
  })

  test('unwrap what is already wrapped', () => {
    expect(runInCell(toggleWrap('**'), 'a **word** b', 4, 8)).toEqual({ text: 'a word b', from: 2, to: 6 })
  })

  test('leave the caret where the editor would', () => {
    expect(runInCell(insertLink, 'see here', 4, 8)).toEqual({ text: 'see [here]()', from: 11, to: 11 })
  })
})
