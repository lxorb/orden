import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** What the menus offer, read out of the components that compose them.
 *
 *  A menu is a list of entries built in the component that owns the thing being
 *  asked about, so there is no function a test can call for it. What can be
 *  read is the list itself: which entries a menu is written with, and whether
 *  the gesture that opens it is there for a pointer and for a finger both. That
 *  is what this does, in the way `tab-strip.test.ts` reads the strip's widths
 *  back out of its stylesheet. */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const read = (name: string) => readFileSync(`${SOURCE}${name}`, 'utf8')

/** A function in a component's script, from its signature to the brace that
 *  closes it: every one of these sits at the top level of the script, so that
 *  brace is the first one indented by two. */
function body(text: string, signature: string): string {
  const from = text.indexOf(signature)
  expect(from, `no ${signature}`).toBeGreaterThanOrEqual(0)

  const to = text.indexOf('\n  }', from)
  expect(to, `${signature} is never closed`).toBeGreaterThan(from)

  return text.slice(from, to)
}

describe('what a space offers', () => {
  const rail = read('lib/Rail.svelte')
  const space = body(rail, 'function spaceMenu(space: Space)')

  test('the space itself: its name, its mark, who may reach it', () => {
    for (const entry of ["t('Rename')", "t('Choose an icon')", "t('Share')", "t('Publish')"]) {
      expect(space, entry).toContain(entry)
    }
  })

  /** Both are the same question about the same folder, so they are neighbours
   *  rather than one at each end of the menu. */
  test('publishing stands next to sharing', () => {
    const share = space.indexOf("t('Share')")
    const publish = space.indexOf("t('Publish')")

    expect(publish).toBeGreaterThan(share)
    // Between the two words is nothing but the start of publishing's own entry.
    expect(space.slice(share, publish).match(/label:/g) ?? []).toHaveLength(1)
  })

  test('and not what to put in it, which is the file list', () => {
    expect(space).not.toContain("t('New note')")
  })

  test('nor the folder behind it, which the rail is not about', () => {
    expect(rail).not.toContain('revealEntry')
  })

  test('a shared space still offers the way out of it', () => {
    expect(space).toContain("t('Leave space')")
  })
})

describe('what the plus in the tab strip offers', () => {
  const tabs = read('lib/Tabs.svelte')
  const entries = body(tabs, 'function newMenu()')

  /** The plus button, from its class to the tag that closes it. */
  const plus = tabs.slice(
    tabs.indexOf('class="new"'),
    tabs.indexOf('</button>', tabs.indexOf('class="new"')),
  )

  test('the two kinds a tab can hold, in the words the other menus use', () => {
    expect(entries).toContain("t('New note')")
    expect(entries).toContain("t('New canvas')")
  })

  test('a plain click still makes a note, so the menu is never in the way', () => {
    expect(plus).toContain('onclick={() => makeNote()}')
  })

  /** A right click, the menu key a keyboard has - both arrive as `contextmenu` -
   *  and a held finger, which is the right click a touch screen has. */
  test('asked for the way every other menu in the app is', () => {
    expect(plus).toContain('oncontextmenu={showNewMenu}')
    expect(plus).toContain('use:longPress={showNewMenu}')
  })
})
