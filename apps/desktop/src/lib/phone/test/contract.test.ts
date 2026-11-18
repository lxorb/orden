import { describe, expect, test } from 'vitest'

describe('the phone shell', () => {
  test('is doors only, so loading the api draws nothing of the phone', async () => {
    expect(Object.keys(await import('../src/api')).sort()).toEqual([
      'loadPhoneTabs',
      'loadPhoneYou',
      'loadTabGrid',
      'noteMore',
      'tabSwipe',
    ])
  })
})
