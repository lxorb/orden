import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** The one row along the top of the app, on a phone and a tablet: the button
 *  that opens and shuts the file list at the left, the document's name in the
 *  middle, and the palette at the right.
 *
 *  Which is a composition rather than a function, so it is read out of the
 *  components the way `reachable.test.ts` and `menus.test.ts` read theirs. What
 *  it guards: there is one sidebar button and it is drawn in one place, and no menu
 *  of the whole app is left in the bar (#304). */

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
const toggle = read('lib/SidebarToggle.svelte')

/** The window with a panel down its left side: the sidebar button's glyph. */
const PANEL = '<rect x="1" y="2.5" width="12" height="9" rx="1.5" />'

describe('the button that opens the file list', () => {
  test('is one component, drawn once', () => {
    expect(toggle).toContain(PANEL)
    expect(toggle).toContain("t('Hide left sidebar')")

    for (const [name, text] of [
      ['lib/Titlebar.svelte', titlebar],
      ['lib/Sidebar.svelte', sidebar],
    ] as const) {
      expect(text, `${name} draws the glyph again`).not.toContain(PANEL)
      expect(text, `${name} uses the component`).toContain('<SidebarToggle />')
    }
  })

  /** With no space and no tab there is nothing for the list to show - the moment before
   *  a fresh start's space is made (fresh-start.ts) - and pressed then, the button
   *  opened a list of a space that did not exist yet. So the bar does not offer it.
   *  The plus stays: a tab is how a note is written with no space yet. */
  test('is not in the bar while there is nothing to list', () => {
    expect(titlebar).toMatch(/\{#if !listless\}\s*<SidebarToggle \/>\s*\{\/if\}/)
    expect(titlebar).toContain('!workspace.spaces.length && !workspace.tabs.length')
  })

  /** One glyph and one movement, wherever it is drawn: the bar over the note and
   *  the drawer's own head show the same button in the same state. Nothing else
   *  in the app draws a sidebar button of its own. */
  test('and nothing else anywhere draws one', () => {
    const others = componentsWith(PANEL).filter((name) => name !== 'lib/SidebarToggle.svelte')
    expect(others, `these draw the sidebar glyph again: ${others.join(', ')}`).toEqual([])
  })

  /** One glyph means one drawing, and the same one in both states. It was reported
   *  as the wrong icon while the list was shut, twice: first the edge faded away,
   *  then it slid into the frame's own border, and both left a plain window where
   *  the split panel had been. So the mark does not move and does not change, and
   *  what says which state it is in is said in words.
   *
   *  `shots/shell-polish` measures the rendered shapes in both states, which is
   *  what catches the version of this that the markup alone cannot see. */
  test('says which way it is in words rather than by redrawing itself', () => {
    expect(toggle).toContain('aria-pressed={open}')
    expect(toggle).toContain("t('Hide left sidebar')")
    expect(toggle).toContain("t('Show left sidebar')")
    expect(toggle).toContain("t('Hide right sidebar')")
    expect(toggle).toContain("t('Show right sidebar')")

    const style = toggle.slice(toggle.indexOf('<style>'))
    for (const shifting of [
      /\.edge[^}]*transform:/,
      /\.edge[^}]*opacity:/,
      /\.edge[^}]*display:/,
    ]) {
      expect(style, `the edge is drawn one way: ${shifting.source}`).not.toMatch(shifting)
    }
  })

  /** Where the sidebar is a drawer it covers the bar the button sits in, so the
   *  drawer's own head carries the same button at the same corner of the screen -
   *  and only there, or a tablet with the sidebar docked beside the note would
   *  have two of them in one row.
   *
   *  Read with the whitespace squeezed out: what this is about is the condition
   *  around the button, and the head it sits in is itself inside a condition now.
   *  The right side of the window has no head at all - the space's name and its
   *  switcher belong to the side that has always carried them. */
  test('is in the drawer head exactly where the sidebar is a drawer', () => {
    const squeezed = sidebar.replace(/\s+/g, ' ')

    expect(squeezed).toContain('{#if viewport.drawer} <SidebarToggle /> {/if}')
    expect(squeezed).toContain('{#if side === \'left\'} <div class="head"')
  })
})

describe('the menu of the whole app', () => {
  /** Gone from the window (#304): what it held is the palette's, a note's dots and the
   *  strip's. A Mac keeps it in the menu bar; see native-menu-bar.svelte.ts. */
  test('is in no bar, on a desktop or on a phone', () => {
    expect(titlebar).not.toContain('AppMenu')
    expect(titlebar).not.toContain('menu.show')
    expect(componentsWith('<AppMenu ')).toEqual([])
  })
})

describe('the search button', () => {
  /** The palette, for somebody who does not know its keys, and on every bar (#304). */
  test('opens the palette, says its key on the tooltip, and is in both bars', () => {
    expect(titlebar).toContain("title={shortcuts.tooltip(t('Search'), 'app.palette')}")
    expect(titlebar).toContain('onclick={() => onpalette()}')
    expect(titlebar.match(/\{@render searchGlyph\(\)\}/g) ?? []).toHaveLength(2)
  })
})
