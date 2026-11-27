import { registered, settingFieldsIn } from '@orden/contracts'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({ desktop: true, opened: [] as [string, string][] }))
vi.mock('../../platform/src/api', () => ({
  get isDesktop() {
    return world.desktop
  },
}))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    openReadOnly: (name: string, text: string) => {
      world.opened.push([name, text])
      return {}
    },
  },
}))
await import('./licences')
await registered()
beforeEach(() => {
  world.desktop = true
  world.opened = []
})
describe('the open source licences row', () => {
  test('sits under Version in the desktop app and opens the licences read-only, with OpenCode and Bun as headings', async () => {
    const [row, ...more] = settingFieldsIn('general', 'Updates')
    expect(more).toEqual([])
    if (row?.kind !== 'value') throw new Error('not a value row')
    expect(row.label).toBe('Open source licences')
    row.press()
    await vi.waitFor(() => expect(world.opened).toHaveLength(1))
    const [[name, text]] = world.opened as [[string, string]]
    expect(name).toBe('Open source licences')
    expect(text).toMatch(/^# OpenCode \d+\.\d+\.\d+$/m)
    expect(text).toMatch(/^# Bun \d+\.\d+\.\d+, /m)
  })
  test('is not on the web, which uses no OpenCode', () => {
    world.desktop = false
    expect(settingFieldsIn('general', 'Updates')).toEqual([])
  })
})
