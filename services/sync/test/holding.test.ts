import { HOLD_GRACE } from '@orden/online/wire'
import { describe, expect, test } from 'vitest'
import { claimed, type Hold, holdOf, standing } from '../src/machines/holding'

const laptop: Hold = { device: 'laptop', who: 'u', name: 'Laptop', since: 100, left: null }
const phone = { device: 'phone', who: 'u', name: 'Phone', take: false }

describe('the lock on a session', () => {
  test('a free session goes to whoever opens it', () => {
    expect(claimed(null, phone, false, 500)).toEqual({
      hold: { device: 'phone', who: 'u', name: 'Phone', since: 500, left: null },
      granted: true,
    })
  })

  test('the holding device always holds it, and keeps its since', () => {
    const back = claimed({ ...laptop, left: 400 }, { ...phone, device: 'laptop' }, false, 500)
    expect(back).toEqual({ hold: { ...laptop, name: 'Phone' }, granted: true })
  })

  test('another device is held off while the holder is there or in its grace', () => {
    expect(claimed(laptop, phone, true, 500)).toEqual({ hold: laptop, granted: false })
    expect(claimed(laptop, phone, false, 500)).toEqual({
      hold: { ...laptop, left: 500 },
      granted: false,
    })
    const gone = { ...laptop, left: 500 }
    expect(claimed(gone, phone, false, 500 + HOLD_GRACE - 1).granted).toBe(false)
    expect(claimed(gone, phone, false, 500 + HOLD_GRACE).granted).toBe(true)
  })

  test('Take over hands it on whatever the holder is doing', () => {
    expect(claimed(laptop, { ...phone, take: true }, true, 700)).toEqual({
      hold: { device: 'phone', who: 'u', name: 'Phone', since: 700, left: null },
      granted: true,
    })
  })

  test('standing: back clears the grace, gone past it frees the session', () => {
    expect(standing(null, true, 1)).toBeNull()
    expect(standing({ ...laptop, left: 5 }, true, 9)).toEqual(laptop)
    expect(standing(laptop, false, 9)).toEqual({ ...laptop, left: 9 })
    expect(standing({ ...laptop, left: 9 }, false, 9 + HOLD_GRACE)).toBeNull()
  })

  test('reads only what is a lock', () => {
    expect(holdOf(undefined)).toBeNull()
    expect(holdOf({ device: 3, since: 1 })).toBeNull()
    expect(holdOf({ device: 'd', since: 1 })).toEqual({
      device: 'd',
      who: '',
      name: '',
      since: 1,
      left: null,
    })
  })
})
