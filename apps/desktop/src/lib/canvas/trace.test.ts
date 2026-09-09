import { describe, expect, test } from 'vitest'
import { Trace } from './trace'

/** The record kept for the one thing about this app nobody here can test by hand: a
 *  stylus, whose button the browser reports three different ways. It has to be cheap
 *  enough to leave on during a stroke, so it writes down what could say something new
 *  and nothing else. */

const one = (over: Partial<Parameters<Trace['note']>[0]> = {}) => ({
  what: 'move',
  kind: 'pen',
  button: -1,
  buttons: 1,
  id: 1,
  ...over,
})

describe('the pointer record', () => {
  test('writes down a press, a lift and a cancel', () => {
    const trace = new Trace()
    expect(trace.note(one({ what: 'down', button: 0, buttons: 1 }))).toBe(true)
    expect(trace.note(one({ what: 'up', button: 0, buttons: 0 }))).toBe(true)
    expect(trace.note(one({ what: 'cancel', button: -1, buttons: 0 }))).toBe(true)
    expect(trace.line).toBe('down/pen b0 B1 | up/pen b0 B0 | cancel/pen b-1 B0')
  })

  /** A stroke is thousands of moves and all but a handful of them say the same thing,
   *  so a fast line writes nothing at all. */
  test('says nothing for a move that changed nothing', () => {
    const trace = new Trace()
    trace.note(one({ what: 'down', button: 0, buttons: 1 }))
    expect(trace.note(one())).toBe(false)
    expect(trace.note(one())).toBe(false)
    expect(trace.line).toBe('down/pen b0 B1')
  })

  /** The one move worth keeping: the barrel button arriving halfway through a line,
   *  which is exactly the report that could not be reproduced on a desktop. */
  test('writes down the move where the button arrived', () => {
    const trace = new Trace()
    trace.note(one({ what: 'down', button: 0, buttons: 1 }))
    expect(trace.note(one({ buttons: 33 }))).toBe(true)
    expect(trace.line).toBe('down/pen b0 B1 | move/pen b-1 B33')
  })

  test('keeps two contacts apart', () => {
    const trace = new Trace()
    trace.note(one({ what: 'down', id: 1, buttons: 1 }))
    trace.note(one({ what: 'down', id: 2, buttons: 1 }))
    expect(trace.note(one({ id: 1 }))).toBe(false)
    expect(trace.note(one({ id: 2, buttons: 3 }))).toBe(true)
  })

  test('holds the gesture that just happened rather than the afternoon', () => {
    const trace = new Trace()
    for (let at = 0; at < 40; at++) trace.note(one({ what: 'down', id: at, buttons: at }))

    expect(trace.line.split(' | ')).toHaveLength(8)
  })
})
