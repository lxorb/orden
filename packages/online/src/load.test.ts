import { describe, expect, it } from 'vitest'
import { usageOf } from './load'

describe('what a process uses', () => {
  it('is read with a GPU it could not read left out', () => {
    expect(usageOf({ cpu: 12.5, memory: 1024, gpu: 3 })).toEqual({
      cpu: 12.5,
      memory: 1024,
      gpu: 3,
    })
    expect(usageOf({ cpu: 12.5, memory: 1024 })).toEqual({ cpu: 12.5, memory: 1024 })
    expect(usageOf({ cpu: 12.5, memory: 1024, gpu: Number.NaN })).toEqual({ cpu: 12.5, memory: 1024 })
  })
  it('is nothing when the processor or the memory is missing or not an amount', () => {
    expect(usageOf({ cpu: -1, memory: 1024 })).toBeNull()
    expect(usageOf({ cpu: 1, memory: Number.POSITIVE_INFINITY })).toBeNull()
    expect(usageOf({ memory: 1024 })).toBeNull()
    expect(usageOf([1, 2])).toBeNull()
    expect(usageOf(null)).toBeNull()
  })
})
