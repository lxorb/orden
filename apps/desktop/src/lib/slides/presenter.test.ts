import { describe, expect, test } from 'vitest'
import { leads, messageOf, type Lead } from './presenter'

const stage = {
  slide: '<h1>One</h1>',
  next: '<h1>Two</h1>',
  step: 0,
  nextStep: 1,
  shape: 'title',
  nextShape: 'prose',
  notes: '',
  at: 1,
  count: 2,
  started: 1,
  scheme: 'dark',
}

describe('the presenter channel', () => {
  test('a message names the show it belongs to', () => {
    expect(messageOf({ kind: 'stage', show: 'a', took: 3, stage })).toMatchObject({
      show: 'a',
      took: 3,
    })
    expect(messageOf({ kind: 'move', show: 'a', by: 1 })).toEqual({
      kind: 'move',
      show: 'a',
      by: 1,
    })
    expect(messageOf({ kind: 'gone', show: 'a' })).toEqual({ kind: 'gone', show: 'a' })
    expect(messageOf({ kind: 'here' })).toEqual({ kind: 'here' })
  })

  test('the stage says which of the waiting items are out, now and next', () => {
    const heard = messageOf({ kind: 'stage', show: 'a', took: 3, stage })
    expect(heard?.kind === 'stage' && [heard.stage.step, heard.stage.nextStep]).toEqual([0, 1])
    expect(
      messageOf({ kind: 'stage', show: 'a', took: 3, stage: { ...stage, step: 'x' } }),
    ).toBeNull()
  })

  test('a message that names no show is not heard', () => {
    expect(messageOf({ kind: 'stage', took: 3, stage })).toBeNull()
    expect(messageOf({ kind: 'move', by: 1 })).toBeNull()
    expect(messageOf({ kind: 'gone' })).toBeNull()
    expect(messageOf({ kind: 'stage', show: 'a', stage })).toBeNull()
  })

  test('the presenter follows the show that last asked for it, and no other', () => {
    let lead: Lead | null = null
    const hear = (show: string, took: number) => {
      if (leads(lead, show, took)) lead = { show, took }
      return lead?.show
    }

    expect(hear('a', 0)).toBe('a')
    expect(hear('b', 0)).toBe('a')
    expect(hear('b', 5)).toBe('b')
    expect(hear('a', 0)).toBe('b')
    expect(hear('a', 4)).toBe('b')
    expect(hear('b', 5)).toBe('b')
    expect(hear('a', 9)).toBe('a')
  })
})
