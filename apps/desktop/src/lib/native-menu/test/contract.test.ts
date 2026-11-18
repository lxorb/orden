import { describe, expect, test } from 'vitest'

describe('the native menu', () => {
  test('is the menu bar’s door and the rows it is built from', async () => {
    expect(Object.keys(await import('../src/api')).sort()).toEqual(['appMenuRows', 'loadMenuBar'])
  })
})
