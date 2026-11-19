import { describe, expect, test } from 'vitest'
import { settingsPartsIn } from '@orden/contracts'

await import('../src/api')
describe('the module stands on its own', () => {
  test('the access pane is a part of the AI settings, offered with its place', () => {
    const [access] = settingsPartsIn('ai')
    expect(access?.card).toBe(false)
    expect(typeof access?.load).toBe('function')
  })
})
