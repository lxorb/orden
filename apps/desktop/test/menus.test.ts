import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
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

/** Every component in the app, for the rules that are about none of them in
 *  particular: what no menu anywhere may offer. */
function componentSources(): string[] {
  const out: string[] = []

  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.svelte')) out.push(readFileSync(path, 'utf8'))
    }
  }

  walk(SOURCE)
  return out
}

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

/** The same, for a function in a module rather than in a component: nothing is
 *  indented there, so the closing brace is the one at the left margin. */
function moduleBody(text: string, signature: string): string {
  const from = text.indexOf(signature)
  expect(from, `no ${signature}`).toBeGreaterThanOrEqual(0)

  const to = text.indexOf('\n}', from)
  expect(to, `${signature} is never closed`).toBeGreaterThan(from)

  return text.slice(from, to)
}

describe('what a space offers', () => {
  const space = moduleBody(read('lib/space-actions.ts'), 'export function spaceMenu(space: Space)')

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

  test('a shared space still offers the way out of it', () => {
    expect(space).toContain("t('Leave space')")
  })

  /** The column of squares this order used to be dragged in is gone, so the
   *  menu is the whole of how a space is moved - and it is the same two rows on
   *  a desktop as under a thumb. */
  test('and where it sits, as a step in each direction', () => {
    expect(space).toContain("t('Move up')")
    expect(space).toContain("t('Move down')")
  })

  /** One list of entries, reached from the row in the switcher, from a right
   *  click on it and from a held finger. */
  test('through the one menu the switcher opens, however it is asked for', () => {
    const switcher = read('lib/SpaceSwitcher.svelte')

    expect(switcher).toContain('menu.show(event, spaceMenu(space)')
    expect(switcher).toContain('oncontextmenu={(event) => about(event, space)}')
    expect(switcher).toContain('use:longPress={(event) => about(event, space)}')
  })
})

/** The folder behind a note is not something a menu talks about.
 *
 *  Nib is a notes app, not a file manager: the path a note is written at is how
 *  the app finds it, not something the reader is asked to hold. Both rows -
 *  "Reveal in Explorer" and "Copy path" - are gone from every menu and from the
 *  palette, and this is what says so if one comes back. What still reaches the
 *  file manager is an export the reader asked for and the app's own folders,
 *  which are commands about a file somebody just made rather than a row on every
 *  note; see export/save.ts and commands.ts. */
describe('the path a note sits at', () => {
  const everywhere = [
    ...componentSources(),
    read('lib/menu.svelte.ts'),
    read('lib/commands.ts'),
    read('lib/app-menu.ts'),
  ].join('\n')

  test('is not a row in any menu, on any device', () => {
    expect(everywhere).not.toContain("t('Reveal in Explorer')")
    expect(everywhere).not.toContain("t('Copy path')")
    expect(everywhere).not.toContain('revealEntry')
    expect(everywhere).not.toContain('copyPathEntry')
  })
})

/** What a row in the file list offers about the thing it stands for. A note's icon
 *  is written in its front matter, a canvas's under its `nib` key and a folder's in
 *  the space's own map, so the entries live in menu.svelte.ts and any list that
 *  shows a row can offer them. */
describe('what a note offers', () => {
  const tree = read('lib/Tree.svelte')
  const note = body(tree, 'function noteMenu(entry: Entry)')
  const folder = body(tree, 'function folderMenu(entry: Entry)')
  const entries = moduleBody(read('lib/menu.svelte.ts'), 'export function iconEntries(')

  test('its icon, in the same words the rail uses for a space', () => {
    expect(note).toContain('iconEntries(entry.path)')
    expect(entries).toContain("t('Choose an icon')")
  })

  test('and the way back to no icon, only while it wears one', () => {
    expect(entries).toContain("t('Remove icon')")
    expect(entries).toContain('chosenIcon(path) === null')
  })

  /** The picker is the sheet the rail opens, on the row this menu stands for. */
  test('choosing opens the one picker there is', () => {
    expect(entries).toContain('iconChoice.file(path)')
    expect(entries).toContain('iconChoice.folder(path)')
  })

  /** A folder is offered the same two words, in the same place in its own menu:
   *  what differs is only where the icon is kept. */
  test('and a folder is offered the same two, since a folder can wear one too', () => {
    expect(folder).toContain('iconEntries(entry.path, true)')
  })

  /** A right click and a held finger, which is the right click a touch screen
   *  has: the icon is offered on a phone as well as on a desktop. */
  test('through the menu a pointer opens and the one a finger opens', () => {
    const row = tree.slice(tree.indexOf('class="nib-row row note"'))
    expect(row).toContain('oncontextmenu={(event) =>')
    expect(row).toContain('use:longPress={(event) =>')
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
