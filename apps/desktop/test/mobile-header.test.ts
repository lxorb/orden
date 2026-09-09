import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

/** Which components hold a given drawing. What says a glyph is drawn in one
 *  place: not "these two do not have it" but "nothing else does". */
function componentsWith(glyph: string): string[] {
  const found: string[] = []

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.svelte') && readFileSync(path, 'utf8').includes(glyph)) {
        found.push(path.slice(SOURCE.length).replace(/\\/g, '/'))
      }
    }
  }

  walk(SOURCE)
  return found.sort()
}

const titlebar = read('lib/Titlebar.svelte')
const sidebar = read('lib/Sidebar.svelte')
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
      ['lib/Sidebar.svelte', sidebar],
    ] as const) {
      expect(text, `${name} draws the glyph again`).not.toContain(PANEL)
      expect(text, `${name} uses the component`).toContain('<SidebarToggle />')
    }
  })

  /** One glyph and one movement, wherever it is drawn: the bar over the note and
   *  the drawer's own head show the same button in the same state. Nothing else
   *  in the app draws a sidebar button of its own. */
  test('and nothing else anywhere draws one', () => {
    const others = componentsWith(PANEL).filter((name) => name !== 'lib/SidebarToggle.svelte')
    expect(others, `these draw the sidebar glyph again: ${others.join(', ')}`).toEqual([])
  })

  /** The glyph says what the press does, and moves while it does it: the panel's
   *  edge slides out of the left of the window as the list arrives. */
  test('says which way it is, and moves between the two', () => {
    expect(toggle).toContain('aria-pressed={open}')
    expect(toggle).toMatch(/\.edge\s*\{[^}]*transition:/)
    expect(toggle).toMatch(/\.toggle:not\(\.on\)\s*\.edge\s*\{[^}]*transform:/)
  })

  /** Where the sidebar is a drawer it covers the bar the button sits in, so the
   *  drawer's own head carries the same button at the same corner of the screen -
   *  and only there, or a tablet with the sidebar docked beside the note would
   *  have two of them in one row. */
  test('is in the drawer head exactly where the sidebar is a drawer', () => {
    expect(sidebar).toContain('{#if viewport.drawer}\n      <SidebarToggle />\n    {/if}')
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
    expect(componentsWith(BARS)).toEqual(['lib/AppMenu.svelte'])

    // The bars are the desktop's, at the left end of the bar where the column of
    // spaces used to keep them; a touch screen reaches the app through the dots
    // at the other end of that same row instead.
    expect(titlebar).toContain(
      '{#if !viewport.touch}\n    <AppMenu {view} {onpalette} {onhistory} />',
    )
  })
})
