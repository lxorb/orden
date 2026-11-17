import { describe, expect, test } from 'vitest'
import { loadLinksPanel } from '../src/api'

describe('the links panel', () => {
  test('loads behind its door', async () => {
    expect(typeof (await loadLinksPanel()).default).toBe('function')
  })
})
