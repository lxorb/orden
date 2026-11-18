import { describe, expect, test } from 'vitest'

describe('the editor menu', () => {
  test('is shown by one call, and the api hands over nothing else', async () => {
    expect(Object.keys(await import('../src/api'))).toEqual(['showEditorMenu'])
  })
})
