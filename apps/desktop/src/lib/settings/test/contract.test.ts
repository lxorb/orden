import { describe, expect, test, vi } from 'vitest'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
const { settingSchema } = await import('../src/api')
describe('the schema it hands out', () => {
  test('describes a switch as a boolean with its default, and refuses a value of another type', async () => {
    const { refusal, schemaOf } = await settingSchema()
    const schema = schemaOf([
      {
        kind: 'switch',
        key: 'editor.wrap',
        label: 'Wrap',
        hint: 'Wraps long lines',
        initial: true,
        get: () => true,
        set: () => undefined,
      },
    ])
    expect(schema).toEqual({ 'editor.wrap': { type: 'boolean', default: true, description: 'Wraps long lines' } })
    const wrap = { type: 'boolean', description: 'Wraps long lines' } as const
    expect(refusal(wrap, 'yes')).toBe('should be a boolean')
    expect(refusal(wrap, false)).toBeNull()
  })
})
