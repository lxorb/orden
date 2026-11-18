import { describe, expect, test } from 'vitest'
import { HOLD, LOAD, quietFor, waitFor } from '../src/pace'
import { spokenTask } from '../src/today'

describe('the pace the glasses redraw at', () => {
  test('waits the usual pause, longer after a slow layout', () => {
    expect(quietFor(700, 5)).toBe(700)
    expect(quietFor(80, 400)).toBe(400 * LOAD)
  })

  test('never puts a redraw off past the hold', () => {
    expect(waitFor(700, 1000, 1000)).toBe(700)
    expect(waitFor(700, 0, 700 * HOLD)).toBe(0)
  })
})

describe('a task said aloud', () => {
  test('loses the word that asked for it and the closing mark', () => {
    expect(spokenTask('Remember, buy milk.')).toBe('buy milk')
    expect(spokenTask('task')).toBe('')
  })
})
