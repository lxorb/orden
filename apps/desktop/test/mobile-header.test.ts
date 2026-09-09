import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** The one row along the top of the app, on a phone and a tablet: the button
 *  that opens and shuts the file list at the left, the document's name in the
 *  middle, and the whole of the app behind three dots at the right.
 *
 *  Which is a composition rather than a function, so it is read out of the
 *  components the way `reachable.test.ts` and `menus.test.ts` read theirs. What
 *  it guards: there is one sidebar button and it is drawn in one place, the dots
 *  open the menu the desktop's own bar holds rather than a second menu written
 *  for a phone, and no three-bar hamburger is left anywhere a thumb can reach. */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const read = (name: string) => readFileSync(`${SOURCE}${name}`, 'utf8')

const titlebar = read('lib/Titlebar.svelte')
const rail = read('lib/Rail.svelte')
const appMenu = read('lib/AppMenu.svelte')
const toggle = read('lib/SidebarToggle.svelte')

/** The three bars, as the one component that still draws them writes them. */
const BARS = 'M1.5 4h13M1.5 8h13M1.5 12h13'
/** The window with a panel down its left side: the sidebar button's glyph. */
const PANEL = '<rect x="1" y="2.5" width="12" height="9" rx="1.5" />'

describe('the button that opens the file list', () => {
  test('is one component, drawn once', () => {
    expect(toggle).toContain(PANEL)
    expect(toggle).toContain("t('Hide sidebar')")

    for (const [name, text] of [
      ['lib/Titlebar.svelte', titlebar],
      ['lib/Rail.svelte', rail],
    ] as const) {
      expect(text, `${name} draws the glyph again`).not.toContain(PANEL)
      expect(text, `${name} uses the component`).toContain('<SidebarToggle />')
    }
  })

  /** The glyph says what the press does, and moves while it does it: the panel's
   *  edge slides out of the left of the window as the list arrives. */
  test('says which way it is, and moves between the two', () => {
    expect(toggle).toContain('aria-pressed={open}')
    expect(toggle).toMatch(/\.edge\s*\{[^}]*transition:/)
    expect(toggle).toMatch(/\.toggle:not\(\.on\)\s*\.edge\s*\{[^}]*transform:/)
  })

  /** Where the sidebar is a drawer it covers the bar the button sits in, so the
   *  drawer carries the same button at the same corner of the screen - and only
   *  there, or a tablet with the sidebar docked beside the note would have two. */
  test('is at the top of the rail exactly where the sidebar is a drawer', () => {
    expect(rail).toContain('{#if viewport.drawer}\n    <div class="top"><SidebarToggle /></div>')
  })
})

describe('the three dots at the other end', () => {
  test('open the menu the desktop bar holds, not a second one', () => {
    expect(titlebar).toContain('<AppMenu {view} {onpalette} {onhistory} dots />')
    // No menu of its own: the bar used to build a short list of its own here.
    expect(titlebar).not.toContain('menu.show')
  })

  test('are the same component as the desktop menu, drawn differently', () => {
    expect(appMenu).toContain('dots = false')
    expect(appMenu).toContain('class:dots')
    // One menu surface, so the groups and their submenus cannot drift apart.
    expect(appMenu.match(/role="menu"/g) ?? []).toHaveLength(1)
  })
})

describe('the hamburger', () => {
  test('is drawn in one place and is not what a phone or a tablet gets', () => {
    expect(appMenu).toContain(BARS)
    expect(titlebar).not.toContain(BARS)
    expect(rail).not.toContain(BARS)

    // The rail's menu button is the desktop's; a touch screen reaches the app
    // through the dots instead.
    expect(rail).toContain('{:else if !viewport.touch}')
  })
})
