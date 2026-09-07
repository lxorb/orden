import { describe, expect, test } from 'vitest'
import type { Canvas } from './format'
import { CanvasHistory, KEPT } from './history'

/** A canvas told apart by the id of the one card on it. */
function step(id: string): Canvas {
  return { nodes: [{ id, type: 'text', x: 0, y: 0, width: 1, height: 1, text: '' }], edges: [] }
}

const at = (canvas: Canvas | null) => canvas?.nodes[0]?.id

describe('the canvas undo stack', () => {
  test('has nothing to take back to begin with', () => {
    const history = new CanvasHistory()

    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    expect(history.undo(step('a'))).toBeNull()
    expect(history.redo(step('a'))).toBeNull()
  })

  test('goes back through the steps in the order they were made', () => {
    const history = new CanvasHistory()
    history.record(step('one'))
    history.record(step('two'))

    expect(at(history.undo(step('three')))).toBe('two')
    expect(at(history.undo(step('two')))).toBe('one')
    expect(history.canUndo).toBe(false)
  })

  test('and forward again through what it took back', () => {
    const history = new CanvasHistory()
    history.record(step('one'))
    const back = history.undo(step('two'))

    expect(at(back)).toBe('one')
    expect(history.canRedo).toBe(true)
    expect(at(history.redo(step('one')))).toBe('two')
    expect(history.canRedo).toBe(false)
  })

  /** A step made after an undo is a new branch, and the one that was undone is
   *  no longer ahead of anything. */
  test('forgets what was undone as soon as something else is done', () => {
    const history = new CanvasHistory()
    history.record(step('one'))
    history.undo(step('two'))

    expect(history.canRedo).toBe(true)
    history.record(step('one'))
    expect(history.canRedo).toBe(false)
  })

  test('keeps a bounded number of steps and drops the oldest', () => {
    const history = new CanvasHistory()
    for (let index = 0; index < KEPT + 10; index++) history.record(step(`${index}`))

    let canvas = step('now')
    let count = 0
    for (;;) {
      const before = history.undo(canvas)
      if (!before) break

      canvas = before
      count++
    }

    expect(count).toBe(KEPT)
    // The oldest ten went, so the earliest step still there is the eleventh.
    expect(at(canvas)).toBe('10')
  })

  test('forgets everything when the canvas is replaced under it', () => {
    const history = new CanvasHistory()
    history.record(step('one'))
    history.undo(step('two'))
    history.clear()

    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
  })
})
