import { afterEach, describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'

vi.mock('./surfaces.svelte', () => ({ showFeedback: () => undefined }))

const { viewport } = await import('./viewport.svelte')
const SidebarFoot = (await import('./SidebarFoot.svelte')).default

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

  test('in a desktop browser offers the app to download and the themes, not a light and dark switch', () => {
    const html = drawn('desktop')
    expect(html).toContain('aria-label="Download the app"')
    expect(html).toContain('aria-label="Themes"')
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
      expect(html.indexOf('aria-label="Scratchpad"')).toBeLessThan(
        html.indexOf('aria-label="Settings"'),
      )
    })
  }

  test('and on a desktop leaves the scratchpad to the right side (#1032)', () => {
    expect(drawn('desktop')).not.toContain('aria-label="Scratchpad"')
  })
})
