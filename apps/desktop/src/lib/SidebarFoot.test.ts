import { afterEach, describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'

/** The row at the bottom of the sidebar, rendered on the server as Sidebar.test
 *  renders the sidebar: what is under test is which buttons it holds. A phone or a
 *  tablet has no download (it is where the app is had) and no theme switch (light
 *  and dark are in Settings); a desktop browser keeps both. */

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
  test('in a desktop browser offers the app to download and the theme switch', () => {
    const html = drawn('desktop')
    expect(html).toContain('aria-label="Download the app"')
    expect(html).toMatch(/aria-label="(Light|Dark)"/)
  })

  for (const device of ['phone', 'tablet'] as const) {
    test(`on a ${device} has neither, and keeps feedback and the settings`, () => {
      const html = drawn(device)
      expect(html).not.toContain('Download the app')
      expect(html).not.toMatch(/aria-label="(Light|Dark)"/)
      expect(html).toContain('aria-label="Send feedback"')
      expect(html).toContain('aria-label="Settings"')
    })
  }
})
