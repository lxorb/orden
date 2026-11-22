import { afterEach, describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'

vi.mock('../../surfaces/src/api', () => ({ showFeedback: () => undefined }))
const { viewport } = await import('../../ui-kit/src/viewport.svelte')
const SidebarFoot = (await import('./SidebarFoot.svelte')).default
await (await import('../../../../test/sidebar-parts')).registerSidebarParts()
function drawn(device: typeof viewport.device) {
  viewport.device = device
  return render(SidebarFoot).body
}
afterEach(() => {
  viewport.device = 'desktop'
})
describe('the foot of the sidebar', () => {
  test('holds Send feedback on every device', () => {
    for (const device of ['desktop', 'phone', 'tablet'] as const) {
      expect(drawn(device), device).toContain('aria-label="Send feedback"')
    }
  })
  test('in a desktop browser offers no app to download (#2462), and leaves the themes to the account menu (#2063)', () => {
    const html = drawn('desktop')
    expect(html).not.toContain('Download the app')
    expect(html).not.toContain('aria-label="Themes"')
    expect(html).not.toMatch(/aria-label="(Light|Dark)"/)
  })
  for (const device of ['phone', 'tablet'] as const) {
    test(`on a ${device} has neither, and keeps feedback and the settings`, () => {
      const html = drawn(device)
      expect(html).not.toContain('Download the app')
      expect(html).not.toContain('aria-label="Themes"')
      expect(html).toContain('aria-label="Send feedback"')
      expect(html).toContain('aria-label="Settings"')
    })
    test(`on a ${device} offers the scratchpad beside the settings`, () => {
      const html = drawn(device)
      expect(html).toContain('aria-label="Scratchpad"')
      expect(html.indexOf('aria-label="Scratchpad"')).toBeLessThan(html.indexOf('aria-label="Settings"'))
    })
  }
  test('and on a desktop leaves the scratchpad to the right side (#1032)', () => {
    expect(drawn('desktop')).not.toContain('aria-label="Scratchpad"')
  })
})
