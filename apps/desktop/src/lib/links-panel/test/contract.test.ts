import { expect, test } from 'vitest'

test('the links panel is one door, so loading the api draws no panel', async () => {
  expect(Object.keys(await import('../src/api')).sort()).toEqual(['loadLinksPanel'])
})
