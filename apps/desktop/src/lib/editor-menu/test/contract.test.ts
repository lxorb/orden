import { expect, test } from 'vitest'

test('the editor menu is shown by one call, and the api hands over nothing else', async () => {
  expect(Object.keys(await import('../src/api'))).toEqual(['showEditorMenu'])
})
