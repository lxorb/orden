import { describe, expect, test } from 'vitest'

describe('the links panel', () => {
  test('is one door, so loading the api draws no panel', async () => {
    expect(Object.keys(await import('../src/api')).sort()).toEqual(['loadLinksPanel'])
  })
})
