import { describe, expect, test, vi } from 'vitest'

const { updates } = await import('../../updates/src/api')
const { isDesktop } = await import('../../platform/src/api')
const { appCommands } = await import('./api')
describe("What's new in the palette", () => {
  test('opens the popup of what changed since last time, and is found by changelog', () => {
    const shown = vi.spyOn(updates, 'showNews').mockResolvedValue()
    const row = appCommands().find((one) => one.id === 'whats-new')
    expect(row).toMatchObject({ label: "What's new", also: ['changelog', 'release notes'] })
    row?.run()
    expect(shown).toHaveBeenCalledOnce()
    shown.mockRestore()
  })
  test('is offered whether or not this is the desktop app', () => {
    expect(isDesktop).toBe(false)
    expect(appCommands().some((one) => one.id === 'whats-new' && one.disabled !== true)).toBe(true)
  })
})
