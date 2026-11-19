import { describe, expect, test } from 'vitest'
import { quickAdd } from '../src/api'

describe('asking for quick add', () => {
  test('is shown with what it was handed and hidden again', () => {
    quickAdd.show({ text: 'Call the bank', tags: ['errand'] })
    expect(quickAdd.open).toBe(true)
    expect(quickAdd.prefill).toEqual({ text: 'Call the bank', tags: ['errand'] })
    quickAdd.hide()
    expect(quickAdd.open).toBe(false)
  })
  test('is shown empty when handed nothing', () => {
    quickAdd.show()
    expect(quickAdd.prefill).toEqual({})
    quickAdd.hide()
  })
  test('keeps the smart reading and the shortcut from anywhere as they were set', () => {
    quickAdd.setSmart(false)
    quickAdd.setAnywhere(false)
    expect([quickAdd.smart, quickAdd.anywhere]).toEqual([false, false])
    quickAdd.setSmart(true)
    quickAdd.setAnywhere(true)
    expect([quickAdd.smart, quickAdd.anywhere]).toEqual([true, true])
  })
})
