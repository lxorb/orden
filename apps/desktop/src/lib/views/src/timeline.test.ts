import { describe, expect, test } from 'vitest'
import { noteValues, type Row, type Value } from '@orden/bases'
import { barOf, dragged } from './timeline'

function inZone(zone: string, run: () => void): void {
  const was = process.env.TZ
  process.env.TZ = zone
  try {
    run()
  } finally {
    if (was === undefined) delete process.env.TZ
    else process.env.TZ = was
  }
}

const row = { kind: 'note' } as unknown as Row

function barFor(written: string) {
  const value: Value = noteValues(`due: ${written}`).due ?? null
  const bar = barOf(row, { start: 'due' }, () => value)
  if (!bar) throw new Error('no bar')
  return bar
}

describe('a bar for a date written with its offset', () => {
  test('moved a day keeps the offset it was written with', () => {
    inZone('America/Los_Angeles', () => {
      expect(dragged(barFor('2026-03-10T23:00:00+09:00'), 'move', 1)).toEqual({
        due: '2026-03-11T23:00+09:00',
      })
      expect(dragged(barFor('2026-11-15T17:00:00Z'), 'end', 2)).toEqual({
        due: '2026-11-17T17:00Z',
      })
    })
  })

  test('sits on the day it falls on here, and moves the day it was written on', () => {
    inZone('America/Los_Angeles', () => {
      const bar = barFor('2026-03-10T02:00:00+09:00')
      expect(bar.start).toBe('2026-03-09')
      expect(dragged(bar, 'move', 1)).toEqual({ due: '2026-03-11T02:00+09:00' })
    })
  })
})
