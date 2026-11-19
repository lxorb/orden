import { describe, expect, test } from 'vitest'

describe('the context menu', () => {
  test('is two doors, so loading the api draws no menu', async () => {
    expect(Object.keys(await import('../src/api')).sort()).toEqual(['loadContextMenu', 'loadFieldMenu'])
  })
})
