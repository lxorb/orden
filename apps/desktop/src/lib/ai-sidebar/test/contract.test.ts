import { describe, expect, test } from 'vitest'

describe('the AI sidebar', () => {
  test('is three doors, so loading the api draws no panel', async () => {
    expect(Object.keys(await import('../src/api')).sort()).toEqual([
      'aiPane',
      'loadChatPanel',
      'loadQuickQuestion',
    ])
  })
})
