import { afterEach, describe, expect, test } from 'vitest'
import { render } from 'svelte/server'

/** The row at the bottom of the sidebar, rendered on the server as Sidebar.test
 *  renders the sidebar: what is under test is which buttons it holds. A phone or a
 *  tablet has no download (it is where the app is had) and no theme switch (light
 *  and dark are in Settings); a desktop browser keeps both. Send feedback is on none of
 *  them: it is the palette's, there as it opens (#1049). */

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
  test('holds no Send feedback on any device: the palette does (#1049)', () => {
    for (const device of ['desktop', 'phone', 'tablet'] as const) {
      expect(drawn(device), device).not.toContain('Send feedback')
    }
  })

  test('in a desktop browser offers the app to download and the theme switch', () => {
    const html = drawn('desktop')
    expect(html).toContain('aria-label="Download the app"')
    expect(html).toMatch(/aria-label="(Light|Dark)"/)
  })

  for (const device of ['phone', 'tablet'] as const) {
    test(`on a ${device} has neither, and keeps the settings`, () => {
      const html = drawn(device)
      expect(html).not.toContain('Download the app')
      expect(html).not.toMatch(/aria-label="(Light|Dark)"/)
      expect(html).toContain('aria-label="Settings"')
    })

    /** #1030: the scratchpad is the drawer's, beside the settings, where it was a switch
     *  on every note's bar. */
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
