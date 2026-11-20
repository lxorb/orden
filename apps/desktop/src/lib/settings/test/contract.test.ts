import { describe, expect, test, vi } from 'vitest'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
const desk = vi.hoisted(() => ({
  spaces: [{ id: 's1', name: 'Plans', root: '/s/Plans' }],
  settingsShown: false,
  settingsTab: null,
  openSettings: () => undefined,
  closeSettings: () => undefined,
}))
vi.mock('../../workspace/src/api', () => ({ workspace: desk }))
const { settings, settingSchema } = await import('../src/api')
describe('the space it is about', () => {
  test('is held by the space, so a rename that moves its folder leaves it on the same space', () => {
    settings.show('space', '/s/Plans')
    expect(settings.space).toBe('/s/Plans')
    desk.spaces = [{ id: 's1', name: 'Ideas', root: '/s/Ideas' }]
    expect(settings.space).toBe('/s/Ideas')
    desk.spaces = []
    expect(settings.space).toBeNull()
  })
  test('is the folder it was given when no space is there, and nothing when none was given', () => {
    settings.show('space', '/s/Elsewhere')
    expect(settings.space).toBe('/s/Elsewhere')
    settings.show('general')
    expect(settings.space).toBeNull()
  })
})
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
